
import { transcriptionResultSchema } from "./meeting-schema";
import type { TranscriptSegment } from "./types";

const MAX_BATCH_BYTES = 768 * 1024;
const MAX_PACKET_BYTES = 64 * 1024;
const MAX_SEGMENTS = 2_000;

interface DecodedWord {
  text: string;
  isFinal: boolean;
}

interface DecodedCaption {
  uid?: number;
  time?: number;
  durationMs?: number;
  dataType?: string;
  culture?: string;
  sentenceId?: number;
  words: DecodedWord[];
}

function readVarint(data: Uint8Array, cursor: { value: number }) {
  let value = 0n;
  let shift = 0n;
  while (cursor.value < data.length && shift <= 63n) {
    const byte = data[cursor.value++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7n;
  }
  throw new Error("Agora caption contains an invalid varint.");
}

function asSafeNumber(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("Agora caption contains an unsafe integer.");
  }
  return number;
}

function readLengthDelimited(data: Uint8Array, cursor: { value: number }) {
  const length = asSafeNumber(readVarint(data, cursor));
  if (length < 0 || cursor.value + length > data.length) {
    throw new Error("Agora caption contains an invalid field length.");
  }
  const value = data.subarray(cursor.value, cursor.value + length);
  cursor.value += length;
  return value;
}

function skipField(data: Uint8Array, cursor: { value: number }, wireType: number) {
  if (wireType === 0) {
    readVarint(data, cursor);
    return;
  }
  if (wireType === 1) {
    cursor.value += 8;
  } else if (wireType === 2) {
    readLengthDelimited(data, cursor);
  } else if (wireType === 5) {
    cursor.value += 4;
  } else {
    throw new Error(`Agora caption uses unsupported protobuf wire type ${wireType}.`);
  }
  if (cursor.value > data.length) throw new Error("Agora caption is truncated.");
}

function decodeWord(data: Uint8Array): DecodedWord {
  const cursor = { value: 0 };
  let text = "";
  let isFinal = false;
  while (cursor.value < data.length) {
    const tag = asSafeNumber(readVarint(data, cursor));
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 1 && wireType === 2) {
      text = new TextDecoder().decode(readLengthDelimited(data, cursor));
    } else if (field === 4 && wireType === 0) {
      isFinal = readVarint(data, cursor) !== 0n;
    } else {
      skipField(data, cursor, wireType);
    }
  }
  return { text: text.replace(/\s+/gu, " ").trim(), isFinal };
}

function decodeCaption(data: Uint8Array): DecodedCaption {
  const cursor = { value: 0 };
  const caption: DecodedCaption = { words: [] };
  while (cursor.value < data.length) {
    const tag = asSafeNumber(readVarint(data, cursor));
    const field = tag >>> 3;
    const wireType = tag & 7;
    if ([4, 6, 12, 16, 19].includes(field) && wireType === 0) {
      const value = asSafeNumber(readVarint(data, cursor));
      if (field === 4) caption.uid = value;
      if (field === 6) caption.time = value;
      if (field === 12) caption.durationMs = value;
      if (field === 16 && caption.time === undefined) caption.time = value;
      if (field === 19) caption.sentenceId = value;
    } else if (field === 10 && wireType === 2) {
      caption.words.push(decodeWord(readLengthDelimited(data, cursor)));
    } else if ((field === 13 || field === 15) && wireType === 2) {
      const value = new TextDecoder().decode(readLengthDelimited(data, cursor));
      if (field === 13) caption.dataType = value;
      if (field === 15) caption.culture = value;
    } else {
      skipField(data, cursor, wireType);
    }
  }
  return caption;
}

function captionSegment(
  caption: DecodedCaption,
  recordingStartedAtMs: number,
): TranscriptSegment | null {
  if (caption.dataType && caption.dataType !== "transcribe") return null;
  const finalWords = caption.words.filter((word) => word.isFinal && word.text);
  if (!finalWords.length) return null;
  const text = finalWords.map((word) => word.text).join(" ").replace(/\s+/gu, " ").trim();
  if (!text) return null;
  const absoluteStart = caption.time || recordingStartedAtMs;
  const startSeconds = Math.max(0, (absoluteStart - recordingStartedAtMs) / 1000);
  const endSeconds = startSeconds + Math.max(0, caption.durationMs || 0) / 1000;
  return {
    id: String(caption.sentenceId || `${absoluteStart}:${text}`),
    // One wearable microphone carries both sides of the conversation. It does
    // not provide evidence for assigning a real person's identity.
    speaker: "Conversation",
    text: text.slice(0, 50_000),
    startSeconds,
    endSeconds,
  };
}

/** Decodes the length-prefixed protobuf packets staged by the ESP32. */
export function parseAgoraCaptionBatch(
  body: Uint8Array,
  recordingStartedAt: string,
) {
  if (!body.length || body.length > MAX_BATCH_BYTES) {
    throw new Error("Agora caption batch is empty or too large.");
  }
  const startedAtMs = Date.parse(recordingStartedAt);
  if (!Number.isFinite(startedAtMs)) throw new Error("Recording start time is invalid.");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const cursor = { value: 0 };
  const captions = new Map<string, { caption: DecodedCaption; segment: TranscriptSegment }>();
  while (cursor.value < body.length) {
    if (cursor.value + 4 > body.length) throw new Error("Agora caption frame is truncated.");
    const packetLength = view.getUint32(cursor.value, true);
    cursor.value += 4;
    if (!packetLength || packetLength > MAX_PACKET_BYTES || cursor.value + packetLength > body.length) {
      throw new Error("Agora caption packet length is invalid.");
    }
    const caption = decodeCaption(body.subarray(cursor.value, cursor.value + packetLength));
    cursor.value += packetLength;
    const segment = captionSegment(caption, startedAtMs);
    if (!segment) continue;
    const key = String(caption.sentenceId || `${caption.time}:${segment.text}`);
    const previous = captions.get(key);
    if (!previous || segment.text.length >= previous.segment.text.length) {
      captions.set(key, { caption, segment });
    }
    if (captions.size > MAX_SEGMENTS) throw new Error("Agora caption batch has too many segments.");
  }
  const ordered = [...captions.values()].sort(
    (left, right) => (left.segment.startSeconds || 0) - (right.segment.startSeconds || 0),
  );
  const languages = [...new Set(ordered.map((item) => item.caption.culture).filter(Boolean))];
  const segments = ordered.map((item) => item.segment);
  return transcriptionResultSchema.parse({
    text: segments.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n"),
    segments,
    language: languages.join(",") || "multilingual",
    provider: "agora",
  });
}

export const agoraCaptionLimits = {
  maxBatchBytes: MAX_BATCH_BYTES,
  maxPacketBytes: MAX_PACKET_BYTES,
};
