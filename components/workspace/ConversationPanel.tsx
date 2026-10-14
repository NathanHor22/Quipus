"use client";

import { useCallback, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { FileText, Headphones, MessageSquare, X } from "lucide-react";
import type { Meeting } from "@/lib/types";
import { sourceConversation } from "@/lib/workspace/model";
import styles from "./workspace.module.css";
import { useWorkspaceTime } from "./WorkspaceTime";
import { FollowUpChecklist } from "./FollowUpChecklist";
import { MeetingKeyPoints } from "./MeetingKeyPoints";
import { initials } from "@/lib/workspace/contact-display";
import {
  ConversationReplay,
  type PlaybackProgress,
} from "./ConversationReplay";

type ConversationPanelProps = {
  meeting: Meeting | null;
  meetings: Meeting[];
  onClose: () => void;
  onTask: (id: string, completed: boolean) => void;
  working: string | null;
  error: string | null;
};

export function ConversationPanel(props: ConversationPanelProps) {
  const [playbackProgress, setPlaybackProgress] = useState(() => new Map<string, PlaybackProgress>());
  const rememberProgress = useCallback((id: string, progress: PlaybackProgress) => {
    setPlaybackProgress(current => {
      const previous = current.get(id);
      if (previous?.position === progress.position && previous.speed === progress.speed) return current;
      return new Map(current).set(id, progress);
    });
  }, []);
  return props.meeting ? <ConversationPanelSession key={props.meeting.id} {...props}
    meeting={props.meeting} playbackProgress={playbackProgress} onProgress={rememberProgress} /> : null;
}

function ConversationPanelSession({ meeting, meetings, onClose, onTask, working, error, playbackProgress, onProgress }:
  Omit<ConversationPanelProps, "meeting"> & { meeting: Meeting; playbackProgress: ReadonlyMap<string, PlaybackProgress>;
    onProgress: (id: string, progress: PlaybackProgress) => void }) {
  const { dateLabel, timeLabel } = useWorkspaceTime();
  const [tab, setTab] = useState<"recap" | "replay">("recap");
  const conversation = meeting
    ? sourceConversation(meetings, meeting)
    : undefined;
  const contact = conversation?.contacts[0] || meeting.contacts[0];
  const insight = conversation?.insight;
  const tasks = (conversation?.followUps || []).filter(
    (task) => task.type !== "schedule" && task.status !== "dismissed",
  );
  const duration = conversation
    ? Math.round(
        (Date.parse(conversation.endAt) - Date.parse(conversation.startAt)) /
          60_000,
      )
    : 0;
  return (
    <Dialog
      open
      onClose={onClose}
      className={styles.drawer}
      aria-labelledby="conversation-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.drawerBody}>
        <header className={styles.drawerHeader}>
          <span className={styles.eyebrow}>
            {meeting.sourceConversationId ? "MEETING BRIEF" : "CONVERSATION"}
          </span>
          <button
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close conversation"
          >
            <X />
          </button>
        </header>
        <div className={styles.identity}>
          <span className={styles.avatar}>
            {initials(contact?.name || meeting.title)}
          </span>
          <div>
            <h2 id="conversation-title">{contact?.name || meeting.title}</h2>
            <p>{contact?.company || "Conversation details"}</p>
          </div>
        </div>
        {meeting.source === "calendar" && (
          <div className={styles.eventSummary}>
            <div>
              <span className={styles.smallLabel}>ON YOUR CALENDAR</span>
              <strong>{meeting.title}</strong>
            </div>
            <p>
              {dateLabel(meeting.startAt, { weekday: "short" })} ·{" "}
              {timeLabel(meeting.startAt)} – {timeLabel(meeting.endAt)}
            </p>
            {meeting.id.startsWith("sample:") && (
              <span className={styles.subtle}>Sample event</span>
            )}
          </div>
        )}
        {conversation && (
          <div className={styles.sourceStrip}>
            <Headphones />
            <span>From {dateLabel(conversation.startAt)} conversation</span>
            <span>{duration} min</span>
          </div>
        )}
        <div
          className={styles.tabs}
          role="group"
          aria-label="Conversation details"
        >
          <button
            aria-pressed={tab === "recap"}
            className={tab === "recap" ? styles.activeTab : ""}
            onClick={() => setTab("recap")}
          >
            Summary & follow-ups
          </button>
          <button
            aria-pressed={tab === "replay"}
            className={tab === "replay" ? styles.activeTab : ""}
            onClick={() => setTab("replay")}
          >
            Replay & transcript
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.inlineError}>
            {error}
          </p>
        )}
        {tab === "recap" ? (
          <div
            role="region"
            aria-label="Summary and follow-ups"
            className={styles.recap}
          >
            {conversation && (
              <button
                type="button"
                className={styles.replayLink}
                onClick={() => setTab("replay")}
              >
                <Headphones />
                <span>
                  <strong>Replay the conversation</strong>
                  <small>
                    Listen to the original audio and follow the transcript.
                  </small>
                </span>
              </button>
            )}
            {insight ? (
              <>
                <section>
                  <h3>
                    <FileText /> What you discussed
                  </h3>
                  <MeetingKeyPoints insight={insight} className={styles.recapPoints} />
                </section>
                <section className={styles.takeNote}>
                  <h3>Keep in mind</h3>
                  <p>{insight.concern}</p>
                </section>
                <section>
                  <h3>
                    <MessageSquare /> What you promised
                  </h3>
                  <p>{insight.promised}</p>
                </section>
              </>
            ) : (
              <div className={styles.emptyInline}>
                <FileText />
                <h3>
                  {conversation?.status === "processing"
                    ? "Your recap is being prepared"
                    : "No conversation recap yet"}
                </h3>
                <p>
                  {conversation?.status === "failed"
                    ? conversation.recordingId
                      ? "This conversation could not be transcribed. Its original recording is still available."
                      : "This conversation could not be processed. Its details are still available."
                    : "A linked conversation will bring the context for this meeting here."}
                </p>
              </div>
            )}
            {tasks.length > 0 && (
              <section>
                <h3>
                  Before the next meeting{" "}
                  <span className={styles.count}>
                    {tasks.filter((task) => task.status === "completed").length}
                    /{tasks.length}
                  </span>
                </h3>
                <FollowUpChecklist
                  tasks={tasks}
                  disabled={Boolean(working)}
                  onTask={onTask}
                  className={styles.checklist}
                  completedClassName={styles.completedTask}
                />
              </section>
            )}
            {conversation && (
              <section>
                <h3>Conversation details</h3>
                <dl className={styles.detailList}>
                  <div>
                    <dt>Captured</dt>
                    <dd>
                      {dateLabel(conversation.startAt, { year: "numeric" })},{" "}
                      {timeLabel(conversation.startAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{duration} minutes</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {conversation.id.startsWith("sample:")
                        ? "Sample wearable conversation"
                        : conversation.source === "hardware"
                          ? "Wearable"
                          : "Recording"}
                    </dd>
                  </div>
                  {insight?.detectedLanguage && (
                    <div>
                      <dt>Languages</dt>
                      <dd>{insight.detectedLanguage}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
            {meeting.sourceConversationId && (
              <p className={styles.privateNote}>
                This brief is private to your Quipus workspace.
              </p>
            )}
          </div>
        ) : conversation ? (
          <ConversationReplay
            key={conversation.id}
            conversation={conversation}
            initialProgress={playbackProgress.get(conversation.id)}
            onProgress={(progress) =>
              onProgress(conversation.id, progress)
            }
          />
        ) : (
          <p className={styles.subtle}>
            No conversation is linked to this calendar entry yet.
          </p>
        )}
      </div>
    </Dialog>
  );
}
