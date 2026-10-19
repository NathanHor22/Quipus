"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Contact } from "@/lib/types";
import type { PersonResearchCandidate } from "@/lib/people-research";
import type { WorkspaceMode } from "@/lib/workspace/model";
import styles from "./person-profile.module.css";

type Answer = { answer: string; sources: Array<{ id: string; title: string; occurredAt: string }> };

export function PersonProfile({
  contact,
  mode,
  onOpenMeeting,
}: {
  contact: Contact;
  mode: WorkspaceMode;
  onOpenMeeting: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<PersonResearchCandidate[]>([]);
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/people/${encodeURIComponent(contact.id)}/research`;
  useEffect(() => {
    if (mode !== "live") return;
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Person details could not be loaded.");
        if (!controller.signal.aborted) {
          setCandidates(payload.candidates || []);
          setNote(payload.note || "");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Person details could not be loaded.");
      });
    return () => controller.abort();
  }, [endpoint, mode]);

  const mutate = async (action: string, method: string, body?: unknown) => {
    if (pending) return;
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "This change could not be saved.");
      if (action === "note") {
        setNotice("Private reminder saved.");
        return;
      }
      const refreshed = await fetch(endpoint, { cache: "no-store" });
      const payload = await refreshed.json();
      if (!refreshed.ok) throw new Error(payload.error || "Profiles could not be loaded.");
      setCandidates(payload.candidates || []);
      if (action === "research")
        setNotice("Research checked. Refreshes are limited to once an hour.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(null);
    }
  };
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || mode !== "live") return;
    setPending("question");
    setError(null);
    setAnswer(null);
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(contact.id)}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Your question could not be answered.");
      setAnswer(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(null);
    }
  };
  const confirmed = candidates.find((candidate) => candidate.status === "confirmed");
  const visible = confirmed
    ? [confirmed]
    : candidates.filter((candidate) => candidate.status === "candidate").slice(0, 3);
  return (
    <section className={styles.profile} aria-label={`Relationship context for ${contact.name}`}>
      <div className={styles.feedback} aria-live="polite">
        {error && <p role="alert">{error}</p>}
        {notice && <p>{notice}</p>}
      </div>
      <header className={styles.profileHeader}>
        <h3>Client context</h3>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Close context" : "Open context"}
        </button>
      </header>
      <div className={styles.grid} hidden={!expanded}>
        <section className={styles.card}>
          <header>
            <h3>LinkedIn profile</h3>
            <button
              type="button"
              disabled={mode !== "live" || Boolean(pending)}
              onClick={() => void mutate("research", "POST")}
            >
              {pending === "research" ? "Checking..." : "Find profile"}
            </button>
          </header>
          {!visible.length && (
            <p>
              {mode === "sample"
                ? "Confirm a professional profile here when using your own workspace."
                : "Possible matches will appear here. Confirm the right person before using their professional background."}
            </p>
          )}
          {visible.map((candidate) => (
            <article className={styles.candidate} key={candidate.id}>
              <span className={styles.label}>
                {candidate.status === "confirmed" ? "Confirmed by you" : "Possible match"}
              </span>
              <a
                className={styles.source}
                href={candidate.url}
                target="_blank"
                rel="noreferrer nofollow"
              >
                {candidate.title}
              </a>
              <p>
                {candidate.snippet || "Open the LinkedIn profile to verify their name and company."}
              </p>
              <small>
                Observed{" "}
                {new Date(candidate.observed_at).toLocaleDateString("en-GB", { timeZone: "UTC" })}
              </small>
              {candidate.status !== "confirmed" && (
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={Boolean(pending)}
                    onClick={() =>
                      void mutate("decision", "PATCH", {
                        candidateId: candidate.id,
                        status: "confirmed",
                      })
                    }
                  >
                    This is the person
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(pending)}
                    onClick={() =>
                      void mutate("decision", "PATCH", {
                        candidateId: candidate.id,
                        status: "rejected",
                      })
                    }
                  >
                    Not them
                  </button>
                </div>
              )}
              {candidate.status === "confirmed" && (
                <button
                  type="button"
                  disabled={Boolean(pending)}
                  onClick={() =>
                    void mutate("decision", "PATCH", {
                      candidateId: candidate.id,
                      status: "rejected",
                    })
                  }
                >
                  Remove match
                </button>
              )}
            </article>
          ))}
        </section>
        <section className={styles.card}>
          <h3>Private reminder</h3>
          <p>For you only. Excluded from shared meeting reports and meeting questions.</p>
          <label className={styles.field}>
            What should you remember?
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={4_000}
              rows={4}
              placeholder="Ask how their badminton tournament went."
            />
          </label>
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() =>
              mode === "sample"
                ? setNotice("Sample reminder saved in this view.")
                : void mutate("note", "PATCH", { note })
            }
          >
            {pending === "note" ? "Saving..." : "Save reminder"}
          </button>
        </section>
        <section className={styles.card}>
          <h3>Ask about your meetings</h3>
          <p>
            Answers use this person&apos;s latest completed conversations, with links back to the
            source.
          </p>
          <form onSubmit={ask}>
            <label className={styles.field}>
              Your question
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={500}
                minLength={2}
                placeholder="What did we agree to follow up?"
                required
              />
            </label>
            <button type="submit" disabled={mode !== "live" || Boolean(pending)}>
              {pending === "question" ? "Checking meetings..." : "Ask question"}
            </button>
          </form>
          {answer && (
            <div className={styles.answer}>
              <p>{answer.answer}</p>
              <div className={styles.actions}>
                {answer.sources.map((source) => (
                  <button type="button" key={source.id} onClick={() => onOpenMeeting(source.id)}>
                    {source.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
