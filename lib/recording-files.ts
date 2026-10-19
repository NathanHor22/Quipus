import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { MAX_AUDIO_BYTES } from "./audio-upload";
import { readAudioBytes, writeAudioBytes } from "./audio-file-io";
import { parseCanonicalWavHeader } from "./wav";
import { audioAlignment, audioTimingSchema, consolidateWindow } from "./multi-source-audio";

export async function recordingTempDirectory() {
  const base = resolve(tmpdir());
  const directory = await mkdtemp(join(base, "quipus-audio-"));
  return {
    directory,
    path: (name: "onboard.wav" | "phone.wav" | "combined.wav" | "recognition.wav" | "verify.wav") =>
      join(directory, name),
    async cleanup() {
      const target = resolve(directory);
      if (!target.startsWith(base + sep + "quipus-audio-") || target === base)
        throw new Error("Invalid recording temporary path.");
      await rm(target, { recursive: true, force: true });
    },
  };
}

export async function downloadVerifiedRecording(options: {
  client: SupabaseClient;
  storagePath: string;
  expectedBytes: number;
  sha256: string;
  outputPath: string;
  fetchImpl?: typeof fetch;
}) {
  if (
    !Number.isSafeInteger(options.expectedBytes) ||
    options.expectedBytes < 46 ||
    options.expectedBytes > MAX_AUDIO_BYTES ||
    !/^[a-f0-9]{64}$/u.test(options.sha256)
  )
    throw new Error("Invalid recording integrity manifest.");
  const { data, error } = await options.client.storage
    .from("recordings")
    .createSignedUrl(options.storagePath, 60);
  if (error || !data?.signedUrl) throw new Error("The private recording could not be read.");
  const response = await (options.fetchImpl ?? fetch)(data.signedUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body)
    throw new Error("The complete recording could not be downloaded.");
  let bytes = 0;
  const hash = createHash("sha256");
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > options.expectedBytes)
        return callback(new Error("The recording exceeds its declared length."));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const destination = await open(options.outputPath, "wx+", 0o600);
  let valid = false;
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      guard,
      createWriteStream(options.outputPath, { fd: destination.fd, autoClose: false }),
    );
    if (bytes !== options.expectedBytes || hash.digest("hex") !== options.sha256) {
      throw new Error(
        "The complete recording failed integrity verification. Keep its SD original.",
      );
    }
    const header = Buffer.alloc(44);
    await readAudioBytes(destination, header, 44, 0);
    const metadata = parseCanonicalWavHeader(header, bytes);
    await destination.sync();
    valid = true;
    return metadata;
  } finally {
    await destination.close();
    if (!valid)
      await unlink(options.outputPath).catch(() => {
        /* Caller also cleans the private working directory. */
      });
  }
}

/** Publish a derived file under a new immutable object name, never overwrite evidence. */
export async function uploadRecordingDerivative(
  client: SupabaseClient,
  storagePath: string,
  filePath: string,
) {
  const { openAsBlob } = await import("node:fs");
  const blob = await openAsBlob(filePath, { type: "audio/wav" });
  const { error } = await client.storage.from("recordings").upload(storagePath, blob, {
    contentType: "audio/wav",
    upsert: false,
    cacheControl: "0",
  });
  if (error) throw new Error("The consolidated replay could not be saved.");
}
export function derivativeStoragePath(userId: string, sessionId: string) {
  return userId + "/device/" + sessionId + "/" + randomUUID() + ".wav";
}

