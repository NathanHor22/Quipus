"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Meeting } from "@/lib/types";
import type { WorkspaceMode } from "@/lib/workspace/model";
import { getRecordingProgress } from "@/lib/workspace/recording-progress";
import { RecordingProgress } from "./RecordingProgress";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./journal.module.css";

type JournalFilters = { query: string; date: string };

function calendarDate(key: string) {
  return new Date(key + "T12:00:00Z");
}

function calendarKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthStart(key: string) {
  return key.slice(0, 7) + "-01";
}

function moveDay(key: string, amount: number) {
  const date = calendarDate(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return calendarKey(date);
}

function moveMonth(key: string, amount: number) {
  const date = calendarDate(key);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return calendarKey(date);
}

function ordinal(day: number) {
  const remainder = day % 100;
  return String(day) + (remainder >= 11 && remainder <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] || "th");
}

function DatePopover({ value, today, onChange }: { value: string; today: string; onChange: (value: string) => void }) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const requestFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeDate, setActiveDate] = useState(value || today);
  const [visibleMonth, setVisibleMonth] = useState(monthStart(value || today));
  const monthLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(calendarDate(visibleMonth));
  const selectedLabel = value ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(calendarDate(value)) : "Date";
  const first = calendarDate(visibleMonth);
  const firstCell = moveDay(visibleMonth, -first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, index) => moveDay(firstCell, index));

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !requestFocus.current) return;
    calendarRef.current?.querySelector<HTMLButtonElement>('[data-date="' + activeDate + '"]')?.focus();
    requestFocus.current = false;
  }, [open, activeDate, visibleMonth]);

  const choose = (key: string) => {
    onChange(key);
    close();
  };

  const navigateDays = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    let next: string | null = null;
    if (event.key === "ArrowLeft") next = moveDay(key, -1);
    if (event.key === "ArrowRight") next = moveDay(key, 1);
    if (event.key === "ArrowUp") next = moveDay(key, -7);
    if (event.key === "ArrowDown") next = moveDay(key, 7);
    if (event.key === "Home") next = moveDay(key, -calendarDate(key).getUTCDay());
    if (event.key === "End") next = moveDay(key, 6 - calendarDate(key).getUTCDay());
    if (event.key === "PageUp") next = moveMonth(key, event.shiftKey ? -12 : -1);
    if (event.key === "PageDown") next = moveMonth(key, event.shiftKey ? 12 : 1);
    if (!next) return;
    event.preventDefault();
    requestFocus.current = true;
    setActiveDate(next);
    setVisibleMonth(monthStart(next));
  };

  const changeMonth = (amount: number) => {
    const next = moveMonth(visibleMonth, amount);
    setVisibleMonth(monthStart(next));
    setActiveDate(monthStart(next));
  };

  return <div ref={rootRef} className={styles.dateControl} onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <button ref={triggerRef} type="button" className={styles.dateTrigger} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-label={value ? "Filter conversations by date: " + selectedLabel : "Filter conversations by date"}
      onClick={() => {
        if (open) { close(); return; }
        const next = value || today;
        setActiveDate(next);
        setVisibleMonth(monthStart(next));
        requestFocus.current = true;
        setOpen(true);
      }}>
      <CalendarDays aria-hidden="true" /><span>{selectedLabel}</span><ChevronDown aria-hidden="true" />
    </button>
    {open && <div id={id} ref={calendarRef} className={styles.calendar} role="dialog" aria-label="Filter conversations by date">
      <header className={styles.calendarHeader}>
        <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft aria-hidden="true" /></button>
        <h3 id={id + "-month"} aria-live="polite">{monthLabel}</h3>
        <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight aria-hidden="true" /></button>
      </header>
      <div role="grid" aria-labelledby={id + "-month"} className={styles.calendarGrid}>
        <div role="row" className={styles.calendarWeek}>
          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day =>
            <span key={day} role="columnheader" aria-label={day}>{day.slice(0, 2)}</span>)}
        </div>
        {Array.from({ length: 6 }, (_, week) => <div key={week} role="row" className={styles.calendarWeek}>
          {days.slice(week * 7, week * 7 + 7).map(key => <span key={key} role="gridcell" aria-selected={value === key}>
            <button type="button" data-date={key} data-outside={monthStart(key) !== visibleMonth} data-today={key === today}
              aria-label={new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(calendarDate(key))}
              aria-current={key === today ? "date" : undefined} tabIndex={key === activeDate ? 0 : -1}
              onFocus={() => setActiveDate(key)} onKeyDown={event => navigateDays(event, key)} onClick={() => choose(key)}>
              {calendarDate(key).getUTCDate()}
            </button>
          </span>)}
        </div>)}
      </div>
      <footer className={styles.calendarFooter}>
        <button type="button" disabled={!value} onClick={() => choose("")}>Clear date</button>
        <button type="button" onClick={() => choose(today)}>Today</button>
      </footer>
    </div>}
  </div>;
}

