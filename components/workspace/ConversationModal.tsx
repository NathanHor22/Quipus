"use client";

import { useId, type ReactNode } from "react";
import { useDismissiblePanel } from "@/components/ui/useDismissiblePanel";
import type { Meeting } from "@/lib/types";
import { sourceConversation } from "@/lib/workspace/model";
import { ConversationDetail } from "./ConversationDetail";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./detail-dock.module.css";

type DetailProps = React.ComponentProps<typeof ConversationDetail>;

/** Embedded meeting details. The workspace controls desktop and mobile placement. */
export function ConversationModal({ meeting, meetings, onClose, onOpenFull, receipt, ...detail }: {
  meeting: Meeting | null;
  meetings: Meeting[];
  onClose: () => void;
  onOpenFull: (id: string) => void;
  receipt?: ReactNode;
} & Omit<DetailProps, "conversation" | "onBack" | "backLabel" | "compact">) {
  const titleId = useId();
  const { dateLabel, timeLabel } = useWorkspaceTime();
  const conversation = meeting ? sourceConversation(meetings, meeting) : undefined;
  const meetingId = meeting?.id;

  const { panelRef, closePanel, onKeyDown } = useDismissiblePanel<HTMLElement>({
    sessionKey: meetingId,
    onClose,
  });

  if (!meeting) return null;
  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className={styles.header}>
        <h2 id={titleId}>Meeting details</h2>
        <div className={styles.headerActions}>
          {conversation && (
            <button type="button" className={styles.fullPage} onClick={() => onOpenFull(conversation.id)} aria-label="Open full conversation">
              Open full meeting
            </button>
          )}
          <button type="button" className={styles.close} onClick={closePanel} aria-label="Close meeting details">
            <span>Close</span>
          </button>
        </div>
      </header>
      {receipt}
      {meeting.source === "calendar" && (
        <section className={styles.event}>
          <p className={styles.kicker}>On your calendar</p>
          <h3>{meeting.title}</h3>
          <p>{dateLabel(meeting.startAt, { weekday: "long", year: "numeric" })} · {timeLabel(meeting.startAt)}</p>
          {meeting.contacts.length > 0 && <p>{meeting.contacts.map(contact => contact.name).join(", ")}</p>}
        </section>
      )}
      {conversation ? (
        <ConversationDetail {...detail} conversation={conversation} compact backLabel="Close meeting" onBack={closePanel} />
      ) : (
        <section className={styles.empty}>
          <h3>No linked recording</h3>
          <p>A summary and actions will appear here after this meeting is recorded.</p>
        </section>
      )}
    </section>
  );
}
