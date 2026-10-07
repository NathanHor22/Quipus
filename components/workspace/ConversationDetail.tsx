"use client";
import { ShareMeetingWhatsApp } from "./WhatsAppDelivery";
import { EmailFollowUp } from "./EmailFollowUp";
import { RecordingProgress } from "./RecordingProgress";

import { useEffect, useId, useRef, useState } from "react";

import type { Contact, Meeting } from "@/lib/types";
import {
  getApprovals,
  type MeetingApproval,
  type WorkspaceMode,
} from "@/lib/workspace/model";
import { ConversationReplay, type PlaybackProgress } from "./ConversationReplay";
import { formatAudioTime } from "@/lib/workspace/playback";
import { getRecordingProgress, recordingDurationLabel } from "@/lib/workspace/recording-progress";
import { initials } from "./ConversationPanel";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./conversation-detail.module.css";

type EditableContact = Pick<Contact, "name" | "company" | "role" | "email">;
const detailTabs = ["Summary", "Actions", "Transcript", "Audio"] as const;
export type DetailTab = (typeof detailTabs)[number];

export type ConversationDetailProps = {
  conversation: Meeting;
  mode: WorkspaceMode;
  working: string | null;
  error: string | null;
  onBack: () => void;
  onTask: (id: string, completed: boolean) => void;
  onEditApproval: (approval: MeetingApproval) => void;
  /** Kept for existing callers. Approval happens only in the review dialog. */
  onApprove?: (approval: MeetingApproval) => void;
  onUpdateContact: (id: string, changes: EditableContact) => Promise<boolean>;
  onOpenContact?: (contactId: string) => void;
  initialTab?: DetailTab;
  initialContactEditing?: boolean;
  initialContactId?: string | null;
  backLabel?: string;
  compact?: boolean;
  onRetryAccepted?: () => void | Promise<void>;
};

