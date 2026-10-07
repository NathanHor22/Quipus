"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowUpRight, X } from "lucide-react";
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
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const { dateLabel, timeLabel } = useWorkspaceTime();
  const conversation = meeting ? sourceConversation(meetings, meeting) : undefined;

  useEffect(() => {
    if (!meeting) return;
    const element = panel.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (trigger && !element?.contains(trigger)) opener.current = trigger;
    element?.focus({ preventScroll: true });
    return () => {
      if (element?.contains(document.activeElement) && trigger?.isConnected && !element.contains(trigger)) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [meeting?.id]);

  const closePanel = () => {
    const trigger = opener.current;
    onClose();
    requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
  };

  if (!meeting) return null;
  return (
    <section
      ref={panel}
      className={styles.panel}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <header className={styles.header}>
        <h2 id={titleId}>Meeting details</h2>
        <div className={styles.headerActions}>
          {conversation && (
            <button type="button" className={styles.fullPage} onClick={() => onOpenFull(conversation.id)} aria-label="Open full conversation">
              <ArrowUpRight aria-hidden="true" />
            </button>
          )}
          <button type="button" className={styles.close} onClick={closePanel} aria-label="Close meeting details">
            <X aria-hidden="true" /><span>Close</span>
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
