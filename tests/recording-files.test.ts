import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAudioBytes, writeAudioBytes } from "../lib/audio-file-io";
import {
  consolidateRecordingFiles,
  downloadVerifiedRecording,
  recordingTempDirectory,
  publishConsolidatedRecording,
} from "../lib/recording-files";
import { createCanonicalWav } from "../lib/wav";
import { consolidateAudio } from "../lib/multi-source-audio";

function wave(amplitude: number, samples = 48_000) {
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++)
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(Math.sin(i * 0.13) * amplitude)));
  return createCanonicalWav(new Uint8Array(pcm.buffer));
}
const source = {
  storage: {
    from: () => ({
      createSignedUrl: async () => ({
        data: { signedUrl: "https://storage.example/private" },
        error: null,
      }),
    }),
  },
} as unknown as SupabaseClient;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const baseTiming = {
  version: 1,
  sampleRate: 16000,
  channels: 1,
  deviceStartedUs: 1000000,
  firstPacketDeviceUs: 1032000,
  lastPacketDeviceUs: 4000000,
  firstPacketPhoneUs: 1000000,
  lastPacketPhoneUs: 3968000,
  receivedSamples: 48000,
  missingSamples: 0,
  droppedPackets: 0,
  disconnects: 0,
};

test("positioned IO completes partial reads and writes and rejects stalled files", async () => {
  const bytes = Buffer.from("complete audio");
  const output = Buffer.alloc(bytes.length),
    copied = Buffer.alloc(bytes.length);
  await readAudioBytes(
    {
      read: async (buffer, offset, length, position) => {
        const count = Math.min(3, length);
        bytes.copy(buffer, offset, position, position + count);
        return { bytesRead: count };
      },
    },
    output,
    output.length,
    0,
  );
  await writeAudioBytes(
    {
      write: async (buffer, offset, length, position) => {
        const count = Math.min(2, length);
        buffer.copy(copied, position, offset, offset + count);
        return { bytesWritten: count };
      },
    },
    output,
    output.length,
    0,
  );
  assert.deepEqual(output, bytes);
  assert.deepEqual(copied, bytes);
  await assert.rejects(
    readAudioBytes({ read: async () => ({ bytesRead: 0 }) }, output, 1, 0),
    /declared WAV length/,
  );
  await assert.rejects(
    writeAudioBytes({ write: async () => ({ bytesWritten: 0 }) }, output, 1, 0),
    /completely/,
  );
});

test("verified download preserves exact bytes and removes failed private copies", async () => {
  const temporary = await recordingTempDirectory();
  const bytes = wave(500);
  try {
    const path = temporary.path("onboard.wav");
    const metadata = await downloadVerifiedRecording({
      client: source,
      storagePath: "owner/session.wav",
      expectedBytes: bytes.length,
      sha256: digest(bytes),
      outputPath: path,
      fetchImpl: async (_url, options) => {
        assert.equal(options?.redirect, "error");
        return new Response(Uint8Array.from(bytes).buffer);
      },
    });
    assert.equal(metadata.durationSeconds, 3);
    assert.deepEqual(new Uint8Array(await readFile(path)), bytes);
    const invalid = temporary.path("phone.wav");
    await assert.rejects(
      downloadVerifiedRecording({
        client: source,
        storagePath: "owner/session.wav",
        expectedBytes: bytes.length,
        sha256: "0".repeat(64),
        outputPath: invalid,
        fetchImpl: async () => new Response(Uint8Array.from(bytes).buffer),
      }),
      /integrity verification/,
    );
    await assert.rejects(stat(invalid), /ENOENT/);
    await assert.rejects(
      downloadVerifiedRecording({
        client: source,
        storagePath: "owner/session.wav",
        expectedBytes: bytes.length,
        sha256: digest(bytes),
        outputPath: path,
        fetchImpl: async () => new Response(Uint8Array.from(bytes).buffer),
      }),
      /EEXIST/,
    );
    assert.deepEqual(new Uint8Array(await readFile(path)), bytes);
  } finally {
    await temporary.cleanup();
  }
});

for (const sample of [
  { name: "stronger phone", primary: wave(100), phone: wave(1000), timing: baseTiming },
  {
    name: "late disconnected phone",
    primary: wave(500, 56000),
    phone: wave(1000, 24000),
    timing: { ...baseTiming, receivedSamples: 24000, firstPacketDeviceUs: 1382000, disconnects: 1 },
  },
  { name: "clipped onboard", primary: wave(38000), phone: wave(1000), timing: baseTiming },
])
  test(`streaming consolidation matches in-memory source selection for ${sample.name}`, async () => {
    const temporary = await recordingTempDirectory();
    try {
      const original = temporary.path("onboard.wav"),
        phone = temporary.path("phone.wav"),
        combined = temporary.path("combined.wav");
      await writeFile(original, sample.primary);
      await writeFile(phone, sample.phone);
      await consolidateRecordingFiles(original, phone, combined, sample.timing);
      assert.deepEqual(
        new Uint8Array(await readFile(combined)),
        consolidateAudio(sample.primary, sample.phone, sample.timing).audio,
      );
      assert.deepEqual(new Uint8Array(await readFile(original)), sample.primary);
      assert.deepEqual(new Uint8Array(await readFile(phone)), sample.phone);
    } finally {
      await temporary.cleanup();
    }
  });

