"use client";

import { useMemo, useState, type ComponentProps } from "react";
import type { Contact, Meeting } from "@/lib/types";
import type { WorkspaceMode } from "@/lib/workspace/model";
import { initials } from "@/lib/workspace/contact-display";
import { ConversationJournal } from "./ConversationJournal";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./people-connections.module.css";

type JournalProps = ComponentProps<typeof ConversationJournal>;

type PeopleConnectionsProps = {
  contacts: Contact[];
  conversations: Meeting[];
  mode: WorkspaceMode;
  filters: JournalProps["filters"];
  onFiltersChange: JournalProps["onFiltersChange"];
  onOpenClient: (id: string) => void;
  onOpenConversation: JournalProps["onOpen"];
  onRetryAccepted: JournalProps["onRetryAccepted"];
};

export function PeopleConnections({
  contacts, conversations, mode, filters, onFiltersChange,
  onOpenClient, onOpenConversation, onRetryAccepted,
}: PeopleConnectionsProps) {
  const [search, setSearch] = useState("");
  const [allConversations, setAllConversations] = useState(false);
  const { dateLabel } = useWorkspaceTime();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matching = contacts.filter(contact =>
    [contact.name, contact.company, contact.role, contact.email]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(normalizedSearch),
  );
  const histories = useMemo(() => {
    const result = new Map<string, { count: number; latest: Meeting }>();
    for (const conversation of conversations) {
      for (const id of new Set(conversation.contacts.map(contact => contact.id))) {
        const existing = result.get(id);
        result.set(id, {
          count: (existing?.count || 0) + 1,
          latest: !existing || Date.parse(conversation.startAt) > Date.parse(existing.latest.startAt)
            ? conversation : existing.latest,
        });
      }
    }
    return result;
  }, [conversations]);

  return <section className={styles.connections} aria-label="Your connection" data-workspace-intro="people">
    <div className={styles.searchRow}>
      <label className={styles.search}>
        <input type="search" aria-label="Search people" placeholder="Find a person or company"
          value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      {search && <button type="button" className={styles.clear} onClick={() => setSearch("")}>Clear</button>}
    </div>
    <span className={styles.announcement} role="status">{matching.length} {matching.length === 1 ? "connection" : "connections"} found</span>
    {matching.length ? <ul className={styles.cards} aria-label="Connection cards">
      {matching.map(contact => {
        const history = histories.get(contact.id);
        return <li key={contact.id}>
          <button type="button" className={styles.card} onClick={() => onOpenClient(contact.id)}
            aria-label={`Open ${contact.name}'s profile`}>
            <span className={styles.cardHeader}>
              <span className={styles.company}>{contact.company || "Connection"}</span>
              <span className={styles.avatar} aria-hidden="true">{initials(contact.name)}</span>
            </span>
            <span className={styles.identity}>
              <strong>{contact.name}</strong>
              {contact.role && <span className={styles.role}>{contact.role}</span>}
            </span>
            {contact.email && <span className={styles.email}>{contact.email}</span>}
            <span className={styles.cardFooter}>
              <span>{history?.count || 0} conversation{history?.count === 1 ? "" : "s"}</span>
              {history && !history.latest.recordingProgress?.timeUncertain && <time dateTime={history.latest.startAt}>
                Last spoke {dateLabel(history.latest.startAt)}
              </time>}
            </span>
          </button>
        </li>;
      })}
    </ul> : <div className={styles.empty}>
      <h2>{search ? "No matching connections" : "No connections yet"}</h2>
      <p>{search ? "Try another name or company." : "People from your conversations will appear here."}</p>
    </div>}
    <div className={styles.history}>
      {allConversations && <button type="button" className={styles.recent} onClick={() => setAllConversations(false)}>Show recent conversations</button>}
      <ConversationJournal meetings={conversations} mode={mode} compact={!allConversations}
        filters={filters} onFiltersChange={onFiltersChange} onOpen={onOpenConversation}
        onAll={() => setAllConversations(true)} onRetryAccepted={onRetryAccepted} />
    </div>
  </section>;
}
