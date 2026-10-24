import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalWav } from "../lib/wav";
import { canDiscardShortSilence, inspectShortDigitalSilence } from "../lib/short-silence";
import { OpenAITranscriptionProviderError, transcribeWithOpenAI } from "../lib/providers/openai-transcription";

const sha = "a".repeat(64);
function wav(samples: number, value: (i: number) => number = () => 0) {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(value(i), i * 2);
  return Buffer.from(createCanonicalWav(pcm));
}

test("actual WAV duration is strictly under five seconds; flat DC is accepted only near zero", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quipus-silence-"));
  try {
    const file = path.join(dir, "test.wav");
    for (const samples of [1, 16_000, 79_999, 80_000, 80_001]) {
      await writeFile(file, wav(samples));
      const result = await inspectShortDigitalSilence(file, "onboard", sha);
      assert.equal(Boolean(result), samples < 80_000);
      if (result) assert.equal(result.totalBytes, samples * 2 + 44);
    }
    await writeFile(file, wav(16_000, () => 22));
    assert.ok(await inspectShortDigitalSilence(file, "onboard", sha));
    await writeFile(file, wav(16_000, () => 32767));
    assert.equal(await inspectShortDigitalSilence(file, "onboard", sha), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("quiet speech, a single nonzero speech sample, background noise, and uncertainty are preserved", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quipus-silence-"));
  try {
    const file = path.join(dir, "test.wav");
    for (const signal of [
      (i: number) => i === 20_000 ? 1 : 0,
      (i: number) => Math.round(3 * Math.sin(2 * Math.PI * 180 * i / 16_000)),
      (i: number) => Math.round(22 * Math.sin(i * 7.123)),
      (i: number) => i > 12_000 && i < 14_000 ? Math.round(2000 * Math.sin(i / 7)) : 0,
    ]) {
      await writeFile(file, wav(32_000, signal));
      assert.equal(await inspectShortDigitalSilence(file, "onboard", sha), null);
    }
    const malformed = wav(16_000);
    await writeFile(file, malformed.subarray(0, malformed.length - 1));
    await assert.rejects(inspectShortDigitalSilence(file, "onboard", sha));
    malformed.writeUInt32LE(1, 28);
    await writeFile(file, malformed);
    await assert.rejects(inspectShortDigitalSilence(file, "onboard", sha));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("duration or empty STT alone never authorizes discard, and every original source must agree", () => {
  const onboard = { sourceKind: "onboard" as const, sha256: sha, totalBytes: 32_044, sampleCount: 16_000, constantSample: 0 };
  const base = { sources: [onboard], expectedSources: ["onboard"], successfulNoSpeechResponses: 2, priorSpeech: false };
  assert.equal(canDiscardShortSilence(base), true);
  for (const changed of [{ successfulNoSpeechResponses: 0 }, { priorSpeech: true }, { sources: [null] },
    { expectedSources: ["onboard", "phone"] }, { expectedSources: ["onboard", "onboard"] },
    { sources: [{ ...onboard, sampleCount: 80_000, totalBytes: 160_044 }] }])
    assert.equal(canDiscardShortSilence({ ...base, ...changed }), false);
  const phone = { ...onboard, sourceKind: "phone" as const };
  assert.equal(canDiscardShortSilence({ ...base, expectedSources: ["onboard", "phone"], sources: [onboard, phone] }), true);
  assert.equal(canDiscardShortSilence({ ...base, expectedSources: ["onboard", "phone"], sources: [onboard, null] }), false);
});

test("only successful empty transcription fallbacks expose no-speech agreement; errors and short YES never do", async () => {
  let calls = 0;
  await assert.rejects(transcribeWithOpenAI(new Blob([wav(16_000)]), {
    apiKey: "test-key", modelId: "gpt-4o-transcribe-diarize",
    fetchImpl: async () => { calls++; return Response.json({ text: "", segments: [] }); },
  }), (error: unknown) => error instanceof OpenAITranscriptionProviderError && error.providerCode === "no_speech" && error.noSpeechResponses === 5);
  assert.equal(calls, 5);
  await assert.rejects(transcribeWithOpenAI(new Blob([wav(16_000)]), {
    apiKey: "test-key", fetchImpl: async () => new Response("unavailable", { status: 503 }),
  }), (error: unknown) => error instanceof OpenAITranscriptionProviderError && error.noSpeechResponses === 0 && error.providerCode !== "no_speech");
  const speech = await transcribeWithOpenAI(new Blob([wav(16_000)]), {
    apiKey: "test-key", fetchImpl: async () => Response.json({ text: "Yes" }),
  });
  assert.equal(speech.text, "Yes");
});
