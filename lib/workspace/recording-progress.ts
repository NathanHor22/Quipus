import type { Meeting } from "../types";

export type RecordingStage = "uploading" | "audio_available" | "transcribing" | "summarizing" | "ready" | "failed" | "pending";

export interface RecordingProgressView {
  stage: RecordingStage;
  label: string;
  detail: string;
  uploadPercent: number | null;
  audioAvailable: boolean;
  canRetry: boolean;
  shouldPoll: boolean;
}

/** Unknown capture timing must not expose a calendar placeholder as real audio length. */
export function recordingDurationLabel(meeting: Meeting): string {
  const archivedSeconds = meeting.recordingProgress?.durationSeconds;
  let seconds: number;
  if (typeof archivedSeconds === "number" && Number.isFinite(archivedSeconds) && archivedSeconds > 0) {
    seconds = Math.round(archivedSeconds);
  } else {
    if (meeting.source === "hardware" && meeting.recordingProgress?.captureEndedAt === null) return "Not confirmed";
    const duration = (Date.parse(meeting.endAt) - Date.parse(meeting.startAt)) / 1000;
    if (!Number.isFinite(duration) || duration <= 0) return "Not confirmed";
    seconds = Math.round(duration);
  }
  if (seconds < 60) return `${Math.max(1, seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes} min${remaining ? ` ${remaining} sec` : ""}`;
}

/** Only recorded byte counts are a percentage. Processing stages are milestones. */
function uploadPercentage(uploaded: number | undefined, total: number | undefined): number | null {
  if (!Number.isFinite(uploaded) || !Number.isFinite(total) || total! <= 0 || uploaded! < 0) return null;
  return Math.min(100, Math.floor(Math.min(uploaded!, total!) * 100 / total!));
}

export function getRecordingProgress(meeting: Meeting): RecordingProgressView {
  const progress = meeting.recordingProgress;
  const rawStage = progress?.stage;
  const audioAvailable = (rawStage !== "uploading" || meeting.status === "ready") && Boolean(
    meeting.recordingUrl || (meeting.recordingId && meeting.source === "hardware"),
  );
  const common = { audioAvailable, uploadPercent: null, canRetry: false };

  // A committed report can precede a delayed worker bookkeeping update.
  if (meeting.status === "ready") {
    return { ...common, stage: "ready", label: "Report ready", detail: "Review the summary, transcript and follow-ups.", shouldPoll: false };
  }
  if (rawStage === "failed" || meeting.status === "failed") {
    const canRetry = meeting.source === "hardware" && Boolean(meeting.recordingId);
    return { ...common, stage: "failed", label: "Processing needs attention", detail: audioAvailable
      ? canRetry ? "The saved recording is available. Retry its transcript and report."
        : "The saved recording is available. Its transcript or report could not be completed."
      : meeting.source === "hardware" ? "No complete recording has been confirmed. Keep the device powered on and reconnect it to Wi-Fi."
        : "No complete recording is available. Check the original recording before trying again.",
    canRetry, shouldPoll: false };
  }
  if (rawStage === "uploading") {
    const uploadPercent = uploadPercentage(progress?.uploadedBytes, progress?.totalBytes);
    return { ...common, stage: "uploading", label: "Uploading", detail: uploadPercent === 100
      ? "All bytes reported uploaded. Confirming the complete recording."
      : "Keep Quipus powered on and connected until its recording is confirmed.", uploadPercent, shouldPoll: true };
  }
  if (rawStage === "queued" || rawStage === "audio_processing") {
    return { ...common, stage: audioAvailable ? "audio_available" : "pending", label: audioAvailable ? "Audio available" : "Preparing recording", detail: !audioAvailable
      ? "Waiting for the saved recording to become available before transcription."
      : rawStage === "audio_processing"
      ? "Checking the saved audio before transcription."
      : "The recording is queued for transcription. Playback can be opened while the report is prepared.", shouldPoll: true };
  }
  if (rawStage === "transcribing") {
    return { ...common, stage: "transcribing", label: "Preparing transcript", detail: audioAvailable
      ? "Recognizing speech and separating speakers. You can play the saved audio while this continues."
      : "Recognizing speech and separating speakers. Waiting for the saved audio to become available.", shouldPoll: true };
  }
  if (["consolidating", "researching", "saving", "extracting"].includes(rawStage || "")) {
    return { ...common, stage: "summarizing", label: "Preparing report", detail: rawStage === "researching"
      ? "Checking company context and assembling the meeting report."
      : rawStage === "saving" ? "Saving the summary, transcript and follow-ups."
        : "Finding decisions, commitments and the next steps from the transcript.", shouldPoll: true };
  }
  // Unknown/legacy states never imply a completed transcript or successful upload.
  return { ...common, stage: "pending", label: audioAvailable ? "Audio available" : meeting.status === "upcoming" ? "Scheduled" : "Processing recording",
    detail: audioAvailable ? "The recording is available. Its report is still being prepared."
      : meeting.status === "upcoming" ? "This meeting has not been recorded yet."
        : "Waiting for the next confirmed processing update.", shouldPoll: meeting.status === "processing" };
}
