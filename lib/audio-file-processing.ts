import { open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { readAudioBytes as readExactly, writeAudioBytes as writeExactly } from "./audio-file-io";
import { recognitionAdjustment, type AudioQualityMetrics } from "./audio-processing";
import { CANONICAL_WAV_HEADER_BYTES, parseCanonicalWavHeader } from "./wav";

/** Fixed working memory, independent of recording duration. */
export const RECOGNITION_FILE_BUFFER_BYTES = 64 * 1024;
const dbfs = (amplitude: number) => (amplitude > 0 ? 20 * Math.log10(amplitude / 32_768) : -96);
const rounded = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** Two source passes, a single 64KB sample buffer, and an unchanged original. */
export async function prepareWavFileForRecognition(
  inputPath: string,
  outputPath: string,
): Promise<AudioQualityMetrics> {
  if (resolve(inputPath) === resolve(outputPath))
    throw new Error("The recognition copy must use a different private path.");
  const input = await open(inputPath, "r");
  let output: FileHandle | undefined;
  let created = false;
  let completed = false;
  try {
    const stat = await input.stat();
    if (!stat.isFile()) throw new Error("Recognition requires a regular WAV file.");
    const header = Buffer.alloc(CANONICAL_WAV_HEADER_BYTES);
    await readExactly(input, header, header.length, 0);
    const wav = parseCanonicalWavHeader(header, stat.size);
    const buffer = Buffer.alloc(RECOGNITION_FILE_BUFFER_BYTES);
    let count = 0,
      sum = 0,
      peak = 0,
      clipped = 0,
      mean = 0,
      m2 = 0;
    let minimum = Number.POSITIVE_INFINITY,
      maximum = Number.NEGATIVE_INFINITY;
    for (let position = 44; position < stat.size; position += buffer.length) {
      const length = Math.min(buffer.length, stat.size - position);
      await readExactly(input, buffer, length, position);
      for (let offset = 0; offset < length; offset += 2) {
        const sample = buffer.readInt16LE(offset);
        count++;
        sum += sample;
        const delta = sample - mean;
        mean += delta / count;
        m2 += delta * (sample - mean);
        peak = Math.max(peak, Math.abs(sample));
        minimum = Math.min(minimum, sample);
        maximum = Math.max(maximum, sample);
        if (Math.abs(sample) >= 32_760) clipped++;
      }
    }
    const dc = sum / count;
    // Welford avoids cancellation for almost-constant, strongly DC-offset audio.
    const rms = Math.sqrt(Math.max(0, m2 / count + (mean - dc) ** 2));
    const centeredPeak = Math.max(Math.abs(minimum - dc), Math.abs(maximum - dc));
    const { gain, normalize } = recognitionAdjustment(dc, rms, centeredPeak, clipped);
    output = await open(outputPath, "wx", 0o600);
    created = true;
    await writeExactly(output, header, header.length, 0);
    let previousInput = 0,
      previousOutput = 0,
      centeredSquares = 0,
      frameSquares = 0,
      frameCount = 0,
      silentFrames = 0,
      samplesInFrame = 0;
    const frameSamples = Math.round(wav.sampleRate * 0.02);
    const finishFrame = () => {
      if (dbfs(Math.sqrt(frameSquares / Math.max(1, samplesInFrame))) < -50) silentFrames++;
      frameCount++;
      frameSquares = 0;
      samplesInFrame = 0;
    };
    for (let position = 44; position < stat.size; position += buffer.length) {
      const length = Math.min(buffer.length, stat.size - position);
      await readExactly(input, buffer, length, position);
      for (let offset = 0; offset < length; offset += 2) {
        const centered = buffer.readInt16LE(offset) - dc;
        centeredSquares += centered * centered;
        frameSquares += centered * centered;
        samplesInFrame++;
        if (samplesInFrame === frameSamples) finishFrame();
        if (normalize) {
          const filtered = centered - previousInput + 0.995 * previousOutput;
          previousInput = centered;
          previousOutput = filtered;
          buffer.writeInt16LE(
            Math.max(-32_768, Math.min(32_767, Math.round(filtered * gain))),
            offset,
          );
        }
      }
      await writeExactly(output, buffer, length, position);
    }
    if (samplesInFrame) finishFrame();
    await output.sync();
    completed = true;
    return {
      peakDbfs: rounded(dbfs(peak)),
      rmsDbfs: rounded(dbfs(Math.sqrt(centeredSquares / count))),
      dcOffset: rounded(dc),
      clippedPercent: rounded((clipped / count) * 100, 3),
      silentPercent: rounded((silentFrames / Math.max(1, frameCount)) * 100),
      appliedGainDb: rounded(normalize ? 20 * Math.log10(gain) : 0),
      normalizedForRecognition: normalize,
    };
  } finally {
    await Promise.allSettled([input.close(), output?.close()]);
    if (created && !completed)
      await unlink(outputPath).catch(() => {
        /* Preserve the original on cleanup failure. */
      });
  }
}
