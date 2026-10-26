"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import type { Meeting } from "@/lib/types";
import { getMonthGrid } from "@/lib/calendar";
import { selectMeetingTitle } from "@/lib/meeting-title";
import { calendarMeetings, canHideRecording } from "@/lib/workspace/calendar-visibility";
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
  onBrowseDay: (date: string, hidden: boolean) => void;
  onVisibilityChange: (id: string, hidden: boolean) => Promise<boolean>;
  working: boolean;
  selectedId: string | null;
  detailKey: string | null;
  detail?: ReactNode;
};

const MAX_VISIBLE_MEETINGS = 3;

/** Calendar tags open one meeting; dates and More open an explicit day browser. */
export function WorkspaceCalendar({ meetings, today, visibleMonth, selectedDate, onMonthChange, onDateChange, onOpenMeeting, onBrowseDay, onVisibilityChange, working, selectedId, detailKey, detail }: Props) {
  const { timezone, dateKey, dateLabel, timeLabel } = useWorkspaceTime();
  const [layout, setLayout] = useState<"month" | "agenda">("month");
  const [hidden, setHidden] = useState(false);
  const reducedMotion = useReducedMotion();
  const { enabled: motionEnabled } = useQuipusMotion();
  const detailRef = useRef<HTMLDivElement>(null);
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
  const grid = getMonthGrid(visibleMonth, { today });
  const labelForDay = (date: string) => dateLabel(`${date}T12:00:00Z`, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const monthLabel = new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${visibleMonth}-15T12:00:00Z`));
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
    onBrowseDay(date, hidden);
  };

  // The parent supplies exactly one inline card on narrow screens and none when docked.
  useEffect(() => {
    if (!detailKey) return;
    const frame = requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start", behavior }));
    return () => cancelAnimationFrame(frame);
  }, [detailKey, behavior]);

  const titleForMeeting = (meeting: Meeting) => selectMeetingTitle({
    preferredTitle: meeting.title, startAt: meeting.startAt, timeZone: timezone,
  });
  const meetingRow = (meeting: Meeting) => {
    const title = titleForMeeting(meeting);
    return (
    <article className={styles.meetingCard} key={meeting.id} data-selected={selectedId === meeting.id}>
      <button type="button" className={styles.meetingButton} onClick={() => onOpenMeeting(meeting.id)} aria-expanded={selectedId === meeting.id}>
        <span className={styles.meetingMeta}>
          <time dateTime={meeting.startAt}>{layout === "agenda" ? `${dateLabel(meeting.startAt, { day: "numeric", month: "short" })} \u00b7 ` : ""}{meeting.recordingProgress?.timeUncertain ? "Time unconfirmed" : timeLabel(meeting.startAt)}</time>
          <span className={styles.kind}>{meeting.source === "calendar" || meeting.status === "upcoming" ? "Follow-up" : "Conversation"}</span>
        </span>
        <strong>{title}</strong>
        {meeting.contacts.length > 0 && <span className={styles.meetingPeople}>{meeting.contacts.map(contact => contact.name).join(", ")}{meeting.contacts[0]?.company ? ` \u00b7 ${meeting.contacts[0].company}` : ""}</span>}
      </button>
      {canHideRecording(meeting) && <div className={styles.hideAction}><CalendarRecordingAction meeting={meeting} disabled={working} onChange={onVisibilityChange} /></div>}
    </article>
    );
  };

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
              </button>
              <div className={styles.dayEvents}>
                {dayMeetings.slice(0, MAX_VISIBLE_MEETINGS).map(meeting => {
                  const title = titleForMeeting(meeting);
                  const time = meeting.recordingProgress?.timeUncertain ? "Time unconfirmed" : timeLabel(meeting.startAt);
                  return <button type="button" key={meeting.id} className={styles.eventChip}
                    data-follow-up={meeting.source === "calendar" || meeting.status === "upcoming"}
                    aria-label={`${title}, ${time}, ${labelForDay(day.isoDate)}`}
                    aria-expanded={selectedId === meeting.id}
                    onClick={() => { onDateChange(day.isoDate); onOpenMeeting(meeting.id); }}
                    title={`${title} \u00b7 ${time}`}>
                    <strong>{title}</strong>
                  </button>;
                })}
                {dayMeetings.length > MAX_VISIBLE_MEETINGS && <button type="button" className={styles.moreButton}
                  aria-label={`Show all ${dayMeetings.length} meetings on ${labelForDay(day.isoDate)}`}
                  onClick={() => selectDay(day.isoDate)}>+{dayMeetings.length - MAX_VISIBLE_MEETINGS} more</button>}
              </div>
            </div>;
          })}
        </div>
      </> : <div className={styles.agenda} {...swipe}>{monthEntries.length ? monthEntries.map(meetingRow) : <p className={styles.empty}>No {hidden ? "hidden recordings" : "meetings"} this month.</p>}</div>}
    </section>
    {detail && <div ref={detailRef} className={styles.detail} data-calendar-details>{detail}</div>}
  </div>;
}
