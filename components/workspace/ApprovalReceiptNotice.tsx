"use client";

import type { ApprovalReceipt } from "./useWorkspace";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./flow.module.css";

export function ApprovalReceiptNotice({ receipt, onView, onDismiss }: {
  receipt: ApprovalReceipt;
  onView: () => void;
  onDismiss: () => void;
}) {
  const { dateLabel, timeLabel } = useWorkspaceTime();
  return <section className={styles.receipt} aria-label="Invitation confirmation" role="status">
    <div>
      <span className={styles.kicker}>{receipt.mode === "sample" ? "SAMPLE EVENT ADDED" : "INVITATION SENT"}</span>
      <h2>{receipt.title}</h2>
      <p>{dateLabel(receipt.startAt, { weekday: "short" })} at {timeLabel(receipt.startAt)}</p>
      <p>{receipt.mode === "sample" ? "No invitation was sent. This event stays in your sample workspace." : `Sent to ${receipt.attendees.join(", ")}. Your recording and report remain private.`}</p>
    </div>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} onClick={onView}>View calendar event</button>
      <button type="button" className={styles.secondary} onClick={onDismiss}>Dismiss confirmation</button>
    </div>
  </section>;
}
