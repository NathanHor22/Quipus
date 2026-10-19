import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const recordingIdSchema = z.string().uuid();
export const playbackSourceSchema = z.enum(["combined", "onboard", "phone"]);
export type PlaybackSource = z.infer<typeof playbackSourceSchema>;
export const PLAYBACK_URL_SECONDS = 5 * 60;

export function playbackJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function ownedAudioPath(
  path: unknown,
  ownerId: string,
  recordingId: string,
): path is string {
  if (typeof path !== "string" || path.length > 512) return false;
  const parts = path.split("/");
  if (parts.length !== 4 || parts[0].toLowerCase() !== ownerId.toLowerCase()) {
    return false;
  }
  const fileName = parts[3];
  const validFile =
    fileName.toLowerCase().startsWith(`${recordingId.toLowerCase()}.`) &&
    /\.(mp3|m4a|mp4|wav|webm|ogg)$/iu.test(fileName) &&
    fileName.split(".").length === 2;
  if (!validFile) return false;
  const datedBrowserUpload = /^\d{4}$/u.test(parts[1]) && /^(0[1-9]|1[0-2])$/u.test(parts[2]);
  const archivedDeviceUpload = parts[1] === "device" && z.string().uuid().safeParse(parts[2]).success;
  return datedBrowserUpload || archivedDeviceUpload;
}

function missingStorageObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  return (
    String(details.statusCode) === "404" ||
    String(details.status) === "404" ||
    details.code === "not_found" ||
    details.code === "NoSuchKey"
  );
}

/** Looks up the owner-scoped row and signs the original object without reading audio bytes. */
export async function recordingPlaybackResponse(
  client: SupabaseClient,
  recordingId: string,
  ownerId: string,
  now = Date.now(),
  source: PlaybackSource = "combined",
) {
  try {
    const { data: recording, error } = await client
      .from("recordings")
      .select("id,user_id,storage_path,consolidated_storage_path,created_at,audio_retention_at,audio_deleted_at")
      .eq("id", recordingId)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (error)
      return playbackJson(
        { error: "The original recording could not be loaded." },
        502,
      );
    if (
      !recording ||
      recording.id?.toLowerCase() !== recordingId.toLowerCase() ||
      recording.user_id?.toLowerCase() !== ownerId.toLowerCase() ||
      !ownedAudioPath(recording.storage_path, ownerId, recordingId)
    ) {
      return playbackJson(
        { error: "No original audio is available for this conversation." },
        404,
      );
    }

    if (recording.audio_deleted_at ||
        ((recording.audio_retention_at || recording.created_at) &&
          Date.parse(recording.audio_retention_at || recording.created_at) + 90 * 86400_000 <= now)) {
      return playbackJson({ error: "This recording has reached its audio retention limit." }, 410);
    }
    const originalPath = String(recording.storage_path);
    let playbackPath = originalPath;
    let selectedSource: PlaybackSource = "onboard";
    const availableSources: PlaybackSource[] = typeof recording.consolidated_storage_path === "string"
      ? ["combined", "onboard", "phone"] : ["onboard"];
    if (source === "phone") {
      const { data: phone, error: phoneError } = await client.from("recording_audio_sources")
        .select("id,user_id,recording_id,storage_path,committed_at,verified_at")
        .eq("recording_id", recordingId).eq("user_id", ownerId).eq("source_kind", "phone").maybeSingle();
      if (phoneError) return playbackJson({ error: "Phone audio is temporarily unavailable." }, 502);
      if (!phone || phone.user_id !== ownerId || phone.recording_id !== recordingId ||
          !phone.committed_at || !phone.verified_at || !recordingIdSchema.safeParse(phone.id).success ||
          !ownedAudioPath(phone.storage_path, ownerId, phone.id)) {
        return playbackJson({ error: "No verified phone audio is available for this conversation." }, 404);
      }
      playbackPath = phone.storage_path;
      selectedSource = "phone";
      if (!availableSources.includes("phone")) availableSources.push("phone");
    } else if (source === "combined" && typeof recording.consolidated_storage_path === "string") {
      const path = recording.consolidated_storage_path;
      const fileName = path.split("/").at(-1) || "";
      const derivativeId = fileName.endsWith(".wav") ? fileName.slice(0, -4) : "";
      if (!recordingIdSchema.safeParse(derivativeId).success || !ownedAudioPath(path, ownerId, derivativeId)) {
        return playbackJson({ error: "Combined recording metadata is invalid." }, 502);
      }
      // A reserved object must also belong to this recording, not merely the
      // same account. RLS and explicit ownership apply to both lookups.
      const { data: derivative, error: derivativeError } = await client.from("recording_audio_derivatives")
        .select("storage_path,user_id,recording_id").eq("recording_id", recordingId)
        .eq("user_id", ownerId).eq("storage_path", path).maybeSingle();
      if (derivativeError || !derivative || derivative.user_id !== ownerId ||
          derivative.recording_id !== recordingId || derivative.storage_path !== path) {
        return playbackJson({ error: "Combined recording metadata is unavailable." }, 502);
      }
      playbackPath = path;
      selectedSource = "combined";
    }
    const { data: signed, error: signingError } = await client.storage
      .from("recordings")
      .createSignedUrl(playbackPath, PLAYBACK_URL_SECONDS);
    if (missingStorageObject(signingError)) {
      return playbackJson(
        { error: "No original audio is available for this conversation." },
        404,
      );
    }
    if (signingError || !signed?.signedUrl) {
      return playbackJson(
        {
          error:
            "A private playback link could not be prepared. Please try again.",
        },
        502,
      );
    }
    return playbackJson({
      url: signed.signedUrl,
      expiresAt: new Date(now + PLAYBACK_URL_SECONDS * 1000).toISOString(),
      source: selectedSource,
      availableSources,
    });
  } catch {
    return playbackJson(
      {
        error:
          "A private playback link could not be prepared. Please try again.",
      },
      502,
    );
  }
}
