"use client";

import { useEffect, useState } from "react";
import type { Meeting } from "@/lib/types";
import type { WorkspaceMode } from "@/lib/workspace/model";
import { getRecordingProgress } from "@/lib/workspace/recording-progress";
import styles from "./recording-progress.module.css";

const milestones = ["Uploading", "Audio available", "Preparing transcript", "Preparing report", "Report ready"];

export function RecordingProgress({ meeting, mode, compact = false, onOpenAudio, onRetryAccepted }: {
  meeting: Meeting;
  mode: WorkspaceMode;
  compact?: boolean;
  onOpenAudio?: () => void;
  onRetryAccepted?: () => void | Promise<void>;
}) {
  const progress = getRecordingProgress(meeting);
  const [retryState, setRetryState] = useState<"idle" | "sending" | "accepted">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setRetryState("idle");
    setMessage("");
  }, [meeting.id, meeting.recordingProgress?.updatedAt, progress.stage]);

  const retry = async () => {
    if (retryState !== "idle" || mode === "sample" || !progress.canRetry || !meeting.recordingId) return;
    setRetryState("sending");
    setMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/recordings/${encodeURIComponent(meeting.recordingId)}/retry`, {
        method: "POST", signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not retry processing.");
      setRetryState("accepted");
      setMessage("Retry queued. Your saved recording is preserved.");
      try { await onRetryAccepted?.(); }
      catch { setMessage("Retry queued. Refresh this view to check its progress."); }
    } catch (error) {
      setRetryState("idle");
      setMessage(error instanceof Error && error.name === "AbortError"
        ? "The request timed out. Refresh the recording status before retrying."
        : error instanceof Error ? error.message : "Could not retry processing. Please try again.");
    } finally {
      clearTimeout(timeout);
    }
  };

  if (compact) {
    return <span className={styles.compact} data-stage={progress.stage}>
      {progress.label}{progress.uploadPercent !== null ? ` · ${progress.uploadPercent}%` : ""}
    </span>;
  }

  const currentStep = progress.stage === "uploading" ? 0
    : progress.stage === "audio_available" ? 1
      : progress.stage === "transcribing" ? 2
        : progress.stage === "summarizing" ? 3
          : progress.stage === "ready" ? 4 : -1;

  return <section className={styles.progress} data-stage={progress.stage} aria-label="Recording progress">
    <div className={styles.heading}>
      <div><span className={styles.kicker}>RECORDING</span><h3 aria-live="polite">{progress.label}</h3></div>
      {progress.uploadPercent !== null && <span className={styles.percentage}>{progress.uploadPercent}%</span>}
    </div>
    <p className={styles.description}>{progress.detail}</p>
    {progress.uploadPercent !== null && <progress className={styles.upload} aria-label="Recording bytes uploaded" max={100} value={progress.uploadPercent} />}
    {currentStep >= 0 && <ol className={styles.milestones} aria-label="Processing stages">
      {milestones.map((label, index) => <li key={label}
        data-state={index < currentStep || progress.stage === "ready" ? "complete" : index === currentStep ? "current" : "pending"}
        aria-current={index === currentStep && progress.stage !== "ready" ? "step" : undefined}>
        <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{label}
      </li>)}
    </ol>}
    {(progress.audioAvailable && onOpenAudio || progress.canRetry) && <div className={styles.actions}>
      {progress.audioAvailable && onOpenAudio && <button type="button" className={styles.secondary} onClick={onOpenAudio}>Play recording</button>}
      {progress.canRetry && <button type="button" className={styles.primary} disabled={retryState !== "idle" || mode === "sample"} onClick={() => void retry()}>
        {retryState === "sending" ? "Requesting retry…" : retryState === "accepted" ? "Retry queued" : "Retry processing"}
      </button>}
    </div>}
    {mode === "sample" && progress.canRetry && <p className={styles.feedback}>Processing retries are available for your own recordings after sign-in.</p>}
    {message && <p className={styles.feedback} role="status">{message}</p>}
  </section>;
}
