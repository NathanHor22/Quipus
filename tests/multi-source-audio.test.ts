import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalWav, parseLanternWav } from "../lib/wav";
import { audioAlignment, audioTimingSchema, consolidateAudio } from "../lib/multi-source-audio";
const timing = audioTimingSchema.parse({
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
});
function wave(amplitude: number, seconds = 3) {
  const samples = new Int16Array(16000 * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i * 0.13) * amplitude);
  return createCanonicalWav(new Uint8Array(samples.buffer));
}
test("dual-source consolidation preserves duration and both original WAVs", () => {
  const original = wave(100),
    phone = wave(1000),
    before = Buffer.from(original);
  const result = consolidateAudio(original, phone, timing);
  assert.equal(parseLanternWav(result.audio).durationSeconds, 3);
  assert.deepEqual(Buffer.from(original), before);
  assert.ok(
    new Int16Array(result.audio.slice(44).buffer)[300] >
      new Int16Array(original.slice(44).buffer)[300],
  );
});
test("phone disconnection cannot truncate the onboard recording", () => {
  const result = consolidateAudio(wave(500), wave(1000, 1), { ...timing, disconnects: 1 });
  assert.equal(parseLanternWav(result.audio).durationSeconds, 3);
  assert.equal(
    new Int16Array(result.audio.slice(44).buffer)[40000],
    new Int16Array(wave(500).slice(44).buffer)[40000],
  );
});
test("clock drift is bounded and malformed manifests cannot allocate unbounded buffers", () => {
  assert.equal(audioAlignment(timing).driftPpm, 0);
  assert.throws(() => audioTimingSchema.parse({ ...timing, receivedSamples: -1 }));
  assert.throws(() =>
    consolidateAudio(wave(100), wave(200), {
      ...timing,
      firstPacketDeviceUs: 999999999999,
      lastPacketDeviceUs: 999999999999,
    }),
  );
});
