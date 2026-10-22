import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import {
  MAX_AUDIO_BYTES,
  normalizeAudioContentType,
  safeAudioExtension,
} from "@/lib/audio-upload";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().max(120),
  size: z.number().int().min(1).max(MAX_AUDIO_BYTES),
  startAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    const input = requestSchema.parse(await request.json());
    const client = getServerSupabase();
    const readinessError = requireProductionPersistence(
      Boolean(client),
      "Supabase Storage is required for production recording uploads.",
    );
    if (readinessError) return readinessError;
    if (!client) {
      return NextResponse.json(
        { error: "Supabase Storage is not configured." },
        { status: 503 },
      );
    }
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) throw new Error("No authenticated Quipus user is available.");

    const contentType = normalizeAudioContentType(input.fileName, input.contentType);
    if (!contentType) {
      return NextResponse.json({ error: "Choose an MP3, M4A, MP4, WAV, WebM, or OGG audio file." }, { status: 415 });
    }

    const recordingId = randomUUID();
    const recordedAt = new Date(input.startAt || Date.now());
    const storagePath = `${userId}/${recordedAt.getUTCFullYear()}/${String(recordedAt.getUTCMonth() + 1).padStart(2, "0")}/${recordingId}.${safeAudioExtension(input.fileName, contentType)}`;
    const { error: rowError } = await client.from("recordings").insert({
      id: recordingId,
      user_id: userId,
      storage_path: storagePath,
      status: "uploading",
    });
    if (rowError) throw new Error(`Could not create the recording: ${rowError.message}`);

    const { data: signed, error: signedError } = await client.storage
      .from("recordings")
      .createSignedUploadUrl(storagePath);
    if (signedError || !signed?.token) {
      await client
        .from("recordings")
        .delete()
        .eq("id", recordingId)
        .eq("user_id", userId)
        .eq("storage_path", storagePath);
      throw new Error(`Could not authorize the private upload: ${signedError?.message || "missing token"}`);
    }

    return NextResponse.json(
      { recordingId, storagePath, signedUrl: signed.signedUrl, token: signed.token, contentType },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Choose a supported audio file up to 256 MB.", issues: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare the recording upload." },
      { status: 500 },
    );
  }
}
