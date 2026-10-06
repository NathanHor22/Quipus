"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Meeting } from "@/lib/types";
import { sourceConversation } from "@/lib/workspace/model";
import { ConversationDetail } from "./ConversationDetail";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./flow.module.css";

type DetailProps = React.ComponentProps<typeof ConversationDetail>;

export function ConversationModal({ meeting, meetings, onClose, onOpenFull, receipt, ...detail }: {
  meeting: Meeting | null;
  meetings: Meeting[];
  onClose: () => void;
  onOpenFull: (id: string) => void;
  receipt?: ReactNode;
} & Omit<DetailProps, "conversation" | "onBack" | "backLabel" | "compact">) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { dateLabel, timeLabel } = useWorkspaceTime();
  const conversation = meeting ? sourceConversation(meetings, meeting) : undefined;
  useEffect(() => {
    if (meeting && !dialog.current?.open) dialog.current?.showModal();
    if (!meeting) dialog.current?.close();
  }, [meeting?.id]);
  if (!meeting) return null;
  return <dialog ref={dialog} className={styles.modal} aria-label="Meeting details" onCancel={onClose} onClick={event => { if (event.currentTarget === event.target) onClose(); }}>
    <header className={styles.modalHeader}>
      <span className={styles.kicker}>MEETING DETAILS</span>
      <div className={styles.actions}>
        {conversation && <button type="button" className={styles.secondary} onClick={() => onOpenFull(conversation.id)}>Open full conversation</button>}
        <button type="button" className={styles.secondary} onClick={onClose}>Close</button>
      </div>
    </header>
    {receipt}
    {meeting.source === "calendar" && <section className={styles.event}>
      <span className={styles.kicker}>ON YOUR CALENDAR</span>
      <h2>{meeting.title}</h2>
      <p>{dateLabel(meeting.startAt, { weekday: "short", year: "numeric" })} · {timeLabel(meeting.startAt)} – {timeLabel(meeting.endAt)}</p>
      {meeting.contacts.length > 0 && <p>{meeting.contacts.map(contact => contact.name).join(", ")}</p>}
    </section>}
    {conversation ? <ConversationDetail {...detail} conversation={conversation} compact backLabel="Close meeting" onBack={onClose} /> : <section className={styles.empty}><h3>No recording linked to this event</h3><p>This event is on your calendar. A linked recording will make its summary, actions, transcript and audio available here.</p></section>}
  </dialog>;
}
