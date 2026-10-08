"use client";

import { useEffect, useRef, useState } from "react";
import type { ApprovalReceipt } from "./useWorkspace";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./flow.module.css";

// Reopening a confirmed receipt should not replay its success animation.
// Keep this client-session memory bounded; it stores event IDs only.
const celebratedReceipts = new Set<string>();

export function ApprovalReceiptNotice({ receipt, onView, onDismiss }: {
  receipt: ApprovalReceipt;
  onView: () => void;
  onDismiss: () => void;
}) {
  const { dateLabel, timeLabel } = useWorkspaceTime();
  const receiptKey = receipt.mode + ":" + receipt.meetingId;
  const checkedReceipt = useRef<string | null>(null);
  const [celebrationKey, setCelebrationKey] = useState<string | null>(null);

  useEffect(() => {
    if (checkedReceipt.current === receiptKey) return;
    checkedReceipt.current = receiptKey;
    if (celebratedReceipts.has(receiptKey)) {
      setCelebrationKey(null);
      return;
    }
    celebratedReceipts.add(receiptKey);
    if (celebratedReceipts.size > 100) {
      const oldest = celebratedReceipts.values().next().value;
      if (oldest) celebratedReceipts.delete(oldest);
    }
    setCelebrationKey(receiptKey);
  }, [receiptKey]);

  return <section className={styles.receipt} aria-label="Invitation confirmation" role="status">
    <div className={styles.receiptBody}>
      <span className={styles.successMark} aria-hidden="true" data-celebrate={celebrationKey === receiptKey}>
        <svg viewBox="0 0 24 24" fill="none"><path d="m6 12 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div>
        <span className={styles.kicker}>{receipt.mode === "sample" ? "SAMPLE EVENT ADDED" : "INVITATION SENT"}</span>
        <h2>{receipt.title}</h2>
        <p>{dateLabel(receipt.startAt, { weekday: "short" })} at {timeLabel(receipt.startAt)}</p>
        <p>{receipt.mode === "sample" ? "No invitation was sent. This event stays in your sample workspace." : `Sent to ${receipt.attendees.join(", ")}. Your recording and report remain private.`}</p>
      </div>
    </div>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} onClick={onView}>View calendar event</button>
      <button type="button" className={styles.secondary} onClick={onDismiss}>Dismiss confirmation</button>
    </div>
  </section>;
}
