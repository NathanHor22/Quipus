import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_AUDIO_BYTES } from "@/lib/audio-upload";
import {
  DEVICE_AUDIO_CHUNK_BYTES,
  deviceAudioPartName,
  parseDeviceContentRange,
} from "@/lib/device-audio-chunks";
import { authenticateLantern, type AuthenticatedLantern } from "@/lib/lantern-device-auth";
import { lanternMachineSchema } from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseLanternWav } from "@/lib/wav";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_DEVICE_WAV_BYTES = MAX_AUDIO_BYTES;
const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const eventIdSchema = z.string().uuid();

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function uploadPrefix(device: AuthenticatedLantern, sessionId: string, eventId: string) {
  return `${device.userId}/.lantern-uploads/${sessionId}/${eventId}`;
}

async function removeUploadParts(client: SupabaseClient, prefix: string) {
  const { data } = await client.storage.from("recordings").list(prefix, { limit: 100 });
  const paths = (data || []).map((entry) => `${prefix}/${entry.name}`);
  if (paths.length) await client.storage.from("recordings").remove(paths);
}

async function assembleUploadParts(
  client: SupabaseClient,
  prefix: string,
  expectedBytes: number,
) {
  const { data, error } = await client.storage.from("recordings").list(prefix, {
    limit: 100,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`Could not inspect Quipus audio chunks: ${error.message}`);
  const entries = (data || [])
    .map((entry) => ({ entry, offset: Number.parseInt(entry.name.split(".", 1)[0] || "", 10) }))
    .filter(({ entry, offset }) => entry.name.endsWith(".part") && Number.isSafeInteger(offset))
    .sort((left, right) => left.offset - right.offset);
  if (!entries.length) throw new Error("Quipus audio chunks are missing.");

  const chunks: Buffer[] = [];
  let nextOffset = 0;
  for (const { entry, offset } of entries) {
    if (offset !== nextOffset) throw new Error(`Quipus audio is missing byte ${nextOffset}.`);
    const { data: part, error: downloadError } = await client.storage
      .from("recordings")
      .download(`${prefix}/${entry.name}`);
    if (downloadError || !part) {
      throw new Error(`Could not read Quipus audio chunk: ${downloadError?.message || entry.name}`);
    }
    const bytes = Buffer.from(await part.arrayBuffer());
    if (!bytes.length || nextOffset + bytes.length > expectedBytes) {
      throw new Error("Quipus audio chunk length is invalid.");
    }
    chunks.push(bytes);
    nextOffset += bytes.length;
  }
  if (nextOffset !== expectedBytes) throw new Error(`Quipus audio is missing byte ${nextOffset}.`);
  return new Uint8Array(Buffer.concat(chunks, expectedBytes));
}

async function attachAudio(
  client: SupabaseClient,
  device: AuthenticatedLantern,
  sessionId: string,
  eventId: string,
  recordingStartedAt: string,
  bytes: Uint8Array,
) {
  const wav = parseLanternWav(bytes);
  const recordingId = randomUUID();
  const recordedAt = new Date(recordingStartedAt);
  const uploadedPath = `${device.userId}/${recordedAt.getUTCFullYear()}/${String(
    recordedAt.getUTCMonth() + 1,
  ).padStart(2, "0")}/${recordingId}.wav`;
  let objectStored = false;
  let attached = false;
  try {
    // Hash the accepted complete bytes before the storage write. The worker
    // independently checks the downloaded object against this durable manifest.
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { error: uploadError } = await client.storage.from("recordings")
      .upload(uploadedPath, bytes, { contentType: "audio/wav", upsert: false });
    if (uploadError) throw new Error("Could not store the complete recording.");
    objectStored = true;
    const { data: acceptedId, error } = await client.rpc("attach_lantern_legacy_audio", {
      p_session_id: sessionId, p_user_id: device.userId, p_device_id: device.id,
      p_event_id: eventId, p_recording_id: recordingId, p_storage_path: uploadedPath,
      p_bytes: bytes.length, p_sha256: sha256, p_duration: Math.ceil(wav.durationSeconds),
    });
    if (error || typeof acceptedId !== "string") throw new Error("Could not attach the complete recording.");
    attached = acceptedId === recordingId;
    if (!attached) await client.storage.from("recordings").remove([uploadedPath]);
    return { recordingId: acceptedId, durationSeconds: wav.durationSeconds };
  } catch (cause) {
    // An RPC transport error can happen after commit. Read the ownership boundary
    // before removing an object; uncertainty must preserve the original.
    if (objectStored && !attached) {
      const { data: stored, error } = await client.from("lantern_sessions").select("recording_id")
        .eq("id", sessionId).eq("user_id", device.userId).eq("device_id", device.id).maybeSingle();
      if (!error && stored && stored.recording_id !== recordingId) {
        await client.storage.from("recordings").remove([uploadedPath]);
      }
    }
    throw cause;
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return response("Quipus service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return response("Device credential is invalid or revoked.", 403);

  try {
    const { id } = paramsSchema.parse(await context.params);
    const eventId = eventIdSchema.parse(
      request.headers.get("x-lantern-event-id") ||
        request.headers.get("x-roxanne-event-id"),
    );
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "audio/wav") {
      return response("Quipus audio must be a WAV file.", 415);
    }
    const contentRange = parseDeviceContentRange(request.headers.get("content-range"));
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > (contentRange ? DEVICE_AUDIO_CHUNK_BYTES : MAX_DEVICE_WAV_BYTES)) {
      return response("Quipus WAV payload is too large.", 413);
    }

    const { data: stored, error: lookupError } = await client
      .from("lantern_sessions")
      .select("id,machine,audio_event_id,recording_id")
      .eq("id", id)
      .eq("device_id", device.id)
      .eq("user_id", device.userId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!stored) return response("Quipus session was not found.", 404);
    if (stored.audio_event_id === eventId && stored.recording_id) {
      return NextResponse.json(
        { accepted: true, duplicate: true, complete: true, recordingId: stored.recording_id },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (stored.audio_event_id || stored.recording_id) {
      return response("Audio is already attached to this session.", 409);
    }
    const machine = lanternMachineSchema.parse(stored.machine);
    if (machine.state !== "finalising" || !machine.recordingStartedAt) {
      return response("Stop the recording before attaching its audio.", 409);
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return response("Quipus audio payload is empty.", 400);
    if (!contentRange) {
      if (bytes.length > MAX_DEVICE_WAV_BYTES) return response("Quipus WAV is too large.", 413);
      const attached = await attachAudio(
        client, device, id, eventId, machine.recordingStartedAt, bytes,
      );
      return NextResponse.json(
        { accepted: true, duplicate: false, complete: true, ...attached },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }

    if (contentRange.total > MAX_DEVICE_WAV_BYTES ||
        contentRange.length > DEVICE_AUDIO_CHUNK_BYTES ||
        contentRange.length !== bytes.length) {
      return response("Quipus audio chunk is outside the accepted range.", 413);
    }
    const prefix = uploadPrefix(device, id, eventId);
    const partPath = `${prefix}/${deviceAudioPartName(contentRange.start)}`;
    const { error: partError } = await client.storage.from("recordings").upload(partPath, bytes, {
      contentType: "audio/wav",
      upsert: true,
    });
    if (partError) throw new Error(`Could not store Quipus audio chunk: ${partError.message}`);

    if (contentRange.end + 1 < contentRange.total) {
      return NextResponse.json(
        { accepted: true, duplicate: false, complete: false, nextOffset: contentRange.end + 1 },
        { status: 202, headers: { "cache-control": "no-store" } },
      );
    }

    const assembled = await assembleUploadParts(client, prefix, contentRange.total);
    const attached = await attachAudio(
      client, device, id, eventId, machine.recordingStartedAt, assembled,
    );
    await removeUploadParts(client, prefix);
    return NextResponse.json(
      { accepted: true, duplicate: false, complete: true, ...attached },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (cause) {
    console.error("Complete recording upload failed; the SD original must be retained.");
    if (cause instanceof z.ZodError) return response("Audio request is invalid.", 400);
    const message = cause instanceof Error ? cause.message : "Quipus audio could not be saved.";
    if (message.includes("Content-Range")) return response(message, 400);
    return response("The complete recording could not be attached. Keep the SD original and retry.", 422);
  }
}
