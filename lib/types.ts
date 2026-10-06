export type Locale = "en" | "ms" | "zh-CN" | "yue" | "ta";

export type MeetingStatus = "upcoming" | "processing" | "ready" | "failed";
export type FollowUpStatus = "pending" | "approved" | "completed" | "failed" | "dismissed";
export type InterestLevel = "low" | "medium" | "high" | "unknown";
export type DealStage =
  | "discovery"
  | "evaluation"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost"
  | "unknown";
export type EvidenceCategory =
  | "need"
  | "decision"
  | "commitment"
  | "objection"
  | "budget"
  | "timeline"
  | "stakeholder"
  | "competitor"
  | "follow_up"
  | "product"
  | "company"
  | "open_question"
  | "context";

export interface Contact {
  id: string;
  name: string;
  company: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface TranscriptSegment {
  id?: string;
  speaker: string;
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface Commitment {
  id?: string;
  ownerType: "user" | "contact";
  description: string;
  dueAt?: string | null;
  status?: "open" | "completed";
}

export interface MeetingInsight {
  meetingType: string;
  intent: string;
  interestLevel: InterestLevel;
  wants: string;
  concern: string;
  promised: string;
  next: string;
  keyPoints: string[];
  commitments: Commitment[];
  detectedLanguage?: string;
  executiveSummary?: string;
  dealStage?: DealStage;
  risks?: string[];
  openQuestions?: string[];
}

export interface MeetingEvidence {
  id?: string;
  category: EvidenceCategory;
  statement: string;
  speaker: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  quote: string;
  confidence: number;
  importance: number;
  sourceKind?: "conversation" | "research";
}

export interface PublicResearchSource {
  id?: string;
  company: string;
  title: string;
  url: string;
  snippet: string;
  publishedDate: string | null;
}

export interface FollowUp {
  id: string;
  meetingId: string;
  contactId: string | null;
  type: "message" | "email" | "schedule" | "call" | "send_file";
  description: string;
  dueAt: string | null;
  status: FollowUpStatus;
  draft?: string | null;
  schedule?: ScheduleDetails | null;
}

/** Extracted facts only. Approval and provider execution are application-owned. */
export interface ScheduleDetails {
  agreement: "agreed" | "tentative";
  startAt: string | null;
  durationMinutes: number | null;
  attendees: string[];
  location: string | null;
  evidence: string | null;
}

/** Durable, owner-scoped recording state; AI completion has no estimated percentage. */
export interface RecordingProgressState {
  stage: string | null;
  uploadedBytes?: number;
  totalBytes?: number;
  error?: string | null;
  updatedAt?: string | null;
  captureEndedAt?: string | null;
  /** Duration from the archived WAV metadata, rather than upload completion time. */
  durationSeconds?: number | null;
}

export interface Meeting {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: MeetingStatus;
  source: "manual" | "calendar" | "hardware" | "upload" | "agora";
  contacts: Contact[];
  recordingId?: string | null;
  recordingUrl?: string | null;
  recordingProgress?: RecordingProgressState | null;
  transcript?: TranscriptSegment[];
  insight?: MeetingInsight | null;
  evidence?: MeetingEvidence[];
  research?: PublicResearchSource[];
  followUps?: FollowUp[];
  calendarEventId?: string | null;
  sourceConversationId?: string | null;
  sourceApprovalId?: string | null;
}

export interface ProcessMeetingResult {
  meeting: Meeting;
  providerStatus: {
    transcription: "live" | "fallback";
    extraction: "live" | "fallback";
    persistence: "live" | "local";
  };
}
