export interface CanonicalWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
}

export interface WavChunk {
  /** A complete, independently playable WAV file. */
  bytes: Uint8Array;
  /** Position of the first sample in the original recording. */
  offsetSeconds: number;
  durationSeconds: number;
}

export const CANONICAL_WAV_HEADER_BYTES = 44;
export const CANONICAL_WAV_BYTES_PER_SECOND = 16_000 * 2;
/** Leave headroom below the provider's 25 MiB multipart-file limit. */
export const OPENAI_WAV_CHUNK_BYTES = 20 * 1024 * 1024;

function ascii(data: Uint8Array, offset: number, length: number) {
  return new TextDecoder("ascii").decode(data.subarray(offset, offset + length));
}

/** Validates the canonical PCM WAV emitted by the Quipus firmware. */
export function parseLanternWav(data: Uint8Array): CanonicalWav {
  return parseCanonicalWavHeader(data, data.byteLength);
}

/** Validates a bounded header read against the complete file size. */
export function parseCanonicalWavHeader(data: Uint8Array, totalFileBytes: number): CanonicalWav {
  if (data.length < 44 || ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 8) !== "WAVEfmt ") {
    throw new Error("Quipus audio is not a WAV file.");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const riffSize = view.getUint32(4, true);
  const formatLength = view.getUint32(16, true);
  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (
    riffSize + 8 !== totalFileBytes ||
    formatLength !== 16 ||
    audioFormat !== 1 ||
    channels !== 1 ||
    sampleRate !== 16_000 ||
    bitsPerSample !== 16 ||
    ascii(data, 36, 4) !== "data"
  ) {
    throw new Error("Quipus audio must be canonical 16 kHz mono 16-bit PCM WAV.");
  }
  const dataBytes = view.getUint32(40, true);
  if (dataBytes === 0 || dataBytes + 44 !== totalFileBytes || dataBytes % 2 !== 0) {
    throw new Error("Quipus WAV data length is invalid.");
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationSeconds: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
  };
}

/** Builds the fixed PCM container emitted by the Quipus recorder. */
export function createCanonicalWav(pcm: Uint8Array): Uint8Array {
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
    throw new Error("Quipus PCM data must contain complete 16-bit samples.");
  }
  const output = new Uint8Array(CANONICAL_WAV_HEADER_BYTES + pcm.byteLength);
  output.set(createCanonicalWavHeader(pcm.byteLength));
  output.set(pcm, CANONICAL_WAV_HEADER_BYTES);
  return output;
}

/** Header construction does not allocate the corresponding PCM payload. */
export function createCanonicalWavHeader(dataBytes: number): Uint8Array {
  if (!Number.isSafeInteger(dataBytes) || dataBytes <= 0 || dataBytes % 2 !== 0 || dataBytes > 0xffff_ffff - 36) {
    throw new Error("Quipus PCM data must contain complete 16-bit samples within the RIFF limit.");
  }
  const output = new Uint8Array(CANONICAL_WAV_HEADER_BYTES);
  const view = new DataView(output.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) output[offset + index] = value.charCodeAt(index);
  };
  writeAscii(0, "RIFF"); view.setUint32(4, dataBytes + 36, true);
  writeAscii(8, "WAVE"); writeAscii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16_000, true);
  view.setUint32(28, CANONICAL_WAV_BYTES_PER_SECOND, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); writeAscii(36, "data"); view.setUint32(40, dataBytes, true);
  return output;
}

function even(value: number) {
  return Math.max(0, Math.floor(value / 2) * 2);
}

/**
 * Finds a low-energy boundary just before the maximum chunk size. Cutting at
 * a pause reduces the chance that a word or sentence is split between API
 * requests. The overlap remains the final protection for speech at a boundary.
 */
function quietBoundary(
  pcm: Uint8Array,
  earliest: number,
  target: number,
): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const windowBytes = even(CANONICAL_WAV_BYTES_PER_SECOND / 5); // 200 ms
  const strideBytes = even(CANONICAL_WAV_BYTES_PER_SECOND / 20); // 50 ms
  let best = target;
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let start = even(earliest); start + windowBytes <= target; start += strideBytes) {
    let energy = 0;
    let samples = 0;
    // Sampling every fourth PCM value makes the scan cheap for hour-long files.
    for (let byte = start; byte < start + windowBytes; byte += 8) {
      energy += Math.abs(view.getInt16(byte, true));
      samples += 1;
    }
    const average = samples ? energy / samples : Number.POSITIVE_INFINITY;
    if (average <= bestEnergy) {
      bestEnergy = average;
      best = start + Math.floor(windowBytes / 2);
    }
  }
  return even(best);
}

/**
 * Splits a canonical WAV into complete overlapping WAV files. Every returned
 * item stays below maxBytes and carries its absolute offset so downstream
 * transcript timestamps can be reconstructed exactly.
 */
