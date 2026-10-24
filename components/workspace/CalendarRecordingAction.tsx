"use client";

import type { Meeting } from "@/lib/types";
import styles from "./workspace.module.css";

type Props = {
  meeting: Meeting;
  disabled: boolean;
  onChange: (id: string, hidden: boolean) => Promise<boolean>;
};

/** Separate from the entry button: hiding never opens or deletes the recording. */
export function CalendarRecordingAction({ meeting, disabled, onChange }: Props) {
  const hidden = Boolean(meeting.calendarHidden);
  const label = `${hidden ? "Restore to calendar" : "Hide from calendar"}: ${meeting.title}`;
  return (
    <button
      type="button"
      className={styles.calendarRecordingAction}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => void onChange(meeting.id, !hidden)}
    >
      {hidden ? "Restore" : <span aria-hidden="true">×</span>}
    </button>
  );
}
