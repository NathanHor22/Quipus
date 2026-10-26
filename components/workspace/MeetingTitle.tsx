"use client";

import { useId, useRef, useState } from "react";
import type { Meeting } from "@/lib/types";
import { MEETING_TITLE_MAX_LENGTH, normalizeMeetingTitle, selectMeetingTitle } from "@/lib/meeting-title";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./meeting-title.module.css";

export type RenameMeeting = (id: string, title: string, expectedTitle?: string) => Promise<boolean>;
export type GenerateMeetingTitle = (id: string, expectedTitle?: string) => Promise<boolean>;

type Props = {
  meeting: Meeting;
  working: boolean;
  onRename?: RenameMeeting;
  onGenerate?: GenerateMeetingTitle;
};

/** Drafts stay local; owner-scoped saves also check the title the user started editing. */
export function MeetingTitle({ meeting, working, onRename, onGenerate }: Props) {
  const { timezone } = useWorkspaceTime();
  const title = selectMeetingTitle({ preferredTitle: meeting.title, startAt: meeting.startAt, timeZone: timezone });
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [action, setAction] = useState<"save" | "generate" | null>(null);
  const [validation, setValidation] = useState("");
  const baseTitle = useRef(meeting.title);
  const busy = working || action !== null;
  const editable = onRename && meeting.source !== "calendar" && meeting.status !== "upcoming";

  if (!editing || !editable) return <div className={styles.heading}>
    <h2>{title}</h2>
    {editable && <button type="button" disabled={busy} className={styles.rename} onClick={() => {
      baseTitle.current = meeting.title;
      setDraft(title);
      setValidation("");
      setEditing(true);
    }}>Rename</button>}
  </div>;

  return <form className={styles.editor} onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    const next = normalizeMeetingTitle(draft);
    if (!next) { setValidation("Enter a short title about this meeting."); return; }
    setValidation(""); setAction("save");
    try { if (await onRename(meeting.id, next, baseTitle.current)) setEditing(false); }
    finally { setAction(null); }
  }}>
    <label htmlFor={inputId}>Meeting title</label>
    <input id={inputId} autoFocus value={draft} maxLength={MEETING_TITLE_MAX_LENGTH} disabled={busy}
      aria-invalid={Boolean(validation)} aria-describedby={validation ? `${inputId}-error` : undefined}
      onChange={event => { setDraft(event.target.value); setValidation(""); }} />
    {validation && <p id={`${inputId}-error`} role="alert">{validation}</p>}
    <div className={styles.actions}>
      <button type="submit" disabled={busy} className={styles.save}>{action === "save" ? "Saving..." : "Save title"}</button>
      <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      {onGenerate && Boolean(meeting.transcript?.length) && <button type="button" disabled={busy} onClick={async () => {
        if (busy) return;
        setValidation(""); setAction("generate");
        try { if (await onGenerate(meeting.id, baseTitle.current)) setEditing(false); }
        finally { setAction(null); }
      }}>{action === "generate" ? "Generating..." : "Generate title"}</button>}
    </div>
  </form>;
}
