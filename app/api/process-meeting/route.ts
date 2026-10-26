import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { researchCompaniesForMeeting } from "@/lib/company-research";
import { MAX_AUDIO_BYTES, normalizeAudioContentType } from "@/lib/audio-upload";
import { prepareWavForRecognition } from "@/lib/audio-processing";
import { parseLocale } from "@/lib/i18n";
import { persistProcessedMeeting } from "@/lib/persistence";
import { selectMeetingTitle } from "@/lib/meeting-title";
import { transcribeMeetingAudio } from "@/lib/providers/transcription";
import { extractConversationInsights } from "@/lib/providers/meeting-extraction";
import { rememberPerson, rememberSession, setProcessingState } from "@/lib/redis";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
import type { Contact, FollowUp, Meeting } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const contactSchema = z.object({
  id: z.string().trim().max(120).optional(),
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(160).nullable().optional(),
  role: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
}).strict();

const metadataSchema = z.object({
  meetingId: z.string().trim().max(120).optional(),
  processingId: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(20).optional(),
  source: z.enum(["upload", "agora"]).optional(),
  title: z.string().trim().max(200).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  contact: contactSchema.optional(),
});

const directRequestSchema = metadataSchema.extend({
  recordingId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(512),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().max(120),
  size: z.number().int().min(1).max(MAX_AUDIO_BYTES),
}).strict();

interface ProcessInput {
  audio: Blob;
  fileName: string;
  clientReference: string;
  processingId: string;
  locale: ReturnType<typeof parseLocale>;
  source: Meeting["source"];
  title: string;
  preferredTitle?: string;
  startAt: string;
  endAt: string;
  contactHint?: Contact;
  preUploadedRecording?: {
    recordingId: string;
    storagePath: string;
  };
  ownerId?: string;
}

class ProcessRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProcessRequestError";
  }
}

function clean(value: FormDataEntryValue | null, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asContact(raw: string): Contact | undefined {
  if (!raw) return undefined;
  try {
    const parsed = contactSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;
    return {
      id: parsed.data.id || randomUUID(),
      name: parsed.data.name,
      company: parsed.data.company ?? null,
      role: parsed.data.role ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
    };
  } catch {
    return undefined;
  }
}

function meetingTimes(startAt?: string, endAt?: string) {
  const start = startAt || new Date().toISOString();
  const end = endAt || new Date(Date.parse(start) + 30 * 60_000).toISOString();
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) {
    throw new ProcessRequestError("Meeting dates are invalid.", 400);
  }
  return { startAt: start, endAt: end };
}

async function parseDirectRequest(request: Request): Promise<ProcessInput> {
  const input = directRequestSchema.parse(await request.json());
  const contentType = normalizeAudioContentType(input.fileName, input.contentType);
  if (!contentType) {
    throw new ProcessRequestError("Choose an MP3, M4A, MP4, WAV, WebM, or OGG audio file.", 415);
  }

  const client = getServerSupabase();
  if (!client) {
    throw new ProcessRequestError("Supabase Storage is not configured.", 503);
  }
  const userId = await resolveWorkspaceUserId(client);
  if (!userId) {
    throw new ProcessRequestError("No authenticated Quipus user is available.", 503);
  }

  // Atomically claim an upload that belongs to this app's owner. Matching both
  // the database ID and exact object path prevents cross-owner object access.
  const { data: claimed, error: claimError } = await client
    .from("recordings")
    .update({ status: "processing", error_message: null })
    .eq("id", input.recordingId)
    .eq("user_id", userId)
    .eq("storage_path", input.storagePath)
    .in("status", ["uploading", "failed"])
    .select("id,storage_path")
    .maybeSingle();
  if (claimError) {
    throw new ProcessRequestError(`Could not claim the recording: ${claimError.message}`, 500);
  }
  if (!claimed) {
    throw new ProcessRequestError("The recording is unavailable, already processing, or does not belong to this account.", 409);
  }

  const failClaimedRecording = async (error: ProcessRequestError): Promise<never> => {
    await client
      .from("recordings")
      .update({ status: "failed", error_message: error.message.slice(0, 1000) })
      .eq("id", input.recordingId)
      .eq("user_id", userId)
      .eq("storage_path", input.storagePath);
    throw error;
  };

  const { data: storedAudio, error: downloadError } = await client.storage
    .from("recordings")
    .download(input.storagePath);
  if (downloadError || !storedAudio) {
    return failClaimedRecording(new ProcessRequestError(`Could not read the private recording: ${downloadError?.message || "missing object"}`, 500));
  }
  if (storedAudio.size === 0) {
    return failClaimedRecording(new ProcessRequestError("The uploaded recording is empty.", 400));
  }
  if (storedAudio.size > MAX_AUDIO_BYTES) {
    return failClaimedRecording(new ProcessRequestError("The recording exceeds the 256 MB archive limit.", 413));
  }
  if (storedAudio.size !== input.size) {
    return failClaimedRecording(new ProcessRequestError("The private upload did not finish correctly. Upload the recording again.", 409));
  }

  let audio: Blob;
  try {
    audio = new Blob([await storedAudio.arrayBuffer()], { type: contentType });
  } catch {
    return failClaimedRecording(new ProcessRequestError("Could not load the private recording into the processing pipeline.", 500));
  }
  const { startAt, endAt } = meetingTimes(input.startAt, input.endAt);
  const clientReference = input.meetingId || `upload-${randomUUID()}`;
  return {
    audio,
    fileName: input.fileName,
    clientReference,
    processingId: input.processingId || clientReference,
    locale: parseLocale(input.locale),
    source: input.source || "upload",
    title: input.title || input.fileName.replace(/\.[^.]+$/u, "") || "Business conversation",
    preferredTitle: input.title,
    startAt,
    endAt,
    contactHint: input.contact ? {
      id: input.contact.id || randomUUID(),
      name: input.contact.name,
      company: input.contact.company ?? null,
      role: input.contact.role ?? null,
      email: input.contact.email ?? null,
      phone: input.contact.phone ?? null,
    } : undefined,
    preUploadedRecording: { recordingId: input.recordingId, storagePath: input.storagePath },
    ownerId: userId,
  };
}

