import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { prepareWavFileForRecognition } from "../lib/audio-file-processing";
import { prepareWavForRecognition } from "../lib/audio-processing";
import { createCanonicalWav, createCanonicalWavHeader } from "../lib/wav";

async function workspace<T>(task: (directory: string) => Promise<T>) {
  const prefix = resolve(join(tmpdir(), "quipus-audio-file-"));
  const directory = await mkdtemp(prefix);
  try {
    return await task(directory);
  } finally {
    if (!resolve(directory).startsWith(prefix))
      throw new Error("Temporary audio cleanup escaped its test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}

for (const fixture of [
  { name: "quiet speech", amplitude: 250, dc: 0 },
  { name: "ordinary speech", amplitude: 5000, dc: 0 },
  { name: "DC offset", amplitude: 1000, dc: 2000 },
  { name: "almost constant", amplitude: 1, dc: 30000 },
  { name: "clipped input", amplitude: 32767, dc: 2000 },
  { name: "silence", amplitude: 0, dc: 0 },
])
  test(`streaming recognition copy matches in-memory audio and metrics for ${fixture.name}`, async () =>
    workspace(async (directory) => {
      const pcm = new Uint8Array(97_702);
      const view = new DataView(pcm.buffer);
      for (let index = 0; index < pcm.length / 2; index++)
        view.setInt16(
          index * 2,
          Math.max(
            -32768,
            Math.min(32767, Math.round(Math.sin(index / 11) * fixture.amplitude + fixture.dc)),
          ),
          true,
        );
      const original = createCanonicalWav(pcm);
      const expected = prepareWavForRecognition(original);
      const input = join(directory, "original.wav"),
        output = join(directory, "recognition.wav");
      await writeFile(input, original);
      const quality = await prepareWavFileForRecognition(input, output);
      assert.deepEqual(quality, expected.quality);
      assert.deepEqual(new Uint8Array(await readFile(output)), expected.audio);
      assert.deepEqual(new Uint8Array(await readFile(input)), original);
    }));

test("streaming preparation refuses overwrite and removes incomplete outputs", async () =>
  workspace(async (directory) => {
    const input = join(directory, "input.wav"),
      output = join(directory, "existing.wav");
    await writeFile(input, createCanonicalWav(new Uint8Array(640)));
    await writeFile(output, "keep me");
    await assert.rejects(prepareWavFileForRecognition(input, input), /different private path/);
    await assert.rejects(prepareWavFileForRecognition(input, output), /EEXIST/);
    assert.equal(await readFile(output, "utf8"), "keep me");
    const broken = join(directory, "broken.wav");
    await writeFile(broken, createCanonicalWavHeader(640));
    await assert.rejects(
      prepareWavFileForRecognition(broken, join(directory, "failed.wav")),
      /canonical|length/,
    );
  }));

test("a 32MB file is prepared with bounded working buffers", { timeout: 60_000 }, async () =>
  workspace(async (directory) => {
    const input = join(directory, "long.wav"),
      output = join(directory, "copy.wav");
    const bytes = 32 * 1024 * 1024;
    await writeFile(input, createCanonicalWavHeader(bytes));
    const file = await open(input, "r+");
    await file.truncate(bytes + 44);
    await file.close();
    const baseline = process.memoryUsage().arrayBuffers;
    let peak = baseline;
    const sample = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    }, 5);
    try {
      const quality = await prepareWavFileForRecognition(input, output);
      assert.equal(quality.silentPercent, 100);
      assert.equal((await stat(output)).size, bytes + 44);
      assert.ok(
        peak - baseline < 8 * 1024 * 1024,
        `Working array buffers grew by ${peak - baseline} bytes`,
      );
    } finally {
      clearInterval(sample);
    }
  }),
);
