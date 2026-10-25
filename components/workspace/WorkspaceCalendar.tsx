"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import type { Meeting } from "@/lib/types";
import { getMonthGrid } from "@/lib/calendar";
import { calendarMeetings, canHideRecording } from "@/lib/workspace/calendar-visibility";
import { useMediaQuery } from "@/components/hooks/useMediaQuery";
import { useQuipusMotion } from "@/components/experience/QuipusExperience";
import { CalendarRecordingAction } from "./CalendarRecordingAction";
import { useCalendarSwipe } from "./useCalendarSwipe";
import { useWorkspaceTime } from "./WorkspaceTime";
import styles from "./calendar.module.css";

type Props = {
  meetings: Meeting[];
  today: string;
  visibleMonth: string;
  selectedDate: string;
  onMonthChange: (month: string) => void;
  onDateChange: (date: string) => void;
  onOpenMeeting: (id: string) => void;
  onVisibilityChange: (id: string, hidden: boolean) => Promise<boolean>;
  working: boolean;
  selectedId: string | null;
  detailKey: string | null;
  detail?: ReactNode;
};

/** Dates stay compact; readable meeting cards and details live outside the seven-column grid. */
export function WorkspaceCalendar({ meetings, today, visibleMonth, selectedDate, onMonthChange, onDateChange, onOpenMeeting, onVisibilityChange, working, selectedId, detailKey, detail }: Props) {
  const { dateKey, dateLabel, timeLabel } = useWorkspaceTime();
  const [layout, setLayout] = useState<"month" | "agenda">("month");
  const [hidden, setHidden] = useState(false);
  const compact = useMediaQuery("(max-width: 760px)");
  const inlineDetails = useMediaQuery("(max-width: 1099px)");
  const reducedMotion = useReducedMotion();
  const { enabled: motionEnabled } = useQuipusMotion();
  const dayListRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const entries = useMemo(() => calendarMeetings(meetings, hidden).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)), [meetings, hidden]);
  const entriesByDate = useMemo(() => {
    const days = new Map<string, Meeting[]>();
    for (const meeting of entries) {
      const date = dateKey(meeting.startAt);
      const group = days.get(date) || [];
      group.push(meeting);
      days.set(date, group);
    }
    return days;
  }, [entries, dateKey]);
  const hiddenCount = calendarMeetings(meetings, true).length;
  const monthEntries = entries.filter(meeting => dateKey(meeting.startAt).startsWith(visibleMonth));
  const dayEntries = entriesByDate.get(selectedDate) || [];
  const grid = getMonthGrid(visibleMonth, { today });
  const labelForDay = (date: string) => dateLabel(`${date}T12:00:00Z`, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const monthLabel = dateLabel(`${visibleMonth}-15T12:00:00Z`, { month: "long", year: "numeric", timeZone: "UTC" });
  const behavior = reducedMotion || !motionEnabled ? "instant" : "smooth";
  const changeMonth = (amount: number) => {
    const date = new Date(`${visibleMonth}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    const month = date.toISOString().slice(0, 7);
    onMonthChange(month);
    onDateChange(`${month}-01`);
  };
  const swipe = useCalendarSwipe(changeMonth);
  const selectDay = (date: string) => {
    onDateChange(date);
    if (!date.startsWith(visibleMonth)) onMonthChange(date.slice(0, 7));
    setSelectionEpoch(value => value + 1);
  };

  // Only an explicit date tap moves the page; background polling and hydration do not.
  useEffect(() => {
    if (!compact || selectionEpoch === 0) return;
    const frame = requestAnimationFrame(() => dayListRef.current?.scrollIntoView({ block: "start", behavior }));
    return () => cancelAnimationFrame(frame);
  }, [selectionEpoch, compact, behavior]);
  useEffect(() => {
    if (!inlineDetails || !detailKey) return;
    const frame = requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start", behavior }));
    return () => cancelAnimationFrame(frame);
  }, [detailKey, inlineDetails, behavior]);

  const meetingRow = (meeting: Meeting) => (
    <article className={styles.meetingCard} key={meeting.id} data-selected={selectedId === meeting.id}>
      <button type="button" className={styles.meetingButton} onClick={() => onOpenMeeting(meeting.id)} aria-expanded={selectedId === meeting.id}>
        <span className={styles.meetingMeta}>
          <time dateTime={meeting.startAt}>{layout === "agenda" ? `${dateLabel(meeting.startAt, { day: "numeric", month: "short" })} ? ` : ""}{meeting.recordingProgress?.timeUncertain ? "Time unconfirmed" : timeLabel(meeting.startAt)}</time>
          <span className={styles.kind}>{meeting.source === "calendar" || meeting.status === "upcoming" ? "Follow-up" : "Conversation"}</span>
        </span>
        <strong>{meeting.title}</strong>
        {meeting.contacts.length > 0 && <span className={styles.meetingPeople}>{meeting.contacts.map(contact => contact.name).join(", ")}{meeting.contacts[0]?.company ? ` ? ${meeting.contacts[0].company}` : ""}</span>}
      </button>
      {canHideRecording(meeting) && <div className={styles.hideAction}><CalendarRecordingAction meeting={meeting} disabled={working} onChange={onVisibilityChange} /></div>}
    </article>
  );

  return <div className={styles.calendar}>
    <section className={styles.surface} aria-label="Meeting calendar" data-workspace-intro="calendar">
      <header className={styles.toolbar}>
        <div className={styles.monthControls}>
          <h2 aria-live="polite" aria-atomic="true">{monthLabel}</h2>
          <div className={styles.monthButtons}>
            <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft aria-hidden="true" /></button>
            <button type="button" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight aria-hidden="true" /></button>
            <button type="button" onClick={() => { onMonthChange(today.slice(0, 7)); selectDay(today); }}>Today</button>
          </div>
        </div>
        <div className={styles.viewControls} aria-label="Calendar layout">
          <div className={styles.viewToggle}>
            <button type="button" aria-pressed={layout === "month"} onClick={() => setLayout("month")}>Month</button>
            <button type="button" aria-pressed={layout === "agenda"} onClick={() => setLayout("agenda")}>Agenda</button>
          </div>
          {(hiddenCount > 0 || hidden) && <button type="button" className={styles.hiddenButton} aria-pressed={hidden} onClick={() => setHidden(current => !current)}>Hidden ({hiddenCount})</button>}
        </div>
      </header>
      {layout === "month" ? <>
        <div className={styles.weekdays} aria-hidden="true">{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={index}>{day}</span>)}</div>
        <div className={styles.monthGrid} {...swipe}>
          {grid.map(day => {
            const dayMeetings = entriesByDate.get(day.isoDate) || [];
            return <div key={day.isoDate} className={styles.day} data-outside={!day.inCurrentMonth} data-selected={day.isoDate === selectedDate}>
              <button type="button" className={styles.dayButton} aria-label={`${labelForDay(day.isoDate)}, ${dayMeetings.length} ${dayMeetings.length === 1 ? "meeting" : "meetings"}`} aria-pressed={day.isoDate === selectedDate} aria-current={day.isToday ? "date" : undefined} onClick={() => selectDay(day.isoDate)}>
                <span className={styles.dayNumber}>{day.dayNumber}</span>
                <span className={styles.dayMarkers} aria-hidden="true">{dayMeetings.slice(0, 3).map(meeting => <i key={meeting.id} data-follow-up={meeting.source === "calendar" || meeting.status === "upcoming"} />)}{dayMeetings.length > 3 && <small>+{dayMeetings.length - 3}</small>}</span>
              </button>
              <div className={styles.desktopEvents}>{dayMeetings.slice(0, 2).map(meeting => <button type="button" key={meeting.id} className={styles.eventChip} onClick={() => { onDateChange(day.isoDate); onOpenMeeting(meeting.id); }} title={meeting.title}><span>{timeLabel(meeting.startAt)}</span><strong>{meeting.contacts[0]?.name || meeting.title}</strong></button>)}{dayMeetings.length > 2 && <button type="button" className={styles.moreButton} onClick={() => selectDay(day.isoDate)}>+{dayMeetings.length - 2} more</button>}</div>
            </div>;
          })}
        </div>
      </> : <div className={styles.agenda} {...swipe}>{monthEntries.length ? monthEntries.map(meetingRow) : <p className={styles.empty}>No {hidden ? "hidden recordings" : "meetings"} this month.</p>}</div>}
      {layout === "month" && <section ref={dayListRef} className={styles.dayList} aria-label={`Meetings on ${labelForDay(selectedDate)}`}>
        <header className={styles.dayHeading}><h3>{labelForDay(selectedDate)}</h3><span>{dayEntries.length}</span></header>
        {dayEntries.length ? dayEntries.map(meetingRow) : <p className={styles.empty}>No {hidden ? "hidden recordings" : "meetings"} on this date.</p>}
      </section>}
    </section>
    {detail && <div ref={detailRef} className={styles.detail} data-calendar-details>{detail}</div>}
  </div>;
}