async function parseLocalMultipartRequest(request: Request): Promise<ProcessInput> {
  // Vercel buffers Route Handler request bodies and has a much smaller request
  // limit than Quipus's 256 MB archive limit. Multipart is intentionally confined
  // to credential-free local development and tiny deterministic smoke tests.
  if (process.env.NODE_ENV === "production" || getServerSupabase()) {
    throw new ProcessRequestError("Upload audio directly to private storage before processing.", 415);
  }
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) throw new ProcessRequestError("Choose an audio recording.", 400);
  if (audio.size === 0) throw new ProcessRequestError("The recording is empty.", 400);
  if (audio.size > MAX_AUDIO_BYTES) throw new ProcessRequestError("The recording exceeds the 256 MB archive limit.", 413);
  const normalizedType = normalizeAudioContentType(audio.name, audio.type);
  if (!normalizedType) throw new ProcessRequestError(`Unsupported audio type: ${audio.type || "unknown"}`, 415);

  const clientReference = clean(form.get("meetingId"), 120) || `upload-${randomUUID()}`;
  const requestedSource = clean(form.get("source"), 20);
  const { startAt, endAt } = meetingTimes(clean(form.get("startAt"), 40) || undefined, clean(form.get("endAt"), 40) || undefined);
  return {
    audio,
    fileName: audio.name,
    clientReference,
    processingId: clean(form.get("processingId"), 120) || clientReference,
    locale: parseLocale(clean(form.get("locale"), 20)),
    source: requestedSource === "agora" ? "agora" : "upload",
    title: clean(form.get("title"), 200) || audio.name.replace(/\.[^.]+$/u, "") || "Business conversation",
    preferredTitle: clean(form.get("title"), 200) || undefined,
    startAt,
    endAt,
    contactHint: asContact(clean(form.get("contact"), 2000)),
  };
}