export function ConversationJournal({ meetings, mode = "sample", compact = false, onOpen, onAll, onPeople, filters, onFiltersChange, onRetryAccepted, selectedId, inlineDetails }: {
  meetings: Meeting[];
  mode?: WorkspaceMode;
  compact?: boolean;
  onOpen: (id: string, tab?: "Audio") => void;
  onAll?: () => void;
  onPeople?: () => void;
  filters?: JournalFilters;
  onFiltersChange?: (filters: JournalFilters) => void;
  onRetryAccepted?: () => void;
  selectedId?: string | null;
  inlineDetails?: ReactNode;
}) {
  const { timezone, dateKey, timeLabel } = useWorkspaceTime();
  const [localFilters, setLocalFilters] = useState<JournalFilters>({ query: "", date: "" });
  const { query, date } = filters || localFilters;
  const changeFilters = onFiltersChange || setLocalFilters;
  const today = dateKey(new Date());
  const matching = useMemo(() => meetings.filter(meeting => (!date || dateKey(meeting.startAt) === date) &&
    (meeting.title + " " + meeting.contacts.map(contact => contact.name + " " + (contact.company || "")).join(" ") + " " + (meeting.insight?.intent || ""))
      .toLowerCase().includes(query.toLowerCase().trim()))
    .sort((left, right) => Date.parse(right.startAt) - Date.parse(left.startAt)), [meetings, date, query, dateKey]);
  const visible = compact ? matching.slice(0, 6) : matching;
  const dateFormat = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, weekday: "long", day: "numeric", month: "short", year: "numeric",
  }), [timezone]);

  const dateStamp = (value: string) => {
    const parts = dateFormat.formatToParts(new Date(value));
    const field = (name: string) => parts.find(part => part.type === name)?.value || "";
    return ordinal(Number(field("day"))) + " " + field("month") + " " + field("year") + ", " + field("weekday");
  };

  return <section className={styles.journal} aria-label="Conversation history">
    <header className={styles.heading}>
      <h2>{compact ? "Recent conversations" : "Meeting history"}</h2>
      {compact && onAll ? <button type="button" className={styles.textLink} onClick={onAll}>View all <ArrowRight aria-hidden="true" /></button> :
        onPeople && <button type="button" className={styles.textLink} onClick={onPeople}>People & companies <ArrowRight aria-hidden="true" /></button>}
    </header>
    <div className={styles.filters}>
      <label className={styles.search}>
        <Search aria-hidden="true" />
        <input type="search" aria-label="Search conversations" placeholder="Search conversations" value={query}
          onChange={event => changeFilters({ query: event.target.value, date })} />
      </label>
      <DatePopover value={date} today={today} onChange={next => changeFilters({ query, date: next })} />
      {(query || date) && <button type="button" className={styles.clearFilters} onClick={() => changeFilters({ query: "", date: "" })}>Clear filters</button>}
    </div>
    <span className={styles.announcement} role="status">{matching.length} {matching.length === 1 ? "conversation" : "conversations"} found</span>
    <div className={styles.list}>
      {visible.map(meeting => {
        const person = meeting.contacts[0]?.name || meeting.title;
        const tagline = meeting.insight?.intent?.trim() || (meeting.title !== person ? meeting.title : "");
        const progress = getRecordingProgress(meeting);
        const selected = selectedId === meeting.id;
        return <article key={meeting.id} className={styles.entry} data-selected={selected}>
          <div className={styles.row}>
            <button type="button" className={styles.detailsButton} onClick={() => onOpen(meeting.id)}
              aria-label={"Details for " + person} aria-expanded={selected}>
              <span>Details</span><ArrowRight aria-hidden="true" />
            </button>
            <div className={styles.copy}>
              <p className={styles.meetingLine}>
                <time dateTime={meeting.startAt}>{dateStamp(meeting.startAt)} · {timeLabel(meeting.startAt).toLowerCase().replace(/\s+/g, "\u00a0")}</time>
                <span aria-hidden="true"> · </span><strong>{person}</strong>
              </p>
              {tagline && <p className={styles.tagline}>{tagline}</p>}
              {meeting.status === "processing" && progress.stage !== "failed" && <div className={styles.processing}>
                <RecordingProgress meeting={meeting} mode={mode} compact />
                {progress.audioAvailable && <button type="button" onClick={() => onOpen(meeting.id, "Audio")}>Play recording <ArrowRight aria-hidden="true" /></button>}
              </div>}
            </div>
          </div>
          {progress.stage === "failed" && <div className={styles.recovery}>
            <RecordingProgress meeting={meeting} mode={mode} onOpenAudio={() => onOpen(meeting.id, "Audio")} onRetryAccepted={onRetryAccepted} />
          </div>}
          {selected && inlineDetails && <div className={styles.inlineDetails}>{inlineDetails}</div>}
        </article>;
      })}
      {!visible.length && <div className={styles.empty}>
        <h3>{query || date ? "No matching conversations" : "No conversations yet"}</h3>
        <p>{query || date ? "Try a different search or date." : "Your recorded meetings will appear here."}</p>
      </div>}
    </div>
  </section>;
}
