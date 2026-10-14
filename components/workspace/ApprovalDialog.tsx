"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useDismissiblePanel } from "@/components/ui/useDismissiblePanel";
import type { MeetingApproval, WorkspaceMode } from "@/lib/workspace/model";
import { scheduleDetailsSchema } from "@/lib/workspace/model";
import styles from "./detail-dock.module.css";
import { useWorkspaceTime } from "./WorkspaceTime";
import { localDateTime, localDateTimeToIso } from "@/lib/workspace-time";

type ApprovalDialogProps = {
  approval: MeetingApproval | null;
  mode: WorkspaceMode;
  working: boolean;
  onClose: () => void;
  onApprove: (approval: MeetingApproval) => Promise<unknown>;
  executionError: string | null;
};

/** Each review owns its draft; polling the same approval cannot overwrite edits. */
export function ApprovalDialog(props: ApprovalDialogProps) {
  const { timezone } = useWorkspaceTime();
  return props.approval ? <ApprovalReview key={JSON.stringify([props.approval.id, timezone])}
    {...props} approval={props.approval} timezone={timezone} /> : null;
}

function ApprovalReview({ approval, mode, working, executionError, onClose, onApprove, timezone }:
  Omit<ApprovalDialogProps, "approval"> & { approval: MeetingApproval; timezone: string }) {
  const activeApproval = useRef<string | null>(null);
  const titleId = useId();
  const [title, setTitle] = useState(approval.title);
  const [dateTime, setDateTime] = useState(() => approval.details.startAt ? localDateTime(approval.details.startAt, timezone) : "");
  const [duration, setDuration] = useState(approval.details.durationMinutes?.toString() || "");
  const [email, setEmail] = useState(approval.details.attendees.join(", "));
  const [location, setLocation] = useState(approval.details.location || "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = working || submitting;
  const reviewId = approval.id;

  const { panelRef, closePanel, onKeyDown } = useDismissiblePanel<HTMLElement>({
    sessionKey: reviewId,
    onClose,
    dismissDisabled: busy,
  });

  useEffect(() => {
    activeApproval.current = reviewId;
    return () => { activeApproval.current = null; };
  }, [reviewId]);

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className={styles.header}>
        <h2 id={titleId}>Review invitation</h2>
        <button type="button" className={styles.close} onClick={closePanel} disabled={busy} aria-label="Close approval">
          <span>Close</span>
        </button>
      </header>
      <p className={styles.reviewIntro}>{approval.contact?.name || "Meeting invitation"}{approval.contact?.company ? ` · ${approval.contact.company}` : ""}</p>
      <form
        className={styles.form}
        onSubmit={async event => {
          event.preventDefault();
          if (busy) return;
          setError(null);
          setSubmitting(true);
          const approvalId = approval.id;
          try {
            if (!title.trim()) throw new Error("Add a meeting title.");
            const details = scheduleDetailsSchema.parse({
              ...approval.details,
              startAt: localDateTimeToIso(dateTime, timezone),
              durationMinutes: Number(duration),
              attendees: email.split(",").map(value => value.trim()).filter(Boolean),
              location: location || null,
            });
            if (!details.attendees.length) throw new Error("Add at least one attendee email.");
            if (Date.parse(details.startAt!) <= Date.now()) throw new Error("Choose a future date and time.");
            const result = await onApprove({ ...approval, title: title.trim(), details });
            if (result && activeApproval.current === approvalId) closePanel();
          } catch (cause) {
            if (activeApproval.current !== approvalId) return;
            setError(cause instanceof Error && !cause.message.startsWith("[") ? cause.message : "Check the meeting details and attendee email.");
          } finally {
            if (activeApproval.current === approvalId) setSubmitting(false);
          }
        }}
      >
        <fieldset disabled={busy} className={styles.fields}>
          <label>Meeting title<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>Date & time · {timezone.replaceAll("_", " ")}<input type="datetime-local" required value={dateTime} onChange={event => setDateTime(event.target.value)} /></label>
          <label>Duration in minutes<input type="number" required min={5} max={480} value={duration} onChange={event => setDuration(event.target.value)} /></label>
          <label>Attendee email(s)<input required value={email} placeholder="client@company.com" onChange={event => setEmail(event.target.value)} /><small>Separate multiple addresses with commas.</small></label>
          <label>Location<input value={location} maxLength={500} placeholder="Add a location, if agreed" onChange={event => setLocation(event.target.value)} /></label>
        </fieldset>
        {approval.details.evidence && <blockquote className={styles.evidence}>“{approval.details.evidence}”</blockquote>}
        {(error || executionError) && <p role="alert" className={styles.error}>{error || executionError}</p>}
        <p className={styles.privateNote}>{mode === "sample" ? "This adds a sample event only. No invitation will be sent." : "Approval sends a calendar invitation. Your conversation recap stays private."}</p>
        <footer className={styles.formActions}>
          <button type="button" className={styles.cancel} onClick={closePanel} disabled={busy}>Cancel</button>
          <button type="submit" className={styles.approve} disabled={busy}>{busy ? mode === "sample" ? "Adding sample event…" : "Sending invitation…" : mode === "sample" ? "Approve sample meeting" : "Approve & send invitation"}</button>
        </footer>
      </form>
    </section>
  );
}
