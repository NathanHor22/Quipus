"use client";

import { useEffect, useRef, useState } from "react";
import type { MeetingApproval, WorkspaceMode } from "@/lib/workspace/model";
import { scheduleDetailsSchema } from "@/lib/workspace/model";
import styles from "./workspace.module.css";
import { useWorkspaceTime } from "./WorkspaceTime";
import { localDateTime, localDateTimeToIso } from "@/lib/workspace-time";

export function ApprovalDialog({
  approval,
  mode,
  working,
  executionError,
  onClose,
  onApprove,
}: {
  approval: MeetingApproval | null;
  mode: WorkspaceMode;
  working: boolean;
  onClose: () => void;
  onApprove: (approval: MeetingApproval) => Promise<unknown>;
  executionError: string | null;
}) {
  const { timezone } = useWorkspaceTime();
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [duration, setDuration] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!approval) {
      dialog.current?.close();
      return;
    }
    setTitle(approval.title);
    setDateTime(
      approval.details.startAt
        ? localDateTime(approval.details.startAt, timezone)
        : "",
    );
    setDuration(approval.details.durationMinutes?.toString() || "");
    setEmail(approval.details.attendees.join(", "));
    setLocation(approval.details.location || "");
    setError(null);
    dialog.current?.showModal();
  }, [approval, timezone]);
  if (!approval) return null;
  return (
    <dialog
      ref={dialog}
      className={styles.approvalDialog}
      aria-labelledby="approval-title"
      onCancel={(event) => {
        if (working) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            const details = scheduleDetailsSchema.parse({
              ...approval.details,
              startAt: localDateTimeToIso(dateTime, timezone),
              durationMinutes: Number(duration),
              attendees: email
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              location: location || null,
            });
            if (!details.attendees.length)
              throw new Error("Add at least one attendee email.");
            if (Date.parse(details.startAt!) <= Date.now())
              throw new Error("Choose a future date and time.");
            const result = await onApprove({ ...approval, title, details });
            if (result) onClose();
          } catch (cause) {
            setError(
              cause instanceof Error && !cause.message.startsWith("[")
                ? cause.message
                : "Check the meeting details and attendee email.",
            );
          }
        }}
      >
        <header>
          <div>
            <span className={styles.eyebrow}>MEETING APPROVAL</span>
            <h2 id="approval-title">Ready when you are.</h2>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            disabled={working}
            aria-label="Close approval"
          >
            Close
          </button>
        </header>
        <p className={styles.subtle}>
          Review the details from your conversation with{" "}
          {approval.contact?.name || "your client"}.
        </p>
        <label>
          Meeting title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className={styles.formRow}>
          <label>
            Date & time · {timezone.replaceAll("_", " ")}
            <input
              type="datetime-local"
              required
              value={dateTime}
              onChange={(event) => setDateTime(event.target.value)}
            />
          </label>
          <label>
            Duration · minutes
            <input
              type="number"
              required
              min={5}
              max={480}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
        </div>
        <label>
          Attendee email(s)
          <input
            required
            value={email}
            placeholder="client@company.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <small>Separate multiple addresses with commas.</small>
        </label>
        <label>
          Location
          <input
            value={location}
            maxLength={500}
            placeholder="Add a location, if agreed"
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        {approval.details.evidence && (
          <blockquote className={styles.evidence}>
            “{approval.details.evidence}”
          </blockquote>
        )}
        {(error || executionError) && (
          <p role="alert" className={styles.inlineError}>
            {error || executionError}
          </p>
        )}
        <p className={styles.privateNote}>
          {mode === "sample"
            ? "This adds a sample event only. No invitation will be sent."
            : "Approval sends a calendar invitation. Your conversation recap stays private."}
        </p>
        <footer>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={working}
          >
            Cancel
          </button>
          <button className={styles.primaryButton} disabled={working}>
            {working
              ? "Adding meeting…"
              : mode === "sample"
                ? "Approve sample meeting"
                : "Approve & send invitation"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
