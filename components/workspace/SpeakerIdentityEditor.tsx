"use client";
import { useState } from "react";
import type { Meeting } from "@/lib/types";
import type { WorkspaceMode } from "@/lib/workspace/model";
import styles from "./person-profile.module.css";

export function SpeakerIdentityEditor({
  meeting,
  mode,
  onSaved,
}: {
  meeting: Meeting;
  mode: WorkspaceMode;
  onSaved?: () => void | Promise<void>;
}) {
  const speakers = [
    ...new Map(
      (meeting.transcript || []).map((segment) => [
        segment.sourceSpeaker || segment.speaker,
        segment,
      ]),
    ).entries(),
  ];
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = async (speakerLabel: string, contactId: string) => {
    if (pending) return;
    setPending(speakerLabel);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meeting.id)}/speakers`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speakerLabel, contactId: contactId || null }),
      });
      if (!response.ok) throw new Error("The speaker correction could not be saved.");
      setNotice("Speaker identity saved. The original label is preserved.");
      await onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(null);
    }
  };
  if (!speakers.length || !meeting.contacts.length) return null;
  return (
    <section className={styles.card} aria-label="Confirm speaker identities">
      <h3>Who is speaking?</h3>
      <p>
        Confirm a participant when you recognise their voice. Unknown speakers can stay
        unidentified.
      </p>
      <div className={styles.actions}>
        {speakers.map(([label, segment]) => (
          <label className={styles.field} key={label}>
            {label}
            <select
              disabled={mode !== "live" || Boolean(pending)}
              value={segment.identifiedContactId || ""}
              onChange={(event) => void save(label, event.target.value)}
            >
              <option value="">Unidentified</option>
              {meeting.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.company ? ` - ${contact.company}` : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
