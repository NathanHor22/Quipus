import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWavChunkBlob,
  CANONICAL_WAV_BYTES_PER_SECOND,
  createCanonicalWav,
  createCanonicalWavHeader,
  parseCanonicalWavHeader,
  parseLanternWav,
  planCanonicalWavChunks,
  splitCanonicalWav,
  OPENAI_WAV_CHUNK_BYTES,
} from "../lib/wav";
import { transcribeWithOpenAI } from "../lib/providers/openai-transcription";

test("lazy ranges retain quiet boundaries, eight-second overlap and byte-identical chunk audio", async () => {
  const pcm = new Uint8Array(CANONICAL_WAV_BYTES_PER_SECOND * 90);
  const samples = new DataView(pcm.buffer);
  for (let index = 0; index < pcm.length / 2; index++)
    samples.setInt16(index * 2, Math.round(Math.sin(index / 7) * 1000), true);
  const bytes = createCanonicalWav(pcm);
  const options = { maxBytes: 30 * CANONICAL_WAV_BYTES_PER_SECOND + 44, overlapSeconds: 8 };
  const eager = splitCanonicalWav(bytes, options);
  const source = new Blob([Uint8Array.from(bytes).buffer]);
  const lazy = await planCanonicalWavChunks(source, options);
  assert.equal(lazy.length, eager.length);
  for (let index = 0; index < eager.length; index++) {
    assert.equal(lazy[index].offsetSeconds, eager[index].offsetSeconds);
    assert.equal(lazy[index].durationSeconds, eager[index].durationSeconds);
    assert.deepEqual(
      new Uint8Array(await canonicalWavChunkBlob(source, lazy[index]).arrayBuffer()),
      eager[index].bytes,
    );
  }
});

class VirtualWav extends Blob {
  readonly reads: number[] = [];
  constructor(readonly pcmBytes: number) {
    super([]);
  }
  override get size() {
    return this.pcmBytes + 44;
  }
  override async arrayBuffer(): Promise<ArrayBuffer> {
    throw new Error("Entire recording allocation is forbidden");
  }
  override slice(start = 0, end = this.size): Blob {
    this.reads.push(end - start);
    if (start === 0 && end === 44)
      return new Blob([Uint8Array.from(createCanonicalWavHeader(this.pcmBytes)).buffer]);
    return new Blob([new ArrayBuffer(end - start)]);
  }
}

test("a two-hour archive is planned with bounded 96KB reads rather than one full-file allocation", async () => {
  const source = new VirtualWav(CANONICAL_WAV_BYTES_PER_SECOND * 7200);
  const chunks = await planCanonicalWavChunks(source);
  assert.ok(chunks.length > 10);
  assert.ok(Math.max(...source.reads) <= 3 * CANONICAL_WAV_BYTES_PER_SECOND);
  const metadata = parseCanonicalWavHeader(createCanonicalWavHeader(source.pcmBytes), source.size);
  assert.equal(metadata.durationSeconds, 7200);
  assert.throws(
    () => parseCanonicalWavHeader(createCanonicalWavHeader(source.pcmBytes), source.size - 2),
    /canonical|length/,
  );
});

test("long recording transcription keeps at most three active lazy audio requests", async () => {
  const source = new VirtualWav(OPENAI_WAV_CHUNK_BYTES * 3 + CANONICAL_WAV_BYTES_PER_SECOND);
  let active = 0,
    maximum = 0,
    calls = 0;
  const result = await transcribeWithOpenAI(source, {
    apiKey: "test-only",
    modelId: "gpt-4o-transcribe-diarize",
    fetchImpl: async (_url, init) => {
      active++;
      maximum = Math.max(maximum, active);
      const call = ++calls;
      const file = (init?.body as FormData).get("file") as Blob;
      assert.ok(file.size <= OPENAI_WAV_CHUNK_BYTES);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return Response.json({
        text: `Section ${call}`,
        segments: [{ speaker: "a", text: `Section ${call}`, start: 1, end: 2 }],
      });
    },
  });
  assert.equal(maximum, 3);
  assert.ok(calls >= 4);
  assert.equal(result.provider, "openai");
  assert.equal(active, 0);
});

test("canonical header construction remains identical to a complete PCM container", () => {
  const complete = createCanonicalWav(new Uint8Array(64_000));
  assert.deepEqual(complete.slice(0, 44), createCanonicalWavHeader(64_000));
  assert.deepEqual(
    parseLanternWav(complete),
    parseCanonicalWavHeader(complete.slice(0, 44), complete.length),
  );
});
