"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarPlus,
  Check,
  ExternalLink,
  LoaderCircle,
  Network,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";

import type { Meeting } from "@/lib/types";
import {
  relayMatchSchema,
  sampleRelayMatches,
  type RelayMatch,
} from "@/lib/relay";
import type { WorkspaceMode } from "@/lib/workspace/model";

import styles from "./relay-panel.module.css";

type RelayPanelProps = {
  meetings: Meeting[];
  mode: WorkspaceMode;
  integrations: Record<string, boolean>;
  onOpenConversation: (id: string) => void;
  onNotice: (message: string) => void;
};

const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1_000;

function malaysiaInputValue(instantMs: number) {
  return new Date(instantMs + MALAYSIA_OFFSET_MS).toISOString().slice(0, 16);
}

function nextIntroductionTime() {
  const thirtyMinutes = 30 * 60 * 1_000;
  return malaysiaInputValue(
    Math.ceil((Date.now() + thirtyMinutes) / thirtyMinutes) * thirtyMinutes,
  );
}

function minimumIntroductionTime() {
  const minute = 60 * 1_000;
  return malaysiaInputValue(Math.ceil((Date.now() + minute) / minute) * minute);
}

function initials(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function RelayPanel(props: RelayPanelProps) {
  return <RelayPanelSession key={props.mode} {...props} />;
}

function RelayPanelSession({
  meetings,
  mode,
  integrations,
  onOpenConversation,
  onNotice,
}: RelayPanelProps) {
  const meetingKey = JSON.stringify(meetings);
  const sampleMatches = useMemo(
    () => mode === "sample" ? sampleRelayMatches(meetings) : [],
    [meetings, mode],
  );
  const [sampleChanges, setSampleChanges] = useState<{
    source: string;
    matches: RelayMatch[];
  } | null>(null);
  const [liveMatches, setLiveMatches] = useState<RelayMatch[]>([]);
  const matches = mode === "sample"
    ? sampleChanges?.source === meetingKey ? sampleChanges.matches : sampleMatches
    : liveMatches;

  function setMatches(update: RelayMatch[] | ((current: RelayMatch[]) => RelayMatch[])) {
    if (mode === "sample") {
      setSampleChanges((previous) => {
        const current = previous?.source === meetingKey ? previous.matches : sampleMatches;
        return { source: meetingKey, matches: typeof update === "function" ? update(current) : update };
      });
    } else {
      setLiveMatches(update);
    }
  }
  const [loading, setLoading] = useState(mode === "live");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<RelayMatch | null>(null);
  const [scheduledFor, setScheduledFor] = useState(nextIntroductionTime);
  const [duration, setDuration] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode === "sample") return;
    const controller = new AbortController();
    void fetch("/api/relay/matches", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Relay could not be opened.");
        return (payload.matches || []).map((match: unknown) => relayMatchSchema.parse(match));
      })
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setLiveMatches(loaded);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Relay could not be opened.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [meetingKey, mode]);

  const active = matches.filter((match) => match.status === "pending");
  const peopleCount = useMemo(
    () => new Set(matches.flatMap((match) => [match.primary.contactId, match.secondary.contactId])).size,
    [matches],
  );
  const sourceCount = useMemo(
    () => new Set(matches.flatMap((match) => match.sources.map((source) => source.url))).size,
    [matches],
  );

  async function runRelay() {
    if (mode === "sample") {
      setMatches(sampleRelayMatches(meetings, new Date()));
      onNotice("Relay rebuilt the sample introduction from saved conversation evidence.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/relay/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Relay could not compare the conversations.");
      const generated: RelayMatch[] = (payload.matches || []).map((match: unknown) =>
        relayMatchSchema.parse(match),
      );
      setMatches(generated);
      const generatedCount =
        typeof payload.generatedCount === "number"
          ? payload.generatedCount
          : generated.filter((match) => match.status === "pending").length;
      onNotice(
        generatedCount
          ? `Relay found ${generatedCount} evidence-backed introduction${generatedCount === 1 ? "" : "s"}.`
          : "Relay found no strong introduction yet.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Relay could not compare the conversations.",
      );
    } finally {
      setRunning(false);
    }
  }

  async function changeStatus(match: RelayMatch, status: RelayMatch["status"]) {
    if (mode === "sample") {
      setMatches((current) =>
        current.map((item) => (item.id === match.id ? { ...item, status } : item)),
      );
      return true;
    }
    const response = await fetch(`/api/relay/matches/${encodeURIComponent(match.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The Relay proposal could not be updated.");
    const updated = relayMatchSchema.parse(payload.match);
    setMatches((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    return true;
  }

  async function dismiss(match: RelayMatch) {
    try {
      await changeStatus(match, "dismissed");
      onNotice("Introduction dismissed. Nobody was contacted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The proposal could not be dismissed.");
    }
  }

  async function scheduleIntroduction() {
    const match = scheduling;
    if (!match) return;
    const attendees = [match.primary.email, match.secondary.email].filter(
      (email): email is string => Boolean(email),
    );
    if (attendees.length !== 2) {
      setError("Both people need a confirmed email before an introduction can be scheduled.");
      return;
    }
    const startAt = new Date(`${scheduledFor}:00+08:00`);
    if (!Number.isFinite(startAt.getTime()) || startAt.getTime() <= Date.now()) {
      setError("Choose a future date and time for the introduction.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "live") {
        const response = await fetch("/api/actions/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            approved: true,
            summary: `Introduction: ${match.primary.name} and ${match.secondary.name}`,
            startAt: startAt.toISOString(),
            durationMinutes: duration,
            attendees,
            description: `${match.reason}\n\nPrepared by Quipus Relay after owner review.`,
            meetingId: match.primary.conversationId,
            relayMatchId: match.id,
            idempotencyKey: `relay:${match.pairKey}:${startAt.toISOString()}:${duration}`,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.event || !payload.relayMatch)
          throw new Error(payload.error || "The introduction could not be scheduled.");
        const updated = relayMatchSchema.parse(payload.relayMatch);
        setMatches((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      } else {
        await changeStatus(match, "scheduled");
      }
      setScheduling(null);
      onNotice(
        mode === "sample"
          ? "Sample introduction approved. No invitation was sent."
          : "Introduction added to Google Calendar and invitations sent.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The introduction could not be scheduled.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.relay} aria-label="Quipus Relay">
      <div className={styles.eventBar}>
        <div>
          <span className={styles.liveDot} />
          <span>
            <small>ACTIVE PLACE</small>
            <strong>{matches[0]?.eventName || "AITKL · Agents, Everywhere"}</strong>
          </span>
        </div>
        <span className={styles.venue}><Building2 /> {matches[0]?.venue || "WORQ Bangsar"}</span>
      </div>

      <div className={styles.stats}>
        <article><Users /><span><strong>{peopleCount}</strong><small>People connected</small></span></article>
        <article><Network /><span><strong>{active.length}</strong><small>Introductions ready</small></span></article>
        <article><SearchCheck /><span><strong>{sourceCount}</strong><small>Public sources</small></span></article>
        <div className={styles.providerState}>
          <span className={integrations.openai || mode === "sample" ? styles.ready : ""}>
            <i /> OpenAI
          </span>
          <span className={integrations.exa ? styles.ready : ""}>
            <i /> Exa {mode === "sample" ? "available live" : ""}
          </span>
        </div>
      </div>

      <header className={styles.toolbar}>
        <div>
          <span>INTRODUCTION QUEUE</span>
          <h2>Connections worth making</h2>
          <p>Each proposal is grounded in two saved conversations. Nobody is contacted until you approve.</p>
        </div>
        <button className={styles.runButton} onClick={() => void runRelay()} disabled={running}>
          {running ? <LoaderCircle className={styles.spin} /> : <Sparkles />}
          {running ? "Comparing conversations…" : matches.length ? "Run Relay again" : "Find connections"}
        </button>
      </header>

      {error && <div className={styles.error} role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X /></button></div>}

      {loading ? (
        <div className={styles.loading}><LoaderCircle className={styles.spin} /><p>Opening the introduction graph…</p></div>
      ) : active.length ? (
        <div className={styles.matchGrid}>
          {active.map((match) => (
            <article className={styles.matchCard} key={match.id}>
              <header>
                <span className={styles.score}>{match.score}% fit</span>
                <span className={styles.pending}><i /> Approval required</span>
              </header>
              <h3>{match.headline}</h3>
              <div className={styles.peoplePair}>
                <button onClick={() => onOpenConversation(match.primary.conversationId)}>
                  <span>{initials(match.primary.name)}</span>
                  <strong>{match.primary.name}</strong>
                  <small>{match.primary.company || "Independent"}</small>
                </button>
                <span className={styles.connection}><i /><i /><i /></span>
                <button onClick={() => onOpenConversation(match.secondary.conversationId)}>
                  <span>{initials(match.secondary.name)}</span>
                  <strong>{match.secondary.name}</strong>
                  <small>{match.secondary.company || "Independent"}</small>
                </button>
              </div>
              <p className={styles.reason}>{match.reason}</p>
              <div className={styles.fitEvidence}>
                <div><small>NEED</small><p>{match.primaryNeed}</p><blockquote>“{match.primaryEvidence}”</blockquote></div>
                <div><small>OFFER</small><p>{match.secondaryOffer}</p><blockquote>“{match.secondaryEvidence}”</blockquote></div>
              </div>
              {match.sources.length > 0 && (
                <div className={styles.sources}>
                  <span><SearchCheck /> EXA PUBLIC EVIDENCE</span>
                  {match.sources.slice(0, 3).map((source) => (
                    <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
                      <span><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></span>
                      <ExternalLink />
                    </a>
                  ))}
                </div>
              )}
              <div className={styles.actionNote}><ShieldCheck /><span><strong>Suggested next step</strong>{match.suggestedAction}</span></div>
              <footer>
                <button className={styles.dismiss} onClick={() => void dismiss(match)}>Dismiss</button>
                <button className={styles.approve} onClick={() => setScheduling(match)} disabled={!match.primary.email || !match.secondary.email}>
                  <CalendarPlus /> Review introduction
                </button>
              </footer>
              {(!match.primary.email || !match.secondary.email) && <p className={styles.emailHint}>Add a confirmed email for both people before scheduling.</p>}
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <Network />
          <h3>{matches.length ? "No introductions awaiting approval" : "Relay is ready to compare the room"}</h3>
          <p>{matches.length ? "Scheduled and dismissed proposals stay out of your active queue." : "Capture at least two conversations, then let OpenAI find a grounded reason for those people to meet."}</p>
          <button onClick={() => void runRelay()} disabled={running}><RefreshCw /> Run Relay</button>
        </div>
      )}

      {scheduling && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScheduling(null); }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="relay-dialog-title">
            <button className={styles.dialogClose} aria-label="Close" onClick={() => setScheduling(null)}><X /></button>
            <span className={styles.dialogIcon}><CalendarPlus /></span>
            <small>FINAL APPROVAL</small>
            <h2 id="relay-dialog-title">Schedule the introduction</h2>
            <p>Review the exact people, date, time and duration. Approval creates the Google Meet invitation immediately.</p>
            <div className={styles.attendees}>
              {[scheduling.primary, scheduling.secondary].map((person) => (
                <span key={person.contactId}><i>{initials(person.name)}</i><span><strong>{person.name}</strong><small>{person.email}</small></span><Check /></span>
              ))}
            </div>
            <label>Date and time (Malaysia time)<input type="datetime-local" value={scheduledFor} min={minimumIntroductionTime()} onChange={(event) => setScheduledFor(event.target.value)} /></label>
            <label>Duration<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></label>
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancel} onClick={() => setScheduling(null)}>Cancel</button>
              <button className={styles.dialogApprove} onClick={() => void scheduleIntroduction()} disabled={submitting}>
                {submitting ? <LoaderCircle className={styles.spin} /> : <CalendarPlus />}
                {mode === "sample" ? "Approve sample" : "Approve and send invites"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
