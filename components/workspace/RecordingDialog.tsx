"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { LiveRecorder } from "@/components/Meeting/LiveRecorder";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { MAX_AUDIO_BYTES, normalizeAudioContentType } from "@/lib/audio-upload";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import styles from "./workspace.module.css";

export function RecordingDialog({
  open,
  onClose,
  onProcessed,
}: {
  open: boolean;
  onClose: () => void;
  onProcessed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState(() =>
    new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16),
  );
  const [duration, setDuration] = useState("");
  const { locale } = useLanguage();
  useEffect(() => {
    if (open) {
      setError(null);
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open]);
  const upload = async (
    file: File,
    source: "upload" | "agora" = "upload",
    timing?: { startAt: string; endAt: string },
  ) => {
    setError(null);
    setWorking(true);
    try {
      const contentType = normalizeAudioContentType(file.name, file.type);
      if (!contentType || file.size === 0 || file.size > MAX_AUDIO_BYTES)
        throw new Error("Choose a supported audio file up to 25 MB.");
      const meetingId = `upload-${crypto.randomUUID()}`;
      const startAt =
        timing?.startAt || new Date(`${capturedAt}:00+08:00`).toISOString();
      const endAt =
        timing?.endAt ||
        new Date(Date.parse(startAt) + Number(duration) * 60_000).toISOString();
      if (
        !Number.isFinite(Date.parse(startAt)) ||
        Date.parse(endAt) <= Date.parse(startAt) ||
        Date.parse(startAt) > Date.now()
      )
        throw new Error(
          "Enter the conversation's actual start time and duration.",
        );
      setStage("Uploading your recording…");
      const authorizationResponse = await fetch("/api/recordings/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType,
          size: file.size,
          startAt,
        }),
      });
      const authorization = await authorizationResponse.json();
      let response: Response;
      if (authorizationResponse.ok) {
        const supabase = getBrowserSupabase();
        if (!supabase)
          throw new Error("Private recording uploads are not configured.");
        const { error: uploadError } = await supabase.storage
          .from("recordings")
          .uploadToSignedUrl(
            authorization.storagePath,
            authorization.token,
            file,
            { contentType: authorization.contentType },
          );
        if (uploadError)
          throw new Error(
            "The recording could not be uploaded. Please try again.",
          );
        setStage("Transcribing and preparing your recap…");
        response = await fetch("/api/process-meeting", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recordingId: authorization.recordingId,
            storagePath: authorization.storagePath,
            fileName: file.name,
            contentType,
            size: file.size,
            meetingId,
            source,
            locale,
            startAt,
            endAt,
          }),
        });
      } else {
        throw new Error(
          authorization.error ||
            "Private recording uploads are not configured.",
        );
      }
      const payload = await response.json();
      if (!response.ok || !payload.persisted)
        throw new Error(
          payload.error ||
            "The recording could not be saved to your workspace.",
        );
      onProcessed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The recording could not be processed.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className={styles.approvalDialog}
      aria-labelledby="recording-title"
      onCancel={(event) => {
        if (working) event.preventDefault();
        else onClose();
      }}
    >
      <div className={styles.recordingForm}>
        <header>
          <div>
            <span className={styles.eyebrow}>ADD A CONVERSATION</span>
            <h2 id="recording-title">Bring the details with you.</h2>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            disabled={working}
            onClick={onClose}
            aria-label="Close recording"
          >
            Close
          </button>
        </header>
        <p className={styles.subtle}>
          Upload a recording or capture a conversation from your microphone.
        </p>
        {working ? (
          <div className={styles.loading}>
            <LoaderCircle />
            <p>{stage}</p>
          </div>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (file) void upload(file);
              }}
              style={{ padding: 0 }}
            >
              <label className={styles.uploadArea}>
                <strong>{file?.name || "Choose an audio recording"}</strong>
                <span>MP3, M4A, WAV, or WebM · up to 25 MB</span>
                <input
                  type="file"
                  required
                  accept="audio/*,.m4a"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>
              <div className={styles.formRow}>
                <label>
                  Conversation started · MYT
                  <input
                    required
                    type="datetime-local"
                    value={capturedAt}
                    onChange={(event) => setCapturedAt(event.target.value)}
                  />
                </label>
                <label>
                  Duration · minutes
                  <input
                    required
                    type="number"
                    min={1}
                    max={480}
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                  />
                </label>
              </div>
              <p className={styles.privateNote}>
                The original date helps interpret phrases like “tomorrow”.
              </p>
              <button className={styles.primaryButton} disabled={!file}>
                Upload & prepare recap
              </button>
            </form>
            <div className={styles.liveCapture}>
              <span>Or record here with Agora</span>
              {open && (
                <LiveRecorder
                  onRecorded={(file, _channel, timing) =>
                    void upload(file, "agora", timing)
                  }
                  onError={setError}
                />
              )}
            </div>
          </>
        )}
        {error && (
          <p className={styles.inlineError} role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
