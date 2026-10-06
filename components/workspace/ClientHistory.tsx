"use client";

import { useId, useMemo } from "react";
import type { Contact, Meeting } from "@/lib/types";
import { clientHistory } from "@/lib/workspace/client-history";
import { initials } from "./ConversationPanel";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./client-history.module.css";

export type ClientHistoryProps = {
  contact: Contact;
  conversations: Meeting[];
  onOpenMeeting: (meetingId: string) => void;
  onBack?: () => void;
  onCorrect?: () => void;
};

export function ClientHistory({ contact, conversations, onOpenMeeting, onBack, onCorrect }: ClientHistoryProps) {
  const { dateLabel, timeLabel } = useWorkspaceTime();
  const nextStepId = useId();
  const history = useMemo(() => clientHistory(contact, conversations), [contact, conversations]);

  return <section className={styles.history} aria-label={`Client history for ${contact.name}`}>
    {onBack && <button type="button" className={styles.back} onClick={onBack}>People & companies</button>}
    <header className={styles.hero}>
      <span className={styles.avatar} aria-hidden="true">{initials(contact.name)}</span>
      <div className={styles.identity}><span className={styles.kicker}>SAVED CONTACT</span><h2>{contact.name}</h2><p>{[contact.role, contact.company].filter(Boolean).join(" · ") || "Contact details have not been added."}</p></div>
      {onCorrect && <button type="button" className={styles.correct} onClick={onCorrect}>Correct details</button>}
    </header>

    <div className={styles.details} aria-label="Saved contact details">
      <div><span>Company<strong>{contact.company || "Not added"}</strong></span></div>
      <div><span>Email<strong>{contact.email || "Not added"}</strong></span></div>
      {contact.phone && <div><span>Phone<strong>{contact.phone}</strong></span></div>}
      <p>Saved contact details. Verify identity before contacting. Public research does not confirm a person’s identity.</p>
    </div>

    {history.nextStepMeeting && <section className={styles.nextStep} aria-labelledby={nextStepId}>
      <span className={styles.kicker}>LATEST NEXT STEP</span>
      <h3 id={nextStepId}>{history.nextStepMeeting.insight!.next}</h3>
      <div><span>From {dateLabel(history.nextStepMeeting.startAt, { year: "numeric" })}</span><button type="button" onClick={() => onOpenMeeting(history.nextStepMeeting!.id)}>View conversation</button></div>
    </section>}

    <div className={styles.columns}>
      <section className={styles.meetings} aria-label="Prior meetings">
        <header className={styles.sectionHeader}><h3>Conversation history</h3><span>{history.meetings.length}</span></header>
        {history.meetings.length ? history.meetings.map(meeting => <button type="button" className={styles.meeting} key={meeting.id} onClick={() => onOpenMeeting(meeting.id)}>
          <span className={styles.meetingDate}>{dateLabel(meeting.startAt, { year: "numeric" })}<small>{timeLabel(meeting.startAt)}</small></span>
          <span className={styles.meetingCopy}><strong>{meeting.title}</strong><span>{meeting.insight?.executiveSummary || meeting.insight?.intent || (meeting.status === "processing" ? "Preparing your summary…" : "Open the conversation to review its details.")}</span></span>
        </button>) : <p className={styles.empty}>Recorded conversations linked to this contact will appear here.</p>}
      </section>

      <section className={styles.outstanding} aria-label="Outstanding commitments">
        <header className={styles.sectionHeader}><h3>Outstanding items</h3><span>{history.outstanding.length}</span></header>
        {history.outstanding.length ? history.outstanding.map(item => <article className={styles.item} key={item.key}>
          <span className={styles.itemOwner}>{item.owner}</span>
          <strong>{item.description}</strong>
          {item.dueAt && <span className={styles.due}>Due {dateLabel(item.dueAt, { year: "numeric" })}</span>}
          <button type="button" onClick={() => onOpenMeeting(item.meeting.id)}>Review conversation</button>
        </article>) : <p className={styles.empty}>No outstanding follow-ups or commitments are recorded for this contact.</p>}
      </section>
    </div>

    {history.research.length > 0 && <section className={styles.research} aria-label="Unverified public company context">
      <header className={styles.researchHeader}><div><span className={styles.kicker}>PUBLIC CONTEXT · UNVERIFIED</span><h3>Company sources</h3><p>These sources describe the company. They do not establish that this contact is the person mentioned in a source.</p></div></header>
      <div className={styles.sources}>{history.research.map(({ source, meeting }) => <article key={source.url}>
        <span>{source.company}{source.publishedDate ? ` · ${source.publishedDate}` : ""}</span>
        <a href={source.url} target="_blank" rel="noreferrer nofollow">{source.title}</a>
        <p>{source.snippet}</p>
        <button type="button" onClick={() => onOpenMeeting(meeting.id)}>View source conversation</button>
      </article>)}</div>
    </section>}
  </section>;
}
