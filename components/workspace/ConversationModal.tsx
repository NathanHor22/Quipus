"use client";

import { type ReactNode } from "react";
import { useDismissiblePanel } from "@/components/ui/useDismissiblePanel";
import type { Meeting } from "@/lib/types";
import { selectMeetingTitle } from "@/lib/meeting-title";
import { sourceConversation } from "@/lib/workspace/model";
import { ConversationDetail } from "./ConversationDetail";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./detail-dock.module.css";

type DetailProps = React.ComponentProps<typeof ConversationDetail>;

/** A selected event and its linked recording share one header and one set of tabs. */
export function ConversationModal({ meeting, meetings, onClose, receipt, ...detail }: {
  meeting: Meeting | null;
  meetings: Meeting[];
  onClose: () => void;
  receipt?: ReactNode;
} & Omit<DetailProps, "conversation" | "onBack" | "backLabel" | "compact" | "headingMeeting" | "onClosePanel">) {
  const { timezone, dateLabel, timeLabel } = useWorkspaceTime();
  const conversation = meeting ? sourceConversation(meetings, meeting) : undefined;
  const meetingId = meeting?.id;
  const { panelRef, closePanel, onKeyDown } = useDismissiblePanel<HTMLElement>({
    sessionKey: meetingId,
    onClose,
  });

  if (!meeting) return null;
  const title = selectMeetingTitle({ preferredTitle: meeting.title, startAt: meeting.startAt, timeZone: timezone });
  return <section ref={panelRef} className={`${styles.panel} ${styles.meetingPanel}`}
    aria-label={title} tabIndex={-1} onKeyDown={onKeyDown}>
    {receipt}
    {conversation ? <ConversationDetail {...detail} conversation={conversation}
      headingMeeting={meeting.source === "calendar" ? meeting : undefined}
      onClosePanel={closePanel} compact backLabel="Close meeting" onBack={closePanel} /> : <>
      <header className={styles.singleHeader}>
        <h2>{title}</h2>
        <button type="button" className={styles.close} onClick={closePanel} aria-label="Close meeting details">Close</button>
      </header>
      <p className={styles.singleMeta}>{dateLabel(meeting.startAt, { weekday: "long", year: "numeric" })}{" \u00b7 "}{timeLabel(meeting.startAt)}</p>
      {meeting.contacts.length > 0 && <p className={styles.singleMeta}>{meeting.contacts.map(contact => contact.name).join(", ")}</p>}
      <section className={styles.empty}>
        <h3>No linked recording</h3>
        <p>A summary and actions will appear here after this meeting is recorded.</p>
      </section>
    </>}
  </section>;
}
