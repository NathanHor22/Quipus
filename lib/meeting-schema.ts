import { z } from "zod";
import { scheduleDetailsSchema } from "./workspace/model";

import type {
  DealStage,
  MeetingEvidence,
  InterestLevel,
  MeetingInsight,
  TranscriptSegment,
} from "./types";

export const compactText = (label: string, maxLength = 240) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? `${label} is required` : undefined) })
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer`);

/** Accepts either a calendar date or an RFC 3339 timestamp with an explicit zone. */
export const dueAtSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) ||
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ),
    "dueAt must be YYYY-MM-DD or an RFC 3339 timestamp with a timezone",
  );

const transcriptSegmentObjectSchema = z
  .object({
    id: compactText("segment ID", 120).optional(),
    speaker: compactText("speaker", 80),
    text: compactText("transcript text", 50_000),
    startSeconds: z.number().finite().nonnegative().optional(),
    endSeconds: z.number().finite().nonnegative().optional(),
  })
  .strict();

export const transcriptSegmentSchema = transcriptSegmentObjectSchema.superRefine(
  (segment, context) => {
    if (
      segment.startSeconds !== undefined &&
      segment.endSeconds !== undefined &&
      segment.endSeconds < segment.startSeconds
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endSeconds cannot be before startSeconds",
        path: ["endSeconds"],
      });
    }
  },
);

export const transcriptionResultSchema = z
  .object({
    text: compactText("transcript", 250_000),
    segments: z.array(transcriptSegmentSchema).min(1).max(10_000),
    language: compactText("language", 40),
    provider: z.enum([
      "elevenlabs",
      "groq",
      "agora",
      "openai",
      "import",
      "fallback",
    ]),
    warning: compactText("warning", 500).optional(),
  })
  .strict();

export const extractedParticipantSchema = z
  .object({
    name: compactText("participant name", 120),
    company: compactText("participant company", 160).nullable(),
    role: compactText("participant role", 120).nullable(),
    email: z.string().trim().email().max(254).nullable(),
    phone: compactText("participant phone", 40).nullable(),
  })
  .strict();

export const extractedCommitmentSchema = z
  .object({
    ownerType: z.enum(["user", "contact"]),
    participantName: compactText("commitment participant", 120).nullable().optional(),
    description: compactText("commitment description", 240),
    dueAt: dueAtSchema.nullable(),
    status: z.enum(["open", "completed"]),
  })
  .strict();

export const meetingInsightSchema = z
  .object({
    meetingType: compactText("meeting type", 80),
    intent: compactText("intent", 240),
    interestLevel: z.enum(["low", "medium", "high", "unknown"]),
    wants: compactText("wants", 240),
    concern: compactText("concern", 240),
    promised: compactText("promised", 240),
    next: compactText("next", 240),
    keyPoints: z.array(compactText("key point", 240)).max(5),
    commitments: z.array(extractedCommitmentSchema).max(20),
    detectedLanguage: compactText("detected language", 80),
    executiveSummary: compactText("executive summary", 500),
    dealStage: z.enum([
      "discovery", "evaluation", "proposal", "negotiation",
      "closed_won", "closed_lost", "unknown",
    ]),
    risks: z.array(compactText("risk", 240)).max(8),
    openQuestions: z.array(compactText("open question", 240)).max(8),
  })
  .strict();

export const meetingEvidenceSchema = z
  .object({
    category: z.enum([
      "need", "decision", "commitment", "objection", "budget", "timeline",
      "stakeholder", "competitor", "follow_up", "product", "company",
      "open_question", "context",
    ]),
    statement: compactText("evidence statement", 500),
    speaker: compactText("evidence speaker", 80).nullable(),
    startSeconds: z.number().finite().nonnegative().nullable(),
    endSeconds: z.number().finite().nonnegative().nullable(),
    quote: compactText("evidence quote", 500),
    confidence: z.number().finite().min(0).max(1),
    importance: z.number().int().min(1).max(5),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.startSeconds !== null &&
      evidence.endSeconds !== null &&
      evidence.endSeconds < evidence.startSeconds
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endSeconds"],
        message: "endSeconds cannot be before startSeconds",
      });
    }
  });

export const extractedFollowUpSchema = z
  .object({
    type: z.enum(["message", "email", "schedule", "call", "send_file"]),
    participantName: compactText("follow-up participant", 120).nullable().optional(),
    description: compactText("follow-up description", 240),
    dueAt: dueAtSchema.nullable(),
    draft: compactText("follow-up draft", 2_000).nullable(),
    schedule: scheduleDetailsSchema.nullable().optional(),
  })
  .strict();

/** The exact object requested from extraction providers before metadata is attached. */
export const meetingExtractionSchema = z
  .object({
    // New strict provider responses include this field. Optional local parsing
    // keeps previously saved extractions readable without reprocessing audio.
    title: compactText("meeting topic title", 80).nullable().optional(),
    insight: meetingInsightSchema,
    participants: z.array(extractedParticipantSchema).max(20),
    followUps: z.array(extractedFollowUpSchema).max(20),
    evidence: z.array(meetingEvidenceSchema).max(80),
  })
  .strict();

export const meetingExtractionResultSchema = meetingExtractionSchema
  .extend({
    provider: z.enum(["qwen", "openai", "fallback"]),
    warning: compactText("warning", 500).optional(),
  })
  .strict();

export const contactHintSchema = z
  .object({
    name: compactText("contact name", 120),
    company: compactText("contact company", 160).nullable().optional(),
    role: compactText("contact role", 120).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    phone: compactText("contact phone", 40).nullable().optional(),
  })
  .strict();

export const extractionContextSchema = z
  .object({
    title: compactText("meeting title", 200).optional(),
    contactHint: contactHintSchema.optional(),
    outputLanguage: compactText("output language", 40).default("English"),
    referenceDate: z.string().datetime({ offset: true }).optional(),
    timezone: compactText("timezone", 80).optional(),
    referenceLocalDateTime: compactText("local reference time", 160).optional(),
    referenceTimeUncertain: z.boolean().optional(),
  })
  .strict();

export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;
export type ExtractedParticipant = z.infer<typeof extractedParticipantSchema>;
export type MeetingExtraction = z.infer<typeof meetingExtractionSchema>;
export type MeetingExtractionResult = z.infer<
  typeof meetingExtractionResultSchema
>;
export type ExtractionContext = z.input<typeof extractionContextSchema>;

// Type-only schema/domain contract: changing either side must remain assignable.
type AssertAssignable<T, U extends T> = U;
export type MeetingSchemaCompatibility = {
  transcript: AssertAssignable<TranscriptSegment, z.infer<typeof transcriptSegmentSchema>>;
  insight: AssertAssignable<MeetingInsight, z.infer<typeof meetingInsightSchema>>;
  interest: AssertAssignable<InterestLevel, z.infer<typeof meetingInsightSchema>["interestLevel"]>;
  dealStage: AssertAssignable<DealStage, z.infer<typeof meetingInsightSchema>["dealStage"]>;
  evidence: AssertAssignable<MeetingEvidence, z.infer<typeof meetingEvidenceSchema>>;
};

/**
 * JSON Schema sent to Qwen's OpenAI-compatible strict structured-output mode.
 * Every property is required because strict providers reject optional properties;
 * absence is represented with null or an empty array.
 */
export const meetingExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "insight", "participants", "followUps", "evidence"],
  properties: {
    title: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 80,
      description: "A short factual topic title from the whole conversation, or null when no topic is established.",
    },
    insight: {
      type: "object",
      additionalProperties: false,
      required: [
        "meetingType",
        "intent",
        "interestLevel",
        "wants",
        "concern",
        "promised",
        "next",
        "keyPoints",
        "commitments",
        "detectedLanguage",
        "executiveSummary",
        "dealStage",
        "risks",
        "openQuestions",
      ],
      properties: {
        meetingType: { type: "string", minLength: 1, maxLength: 80 },
        intent: { type: "string", minLength: 1, maxLength: 240 },
        interestLevel: {
          type: "string",
          enum: ["low", "medium", "high", "unknown"],
        },
        wants: { type: "string", minLength: 1, maxLength: 240 },
        concern: { type: "string", minLength: 1, maxLength: 240 },
        promised: { type: "string", minLength: 1, maxLength: 240 },
        next: { type: "string", minLength: 1, maxLength: 240 },
        keyPoints: {
          type: "array",
          maxItems: 5,
          items: { type: "string", minLength: 1, maxLength: 240 },
        },
        commitments: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ownerType", "participantName", "description", "dueAt", "status"],
            properties: {
              ownerType: { type: "string", enum: ["user", "contact"] },
              participantName: { type: ["string", "null"], description: "Exact participant name or email explicitly responsible; null if uncertain" },
              description: {
                type: "string",
                minLength: 1,
                maxLength: 240,
              },
              dueAt: {
                type: ["string", "null"],
                description:
                  "YYYY-MM-DD or an RFC 3339 timestamp with timezone; null if ambiguous",
              },
              status: { type: "string", enum: ["open", "completed"] },
            },
          },
        },
        detectedLanguage: { type: "string", minLength: 1, maxLength: 80 },
        executiveSummary: { type: "string", minLength: 1, maxLength: 500 },
        dealStage: {
          type: "string",
          enum: ["discovery", "evaluation", "proposal", "negotiation", "closed_won", "closed_lost", "unknown"],
        },
        risks: {
          type: "array", maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 240 },
        },
        openQuestions: {
          type: "array", maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
    },
    participants: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "company", "role", "email", "phone"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          company: {
            type: ["string", "null"],
            description: "Company stated in the transcript, otherwise null",
          },
          role: {
            type: ["string", "null"],
            description: "Role stated in the transcript, otherwise null",
          },
          email: {
            type: ["string", "null"],
            description: "Valid stated email address, otherwise null",
          },
          phone: {
            type: ["string", "null"],
            description: "Stated phone number, otherwise null",
          },
        },
      },
    },
    followUps: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "participantName", "description", "dueAt", "draft", "schedule"],
        properties: {
          type: {
            type: "string",
            enum: ["message", "email", "schedule", "call", "send_file"],
          },
          participantName: { type: ["string", "null"], description: "Exact recipient participant name or email; null if ambiguous or group-wide" },
          description: { type: "string", minLength: 1, maxLength: 240 },
          dueAt: {
            type: ["string", "null"],
            description:
              "YYYY-MM-DD or an RFC 3339 timestamp with timezone; null if ambiguous",
          },
          draft: {
            type: ["string", "null"],
            description: "A compact draft when appropriate, otherwise null",
          },
          schedule: {
            type: ["object", "null"],
            additionalProperties: false,
            required: [
              "agreement",
              "startAt",
              "durationMinutes",
              "attendees",
              "location",
              "evidence",
            ],
            properties: {
              agreement: { type: "string", enum: ["agreed", "tentative"] },
              startAt: {
                type: ["string", "null"],
                description:
                  "RFC3339 with explicit timezone, resolved against conversation time; null if not agreed",
              },
              durationMinutes: {
                type: ["integer", "null"],
                minimum: 5,
                maximum: 480,
              },
              attendees: {
                type: "array",
                maxItems: 20,
                items: { type: "string" },
              },
              location: { type: ["string", "null"] },
              evidence: {
                type: ["string", "null"],
                description:
                  "Exact contiguous quote from the transcript supporting an agreed meeting",
              },
            },
          },
        },
      },
    },
    evidence: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "category", "statement", "speaker", "startSeconds", "endSeconds",
          "quote", "confidence", "importance",
        ],
        properties: {
          category: {
            type: "string",
            enum: [
              "need", "decision", "commitment", "objection", "budget", "timeline",
              "stakeholder", "competitor", "follow_up", "product", "company",
              "open_question", "context",
            ],
          },
          statement: { type: "string", minLength: 1, maxLength: 500 },
          speaker: { type: ["string", "null"], maxLength: 80 },
          startSeconds: { type: ["number", "null"], minimum: 0 },
          endSeconds: { type: ["number", "null"], minimum: 0 },
          quote: { type: "string", minLength: 1, maxLength: 500 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          importance: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
    },
  },
} as const;
