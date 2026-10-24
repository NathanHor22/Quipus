import { open } from "node:fs/promises";
import { readAudioBytes } from "./audio-file-io";
import { parseCanonicalWavHeader } from "./wav";

export interface DigitalSilenceEvidence {
  sourceKind: "onboard" | "phone";
  sha256: string;
  totalBytes: number;
  sampleCount: number;
  constantSample: number;
}

/**
 * Deliberately conservative: a flat digital signal, not an energy threshold.
 * Any varying sample, even a single quiet speech sample, keeps the recording.
 * A positive result still requires successful no-speech transcription agreement.
 * At most 160 kB is read; ordinary/long recordings keep the normal upload path.
 */
export async function inspectShortDigitalSilence(
  filePath: string,
  sourceKind: DigitalSilenceEvidence["sourceKind"],
  sha256: string,
): Promise<DigitalSilenceEvidence | null> {
  const file = await open(filePath, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(44);
    await readAudioBytes(file, header, header.length, 0);
    const wav = parseCanonicalWavHeader(header, size);
    if (header.readUInt32LE(28) !== 32_000 || header.readUInt16LE(32) !== 2)
      throw new Error("Invalid WAV byte rate or block alignment.");
    if (wav.durationSeconds >= 5) return null;
    const pcm = Buffer.alloc(wav.dataBytes);
    await readAudioBytes(file, pcm, pcm.length, 44);
    const constantSample = pcm.readInt16LE(0);
    // Saturation or large DC can indicate a broken/clipped input: preserve it.
    if (Math.abs(constantSample) > 128) return null;
    for (let offset = 2; offset < pcm.length; offset += 2)
      if (pcm.readInt16LE(offset) !== constantSample) return null;
    return { sourceKind, sha256, totalBytes: size, sampleCount: wav.dataBytes / 2, constantSample };
  } finally {
    await file.close();
  }
}

export function canDiscardShortSilence(input: {
  sources: readonly (DigitalSilenceEvidence | null)[];
  expectedSources: readonly string[];
  successfulNoSpeechResponses: number;
  priorSpeech: boolean;
}) {
  if (input.priorSpeech || !Number.isInteger(input.successfulNoSpeechResponses) || input.successfulNoSpeechResponses < 1 ||
      !input.expectedSources.length || !input.expectedSources.includes("onboard") ||
      input.expectedSources.some(kind => kind !== "onboard" && kind !== "phone") ||
      new Set(input.expectedSources).size !== input.expectedSources.length ||
      input.sources.length !== input.expectedSources.length) return false;
  return input.expectedSources.every(kind => input.sources.filter(source => source?.sourceKind === kind).length === 1) &&
    input.sources.every(source => source !== null && Number.isInteger(source.sampleCount) &&
      source.sampleCount > 0 && source.sampleCount < 80_000 && source.totalBytes === source.sampleCount * 2 + 44 &&
      Number.isInteger(source.constantSample) && Math.abs(source.constantSample) <= 128 && /^[a-f0-9]{64}$/u.test(source.sha256));
}