async function markFailed(input: ProcessInput | undefined, message: string) {
  if (input?.processingId) {
    await setProcessingState(input.ownerId || "local-development", input.processingId, { status: "failed", error: message });
  }
  if (!input?.preUploadedRecording || !input.ownerId) return;
  const client = getServerSupabase();
  if (!client) return;
  await Promise.all([
    client
      .from("recordings")
      .update({ status: "failed", error_message: message.slice(0, 1000) })
      .eq("id", input.preUploadedRecording.recordingId)
      .eq("user_id", input.ownerId)
      .eq("storage_path", input.preUploadedRecording.storagePath),
    client
      .from("meetings")
      .update({ status: "failed" })
      .eq("user_id", input.ownerId)
      .eq("client_reference", input.clientReference),
  ]);
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const readinessError = requireProductionPersistence(
    Boolean(getServerSupabase()),
    "Supabase persistence and private storage are required for production meeting processing.",
  );
  if (readinessError) return readinessError;
  let input: ProcessInput | undefined;
  try {
    const requestType = request.headers.get("content-type")?.toLowerCase() || "";
    input = requestType.includes("application/json")
      ? await parseDirectRequest(request)
      : await parseLocalMultipartRequest(request);
    const clientReference = input.clientReference;
    const processingOwner = input.ownerId || "local-development";

    let recognitionAudio = input.audio;
    await setProcessingState(processingOwner, input.processingId, { status: "processing", stage: "audio_processing", fileName: input.fileName });
    if (input.audio.type === "audio/wav") {
      const prepared = prepareWavForRecognition(new Uint8Array(await input.audio.arrayBuffer()));
      recognitionAudio = new Blob([Uint8Array.from(prepared.audio).buffer], { type: "audio/wav" });
      if (input.preUploadedRecording && input.ownerId) {
        const client = getServerSupabase();
        const { error: qualityError } = await client?.from("recordings").update({ audio_quality: prepared.quality })
          .eq("id", input.preUploadedRecording.recordingId).eq("user_id", input.ownerId) ?? { error: null };
        if (qualityError) throw new Error(`Could not save audio quality metadata: ${qualityError.message}`);
      }
    }
    await setProcessingState(processingOwner, input.processingId, { status: "processing", stage: "transcribing", fileName: input.fileName });
    const transcription = await transcribeMeetingAudio(recognitionAudio, { fileName: input.fileName });
    await setProcessingState(processingOwner, input.processingId, { status: "processing", stage: "consolidating", language: transcription.language });
    const extraction = await extractConversationInsights(transcription.segments, {
      title: input.title,
      contactHint: input.contactHint ? { name: input.contactHint.name, company: input.contactHint.company, role: input.contactHint.role, email: input.contactHint.email, phone: input.contactHint.phone } : undefined,
      outputLanguage: input.locale,
      referenceDate: input.startAt,
      timezone: "Asia/Kuala_Lumpur",
    });
    await setProcessingState(processingOwner, input.processingId, { status: "processing", stage: "researching" });
    const research = await researchCompaniesForMeeting(
      extraction.participants.map((participant) => participant.company),
    );

    const contacts: Contact[] = extraction.participants.length
      ? extraction.participants.map((item) => ({ id: randomUUID(), ...item }))
      : input.contactHint ? [input.contactHint] : [];
    const followUps: FollowUp[] = extraction.followUps.map((item) => ({ id: randomUUID(), meetingId: clientReference, contactId: contacts[0]?.id || null, ...item, status: "pending" }));
    const meeting: Meeting = {
      id: input.clientReference,
      title: selectMeetingTitle({ generatedTitle: extraction.title, preferredTitle: input.preferredTitle, startAt: input.startAt, timeZone: "Asia/Kuala_Lumpur" }),
      startAt: input.startAt,
      endAt: input.endAt,
      status: "ready",
      source: input.source,
      contacts,
      transcript: transcription.segments,
      insight: extraction.insight,
      evidence: extraction.evidence.map((item) => ({ ...item, sourceKind: "conversation" })),
      research,
      followUps,
    };

    const persistence = await persistProcessedMeeting({
      clientReference: input.clientReference,
      meeting,
      audio: input.audio,
      fileName: input.fileName,
      transcription,
      extraction,
      research,
      preUploadedRecording: input.preUploadedRecording,
    });
    if (persistence.recordingId) meeting.recordingId = persistence.recordingId;
    if (persistence.signedRecordingUrl) meeting.recordingUrl = persistence.signedRecordingUrl;
    await rememberSession(input.clientReference, { title: meeting.title, intent: extraction.insight.intent, commitments: extraction.insight.commitments, followUps: extraction.followUps });
    if (contacts[0]) await rememberPerson(contacts[0].id, { name: contacts[0].name, company: contacts[0].company, lastMeeting: meeting.startAt, wants: extraction.insight.wants, openCommitments: extraction.insight.commitments.filter((item) => item.ownerType === "user" && item.status === "open").map((item) => item.description) });
    await setProcessingState(processingOwner, input.processingId, { status: "ready", meetingId: input.clientReference, persisted: persistence.persisted });

    return NextResponse.json({
      meeting,
      persisted: persistence.persisted,
      persistence,
      providerStatus: { transcription: transcription.provider === "fallback" ? "fallback" : "live", extraction: extraction.provider === "fallback" ? "fallback" : "live", persistence: persistence.persisted ? "live" : "local" },
      warnings: [transcription.warning, extraction.warning, persistence.warning].filter(Boolean),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meeting processing failed.";
    await markFailed(input, message);
    console.error("[process-meeting]", message);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "The recording processing request is invalid.", issues: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: message },
      { status: error instanceof ProcessRequestError ? error.status : 500 },
    );
  }
}
