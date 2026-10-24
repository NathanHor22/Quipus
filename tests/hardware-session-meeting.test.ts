import assert from "node:assert/strict";
import test from "node:test";

import { archivedLanternSessionMeeting, shouldIncludeArchivedSession } from "../lib/hardware-session-meeting";

test("an archived Lantern session remains replayable when transcription fails", () => {
  const meeting = archivedLanternSessionMeeting(
    {
      id: "e8e9f319-ba17-42a4-97ef-508c543d9c5d",
      started_at: "2026-09-19T14:53:38.000Z",
      capture_ended_at: "2026-09-19T14:56:32.000Z",
      recording_id: "7b3f3d3c-41e3-45dc-90ce-a8c86b09ea50",
      processing_error: "OpenAI did not detect speech in this recording.",
    },
    "https://storage.example.test/recording.wav",
  );

  assert.equal(meeting.id, "hardware:e8e9f319-ba17-42a4-97ef-508c543d9c5d");
  assert.equal(meeting.status, "failed");
  assert.equal(meeting.source, "hardware");
  assert.equal(meeting.recordingId, "7b3f3d3c-41e3-45dc-90ce-a8c86b09ea50");
  assert.equal(meeting.recordingUrl, "https://storage.example.test/recording.wav");
  assert.equal(
    Date.parse(meeting.endAt) - Date.parse(meeting.startAt),
    174_000,
  );
  assert.deepEqual(meeting.transcript, []);
});

test("an incomplete archive receives a valid minimal calendar duration", () => {
  const meeting = archivedLanternSessionMeeting(
    {
      id: "e8e9f319-ba17-42a4-97ef-508c543d9c5d",
      started_at: "2026-09-19T14:53:38.000Z",
      capture_ended_at: null,
      recording_id: "7b3f3d3c-41e3-45dc-90ce-a8c86b09ea50",
      processing_error: null,
    },
    null,
  );

  assert.equal(meeting.status, "processing");
  assert.equal(
    Date.parse(meeting.endAt) - Date.parse(meeting.startAt),
    1_000,
  );
});


test("uncertain offline clock stays explicitly marked independently of audio duration", () => {
  const meeting = archivedLanternSessionMeeting({ id: "offline-session", started_at: "2026-10-18T01:00:00Z", capture_ended_at: "2026-10-18T01:05:00Z", recording_id: "recording", processing_error: null, capture_time_uncertain: true }, null, 300);
  assert.equal(meeting.recordingProgress?.timeUncertain, true);
  assert.equal(meeting.recordingProgress?.durationSeconds, 300);
});


test("an explicitly discarded silent fluke is not re-created as a calendar placeholder", () => {
  const session = { id: "silent-session", started_at: "2026-10-24T01:00:00Z", capture_ended_at: "2026-10-24T01:00:03Z", recording_id: "silent-audio", processing_error: null };
  assert.equal(shouldIncludeArchivedSession({ ...session, processing_stage: "discarded_silence" }, []), false);
  assert.equal(shouldIncludeArchivedSession({ ...session, processing_stage: "failed", processing_error: "No speech detected" }, []), true);
  assert.equal(shouldIncludeArchivedSession({ ...session, processing_stage: "queued" }, []), true);
});
