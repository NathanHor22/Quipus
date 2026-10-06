"use client";

import { useMemo, useState } from "react";
import type { Meeting } from "@/lib/types";
import { getApprovals } from "@/lib/workspace/model";
import type { WorkspaceMode } from "@/lib/workspace/model";
import { getRecordingProgress, recordingDurationLabel } from "@/lib/workspace/recording-progress";
import { RecordingProgress } from "./RecordingProgress";
import { initials } from "./ConversationPanel";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./quipus.module.css";

type JournalFilters = { query: string; date: string };

export function ConversationJournal({ meetings, mode = "sample", compact = false, onOpen, onAll, onPeople, filters, onFiltersChange, onRetryAccepted }: {
  meetings: Meeting[];
  mode?: WorkspaceMode;
  compact?: boolean;
  onOpen: (id: string, tab?: "Audio") => void;
  onAll?: () => void;
  onPeople?: () => void;
  filters?: JournalFilters;
  onFiltersChange?: (filters: JournalFilters) => void;
  onRetryAccepted?: () => void;
}) {
  const { timezone, dateKey, dateLabel, timeLabel } = useWorkspaceTime();
  const [localFilters, setLocalFilters] = useState<JournalFilters>({ query: "", date: "" });
  const { query, date } = filters || localFilters;
  const changeFilters = onFiltersChange || setLocalFilters;
  const today = dateKey(new Date());
  const { groups, count } = useMemo(() => {
    const matching = meetings.filter(meeting => (!date || dateKey(meeting.startAt) === date) &&
      `${meeting.title} ${meeting.contacts.map(contact => `${contact.name} ${contact.company || ""}`).join(" ")} ${meeting.insight?.intent || ""}`
        .toLowerCase().includes(query.toLowerCase().trim()));
    const grouped = new Map<string, Meeting[]>();
    for (const meeting of compact ? matching.slice(0, 6) : matching) {
      const key = dateKey(meeting.startAt);
      grouped.set(key, [...(grouped.get(key) || []), meeting]);
    }
    return { groups: grouped, count: matching.length };
  }, [meetings, compact, date, query, timezone, dateKey]);

  return <section className={styles.journal} aria-label="Conversation history">
    <header className={styles.sectionHeading}>
      <div className={styles.historyHeading}><h2>{compact ? "Recent conversations" : "Meeting history"}</h2><span>{count}</span></div>
      {compact && onAll ? <button className={styles.textLink} onClick={onAll}>View all</button> :
        onPeople && <button className={styles.textLink} onClick={onPeople}>People & companies</button>}
    </header>
    <div className={styles.journalFilters}>
      <label className={styles.search}><input aria-label="Search conversations" placeholder="Search client, company or meeting" value={query} onChange={event => changeFilters({ query: event.target.value, date })} /></label>
      <label className={styles.dateFilter}><span>Date</span><input aria-label="Filter conversation date" type="date" value={date} onChange={event => changeFilters({ query, date: event.target.value })} /></label>
      {(query || date) && <button className={styles.clearFilter} aria-label="Clear conversation filters" onClick={() => changeFilters({ query: "", date: "" })}><span>Clear</span></button>}
    </div>
    <div className={styles.journalSurface}>
      {!!groups.size && <div className={styles.journalColumns} aria-hidden="true"><span>Time</span><span>Client / company</span><span>Meeting</span><span>Duration</span><span>Status</span><span /></div>}
      {[...groups].map(([day, entries]) => <div key={day} className={styles.dayGroup}>
        <h3>{day === today ? "Today" : dateLabel(entries[0].startAt, { weekday: "short", year: "numeric" })}</h3>
        {entries.map(meeting => {
          const contact = meeting.contacts[0];
          const duration = recordingDurationLabel(meeting);
          const needsApproval = getApprovals([meeting]).some(approval => approval.status === "pending");
          const progress = getRecordingProgress(meeting);
          const status = needsApproval && meeting.status === "ready" ? "Review follow-up" : progress.label;
          return <div key={meeting.id} className={styles.journalEntry}><button className={styles.journalRow} onClick={() => onOpen(meeting.id)} aria-label={`Open ${contact?.name || meeting.title}, ${timeLabel(meeting.startAt)}, ${status}`}>
            <span className={styles.journalTime}>{timeLabel(meeting.startAt)}</span>
            <span className={styles.journalIdentity}><span className={styles.journalAvatar}>{initials(contact?.name || meeting.title)}</span><span className={styles.journalCopy}><strong>{contact?.name || meeting.title}</strong><span>{contact?.company || meeting.insight?.intent || meeting.title}</span></span></span>
            <span className={styles.journalTopic} title={meeting.insight?.intent || meeting.title}>{meeting.insight?.intent || meeting.title}</span>
            <span className={styles.journalDuration}>{duration}</span>
            <span className={styles.journalStatus} data-status={meeting.status} data-approval={needsApproval && meeting.status === "ready"}>{status}</span>
            <span className={styles.rowArrow}>Open</span>
          </button>{progress.stage === "failed" && <div className={styles.journalRecovery}><RecordingProgress meeting={meeting} mode={mode} onOpenAudio={() => onOpen(meeting.id, "Audio")} onRetryAccepted={onRetryAccepted} /></div>}</div>;
        })}
      </div>)}
      {!groups.size && <div className={styles.journalEmpty}><h3>{query || date ? "No matching conversations" : "No conversations yet"}</h3><p>{query || date ? "Try a different search or date." : "Your recorded meetings will appear here."}</p></div>}
    </div>
  </section>;
}