export function ConversationDetail({
  conversation,
  mode,
  working,
  error,
  onBack,
  onTask,
  onEditApproval,
  onUpdateContact,
  onOpenContact,
  initialTab = "Summary",
  initialContactEditing = false,
  initialContactId,
  backLabel = "All conversations",
  compact = false,
  onRetryAccepted,
}: ConversationDetailProps) {
  const { dateLabel, timeLabel } = useWorkspaceTime();
  const panelPrefix = useId();
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const tabId = (tab: DetailTab) => `${panelPrefix}-tab-${tab.toLowerCase()}`;
  const panelId = (tab: DetailTab) => `${panelPrefix}-panel-${tab.toLowerCase()}`;
  const playback = useRef<PlaybackProgress | undefined>(undefined);
  const contact = initialContactId != null
    ? conversation.contacts.find(person => person.id === initialContactId) || null
    : conversation.contacts[0] || null;
  const insight = conversation.insight;
  const approvals = getApprovals([conversation]).filter(
    (approval) => approval.status === "pending",
  );
  const tasks = (conversation.followUps || []).filter(
    (task) => task.type !== "schedule" && task.status !== "dismissed",
  );
  const commitments = insight?.commitments || [];
  const [editingContact, setEditingContact] = useState(Boolean(initialContactEditing && contact));
  const [contactDraft, setContactDraft] = useState<EditableContact>({
    name: contact?.name || "",
    company: contact?.company || null,
    role: contact?.role || null,
    email: contact?.email || null,
  });

  useEffect(() => {
    setActiveTab(initialTab);
    playback.current = undefined;
  }, [conversation.id, initialTab]);

  useEffect(() => {
    setEditingContact(Boolean(initialContactEditing && contact?.id));
  }, [conversation.id, initialContactEditing, initialContactId, contact?.id]);

  useEffect(() => {
    setContactDraft({
      name: contact?.name || "",
      company: contact?.company || null,
      role: contact?.role || null,
      email: contact?.email || null,
    });
  }, [contact?.name, contact?.company, contact?.role, contact?.email]);

  const saveContact = async () => {
    if (!contact || !contactDraft.name.trim()) return;
    const saved = await onUpdateContact(contact.id, {
      name: contactDraft.name.trim(),
      company: contactDraft.company?.trim() || null,
      role: contactDraft.role?.trim() || null,
      email: contactDraft.email?.trim().toLowerCase() || null,
    });
    if (saved) setEditingContact(false);
  };

  return (
    <div className={`${styles.detail} ${compact ? styles.compact : ""}`}>
      {!compact && <button className={styles.back} onClick={onBack}>
        {backLabel}
      </button>}

      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          {!compact && <span className={styles.heroAvatar}>
            {initials(contact?.name || conversation.title)}
          </span>}
          <div>
            <div className={styles.heroMeta}>
              {!compact && conversation.status !== "ready" && <span className={styles.status}>{conversation.status}</span>}
              <span>{dateLabel(conversation.startAt, { year: "numeric" })}</span>
              <span>{timeLabel(conversation.startAt)}</span>
            </div>
            <h2>{contact?.name || conversation.title}</h2>
            <p>
              {contact?.company || conversation.title}
              {contact?.role ? ` · ${contact.role}` : ""}
            </p>
          </div>
        </div>
        {!compact && <dl className={styles.heroFacts}>
          <div><dt>Duration</dt><dd>{recordingDurationLabel(conversation)}</dd></div>
          <div><dt>Source</dt><dd>{conversation.source === "hardware" ? "Quipus" : conversation.source}</dd></div>
          <div><dt>Transcript</dt><dd>{conversation.transcript?.length || 0} segments</dd></div>
        </dl>}
      </header>

      {error && <p className={styles.pageError} role="alert">{error}</p>}
      {getRecordingProgress(conversation).stage !== "ready" && <RecordingProgress meeting={conversation} mode={mode} onOpenAudio={() => setActiveTab("Audio")} onRetryAccepted={onRetryAccepted} />}
      <div className={styles.detailGrid}>
        <div className={styles.mainColumn}>
          <div className={styles.tabs} role="tablist" aria-label="Conversation details">
            {detailTabs.map((tab, index) => (
              <button
                key={tab}
                ref={(button) => { tabButtons.current[index] = button; }}
                type="button"
                role="tab"
                id={tabId(tab)}
                aria-controls={panelId(tab)}
                aria-selected={activeTab === tab}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => {
                  const nextIndex = event.key === "ArrowRight" ? (index + 1) % detailTabs.length
                    : event.key === "ArrowLeft" ? (index + detailTabs.length - 1) % detailTabs.length
                    : event.key === "Home" ? 0
                    : event.key === "End" ? detailTabs.length - 1
                    : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  setActiveTab(detailTabs[nextIndex]);
                  tabButtons.current[nextIndex]?.focus();
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className={styles.pane} role="tabpanel" id={panelId("Summary")} aria-labelledby={tabId("Summary")} tabIndex={0} hidden={activeTab !== "Summary"}>
            <section className={styles.contextCard}>
              <header className={styles.cardHeader}>
                <div><span className={styles.kicker}>SUMMARY</span><h3>What mattered</h3></div>
              </header>
              {insight ? (
                <div className={styles.brief}>
                  {insight.executiveSummary && (!compact || !insight.keyPoints.some(point => point.trim())) && <p className={styles.executiveSummary}>{insight.executiveSummary}</p>}
                  {!compact && insight.dealStage && insight.dealStage !== "unknown" && <span className={styles.dealStage}>{insight.dealStage.replace("_", " ")}</span>}
                  <ul>{(insight.keyPoints.length ? insight.keyPoints : [insight.wants]).filter(Boolean).map((point, index) => <li key={index}>{point}</li>)}</ul>
                  {insight.concern && <div className={styles.concern}><strong>Keep in mind</strong><p>{insight.concern}</p></div>}
                  {insight.promised && <div><strong>You promised</strong><p>{insight.promised}</p></div>}
                  {!compact && insight.next && <div><strong>Recommended next step</strong><p>{insight.next}</p></div>}
                </div>
              ) : (
                <div className={styles.emptyCard}><strong>{conversation.status === "processing" ? "Preparing the brief" : "No brief available"}</strong><p>{conversation.transcript?.length ? "The original transcript is still available." : conversation.recordingId ? "The original recording is still available." : "No recording or transcript is available."}</p></div>
              )}
            </section>

            {Boolean(conversation.evidence?.length) && (
              <details className={styles.sourceDetails} open={!compact}>
                <summary>Source excerpts</summary>
              <section className={styles.contextCard}>
                <header className={styles.cardHeader}>
                  <div><span className={styles.kicker}>SOURCE EVIDENCE</span><h3>Source excerpts</h3></div>
                </header>
                <div className={styles.evidenceList}>
                  {conversation.evidence!.slice(0, 8).map((item, index) => (
                    <article className={styles.evidenceItem} key={item.id || `${item.category}-${index}`}>
                      <span>{item.sourceKind === "research" ? "Public context · Unverified" : "Conversation excerpt"} · {item.category.replace("_", " ")} · {Math.round(item.confidence * 100)}% confidence</span>
                      <strong>{item.statement}</strong>
                      <blockquote>“{item.quote}”</blockquote>
                      <small>{item.speaker || "Unidentified speaker"}{item.startSeconds !== null ? ` · ${formatAudioTime(item.startSeconds)}` : ""}</small>
                    </article>
                  ))}
                </div>
              </section>
              </details>
            )}

            {Boolean(conversation.research?.length) && (
              <details className={styles.sourceDetails} open={!compact}>
                <summary>Company research</summary>
              <section className={styles.contextCard}>
                <header className={styles.cardHeader}>
                  <div><span className={styles.kicker}>PUBLIC CONTEXT · UNVERIFIED</span><h3>Company research</h3></div>
                </header>
                <div className={styles.researchList}>
                  <p className={styles.researchNote}>Company sources are background context. They do not confirm this contact’s identity.</p>
                  {conversation.research!.slice(0, 6).map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer nofollow" key={source.id || source.url}>
                      <span>{source.company}</span>
                      <strong>{source.title}</strong>
                      <p>{source.snippet}</p>
                      <small>Open source</small>
                    </a>
                  ))}
                </div>
              </section>
              </details>
            )}

          </div>

          <div className={styles.pane} role="tabpanel" id={panelId("Actions")} aria-labelledby={tabId("Actions")} tabIndex={0} hidden={activeTab !== "Actions"}>
            {(approvals.length > 0 || tasks.length > 0 || commitments.length > 0) && (
              <section className={styles.contextCard}>
                <header className={styles.cardHeader}>
                  <div><span className={styles.kicker}>ACTIONS</span><h3>Follow-ups and commitments</h3></div>
                </header>
                {approvals.map((approval) => {
                  return (
                    <article className={styles.approval} key={approval.id}>
                      <span>Calendar approval</span>
                      <strong>{approval.title}</strong>
                      <p>{approval.details.startAt ? `${dateLabel(approval.details.startAt, { weekday: "short" })} at ${timeLabel(approval.details.startAt)}` : "Date and time need review"}</p>
                      <button disabled={Boolean(working)} onClick={() => onEditApproval(approval)}>
                        Awaiting your approval
                      </button>
                    </article>
                  );
                })}
                <div className={styles.taskList}>
                  {tasks.map((task) => (
                    <label key={task.id} className={task.status === "completed" ? styles.taskComplete : ""}>
                      <input type="checkbox" checked={task.status === "completed"} disabled={Boolean(working)} onChange={(event) => onTask(task.id, event.target.checked)} />
                      <span><strong>{task.description}</strong>{task.dueAt && <small>Due {dateLabel(task.dueAt)}</small>}</span>
                    </label>
                  ))}
                  {commitments.map((commitment, index) => (
                    <div className={styles.commitment} key={commitment.id || index}>
                      <span><strong>{commitment.description}</strong><small>{commitment.ownerType === "user" ? "Your commitment" : "Client commitment"}{commitment.dueAt ? ` · ${dateLabel(commitment.dueAt)}` : ""}</small></span>
                    </div>
                  ))}
                </div>
                {tasks.filter(task => task.type === "email" && task.status !== "completed").map(task => (
                  <EmailFollowUp key={task.id} task={task} sample={mode === "sample"}
                    recipient={conversation.contacts.find(person => person.id === task.contactId)?.email || ""}
                    onSent={() => onTask(task.id, true)} />
                ))}
              </section>
            )}
            {approvals.length === 0 && tasks.length === 0 && commitments.length === 0 && (
              <section className={styles.contextCard}>
                <div className={styles.emptyCard}>
                  <strong>No follow-ups to review</strong>
                  <p>Approvals and commitments from this conversation will appear here.</p>
                </div>
              </section>
            )}
            {conversation.status === "ready" && <ShareMeetingWhatsApp key={conversation.id} meetingId={conversation.id} title={conversation.title} sample={mode === "sample"} />}
          </div>

          <div className={styles.replayColumn} hidden={activeTab !== "Audio" && activeTab !== "Transcript"}>
            <ConversationReplay
              key={conversation.id}
              conversation={conversation}
              view={activeTab === "Audio" ? "audio" : activeTab === "Transcript" ? "transcript" : "hidden"}
              panels={{
                audio: { id: panelId("Audio"), labelledBy: tabId("Audio") },
                transcript: { id: panelId("Transcript"), labelledBy: tabId("Transcript") },
              }}
              initialProgress={playback.current}
              onProgress={(progress) => {
                playback.current = progress;
              }}
            />
          </div>
        </div>

        <aside className={styles.contextColumn} aria-label="Contact details">
          <section className={styles.contextCard}>
            <header className={styles.cardHeader}>
              <div>
                <span className={styles.kicker}>CONTACT</span>
                <h3>Contact details</h3>
              </div>
              {contact && !editingContact && (
                <button onClick={() => setEditingContact(true)}>
                  Correct
                </button>
              )}
            </header>
            {contact ? editingContact ? (
              <form
                className={styles.contactForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveContact();
                }}
              >
                <label>Name<input required maxLength={120} value={contactDraft.name} onChange={(event) => setContactDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>Company<input maxLength={160} value={contactDraft.company || ""} onChange={(event) => setContactDraft((current) => ({ ...current, company: event.target.value }))} /></label>
                <label>Role<input maxLength={120} value={contactDraft.role || ""} onChange={(event) => setContactDraft((current) => ({ ...current, role: event.target.value }))} /></label>
                <label>Email<input type="email" maxLength={320} value={contactDraft.email || ""} onChange={(event) => setContactDraft((current) => ({ ...current, email: event.target.value }))} /></label>
                <div className={styles.formActions}>
                  <button type="button" onClick={() => setEditingContact(false)}>Cancel</button>
                  <button type="submit" disabled={Boolean(working) || !contactDraft.name.trim()}>Save</button>
                </div>
              </form>
            ) : (
              <div className={styles.contactDetails}>
                <span className={styles.contactAvatar}>{initials(contact.name)}</span>
                <div><strong>{contact.name}</strong>{(!compact || contact.role) && <p>{contact.role || "Role not confirmed"}</p>}</div>
                <dl>
                  {(!compact || contact.company) && <div><dt>Company</dt><dd>{contact.company || "Not confirmed"}</dd></div>}
                  {(!compact || contact.email) && <div><dt>Email</dt><dd>{contact.email || "Not confirmed"}</dd></div>}
                </dl>
                {!compact && <p className={styles.verifyNote}>Review these details before sending a follow-up.</p>}
                {onOpenContact && <button type="button" className={styles.contactHistoryLink} onClick={() => onOpenContact(contact.id)}>View client history</button>}
              </div>
            ) : (
              <div className={styles.emptyCard}><strong>{initialContactId != null ? "This contact is not linked to this conversation" : "No person identified yet"}</strong><p>{conversation.transcript?.length ? "The transcript remains available for manual review." : conversation.recordingId ? "The original recording remains available for manual review." : "No recording or transcript is available."}</p></div>
            )}
          </section>

        </aside>
      </div>
    </div>
  );
}
