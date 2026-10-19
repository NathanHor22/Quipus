import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openAsBlob } from "node:fs";
import { prepareWavFileForRecognition } from "./audio-file-processing";
import {
  recordingTempDirectory,
  downloadVerifiedRecording,
  consolidateRecordingFiles,
  publishConsolidatedRecording,
} from "./recording-files";
import { conversationClock } from "./conversation-clock";
import { env } from "./env";
import { transcriptionResultSchema, type TranscriptionResult } from "./meeting-schema";
import { persistFailedHardwareMeeting, persistProcessedMeeting } from "./persistence";
import { transcribeWithOpenAI } from "./providers/openai-transcription";
import { extractConversationInsights } from "./providers/meeting-extraction";
import { setProcessingState } from "./redis";
import type { Meeting } from "./types";

class AudioExpiredError extends Error {}

/** A job owns one archived session, never the current state of its device. */
export async function processNextRecording(
  client: SupabaseClient,
  userId?: string,
  sessionId?: string,
) {
  const { data: jobs, error: claimError } = await client.rpc("claim_lantern_processing", {
    p_user_id: userId || null,
    p_session_id: sessionId || null,
  });
  if (claimError) throw new Error(claimError.message);
  const job = jobs?.[0];
  if (!job) return false;
  const { data: session, error: sessionError } = await client
    .from("lantern_sessions")
    .select("*")
    .eq("id", job.session_id)
    .eq("user_id", job.user_id)
    .single();
  if (sessionError || !session) throw new Error("Queued session is missing.");
  const reference = `hardware:${session.id}`;
  const clock = conversationClock(
    session.recording_started_at || session.started_at,
    session.conversation_timezone || env().APP_TIMEZONE,
  );
  const endAt = session.capture_ended_at || session.ended_at;
  const { data: recording } = await client
    .from("recordings")
    .select("id,storage_path,consolidated_storage_path,audio_deleted_at,audio_retention_at")
    .eq("id", session.recording_id)
    .eq("user_id", job.user_id)
    .single();
  const updateJob = async (values: Record<string, unknown>) => {
    const { data, error } = await client
      .from("lantern_processing_jobs")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("session_id", session.id)
      .eq("user_id", job.user_id)
      .eq("state", "running")
      .eq("lease_token", job.lease_token)
      .gt("lease_until", new Date().toISOString())
      .select("session_id")
      .maybeSingle();
    if (error || !data) throw new Error("The processing lease was lost.");
  };
  const stage = async (processing_stage: string, values: Record<string, unknown> = {}) => {
    await updateJob({});
    const { error } = await client
      .from("lantern_sessions")
      .update({ processing_stage, ...values })
      .eq("id", session.id)
      .eq("user_id", job.user_id);
    if (error) throw new Error(error.message);
    if (recording?.id) {
      const progress: Record<string, number> = {
        queued: 5,
        audio_processing: 18,
        transcribing: 45,
        consolidating: 72,
        researching: 82,
        saving: 90,
        ready: 100,
        failed: 100,
      };
      await setProcessingState(job.user_id, recording.id, {
        stage: processing_stage,
        progress: progress[processing_stage] ?? 0,
        sessionId: session.id,
        ...(typeof values.meeting_id === "string" ? { meetingId: values.meeting_id } : {}),
        ...(typeof values.processing_error === "string" ? { error: values.processing_error } : {}),
      });
    }
  };
  const heartbeat = setInterval(() => {
    void updateJob({ lease_until: new Date(Date.now() + 6 * 60_000).toISOString() }).catch(() =>
      console.error("Recording processing heartbeat failed; the lease will recover."),
    );
  }, 60_000);
  heartbeat.unref?.();
  let readyMeetingId: string | null = null;
  let temporary: Awaited<ReturnType<typeof recordingTempDirectory>> | undefined;
  try {
    if (
      recording?.audio_deleted_at ||
      (recording?.audio_retention_at &&
        Date.parse(recording.audio_retention_at) + 90 * 86400_000 <= Date.now())
    ) {
      throw new AudioExpiredError("The recording has reached its audio retention limit.");
    }
    if (!recording?.storage_path) throw new Error("Original WAV is unavailable.");
    // Verification precedes cached transcription and ready-meeting recovery. A queue
    // acknowledgement never grants permission to delete the only SD original.
    const { data: manifest, error: manifestError } = await client
      .from("lantern_audio_uploads")
      .select("event_id,total_bytes,sha256,verified_at,storage_path")
      .eq("session_id", session.id)
      .maybeSingle();
    if (manifestError || !manifest)
      throw new Error("The recording integrity manifest is unavailable. Keep the SD original.");
    if (
      manifest.storage_path !== recording.storage_path ||
      manifest.event_id !== session.audio_event_id
    ) {
      throw new Error("Recording integrity manifest does not match this archived session.");
    }
    temporary = await recordingTempDirectory();
    let recognitionSource = temporary.path("onboard.wav");
    if (!manifest.verified_at || !session.final_transcription) {
      await stage("audio_processing");
      await downloadVerifiedRecording({
        client,
        storagePath: recording.storage_path,
        expectedBytes: Number(manifest.total_bytes),
        sha256: String(manifest.sha256),
        outputPath: recognitionSource,
      });
      await updateJob({});
      const { data: verified, error: verifiedError } = await client
        .from("lantern_audio_uploads")
        .update({ verified_at: new Date().toISOString() })
        .eq("session_id", session.id)
        .eq("event_id", manifest.event_id)
        .eq("sha256", manifest.sha256)
        .eq("storage_path", recording.storage_path)
        .select("session_id")
        .maybeSingle();
      if (verifiedError || !verified)
        throw new Error("Could not mark the recording integrity check complete.");
    }
    if (
      Array.isArray(session.expected_audio_sources) &&
      session.expected_audio_sources.includes("phone")
    ) {
      const { data: source, error: sourceError } = await client
        .from("recording_audio_sources")
        .select("*")
        .eq("session_id", session.id)
        .eq("user_id", job.user_id)
        .eq("source_kind", "phone")
        .maybeSingle();
      if (sourceError || !source?.committed_at)
        throw new Error("The phone recording is not completely archived. Keep both local tracks.");
      if (!source.verified_at || !session.final_transcription) {
        const phonePath = temporary.path("phone.wav");
        await downloadVerifiedRecording({
          client,
          storagePath: source.storage_path,
          expectedBytes: Number(source.byte_length),
          sha256: String(source.sha256),
          outputPath: phonePath,
        });
        await updateJob({});
        const { data: marked, error: markError } = await client
          .from("recording_audio_sources")
          .update({ verified_at: new Date().toISOString(), recording_id: recording.id })
          .eq("id", source.id)
          .eq("user_id", job.user_id)
          .eq("sha256", source.sha256)
          .select("id")
          .maybeSingle();
        if (markError || !marked)
          throw new Error("Phone recording verification could not be saved.");
        if (!session.final_transcription) {
          const combinedPath = temporary.path("combined.wav");
          await consolidateRecordingFiles(
            recognitionSource,
            phonePath,
            combinedPath,
            source.timing_manifest,
          );
          if (!recording.consolidated_storage_path) {
            const playbackPath = await publishConsolidatedRecording({
              client,
              userId: job.user_id,
              sessionId: session.id,
              recordingId: recording.id,
              filePath: combinedPath,
              verificationPath: temporary.path("verify.wav"),
            });
            await updateJob({});
            const { data: linked, error: replayError } = await client
              .from("recordings")
              .update({ consolidated_storage_path: playbackPath })
              .eq("id", recording.id)
              .eq("user_id", job.user_id)
              .is("consolidated_storage_path", null)
              .select("id")
              .maybeSingle();
            if (replayError || !linked) {
              if (replayError) throw new Error("Consolidated playback could not be linked.");
            }
          }
          recognitionSource = combinedPath;
        }
      }
    }
    // Recover a lost completion response without replacing approved follow-ups.
    const { data: existing, error: existingError } = await client
      .from("meetings")
      .select("id,status")
      .eq("user_id", job.user_id)
      .eq("client_reference", reference)
      .maybeSingle();
    if (existingError) throw new Error("Could not check whether this meeting is already complete.");
    if (existing?.status === "ready") {
      readyMeetingId = existing.id;
      await stage("ready", { meeting_id: existing.id, processing_error: null });
      await updateJob({ state: "ready", lease_until: null, last_error: null });
      return true;
    }
    if (job.attempts > 3)
      throw new Error("Processing timed out repeatedly. The original recording is preserved.");
    let transcription: TranscriptionResult;
    if (session.final_transcription) {
      transcription = transcriptionResultSchema.parse(session.final_transcription);
    } else {
      const preparedPath = temporary.path("recognition.wav");
      const quality = await prepareWavFileForRecognition(recognitionSource, preparedPath);
      const { error: qualityError } = await client
        .from("recordings")
        .update({ audio_quality: quality })
        .eq("id", recording.id)
        .eq("user_id", job.user_id);
      if (qualityError)
        throw new Error(`Could not save audio quality metadata: ${qualityError.message}`);
      await stage("transcribing");
      try {
        transcription = await transcribeWithOpenAI(
          await openAsBlob(preparedPath, { type: "audio/wav" }),
          {
            fileName: `${session.id}.wav`,
            timeoutMs: 180000,
            onChunkProgress: async (completed, total) => {
              await setProcessingState(job.user_id, recording.id, {
                stage: "transcribing",
                progress: Math.round(20 + (completed / total) * 45),
                completedAudioSections: completed,
                totalAudioSections: total,
                sessionId: session.id,
              });
            },
          },
        );
      } catch (cause) {
        if (job.attempts < 3 || !session.transcript_segments?.length) throw cause;
        transcription = transcriptionResultSchema.parse({
          text: session.transcript_segments
            .map((s: { speaker: string; text: string }) => `${s.speaker}: ${s.text}`)
            .join("\n"),
          segments: session.transcript_segments,
          language: session.transcript_language || "multilingual",
          provider: "agora",
          warning:
            "Final speaker separation was unavailable; this report uses the live transcript.",
        });
      }
      await stage("consolidating", {
        final_transcription: transcription,
        transcript_segments: transcription.segments,
        transcript_language: transcription.language,
        transcript_received_at: new Date().toISOString(),
      });
    }
    if (session.final_transcription) await stage("consolidating");
    const extraction = await extractConversationInsights(transcription.segments, {
      title: "Recorded conversation",
      outputLanguage: "English",
      referenceDate: clock.startedAt,
      timezone: clock.timeZone,
      referenceLocalDateTime: clock.localDateTime,
      referenceTimeUncertain: Boolean(session.capture_time_uncertain),
    });
    await stage("saving");
    const contacts = extraction.participants.map((p) => ({ id: randomUUID(), ...p }));
    const meeting: Meeting = {
      id: reference,
      title: contacts[0]
        ? `${contacts[0].name}${contacts[0].company ? ` · ${contacts[0].company}` : ""}`
        : `Conversation · ${clock.localDate} ${clock.localTime.slice(0, 5)}`,
      startAt: clock.startedAt,
      endAt,
      status: "ready",
      source: "hardware",
      contacts,
      recordingId: recording.id,
      transcript: transcription.segments,
      insight: extraction.insight,
      evidence: extraction.evidence.map((item) => ({ ...item, sourceKind: "conversation" })),
      research: [],
      followUps: [],
    };
    const saved = await persistProcessedMeeting(
      {
        ownerUserId: job.user_id,
        clientReference: reference,
        meeting,
        transcription,
        extraction,
        research: [],
        preUploadedRecording: { recordingId: recording.id, storagePath: recording.storage_path },
      },
      { client, runtimeEnvironment: "production" },
    );
    if (!saved.meetingId) throw new Error("Could not save the meeting.");
    readyMeetingId = saved.meetingId;
    await stage("ready", { meeting_id: saved.meetingId, processing_error: null });
    await updateJob({ state: "ready", lease_until: null, last_error: null });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : "Processing failed.";
    if (!readyMeetingId) {
      // The ready write itself may have committed before its response was lost.
      // If we cannot read that boundary, leave the lease for recovery; do not
      // overwrite a possibly completed meeting with a failure placeholder.
      const { data: recovered, error: recoveryError } = await client
        .from("meetings")
        .select("id,status")
        .eq("user_id", job.user_id)
        .eq("client_reference", reference)
        .maybeSingle();
      if (recoveryError)
        throw new Error("Could not verify the saved meeting. The job will be retried.");
      if (recovered?.status === "ready") readyMeetingId = recovered.id;
    }
    if (readyMeetingId) {
      // A bookkeeping outage must never overwrite a completed meeting or its
      // approved actions. The next lease repairs the session/job association.
      await updateJob({
        state: job.attempts >= 3 ? "failed" : "queued",
        lease_until: null,
        last_error: message,
        available_at: new Date(Date.now() + 60000).toISOString(),
      });
      return true;
    }
    const failed = cause instanceof AudioExpiredError || job.attempts >= 3;
    await stage(failed ? "failed" : "queued", { processing_error: message });
    if (failed && recording?.storage_path && !(cause instanceof AudioExpiredError)) {
      const saved = await persistFailedHardwareMeeting(client, {
        ownerUserId: job.user_id,
        clientReference: reference,
        title: `Conversation · ${clock.localDate} ${clock.localTime.slice(0, 5)}`,
        startAt: clock.startedAt,
        endAt,
        recordingId: recording.id,
        storagePath: recording.storage_path,
        errorMessage: message,
      });
      await stage("failed", { meeting_id: saved.meetingId });
    }
    await updateJob({
      state: failed ? "failed" : "queued",
      lease_until: null,
      last_error: message,
      available_at: new Date(Date.now() + job.attempts * 60000).toISOString(),
    });
  } finally {
    clearInterval(heartbeat);
    await temporary?.cleanup();
  }
  return true;
}
