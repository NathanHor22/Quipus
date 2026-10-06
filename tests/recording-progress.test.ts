import assert from "node:assert/strict";
import test from "node:test";
import type { Meeting } from "../lib/types";
import { getRecordingProgress, recordingDurationLabel } from "../lib/workspace/recording-progress";
import { archivedLanternSessionMeeting, shouldIncludeArchivedSession, withSessionRecordingProgress, type ArchivedLanternSession } from "../lib/hardware-session-meeting";

const baseMeeting: Meeting = {
  id: "hardware:session-1", title: "Recorded conversation", startAt: "2026-10-06T01:00:00.000Z",
  endAt: "2026-10-06T01:05:00.000Z", source: "hardware", status: "processing", contacts: [],
};
const session: ArchivedLanternSession = {
  id: "session-1", started_at: baseMeeting.startAt, capture_ended_at: baseMeeting.endAt,
  recording_id: "recording-1", processing_error: null, processing_stage: "queued", updated_at: "2026-10-06T01:06:00.000Z",
};

test("upload progress uses measured bytes and does not imply an archived WAV at 100%", () => {
  const meeting = { ...baseMeeting, recordingProgress: { stage: "uploading", uploadedBytes: 350, totalBytes: 1000 } };
  const progress = getRecordingProgress(meeting);
  assert.equal(progress.stage, "uploading");
  assert.equal(progress.uploadPercent, 35);
  assert.equal(progress.audioAvailable, false);
  assert.equal(progress.canRetry, false);
  const complete = getRecordingProgress({ ...meeting, recordingProgress: { stage: "uploading", uploadedBytes: 1000, totalBytes: 1000 } });
  assert.equal(complete.uploadPercent, 100);
  assert.equal(complete.audioAvailable, false);
  assert.match(complete.detail, /Confirming the complete recording/);
});

test("invalid and unknown byte totals never produce invented upload percentages", () => {
  for (const counts of [{ uploadedBytes: 0, totalBytes: 0 }, { uploadedBytes: -1, totalBytes: 100 }, { uploadedBytes: Number.NaN, totalBytes: 100 }, { totalBytes: 100 }, { uploadedBytes: 15 }]) {
    assert.equal(getRecordingProgress({ ...baseMeeting, recordingProgress: { stage: "uploading", ...counts } }).uploadPercent, null);
  }
  assert.equal(getRecordingProgress({ ...baseMeeting, recordingProgress: { stage: "uploading", uploadedBytes: 110, totalBytes: 100 } }).uploadPercent, 100);
});

test("confirmed archived audio stays playable throughout transcript and report processing", () => {
  const expected: Record<string, string> = { queued: "audio_available", audio_processing: "audio_available", transcribing: "transcribing", consolidating: "summarizing", researching: "summarizing", saving: "summarizing" };
  for (const [rawStage, stage] of Object.entries(expected)) {
    const meeting = withSessionRecordingProgress({ ...baseMeeting, recordingId: session.recording_id }, { ...session, processing_stage: rawStage });
    const progress = getRecordingProgress(meeting);
    assert.equal(progress.stage, stage);
    assert.equal(progress.audioAvailable, true);
    assert.equal(progress.uploadPercent, null);
    assert.equal(progress.shouldPoll, true);
    assert.equal(progress.canRetry, false);
  }
});

test("a linked failed placeholder reflects its accepted retry without dropping its original audio", () => {
  const failed = { ...baseMeeting, status: "failed" as const, recordingId: session.recording_id, recordingUrl: "https://example.test/recording.wav" };
  const retried = withSessionRecordingProgress(failed, { ...session, meeting_id: "database-meeting-id" });
  assert.equal(retried.status, "processing");
  assert.equal(retried.recordingUrl, failed.recordingUrl);
  assert.equal(retried.recordingProgress?.updatedAt, session.updated_at);
  assert.equal(getRecordingProgress(retried).stage, "audio_available");
  assert.equal(getRecordingProgress(retried).canRetry, false);
  assert.equal(shouldIncludeArchivedSession({ ...session, meeting_id: "database-meeting-id" }, [retried]), false);
});

