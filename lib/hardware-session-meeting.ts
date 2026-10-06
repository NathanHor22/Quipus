import type { Meeting, RecordingProgressState } from "@/lib/types";

export interface ArchivedLanternSession {
  id: string;
  started_at: string;
  capture_ended_at: string | null;
  recording_id: string | null;
  processing_error: string | null;
  processing_stage?: string | null;
  upload_bytes?: number;
  upload_total_bytes?: number;
  updated_at?: string | null;
  meeting_id?: string | null;
  recording_started_at?: string | null;
}

export function sessionRecordingProgress(session: ArchivedLanternSession, durationSeconds?: number | null): RecordingProgressState {
  return {
    stage: session.processing_stage || null,
    uploadedBytes: Number(session.upload_bytes || 0),
    totalBytes: Number(session.upload_total_bytes || 0),
    error: session.processing_error,
    updatedAt: session.updated_at || null,
    captureEndedAt: session.capture_ended_at,
    durationSeconds: durationSeconds ?? null,
  };
}

/** Keep a retry visible even when a failed placeholder already has a meeting id. */
export function withSessionRecordingProgress(meeting: Meeting, session: ArchivedLanternSession, durationSeconds?: number | null): Meeting {
  const retryInProgress = ["uploading", "queued", "audio_processing", "transcribing", "consolidating", "researching", "saving", "extracting"].includes(session.processing_stage || "");
  const recordingProgress = sessionRecordingProgress(session, durationSeconds);
  // A normal stored meeting has a real time interval; only the archive fallback
  // below fabricates a calendar-safe end when capture timing is not confirmed.
  if (recordingProgress.captureEndedAt === null) delete recordingProgress.captureEndedAt;
  return {
    ...meeting,
    status: meeting.status === "failed" && retryInProgress ? "processing" : meeting.status,
    recordingProgress,
  };
}

/** A stored meeting and its unlinked legacy session represent one recording. */
export function shouldIncludeArchivedSession(session: ArchivedLanternSession, meetings: Meeting[]): boolean {
  return !session.meeting_id && !meetings.some((meeting) =>
    meeting.id === `hardware:${session.id}` || Boolean(session.recording_id && meeting.recordingId === session.recording_id),
  );
}

/**
 * Keep an archived hardware recording visible even when its AI processing did
 * not produce a transcript or a normal meetings row.
 */
export function archivedLanternSessionMeeting(
  session: ArchivedLanternSession,
  recordingUrl: string | null,
  durationSeconds?: number | null,
): Meeting {
  const recordingStarted = session.recording_started_at ? Date.parse(session.recording_started_at) : Number.NaN;
  const startAt = Number.isFinite(recordingStarted) ? new Date(recordingStarted).toISOString() : session.started_at;
  const started = Date.parse(startAt);
  const capturedEnd = session.capture_ended_at
    ? Date.parse(session.capture_ended_at)
    : Number.NaN;
  const endAt = Number.isFinite(capturedEnd) && capturedEnd > started
    ? new Date(capturedEnd).toISOString()
    : new Date(started + 1_000).toISOString();

  return {
    id: `hardware:${session.id}`,
    title: session.processing_stage === "uploading" ? "Uploading recording" : "Quipus recording",
    startAt,
    endAt,
    status: session.processing_stage ? (session.processing_stage === "failed" ? "failed" : "processing") : session.processing_error ? "failed" : "processing",
    source: "hardware",
    contacts: [],
    recordingId: session.recording_id,
    recordingUrl,
    recordingProgress: sessionRecordingProgress(session, durationSeconds),
    transcript: [],
    insight: null,
    followUps: [],
  };
}