/** Bounded two-track consolidation: at most one second of each input in memory. */
export async function consolidateRecordingFiles(
  primaryPath: string,
  phonePath: string,
  outputPath: string,
  rawTiming: unknown,
) {
  const timing = audioTimingSchema.parse(rawTiming);
  const alignment = audioAlignment(timing);
  const handles: import("node:fs/promises").FileHandle[] = [];
  let outputCreated = false,
    completed = false;
  try {
    const primary = await open(primaryPath, "r");
    handles.push(primary);
    const phone = await open(phonePath, "r");
    handles.push(phone);
    const output = await open(outputPath, "wx", 0o600);
    handles.push(output);
    outputCreated = true;
    const [primaryStat, phoneStat] = await Promise.all([primary.stat(), phone.stat()]);
    const header = Buffer.alloc(44);
    await readAudioBytes(primary, header, 44, 0);
    const metadata = parseCanonicalWavHeader(header, primaryStat.size);
    const phoneHeader = Buffer.alloc(44);
    await readAudioBytes(phone, phoneHeader, 44, 0);
    const alternate = parseCanonicalWavHeader(phoneHeader, phoneStat.size);
    if (timing.receivedSamples !== alternate.dataBytes / 2)
      throw new Error("Phone timing does not match the saved audio.");
    if (alignment.offsetSeconds < -5 || alignment.offsetSeconds > metadata.durationSeconds + 5)
      throw new Error("Phone audio does not overlap this meeting.");
    await writeAudioBytes(output, header, 44, 0);
    const offset = Math.round(alignment.offsetSeconds * 16000);
    const ratio = 1_000_000 / 16000 / alignment.deviceUsPerSample;
    const primarySamples = metadata.dataBytes / 2,
      phoneSamples = alternate.dataBytes / 2;
    let previousPhone = false;
    for (let start = 0; start < primarySamples; start += 16000) {
      const count = Math.min(16000, primarySamples - start);
      const first = Buffer.alloc(count * 2);
      await readAudioBytes(primary, first, first.length, 44 + start * 2);
      const phoneStart = Math.max(0, Math.floor((start - offset) * ratio));
      const phoneEnd = Math.min(phoneSamples, Math.ceil((start + count - offset) * ratio) + 1);
      const second = Buffer.alloc(Math.max(0, phoneEnd - phoneStart) * 2);
      if (second.length) {
        await readAudioBytes(phone, second, second.length, 44 + phoneStart * 2);
      }
      const sample = (index: number): number | null => {
        const frame = Math.floor((index - offset) * ratio);
        return frame < phoneStart || frame >= phoneEnd
          ? null
          : second.readInt16LE((frame - phoneStart) * 2);
      };
      const selected = consolidateWindow(
        new Int16Array(first.buffer, first.byteOffset, count),
        (index) => sample(start + index),
        previousPhone,
      );
      const result = Buffer.from(
        selected.audio.buffer,
        selected.audio.byteOffset,
        selected.audio.byteLength,
      );
      await writeAudioBytes(output, result, result.length, 44 + start * 2);
      previousPhone = selected.usePhone;
    }
    await output.sync();
    completed = true;
    return { alignment, sourceCount: 2 };
  } finally {
    await Promise.allSettled(handles.map((handle) => handle.close()));
    if (outputCreated && !completed)
      await unlink(outputPath).catch(() => {
        /* Outer private-directory cleanup remains a fallback. */
      });
  }
}

/** Idempotent publication with a durable object ledger for retention and recovery. */
export async function publishConsolidatedRecording(options: {
  client: SupabaseClient;
  userId: string;
  sessionId: string;
  recordingId: string;
  filePath: string;
  verificationPath: string;
}) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(options.filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  const sha256 = hash.digest("hex");
  const version = "source-selection-v1";
  const { error: reserveError } = await options.client.from("recording_audio_derivatives").upsert(
    {
      user_id: options.userId,
      recording_id: options.recordingId,
      version,
      sha256,
      byte_length: bytes,
      storage_path: derivativeStoragePath(options.userId, options.sessionId),
    },
    { onConflict: "recording_id,version", ignoreDuplicates: true },
  );
  if (reserveError) throw new Error("Consolidated recording could not be reserved.");
  const { data: reservation, error: readError } = await options.client
    .from("recording_audio_derivatives")
    .select("storage_path,sha256,byte_length")
    .eq("recording_id", options.recordingId)
    .eq("user_id", options.userId)
    .eq("version", version)
    .single();
  if (
    readError ||
    !reservation ||
    reservation.sha256 !== sha256 ||
    Number(reservation.byte_length) !== bytes ||
    !reservation.storage_path.startsWith(options.userId + "/device/" + options.sessionId + "/")
  ) {
    throw new Error("Consolidated recording reservation does not match this session.");
  }
  try {
    await uploadRecordingDerivative(options.client, reservation.storage_path, options.filePath);
  } catch {
    // An earlier upload may have succeeded before its response was lost. Verify
    // the complete remote object; never accept existence/size alone as success.
    await downloadVerifiedRecording({
      client: options.client,
      storagePath: reservation.storage_path,
      expectedBytes: bytes,
      sha256,
      outputPath: options.verificationPath,
    });
  }
  return reservation.storage_path as string;
}