test("ready report takes precedence over a delayed session stage and preserves approved actions", () => {
  const ready = { ...baseMeeting, status: "ready" as const, recordingId: session.recording_id, followUps: [{ id: "follow-up-1", meetingId: baseMeeting.id, contactId: null, type: "schedule" as const, description: "Invite client", dueAt: null, status: "completed" as const }] };
  const stale = withSessionRecordingProgress(ready, { ...session, processing_stage: "uploading" });
  assert.equal(stale.status, "ready");
  assert.equal(stale.followUps, ready.followUps);
  assert.equal(getRecordingProgress(stale).stage, "ready");
  assert.equal(getRecordingProgress(stale).audioAvailable, true);
  assert.equal(getRecordingProgress(stale).canRetry, false);
  assert.equal(getRecordingProgress(stale).shouldPoll, false);
});

test("legacy unlinked sessions do not duplicate meetings with the same WAV", () => {
  assert.equal(shouldIncludeArchivedSession(session, [{ ...baseMeeting, id: "legacy-reference", recordingId: session.recording_id }]), false);
  assert.equal(shouldIncludeArchivedSession(session, [baseMeeting]), false);
  assert.equal(shouldIncludeArchivedSession(session, [{ ...baseMeeting, id: "different-session", recordingId: "different-recording" }]), true);
});

test("failed hardware audio permits processing retry; missing audio and unrelated uploads do not", () => {
  const failed = archivedLanternSessionMeeting({ ...session, processing_stage: "failed", processing_error: "Recognition failed." }, "https://example.test/recording.wav");
  assert.equal(getRecordingProgress(failed).canRetry, true);
  assert.equal(getRecordingProgress(failed).audioAvailable, true);
  assert.equal(getRecordingProgress({ ...failed, source: "upload" }).canRetry, false);
  assert.equal(getRecordingProgress({ ...failed, recordingId: null, recordingUrl: null }).canRetry, false);
});

test("unknown stages and scheduled meetings avoid claiming that a report is ready", () => {
  const unknown = getRecordingProgress({ ...baseMeeting, recordingProgress: { stage: "new-worker-stage" } });
  assert.equal(unknown.stage, "pending");
  assert.equal(unknown.uploadPercent, null);
  assert.equal(unknown.audioAvailable, false);
  const scheduled = getRecordingProgress({ ...baseMeeting, status: "upcoming", source: "calendar" });
  assert.equal(scheduled.label, "Scheduled");
  assert.equal(scheduled.shouldPoll, false);
  const noArchive = getRecordingProgress({ ...baseMeeting, recordingProgress: { stage: "queued" } });
  assert.equal(noArchive.stage, "pending");
  assert.equal(noArchive.audioAvailable, false);
  assert.doesNotMatch(noArchive.detail, /Playback can be opened/);
});

test("unknown archive capture length never presents the one-second calendar placeholder as a minute", () => {
  const unknown = archivedLanternSessionMeeting({ ...session, capture_ended_at: null, recording_id: null, processing_stage: "uploading" }, null);
  assert.equal(Date.parse(unknown.endAt) - Date.parse(unknown.startAt), 1000);
  assert.equal(recordingDurationLabel(unknown), "Not confirmed");
});

test("confirmed WAV duration takes precedence over delayed offline upload event timestamps", () => {
  const recorded = archivedLanternSessionMeeting({ ...session, capture_ended_at: "2026-10-06T09:00:00.000Z" }, "https://example.test/recording.wav", 174);
  assert.equal(recordingDurationLabel(recorded), "2 min 54 sec");
  assert.equal(recordingDurationLabel({ ...recorded, recordingProgress: { stage: "queued", durationSeconds: 35 } }), "35 sec");
  assert.equal(recordingDurationLabel({ ...recorded, recordingProgress: { stage: "queued", captureEndedAt: null, durationSeconds: 300 } }), "5 min");
});

test("normal stored meeting timing and recording start exclude consent wait when file timing is absent", () => {
  const stored = withSessionRecordingProgress(baseMeeting, { ...session, capture_ended_at: null });
  assert.equal(recordingDurationLabel(stored), "5 min");
  const recordingStarted = archivedLanternSessionMeeting({ ...session, recording_started_at: "2026-10-06T01:01:00.000Z" }, null);
  assert.equal(recordingStarted.startAt, "2026-10-06T01:01:00.000Z");
  assert.equal(recordingDurationLabel(recordingStarted), "4 min");
  assert.equal(recordingDurationLabel({ ...baseMeeting, endAt: "2026-10-06T01:00:35.000Z" }), "35 sec");
  assert.equal(recordingDurationLabel({ ...baseMeeting, endAt: "invalid" }), "Not confirmed");
});
