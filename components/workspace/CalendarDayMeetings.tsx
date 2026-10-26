"use client";

import { useId } from "react";
import type { Meeting } from "@/lib/types";
import { selectMeetingTitle } from "@/lib/meeting-title";
import { canHideRecording } from "@/lib/workspace/calendar-visibility";
import { useDismissiblePanel } from "@/components/ui/useDismissiblePanel";
import { CalendarRecordingAction } from "./CalendarRecordingAction";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./calendar-day-meetings.module.css";

type Props = {
  date: string;
  meetings: Meeting[];
  working: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onVisibilityChange: (id: string, hidden: boolean) => Promise<boolean>;
};

/** Only opened by a date or More; selecting a row replaces this list with its meeting. */
export function CalendarDayMeetings({ date, meetings, working, onOpen, onClose, onVisibilityChange }: Props) {
  const { timezone, dateLabel, timeLabel } = useWorkspaceTime();
  const headingId = useId();
  const label = dateLabel(`${date}T12:00:00Z`, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const { panelRef, closePanel, onKeyDown } = useDismissiblePanel<HTMLElement>({ sessionKey: date, onClose });
  return <section ref={panelRef} className={styles.panel} tabIndex={-1} onKeyDown={onKeyDown}
    aria-labelledby={headingId} data-calendar-day-list>
    <header className={styles.header}>
      <h2 id={headingId}>{label}</h2>
      <button type="button" className={styles.close} onClick={closePanel} aria-label="Close day meetings">Close</button>
    </header>
    {meetings.length ? <div className={styles.list}>{meetings.map(meeting => {
      const title = selectMeetingTitle({ preferredTitle: meeting.title, startAt: meeting.startAt, timeZone: timezone });
      return <article key={meeting.id} className={styles.row}>
        <button type="button" className={styles.meeting} onClick={() => onOpen(meeting.id)}>
          <strong>{title}</strong>
          <span>{meeting.recordingProgress?.timeUncertain ? "Time unconfirmed" : timeLabel(meeting.startAt)}</span>
        </button>
        {canHideRecording(meeting) && <CalendarRecordingAction meeting={meeting} disabled={working} onChange={onVisibilityChange} />}
      </article>;
    })}</div> : <p className={styles.empty}>No meetings on this date.</p>}
  </section>;
}
