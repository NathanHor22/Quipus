import { z } from "zod";

import { env } from "../env";
import {
  transcriptionResultSchema,
  type TranscriptionResult,
} from "../meeting-schema";
import {
  OPENAI_WAV_CHUNK_BYTES,
  planCanonicalWavChunks,
  canonicalWavChunkBlob,
  type WavChunkRange,
  type WavChunk,
} from "../wav";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TIMEOUT_MS = 120_000;
const DIARIZATION_MODEL = "gpt-4o-transcribe-diarize";
const TRANSCRIPTION_FALLBACK_MODELS = [
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "whisper-1",
] as const;
const SAME_SPEAKER_MERGE_GAP_SECONDS = 1.25;

type TranscriptionOptions = {
  fileName?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  modelId?: string;
  prompt?: string;
  onChunkProgress?: (completed: number, total: number) => void | Promise<void>;
};

const openAIResponseSchema = z
  .object({
    // Diarized responses can contain valid segment text while leaving the
    // aggregate text field empty. Rebuild it from segments below.
    text: z.string().default(""),
    segments: z
      .array(
        z
          .object({
            id: z.string().optional(),
            start: z.number().finite().nonnegative(),
            end: z.number().finite().nonnegative(),
            text: z.string(),
            speaker: z.string().trim().min(1),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export class OpenAITranscriptionProviderError extends Error {
  readonly status?: number;
  readonly providerCode?: string;
  readonly noSpeechResponses: number;

  constructor(
    message: string,
    options?: { status?: number; providerCode?: string; noSpeechResponses?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "OpenAITranscriptionProviderError";
    this.status = options?.status;
    this.providerCode = options?.providerCode;
    this.noSpeechResponses = options?.noSpeechResponses ?? 0;
  }
}

function readProviderErrorCode(body: string) {
  try {
    const decoded = JSON.parse(body) as { error?: { code?: unknown; type?: unknown } };
    const candidate = decoded.error?.code ?? decoded.error?.type;
    if (typeof candidate !== "string") return undefined;
    const safeCode = candidate.trim().slice(0, 80);
    return /^[a-zA-Z0-9._-]+$/u.test(safeCode) ? safeCode : undefined;
  } catch {
    return undefined;
  }
}

function createTranscriptionForm(
  audio: Blob,
  fileName: string,
  model: string,
  prompt?: string,
) {
  const form = new FormData();
  form.append("file", audio, fileName || "lantern.wav");
  form.append("model", model);
  if (model === DIARIZATION_MODEL) {
    form.append("response_format", "diarized_json");
    form.append("chunking_strategy", "auto");
  } else {
    form.append("response_format", "json");
    const guidance = prompt?.trim().slice(0, 1_000);
    if (guidance) form.append("prompt", guidance);
  }
  return form;
}

function numberAndGroupSpeakers(
  segments: Array<{
    id?: string;
    speaker: string;
    text: string;
    startSeconds: number;
    endSeconds: number;
  }>,
) {
  const speakerNumbers = new Map<string, number>();
  const grouped: typeof segments = [];

  for (const segment of segments) {
    const providerSpeaker = segment.speaker.trim().toLocaleLowerCase();
    let speakerNumber = speakerNumbers.get(providerSpeaker);
    if (!speakerNumber) {
      speakerNumber = speakerNumbers.size + 1;
      speakerNumbers.set(providerSpeaker, speakerNumber);
    }
    const numbered = {
      ...segment,
      speaker: `Speaker ${speakerNumber}`,
    };
    const previous = grouped.at(-1);
    const gap = previous
      ? numbered.startSeconds - previous.endSeconds
      : Number.POSITIVE_INFINITY;
    if (
      previous &&
      previous.speaker === numbered.speaker &&
      gap >= 0 &&
      gap <= SAME_SPEAKER_MERGE_GAP_SECONDS
    ) {
      previous.text = `${previous.text} ${numbered.text}`.trim();
      previous.endSeconds = Math.max(previous.endSeconds, numbered.endSeconds);
      continue;
    }
    grouped.push(numbered);
  }

  return grouped;
}

async function transcribeSingleWithOpenAI(
  audio: Blob,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const runtime = env();
  const apiKey =
    options.apiKey === undefined
      ? runtime.OPENAI_API_KEY?.trim()
      : options.apiKey?.trim();
  if (!apiKey) {
    throw new OpenAITranscriptionProviderError(
      "OpenAI transcription is not configured. Set OPENAI_API_KEY.",
    );
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    throw new OpenAITranscriptionProviderError(
      "OpenAI transcription requires a non-empty audio recording.",
    );
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const fileName = (options.fileName || "lantern.wav")
    .replace(/[\r\n"\\/]/gu, "_")
    .slice(0, 180);
  const requestedModel =
    options.modelId?.trim() || runtime.OPENAI_TRANSCRIPTION_MODEL;
  const models = [
    requestedModel,
    ...TRANSCRIPTION_FALLBACK_MODELS.filter((model) => model !== requestedModel),
  ];

  let noSpeechResponses = 0;
  try {
    for (const [index, model] of models.entries()) {
      let response: Response;
      try {
        response = await (options.fetchImpl ?? fetch)(OPENAI_TRANSCRIPTION_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: createTranscriptionForm(audio, fileName, model, options.prompt),
          signal: controller.signal,
        });
      } catch (error) {
        throw new OpenAITranscriptionProviderError(
          controller.signal.aborted
            ? `OpenAI transcription timed out after ${timeoutMs}ms.`
            : "Could not reach OpenAI transcription.",
          { cause: error },
        );
      }

      const body = await response.text();

      if (!response.ok) {
        const providerCode = readProviderErrorCode(body);
        const canTryAnotherModel =
          index < models.length - 1 &&
          response.status === 403 &&
          providerCode === "model_not_found";
        if (canTryAnotherModel) continue;

        throw new OpenAITranscriptionProviderError(
          `OpenAI transcription failed with HTTP ${response.status}${
            providerCode ? ` (${providerCode})` : ""
          }.`,
          { status: response.status, providerCode },
        );
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(body);
      } catch (error) {
        throw new OpenAITranscriptionProviderError(
          "OpenAI returned a non-JSON transcription response.",
          { cause: error },
        );
      }
      const parsed = openAIResponseSchema.safeParse(decoded);
      if (!parsed.success) {
        throw new OpenAITranscriptionProviderError(
          "OpenAI returned an invalid diarized transcription response.",
          { cause: parsed.error },
        );
      }

      const segments = numberAndGroupSpeakers(
        (parsed.data.segments ?? [])
          .filter((segment) => segment.text.trim())
          .map((segment) => ({
            ...(segment.id ? { id: segment.id } : {}),
            speaker: segment.speaker,
            text: segment.text.trim(),
            startSeconds: segment.start,
            endSeconds: segment.end,
          })),
      );
      const text =
        parsed.data.text.trim() ||
        segments.map((segment) => segment.text).join(" ").trim();
      // Diarization can occasionally return a successful but empty response
      // for valid speech. Retry the same complete WAV with the standard
      // transcription models before declaring the archive silent.
      if (!text) noSpeechResponses += 1;
      if (!text && index < models.length - 1) continue;
      if (!text) {
        throw new OpenAITranscriptionProviderError(
          "OpenAI did not detect speech in this recording.",
          { providerCode: "no_speech", noSpeechResponses },
        );
      }

      return transcriptionResultSchema.parse({
        text,
        segments: segments.length
          ? segments
          : [{ speaker: "Conversation", text }],
        language: "multilingual",
        provider: "openai",
      });
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
  throw new OpenAITranscriptionProviderError(
    "OpenAI did not detect speech in this recording.",
  );
}

type TimedSegment = TranscriptionResult["segments"][number] & {
  startSeconds: number;
  endSeconds: number;
};

function normalizedWords(text: string) {
  return new Set(
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter(Boolean),
  );
}

function wordSimilarity(left: string, right: string) {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

/** Keeps provider-local speaker labels stable across overlapping API chunks. */
export function combineChunkedTranscriptions(
  chunks: readonly Pick<WavChunk, "offsetSeconds" | "durationSeconds">[],
  results: readonly TranscriptionResult[],
): TranscriptionResult {
  if (chunks.length !== results.length || chunks.length === 0) {
    throw new Error("Each WAV chunk requires one transcription result.");
  }
  const combined: TranscriptionResult["segments"] = [];
  let nextSpeaker = 1;
  let previousCoverageEnd = 0;

  for (let index = 0; index < results.length; index += 1) {
    const chunk = chunks[index]!;
    const result = results[index]!;
    const shifted = result.segments.map((segment) => ({
      ...segment,
      ...(segment.startSeconds !== undefined
        ? { startSeconds: segment.startSeconds + chunk.offsetSeconds }
        : {}),
      ...(segment.endSeconds !== undefined
        ? { endSeconds: segment.endSeconds + chunk.offsetSeconds }
        : {}),
    }));
    const localSpeakers = [...new Set(shifted.map((segment) => segment.speaker))];
    const mapping = new Map<string, string>();

    if (index === 0) {
      for (const label of localSpeakers) {
        if (label === "Conversation") mapping.set(label, label);
        else {
          mapping.set(label, `Speaker ${nextSpeaker}`);
          nextSpeaker += 1;
        }
      }
    } else {
      const previousOverlap = combined.filter(
        (segment): segment is TimedSegment =>
          segment.startSeconds !== undefined &&
          segment.endSeconds !== undefined &&
          segment.endSeconds > chunk.offsetSeconds,
      );
      const candidates: Array<{ local: string; global: string; score: number }> = [];
      for (const local of localSpeakers) {
        const current = shifted.filter(
          (segment): segment is TimedSegment =>
            segment.speaker === local &&
            segment.startSeconds !== undefined &&
            segment.endSeconds !== undefined &&
            segment.startSeconds < previousCoverageEnd,
        );
        for (const global of new Set(previousOverlap.map((segment) => segment.speaker))) {
          let score = 0;
          for (const currentSegment of current) {
            for (const previousSegment of previousOverlap) {
              if (previousSegment.speaker !== global) continue;
              const overlap = Math.max(
                0,
                Math.min(currentSegment.endSeconds, previousSegment.endSeconds) -
                  Math.max(currentSegment.startSeconds, previousSegment.startSeconds),
              );
              if (overlap > 0) {
                score += overlap * (1 + wordSimilarity(currentSegment.text, previousSegment.text));
              }
            }
          }
          if (score > 0) candidates.push({ local, global, score });
        }
      }
      const usedLocal = new Set<string>();
      const usedGlobal = new Set<string>();
      for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
        if (usedLocal.has(candidate.local) || usedGlobal.has(candidate.global)) continue;
        mapping.set(candidate.local, candidate.global);
        usedLocal.add(candidate.local);
        usedGlobal.add(candidate.global);
      }
      for (const local of localSpeakers) {
        if (mapping.has(local)) continue;
        if (local === "Conversation") mapping.set(local, local);
        else {
          mapping.set(local, `Speaker ${nextSpeaker}`);
          nextSpeaker += 1;
        }
      }
    }

    for (const segment of shifted) {
      const mapped = { ...segment, speaker: mapping.get(segment.speaker) ?? segment.speaker };
      // The earlier chunk owns the overlap. Preserve a crossing segment because
      // it may contain the first complete rendering of speech after the cut.
      if (
        index > 0 &&
        mapped.endSeconds !== undefined &&
        mapped.endSeconds <= previousCoverageEnd
      ) {
        continue;
      }
      const previous = combined.at(-1);
      const gap =
        previous?.endSeconds !== undefined && mapped.startSeconds !== undefined
          ? mapped.startSeconds - previous.endSeconds
          : Number.POSITIVE_INFINITY;
      if (
        previous &&
        previous.speaker === mapped.speaker &&
        gap >= 0 &&
        gap <= SAME_SPEAKER_MERGE_GAP_SECONDS
      ) {
        previous.text = `${previous.text} ${mapped.text}`.trim();
        if (mapped.endSeconds !== undefined) previous.endSeconds = mapped.endSeconds;
      } else {
        combined.push(mapped);
      }
    }
    previousCoverageEnd = Math.max(
      previousCoverageEnd,
      chunk.offsetSeconds + chunk.durationSeconds,
    );
  }

  const text = combined.map((segment) => segment.text).join(" ").trim();
  return transcriptionResultSchema.parse({
    text,
    segments: combined,
    language: results[0]!.language,
    provider: "openai",
    warning: `Long recording processed in ${chunks.length} overlapping audio sections.`,
  });
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<U>,
) {
  const output = new Array<U>(values.length);
  let cursor = 0;
  let failed = false;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (!failed && cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try { output[index] = await task(values[index]!, index); }
      catch (error) { failed = true; throw error; }
    }
  });
  const outcomes = await Promise.allSettled(runners);
  const failure = outcomes.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return output;
}

/**
 * Transcribes short files directly and long Quipus WAV archives as bounded
 * concurrent, overlapping requests while rebuilding absolute timestamps.
 */
export async function transcribeWithOpenAI(
  audio: Blob,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  if (audio.size <= OPENAI_WAV_CHUNK_BYTES) {
    const result = await transcribeSingleWithOpenAI(audio, options);
    await options.onChunkProgress?.(1, 1);
    return result;
  }
  let chunks: WavChunkRange[];
  try {
    chunks = await planCanonicalWavChunks(audio, { signal: options.signal });
  } catch (cause) {
    throw new OpenAITranscriptionProviderError(
      "Recordings over 20 MB must be canonical 16 kHz mono PCM WAV files.",
      { cause },
    );
  }
  const baseName = (options.fileName || "quipus.wav").replace(/\.wav$/iu, "");
  let completed = 0;
  const chunkController = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, chunkController.signal]) : chunkController.signal;
  const results = await mapWithConcurrency(chunks, 3, async (chunk, index) => {
    try {
      signal.throwIfAborted();
      const result = await transcribeSingleWithOpenAI(canonicalWavChunkBlob(audio, chunk), {
        ...options, signal,
        fileName: `${baseName}.part-${String(index + 1).padStart(3, "0")}.wav`,
      });
      completed += 1;
      await options.onChunkProgress?.(completed, chunks.length);
      return result;
    } catch (error) { chunkController.abort(error); throw error; }
  });
  return combineChunkedTranscriptions(chunks, results);
}