export function splitCanonicalWav(
  data: Uint8Array,
  options: { maxBytes?: number; overlapSeconds?: number } = {},
): WavChunk[] {
  const metadata = parseLanternWav(data);
  const maxBytes = options.maxBytes ?? OPENAI_WAV_CHUNK_BYTES;
  const maxPcmBytes = even(maxBytes - CANONICAL_WAV_HEADER_BYTES);
  if (maxPcmBytes < CANONICAL_WAV_BYTES_PER_SECOND) {
    throw new Error("WAV chunks must hold at least one second of audio.");
  }
  if (data.byteLength <= maxBytes) {
    return [{ bytes: data, offsetSeconds: 0, durationSeconds: metadata.durationSeconds }];
  }

  const pcm = data.subarray(CANONICAL_WAV_HEADER_BYTES);
  const overlapBytes = Math.min(
    even((options.overlapSeconds ?? 8) * CANONICAL_WAV_BYTES_PER_SECOND),
    even(maxPcmBytes / 4),
  );
  const searchBytes = 3 * CANONICAL_WAV_BYTES_PER_SECOND;
  const minimumChunkBytes = 60 * CANONICAL_WAV_BYTES_PER_SECOND;
  const chunks: WavChunk[] = [];
  let start = 0;

  while (start < pcm.byteLength) {
    const hardEnd = Math.min(pcm.byteLength, start + maxPcmBytes);
    const end = hardEnd === pcm.byteLength
      ? hardEnd
      : quietBoundary(
          pcm,
          Math.max(start + Math.min(minimumChunkBytes, maxPcmBytes / 2), hardEnd - searchBytes),
          hardEnd,
        );
    if (end <= start) throw new Error("Could not create a valid WAV chunk boundary.");
    const chunkPcm = pcm.slice(start, end);
    chunks.push({
      bytes: createCanonicalWav(chunkPcm),
      offsetSeconds: start / CANONICAL_WAV_BYTES_PER_SECOND,
      durationSeconds: chunkPcm.byteLength / CANONICAL_WAV_BYTES_PER_SECOND,
    });
    if (end === pcm.byteLength) break;
    const next = even(end - overlapBytes);
    start = next > start ? next : end;
  }
  return chunks;
}

export type WavChunkRange = {
  pcmStartByte: number;
  pcmEndByte: number;
  offsetSeconds: number;
  durationSeconds: number;
};

/** Plan ranges using only the 44-byte header and at most three seconds per cut. */
export async function planCanonicalWavChunks(audio: Blob, options: { maxBytes?: number; overlapSeconds?: number; signal?: AbortSignal } = {}): Promise<WavChunkRange[]> {
  options.signal?.throwIfAborted();
  const metadata = parseCanonicalWavHeader(new Uint8Array(await audio.slice(0, CANONICAL_WAV_HEADER_BYTES).arrayBuffer()), audio.size);
  const maxBytes = options.maxBytes ?? OPENAI_WAV_CHUNK_BYTES;
  const maxPcmBytes = even(maxBytes - CANONICAL_WAV_HEADER_BYTES);
  if (!Number.isFinite(maxPcmBytes) || maxPcmBytes < CANONICAL_WAV_BYTES_PER_SECOND) throw new Error("WAV chunks must hold at least one second of audio.");
  const overlapBytes = Math.min(even((options.overlapSeconds ?? 8) * CANONICAL_WAV_BYTES_PER_SECOND), even(maxPcmBytes / 4));
  const chunks: WavChunkRange[] = [];
  let start = 0;
  while (start < metadata.dataBytes) {
    options.signal?.throwIfAborted();
    const hardEnd = Math.min(metadata.dataBytes, start + maxPcmBytes);
    let end = hardEnd;
    if (hardEnd !== metadata.dataBytes) {
      const earliest = even(Math.max(start + Math.min(60 * CANONICAL_WAV_BYTES_PER_SECOND, maxPcmBytes / 2), hardEnd - 3 * CANONICAL_WAV_BYTES_PER_SECOND));
      const scan = new Uint8Array(await audio.slice(CANONICAL_WAV_HEADER_BYTES + earliest, CANONICAL_WAV_HEADER_BYTES + hardEnd).arrayBuffer());
      end = earliest + quietBoundary(scan, 0, scan.byteLength);
    }
    if (end <= start) throw new Error("Could not create a valid WAV chunk boundary.");
    chunks.push({ pcmStartByte: start, pcmEndByte: end, offsetSeconds: start / CANONICAL_WAV_BYTES_PER_SECOND, durationSeconds: (end - start) / CANONICAL_WAV_BYTES_PER_SECOND });
    if (end === metadata.dataBytes) break;
    const next = even(end - overlapBytes);
    start = next > start ? next : end;
  }
  return chunks;
}

/** Blob slices stay file-backed when the caller supplies an openAsBlob source. */
export function canonicalWavChunkBlob(audio: Blob, chunk: WavChunkRange): Blob {
  const bytes = chunk.pcmEndByte - chunk.pcmStartByte;
  return new Blob([Uint8Array.from(createCanonicalWavHeader(bytes)).buffer, audio.slice(CANONICAL_WAV_HEADER_BYTES + chunk.pcmStartByte, CANONICAL_WAV_HEADER_BYTES + chunk.pcmEndByte)], { type: "audio/wav" });
}