test("invalid consolidation leaves no misleading output and preserves both source files", async () => {
  const temporary = await recordingTempDirectory();
  try {
    const original = temporary.path("onboard.wav"),
      phone = temporary.path("phone.wav"),
      combined = temporary.path("combined.wav");
    const bytes = wave(500);
    await writeFile(original, bytes);
    await writeFile(phone, bytes);
    await assert.rejects(
      consolidateRecordingFiles(original, phone, combined, {
        ...baseTiming,
        receivedSamples: 16000,
      }),
      /does not match/,
    );
    await assert.rejects(stat(combined), /ENOENT/);
    assert.deepEqual(new Uint8Array(await readFile(original)), bytes);
    assert.deepEqual(new Uint8Array(await readFile(phone)), bytes);
  } finally {
    await temporary.cleanup();
  }
});

function derivativePublisher(
  bytes: Uint8Array,
  remote: Uint8Array = bytes,
  conflictingReservation = false,
) {
  const userId = "16b03c76-6d48-4a8e-a215-c14603d4ae42";
  const sessionId = "12e8da59-6303-49ca-9564-83f8c98f2097";
  const recordingId = "7b3f3d3c-41e3-45dc-90ce-a8c86b09ea50";
  const storagePath = `${userId}/device/${sessionId}/6a625d29-4ce2-46f4-90e6-aa059ff97410.wav`;
  const events: string[] = [];
  const filters: Array<[string, string]> = [];
  const reservation = {
    storage_path: storagePath,
    sha256: conflictingReservation ? "f".repeat(64) : digest(bytes),
    byte_length: bytes.length,
  };
  const query = {
    select: () => query,
    eq: (key: string, value: string) => {
      filters.push([key, value]);
      return query;
    },
    single: async () => ({ data: reservation, error: null }),
  };
  const client = {
    from: (table: string) => {
      assert.equal(table, "recording_audio_derivatives");
      return {
        ...query,
        upsert: async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
          assert.equal(payload.user_id, userId);
          assert.equal(payload.recording_id, recordingId);
          assert.equal(payload.sha256, digest(bytes));
          assert.equal(payload.byte_length, bytes.length);
          assert.deepEqual(options, { onConflict: "recording_id,version", ignoreDuplicates: true });
          events.push("reservation");
          return { error: null };
        },
      };
    },
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, "recordings");
        return {
          upload: async (path: string, file: Blob, options: { upsert: boolean }) => {
            assert.equal(path, storagePath);
            assert.equal(options.upsert, false);
            assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
            events.push("upload-response-lost");
            return { error: { message: "Connection closed after object commit" } };
          },
          createSignedUrl: async (path: string) => {
            assert.equal(path, storagePath);
            events.push("verify-complete-object");
            return {
              data: { signedUrl: "https://storage.example/private-derivative" },
              error: null,
            };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return {
    client,
    userId,
    sessionId,
    recordingId,
    storagePath,
    events,
    filters,
    fetchImpl: async () => new Response(Uint8Array.from(remote).buffer),
  };
}

test("a lost derivative upload response recovers only after complete remote hash verification", async () => {
  const temporary = await recordingTempDirectory();
  const originalFetch = globalThis.fetch;
  const bytes = wave(500);
  const mock = derivativePublisher(bytes);
  try {
    const filePath = temporary.path("combined.wav"),
      verificationPath = temporary.path("verify.wav");
    await writeFile(filePath, bytes);
    globalThis.fetch = mock.fetchImpl;
    const path = await publishConsolidatedRecording({ ...mock, filePath, verificationPath });
    assert.equal(path, mock.storagePath);
    assert.deepEqual(mock.events, [
      "reservation",
      "upload-response-lost",
      "verify-complete-object",
    ]);
    assert.ok(mock.filters.some(([key, value]) => key === "user_id" && value === mock.userId));
    assert.ok(
      mock.filters.some(([key, value]) => key === "recording_id" && value === mock.recordingId),
    );
    assert.deepEqual(new Uint8Array(await readFile(verificationPath)), bytes);
    assert.deepEqual(new Uint8Array(await readFile(filePath)), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    await temporary.cleanup();
  }
});

test("same-sized corrupt remote derivatives are rejected and never replace either original", async () => {
  const temporary = await recordingTempDirectory();
  const originalFetch = globalThis.fetch;
  const bytes = wave(500),
    remote = Uint8Array.from(bytes);
  remote[100] ^= 0x20;
  const mock = derivativePublisher(bytes, remote);
  try {
    const filePath = temporary.path("combined.wav"),
      verificationPath = temporary.path("verify.wav");
    await writeFile(filePath, bytes);
    globalThis.fetch = mock.fetchImpl;
    await assert.rejects(
      publishConsolidatedRecording({ ...mock, filePath, verificationPath }),
      /integrity verification/,
    );
    await assert.rejects(stat(verificationPath), /ENOENT/);
    assert.deepEqual(new Uint8Array(await readFile(filePath)), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    await temporary.cleanup();
  }
});

test("a conflicting durable derivative reservation is not uploaded or silently overwritten", async () => {
  const temporary = await recordingTempDirectory();
  const bytes = wave(500),
    mock = derivativePublisher(bytes, bytes, true);
  try {
    const filePath = temporary.path("combined.wav");
    await writeFile(filePath, bytes);
    await assert.rejects(
      publishConsolidatedRecording({
        ...mock,
        filePath,
        verificationPath: temporary.path("verify.wav"),
      }),
      /reservation does not match/,
    );
    assert.deepEqual(mock.events, ["reservation"]);
    assert.deepEqual(new Uint8Array(await readFile(filePath)), bytes);
  } finally {
    await temporary.cleanup();
  }
});
