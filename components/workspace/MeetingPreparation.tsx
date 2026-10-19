"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { Meeting } from "@/lib/types";
import type { WorkspaceMode } from "@/lib/workspace/model";
import type { PreparationRequirement } from "@/lib/meeting-preparation";
import type { VenueOption, VenuePreferences } from "@/lib/venues";
import styles from "./meeting-preparation.module.css";

export function MeetingPreparation({
  meeting,
  mode,
  compact = false,
  onUpdated,
}: {
  meeting: Meeting;
  mode: WorkspaceMode;
  compact?: boolean;
  onUpdated?: () => void | Promise<void>;
}) {
  const id = useId();
  const [requirements, setRequirements] = useState<PreparationRequirement[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const schedules = (meeting.followUps || []).filter(
    (task) => task.type === "schedule" && task.status === "pending",
  );
  const [followUpId, setFollowUpId] = useState(schedules.length === 1 ? schedules[0].id : "");
  const [preferences, setPreferences] = useState<VenuePreferences>({
    area: schedules[0]?.schedule?.location || "",
    kind: "coffee",
    partySize: Math.min(20, meeting.contacts.length + 1),
    budgetMyr: 50,
    budgetBasis: "total",
    setting: "any",
    quietPreferred: true,
  });
  const endpoint = `/api/meetings/${encodeURIComponent(meeting.id)}/preparation`;
  useEffect(() => {
    if (mode !== "live" || meeting.status !== "ready") return;
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Preparation could not be loaded.");
        if (!controller.signal.aborted) {
          setRequirements(payload.requirements || []);
          setVenues(payload.venues || []);
          if (payload.preferences) setPreferences(payload.preferences);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Preparation could not be loaded.");
      });
    return () => controller.abort();
  }, [endpoint, meeting.status, mode]);
  const update = async (action: string, method: string, body: unknown) => {
    if (pending) return;
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Preparation could not be updated.");
      if (payload.requirements) setRequirements(payload.requirements);
      if (payload.venues) {
        setVenues(payload.venues);
        if (!payload.venues.length)
          setNotice("No sufficiently sourced places found. Try a more specific area later.");
      }
      if (payload.approvalRequired) {
        setNotice(
          "Location added to the pending invitation. Review and approve it before sending.",
        );
        await onUpdated?.();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(null);
    }
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    void update("research", "POST", preferences);
  };
  if (meeting.status !== "ready") return null;
  return (
    <section className={styles.preparation} data-compact={compact} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>BEFORE THE NEXT MEETING</span>
          <h3 id={`${id}-title`}>Be prepared</h3>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-venues`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Close places" : "Find meeting place"}
        </button>
      </header>
      {requirements.length > 0 ? (
        <div className={styles.requirements}>
          {requirements.map((requirement) => (
            <label key={requirement.id} className={styles.requirement}>
              <input
                type="checkbox"
                checked={requirement.completed}
                disabled={mode !== "live" || Boolean(pending)}
                onChange={(event) =>
                  void update(requirement.id, "PATCH", {
                    requirementId: requirement.id,
                    completed: event.target.checked,
                  })
                }
              />
              <span>
                {requirement.description}
                <small>{requirement.speaker || "Conversation excerpt"}</small>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className={styles.description}>
          Preparation items appear here when they are supported by your conversation.
        </p>
      )}
      {error && (
        <p className={styles.feedback} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.feedback} role="status">
          {notice}
        </p>
      )}
      {expanded && (
        <div id={`${id}-venues`} className={styles.venues}>
          <p className={styles.description}>
            Choose the area and your budget. Public sources may be out of date; traffic and crowds
            are currently unavailable.
          </p>
          <form onSubmit={search} className={styles.form}>
            <label className={styles.wide}>
              Area
              <input
                required
                minLength={2}
                maxLength={120}
                value={preferences.area}
                placeholder="Bangsar, Kuala Lumpur"
                onChange={(event) =>
                  setPreferences((current) => ({ ...current, area: event.target.value }))
                }
              />
            </label>
            <label>
              Meeting type
              <select
                value={preferences.kind}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    kind: event.target.value as VenuePreferences["kind"],
                  }))
                }
              >
                <option value="coffee">Coffee</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="meeting_room">Meeting room</option>
              </select>
            </label>
            <label>
              People
              <input
                type="number"
                min={1}
                max={20}
                required
                value={preferences.partySize}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    partySize: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Budget (RM)
              <input
                type="number"
                min={1}
                max={10000}
                step="0.01"
                required
                value={preferences.budgetMyr}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    budgetMyr: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Budget covers
              <select
                value={preferences.budgetBasis}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    budgetBasis: event.target.value as VenuePreferences["budgetBasis"],
                  }))
                }
              >
                <option value="total">Everyone in total</option>
                <option value="per_person">Each person</option>
              </select>
            </label>
            <label>
              Setting
              <select
                value={preferences.setting}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    setting: event.target.value as VenuePreferences["setting"],
                  }))
                }
              >
                <option value="any">Any</option>
                <option value="mall">Shopping mall</option>
                <option value="shoplot">Shop lot</option>
              </select>
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={preferences.quietPreferred}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    quietPreferred: event.target.checked,
                  }))
                }
              />
              Prefer somewhere quiet
            </label>
            <button type="submit" disabled={mode !== "live" || Boolean(pending)}>
              {pending === "research" ? "Checking sources..." : "Find places"}
            </button>
          </form>
          {mode === "sample" && (
            <p className={styles.description}>
              Venue research becomes available in your signed-in workspace.
            </p>
          )}
          {venues.length > 0 && (
            <div className={styles.results}>
              {venues.map((venue) => (
                <article className={styles.venue} key={venue.sourceUrl + venue.name}>
                  <header>
                    <h4>{venue.name}</h4>
                    <span
                      className={styles.budget}
                      data-over={venue.budget.status === "over_budget"}
                    >
                      {venue.budget.status === "within_budget"
                        ? "Published estimate fits"
                        : venue.budget.status === "over_budget"
                          ? "Over your budget"
                          : "Price needs checking"}
                    </span>
                  </header>
                  <p>{venue.address || "Address needs checking"}</p>
                  <dl>
                    <div>
                      <dt>Setting</dt>
                      <dd>
                        {venue.setting === "unknown"
                          ? "Needs checking"
                          : venue.setting === "mall"
                            ? "Shopping mall"
                            : "Shop lot"}
                      </dd>
                    </div>
                    <div>
                      <dt>Published estimate</dt>
                      <dd>
                        {venue.budget.estimatedTotalMyr === null
                          ? "Unavailable"
                          : `RM${venue.budget.estimatedTotalMyr.toFixed(2)} total`}
                      </dd>
                    </div>
                    <div>
                      <dt>Traffic / crowds</dt>
                      <dd>Unavailable</dd>
                    </div>
                  </dl>
                  {venue.priceQuote && <blockquote>{venue.priceQuote}</blockquote>}
                  {venue.ratingQuote && <p className={styles.description}>{venue.ratingQuote}</p>}
                  <small>
                    Checked{" "}
                    {new Date(venue.observedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}.
                    Prices may exclude tax and service charges.
                  </small>
                  <div className={styles.actions}>
                    <a href={venue.sourceUrl} target="_blank" rel="noreferrer nofollow">
                      Check source
                    </a>
                    {schedules.length > 0 && (
                      <button
                        type="button"
                        disabled={
                          Boolean(pending) || !followUpId || venue.budget.status === "over_budget"
                        }
                        onClick={() =>
                          void update("location", "PATCH", {
                            followUpId,
                            venueUrl: venue.sourceUrl,
                            venueName: venue.name,
                          })
                        }
                      >
                        Use location
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {venues.length > 0 && schedules.length > 1 && (
            <label className={styles.invitation}>
              Apply location to
              <select value={followUpId} onChange={(event) => setFollowUpId(event.target.value)}>
                <option value="">Choose pending follow-up</option>
                {schedules.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.description}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </section>
  );
}
