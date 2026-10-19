import { z } from "zod";
import { createCanonicalWav, parseLanternWav } from "./wav";

const safeCounter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const audioTimingSchema = z
  .object({
    recovered: z.boolean().optional(),
    version: z.literal(1),
    sampleRate: z.literal(16000),
    channels: z.literal(1),
    deviceStartedUs: safeCounter,
    firstPacketDeviceUs: safeCounter,
    lastPacketDeviceUs: safeCounter,
    firstPacketPhoneUs: safeCounter,
    lastPacketPhoneUs: safeCounter,
    receivedSamples: safeCounter,
    missingSamples: safeCounter,
    droppedPackets: safeCounter,
    disconnects: safeCounter,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.missingSamples > value.receivedSamples ||
      value.lastPacketDeviceUs < value.firstPacketDeviceUs ||
      value.lastPacketPhoneUs < value.firstPacketPhoneUs
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent audio timing.",
      });
  });
export type AudioTiming = z.infer<typeof audioTimingSchema>;

/** Arrival times provide estimated alignment, not sample-accurate shared clocks. */
export function audioAlignment(timing: AudioTiming) {
  let deviceUsPerSample = 1_000_000 / 16000;
  const elapsedSamples = timing.receivedSamples - 512;
  if (!timing.recovered && elapsedSamples >= 16000 * 30) {
    const measured = (timing.lastPacketDeviceUs - timing.firstPacketDeviceUs) / elapsedSamples;
    if (measured >= deviceUsPerSample * 0.995 && measured <= deviceUsPerSample * 1.005)
      deviceUsPerSample = measured;
  }
  return {
    offsetSeconds: (timing.firstPacketDeviceUs - timing.deviceStartedUs - 32_000) / 1_000_000,
    deviceUsPerSample,
    driftPpm: ((deviceUsPerSample * 16000) / 1_000_000 - 1) * 1_000_000,
    estimated: true as const,
  };
}

/** Shared bounded source selector used by both file and in-memory adapters. */
export function consolidateWindow(
  primary: Int16Array,
  phoneAt: (index: number) => number | null,
  previousPhone: boolean,
) {
  let energy1 = 0,
    energy2 = 0,
    clipped1 = 0,
    clipped2 = 0,
    coverage = 0;
  for (let i = 0; i < primary.length; i += 8) {
    const a = primary[i],
      b = phoneAt(i);
    energy1 += a * a;
    if (Math.abs(a) >= 32000) clipped1++;
    if (b !== null) {
      energy2 += b * b;
      coverage++;
      if (Math.abs(b) >= 32000) clipped2++;
    }
  }
  const usePhone =
    coverage >= Math.ceil(primary.length / 8) * 0.95 &&
    (clipped1 > clipped2 + 3 || (clipped2 < 3 && energy2 > energy1 * 1.6));
  const audio = new Int16Array(primary.length);
  for (let i = 0; i < primary.length; i++) {
    const alternate = phoneAt(i),
      chosen = usePhone && alternate !== null ? alternate : primary[i];
    const previous = previousPhone && alternate !== null ? alternate : primary[i];
    audio[i] =
      i < 160 && usePhone !== previousPhone && alternate !== null
        ? Math.round(previous * (1 - i / 160) + (chosen * i) / 160)
        : chosen;
  }
  return { audio, usePhone };
}

function pcm(data: Uint8Array): Int16Array {
  parseLanternWav(data);
  // Copy avoids alignment assumptions about downloaded Buffer byte offsets.
  const bytes = data.slice(44);
  return new Int16Array(bytes.buffer);
}

/**
 * Produce one full-length listening/recognition derivative, keeping both originals.
 * Select a source per 1-second window; do not add delayed waveforms destructively.
 * The short crossfade reduces clicks without pretending this is beamforming.
 */
export function consolidateAudio(primaryWav: Uint8Array, phoneWav: Uint8Array, rawTiming: unknown) {
  const timing = audioTimingSchema.parse(rawTiming);
  const primary = pcm(primaryWav);
  const phone = pcm(phoneWav);
  const alignment = audioAlignment(timing);
  if (Math.abs(alignment.offsetSeconds) > primary.length / 16000 + 5)
    throw new Error("Phone timing does not overlap this meeting.");
  const offset = Math.round(alignment.offsetSeconds * 16000);
  const ratio = 1_000_000 / 16000 / alignment.deviceUsPerSample;
  const output = new Int16Array(primary.length);
  const phoneAt = (index: number): number | null => {
    const location = (index - offset) * ratio;
    const frame = Math.floor(location);
    if (frame < 0 || frame >= phone.length) return null;
    return phone[frame];
  };
  let previousPhone = false;
  for (let start = 0; start < primary.length; start += 16000) {
    const end = Math.min(start + 16000, primary.length);
    const window = consolidateWindow(
      primary.subarray(start, end),
      (index) => phoneAt(start + index),
      previousPhone,
    );
    output.set(window.audio, start);
    previousPhone = window.usePhone;
  }
  return {
    audio: createCanonicalWav(new Uint8Array(output.buffer)),
    alignment,
    sourceCount: 2,
    warning:
      "Automatic source selection is a preliminary quality heuristic; both original recordings are preserved.",
  };
}
