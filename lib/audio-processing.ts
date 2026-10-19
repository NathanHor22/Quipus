import { createCanonicalWav, parseLanternWav } from "./wav";

export interface AudioQualityMetrics {
  peakDbfs: number;
  rmsDbfs: number;
  dcOffset: number;
  clippedPercent: number;
  silentPercent: number;
  appliedGainDb: number;
  normalizedForRecognition: boolean;
}

function decibels(amplitude: number) {
  return amplitude > 0 ? 20 * Math.log10(amplitude / 32_768) : -96;
}

function rounded(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Shared recognition-copy policy for in-memory and streaming implementations. */
export function recognitionAdjustment(dc: number, rms: number, centeredPeak: number, clipped: number): { gain: number; normalize: boolean } {
  // Aim for speech around -20 dBFS. Cap the boost at 12 dB and preserve 8%
  // peak headroom. Loud or already-clipped recordings are never amplified.
  const desiredRms = 32_768 * 10 ** (-20 / 20);
  const rmsGain = rms > 0 ? desiredRms / rms : 1;
  const peakGain = centeredPeak > 0 ? (32_767 * 0.92) / centeredPeak : 1;
  const maximumGain = 10 ** (12 / 20);
  const gain = clipped > 0 ? Math.min(1, peakGain) : Math.min(maximumGain, rmsGain, peakGain);
  const removeDc = Math.abs(dc) >= 64;
  const normalize = removeDc || gain >= 1.12 || gain < 0.95;
  return { gain, normalize };
}

/**
 * Measures a canonical recording and creates a conservative speech-recognition
 * copy. The original bytes remain untouched for evidence and playback.
 */
export function prepareWavForRecognition(data: Uint8Array): {
  audio: Uint8Array;
  quality: AudioQualityMetrics;
} {
  const wav = parseLanternWav(data);
  const input = new Int16Array(
    data.buffer,
    data.byteOffset + 44,
    wav.dataBytes / 2,
  );
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  for (const sample of input) {
    sum += sample;
    peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) >= 32_760) clipped += 1;
  }
  const dc = sum / input.length;
  let centeredSquares = 0;
  let centeredPeak = 0;
  for (const sample of input) {
    const centered = sample - dc;
    centeredSquares += centered * centered;
    centeredPeak = Math.max(centeredPeak, Math.abs(centered));
  }
  const rms = Math.sqrt(centeredSquares / input.length);
  const frameSamples = Math.round(wav.sampleRate * 0.02);
  let silentFrames = 0;
  let frameCount = 0;
  for (let start = 0; start < input.length; start += frameSamples) {
    const end = Math.min(input.length, start + frameSamples);
    let frameSquares = 0;
    for (let index = start; index < end; index += 1) {
      const centered = input[index]! - dc;
      frameSquares += centered * centered;
    }
    const frameRms = Math.sqrt(frameSquares / Math.max(1, end - start));
    if (decibels(frameRms) < -50) silentFrames += 1;
    frameCount += 1;
  }

  const { gain, normalize } = recognitionAdjustment(dc, rms, centeredPeak, clipped);
  let audio = data;

  if (normalize) {
    const pcmBytes = new Uint8Array(input.length * 2);
    const output = new DataView(pcmBytes.buffer);
    let previousInput = 0;
    let previousOutput = 0;
    for (let index = 0; index < input.length; index += 1) {
      const centered = input[index]! - dc;
      // A gentle one-pole high-pass removes handling rumble and DC without
      // trying to fabricate frequencies that the microphone never captured.
      const filtered = centered - previousInput + 0.995 * previousOutput;
      previousInput = centered;
      previousOutput = filtered;
      const scaled = Math.max(-32_768, Math.min(32_767, Math.round(filtered * gain)));
      output.setInt16(index * 2, scaled, true);
    }
    audio = createCanonicalWav(pcmBytes);
  }

  return {
    audio,
    quality: {
      peakDbfs: rounded(decibels(peak)),
      rmsDbfs: rounded(decibels(rms)),
      dcOffset: rounded(dc),
      clippedPercent: rounded((clipped / input.length) * 100, 3),
      silentPercent: rounded((silentFrames / Math.max(1, frameCount)) * 100),
      appliedGainDb: rounded(normalize ? 20 * Math.log10(gain) : 0),
      normalizedForRecognition: normalize,
    },
  };
}
