"use client";
import { WhatsAppDelivery } from "./WhatsAppDelivery";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { getMonthGrid } from "@/lib/calendar";
import { workspaceTime } from "@/lib/workspace-time";
import type { Meeting } from "@/lib/types";
import {
  getApprovals,
  isConversation,
  missingApprovalDetails,
  type MeetingApproval,
  type WorkspaceMode,
} from "@/lib/workspace/model";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { RevealHeading, useQuipusMotion } from "@/components/experience/QuipusExperience";
import { personalGreeting, validTimezone } from "@/lib/quipus-profile";
import { QuipusHeader, viewPaths } from "./QuipusHeader";
import { ConversationJournal } from "./ConversationJournal";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationModal } from "./ConversationModal";
import { ClientHistory } from "./ClientHistory";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { RecordingProgress } from "./RecordingProgress";
import { getRecordingProgress } from "@/lib/workspace/recording-progress";
import { hasRecentHeartbeat } from "@/lib/workspace/setup";
import { ApprovalReceiptNotice } from "./ApprovalReceiptNotice";
import flow from "./flow.module.css";
import { ProfileSettings } from "./ProfileSettings";
import { CalendarConnection } from "./CalendarConnection";
import { WorkspaceTimezone } from "./WorkspaceTime";
import q from "./quipus.module.css";
import { useWorkspace } from "./useWorkspace";
import { initials } from "./ConversationPanel";
import { ApprovalDialog } from "./ApprovalDialog";
import { RecordingDialog } from "./RecordingDialog";
import { LanternDevicePanel } from "./LanternDevicePanel";
import styles from "./workspace.module.css";

export type WorkspaceView =
  | "overview"
  | "conversations"
  | "calendar"
  | "people"
  | "device"
  | "settings";

export type WorkspaceAccount = {
  email: string;
  displayName: string | null;
  timezone?: string;
};

type WorkspaceProps = {
  account: WorkspaceAccount | null;
  initialMode: WorkspaceMode;
  initialView?: WorkspaceView;
  initialConversationId?: string;
};

const viewLabel: Record<WorkspaceView, string> = {
  overview: "Home", conversations: "Conversations", calendar: "Calendar", people: "People", device: "Devices", settings: "Settings",
};
const validViews = Object.keys(viewLabel) as WorkspaceView[];

export function Workspace({
  account: initialAccount,
  initialMode,
  initialView = "overview",
  initialConversationId,
}: WorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reducedMotion = useReducedMotion();
  const { enabled: motionEnabled } = useQuipusMotion();
  const [account, setAccount] = useState(initialAccount);
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [journalFilters, setJournalFilters] = useState({ query: "", date: "" });
  const timezone = validTimezone(account?.timezone);
  const { dateKey: formatDateKey, dateLabel, timeLabel } = workspaceTime(timezone);
  useEffect(() => { setAccount(initialAccount); }, [initialAccount]);
  useEffect(() => {
    try { if (localStorage.getItem("quipus:theme") === "dark") setTheme("dark"); } catch {}
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("quipus:theme", next); } catch {}
  };
  const workspace = useWorkspace(initialMode, initialAccount?.email || null);
  const {
    meetings,
    mode,
    loading,
    error,
    notice,
    working,
    integrations,
    device,
  } =
    workspace;
  const requestedView = params.get("view") as WorkspaceView;
  const view: WorkspaceView = mode === "sample"
    ? validViews.includes(requestedView) ? requestedView : initialView
    : pathname.includes("/conversations") ? "conversations"
    : (Object.entries(viewPaths).find(([key, path]) => key !== "overview" && path === pathname)?.[0] as WorkspaceView) || initialView;
  const detailId = pathname.startsWith("/dashboard/conversations/")
    ? decodeURIComponent(pathname.split("/").at(-1) || "")
    : mode === "sample" ? params.get("conversation") : initialConversationId;
  const detailMeeting = detailId ? meetings.find(m => m.id === detailId) : null;
  const requestedTab = params.get("tab");
  const detailTab = requestedTab === "Audio" || requestedTab === "Transcript" || requestedTab === "Actions" ? requestedTab : "Summary";
  const detailOrigin = useRef<{ href: string; scroll: number } | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const previousPage = useRef(`${view}:${detailId || ""}`);
  useEffect(() => {
    const nextPage = `${view}:${detailId || ""}`;
    if (previousPage.current !== nextPage) document.getElementById("main-content")?.focus({ preventScroll: true });
    previousPage.current = nextPage;
  }, [view, detailId]);
  useEffect(() => {
    if (loading || pendingScroll.current === null) return;
    const position = pendingScroll.current;
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: position, behavior: "instant" });
      pendingScroll.current = null;
    }, reducedMotion || !motionEnabled ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [view, detailId, loading, motionEnabled, reducedMotion]);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    formatDateKey(new Date()).slice(0, 7),
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    formatDateKey(new Date()),
  );
  const [layout, setLayout] = useState<"month" | "agenda">("month");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MeetingApproval | null>(null);
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<"pending" | "dismissed">(
    "pending",
  );
  const [recordingOpen, setRecordingOpen] = useState(false);
  const now = new Date();
  const deviceOnline = Boolean(device && device.status === "online" && hasRecentHeartbeat(device.last_seen_at, now.getTime()));
  const today = formatDateKey(now);
  const approvals = useMemo(() => getApprovals(meetings), [meetings]);
  const pending = approvals.filter((approval) => approval.status === "pending");
  const conversations = useMemo(
    () =>
      meetings
        .filter(isConversation)
        .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)),
    [meetings],
  );
  const contacts = useMemo(
    () => [
      ...new Map(
        conversations
          .flatMap((conversation) => conversation.contacts)
          .map((contact) => [contact.id, contact]),
      ).values(),
    ],
    [conversations],
  );
  const selectedContactId = params.get("client");
  const selectedContact = view === "people" ? contacts.find(contact => contact.id === selectedContactId) : null;
  const activeRecordings = conversations.filter(meeting => getRecordingProgress(meeting).shouldPoll);
  const hasFirstUpload = conversations.some(meeting => meeting.source === "hardware" && getRecordingProgress(meeting).audioAvailable);
  const scheduled = meetings.filter(
    (meeting) => meeting.source === "calendar" || meeting.status === "upcoming",
  );
  const upcoming = scheduled
    .filter((meeting) => Date.parse(meeting.endAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const nextMeeting = upcoming[0] || null;
  const tasks = conversations
    .flatMap((meeting) => meeting.followUps || [])
    .filter(
      (item) =>
        item.type !== "schedule" &&
        item.status !== "completed" &&
      item.status !== "dismissed",
    );
  const todayConversations = conversations.filter(
    (meeting) => formatDateKey(meeting.startAt) === today,
  );
  const selectedMeeting =
    meetings.find((meeting) => meeting.id === selectedId) || null;
  const grid = getMonthGrid(visibleMonth, { today });
  const monthLabel = new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${visibleMonth}-15T12:00:00Z`));
  const normalizedSearch = search.trim().toLowerCase();
  const accountName =
    account?.displayName || account?.email.split("@")[0] || "Google account";
  const accountInitials = account
    ? initials(accountName).toUpperCase() ||
      account.email[0]?.toUpperCase() ||
      "ME"
    : "?";

  const navigate = (next: WorkspaceView) => {
    setSelectedId(null);
    if (mode === "live") router.push(viewPaths[next]);
    else {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next); url.searchParams.delete("conversation"); url.searchParams.delete("client"); url.searchParams.delete("tab"); url.searchParams.delete("edit"); url.searchParams.delete("contact");
      window.history.pushState({}, "", url);
    }
  };
  const openDetail = (id: string, tab: "Summary" | "Actions" | "Transcript" | "Audio" = "Summary", editContact = false, contactId?: string) => {
    detailOrigin.current = { href: window.location.pathname + window.location.search, scroll: window.scrollY };
    setSelectedId(null);
    const details = new URLSearchParams();
    if (tab !== "Summary") details.set("tab", tab);
    if (editContact) details.set("edit", "contact");
    if (contactId) details.set("contact", contactId);
    if (mode === "live") router.push(`/dashboard/conversations/${encodeURIComponent(id)}${details.size ? `?${details}` : ""}`);
    else {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "conversations"); url.searchParams.set("conversation", id);
      url.searchParams.delete("client"); url.searchParams.delete("tab"); url.searchParams.delete("edit"); url.searchParams.delete("contact");
      details.forEach((value, key) => url.searchParams.set(key, value));
      window.history.pushState({}, "", url);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  };
  const backFromDetail = () => {
    const origin = detailOrigin.current;
    if (!origin || !origin.href.startsWith("/") || origin.href.startsWith("//")) { navigate("conversations"); return; }
    pendingScroll.current = origin.scroll;
    if (mode === "live") router.push(origin.href, { scroll: false });
    else window.history.pushState({}, "", origin.href);
  };
  const openClient = (id: string) => {
    setSelectedId(null);
    const url = mode === "live" ? new URL(viewPaths.people, window.location.origin) : new URL(window.location.href);
    if (mode === "sample") { url.searchParams.set("view", "people"); url.searchParams.delete("conversation"); url.searchParams.delete("tab"); url.searchParams.delete("edit"); url.searchParams.delete("contact"); }
    url.searchParams.set("client", id);
    if (mode === "live") router.push(url.pathname + url.search);
    else { window.history.pushState({}, "", url); window.scrollTo({ top: 0, behavior: "instant" }); }
  };
  const changeMonth = (amount: number) => {
    const date = new Date(`${visibleMonth}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setVisibleMonth(date.toISOString().slice(0, 7));
  };
  const approve = async (approval: MeetingApproval) => {
    const created = await workspace.approve(approval);
    return created;
  };
  const viewApprovedEvent = () => {
    const receipt = workspace.approvalReceipt;
    if (!receipt) return;
    setVisibleMonth(formatDateKey(receipt.startAt).slice(0, 7));
    setSelectedDate(formatDateKey(receipt.startAt));
    navigate("calendar");
    setSelectedId(receipt.meetingId);
  };
  const receiptNotice = workspace.approvalReceipt && <ApprovalReceiptNotice receipt={workspace.approvalReceipt} onView={viewApprovedEvent} onDismiss={workspace.dismissApprovalReceipt} />;
  const openConversation = (id: string) => {
    if (meetings.some((meeting) => meeting.id === id)) setSelectedId(id);
  };
  return (
    <WorkspaceTimezone.Provider value={timezone}>
    <div className={styles.shell} data-theme={theme}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <QuipusHeader view={view} sample={mode === "sample"} account={account} navigate={navigate} theme={theme} onTheme={toggleTheme} />
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
        <motion.div className={styles.content} key={`${view}:${detailId || ""}`}
          initial={reducedMotion || !motionEnabled ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion || !motionEnabled ? { opacity: 1 } : { opacity: 0, y: -3 }} transition={{ duration: .14 }}>

          {mode === "sample" && <div className={q.sampleNote}>
            <span><span className={q.sampleBadge}>DEMO</span> Sample meetings. Approvals stay in this demo.</span>
            <button disabled={Boolean(working)} onClick={() => { setSelectedId(null); setEditing(null); setJournalFilters({ query: "", date: "" }); setSearch(""); navigate("overview"); workspace.loadSample(true); }}> Reset sample</button>
          </div>}
          {!detailId && (view === "overview" ? <header className={q.welcome}>
            <div className={q.welcomeCopy}>
              <div className={q.dateLine}><span>YOUR WORKSPACE</span><span className={q.dateDivider} />{new Intl.DateTimeFormat("en-MY", { weekday: "long", month: "long", day: "numeric", timeZone: timezone }).format(now)}</div>
              <RevealHeading text={mode === "sample" ? "Keep every conversation moving." : personalGreeting(account?.displayName, now, timezone)} replayKey={view} />
              <p>{mode === "sample" ? "Record meetings. Review the details. Follow up." : pending.length ? `${pending.length} follow-up${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} your approval.` : "Your meetings and next steps, in one place."}</p>
            </div>
            <div className={q.welcomeMetrics} aria-label="Workspace overview">
              <div><strong>{conversations.length.toString().padStart(2, "0")}</strong><span>Conversations</span></div>
              <div><strong>{pending.length.toString().padStart(2, "0")}</strong><span>To approve</span></div>
            </div>
          </header> : <header className={styles.pageHeader}>
            <div><p className={styles.eyebrow}>YOUR WORKSPACE</p>
              <RevealHeading text={viewLabel[view]} replayKey={view} />
              <p>{view === "conversations" ? "Find a meeting. Review what matters." : view === "calendar" ? "Select a meeting to see its conversation and next steps." : view === "device" ? "Connection, battery and storage." : view === "people" ? "Your clients, companies and meeting history." : "Your profile and connected accounts."}</p>
            </div>
          </header>)}
          {error && (
            <div className={styles.errorBanner} role="alert">
              <span>{error}</span>
              <button
                className={styles.iconButton}
                aria-label="Dismiss error"
                onClick={() => workspace.setError(null)}
              >
                Close
              </button>
            </div>
          )}
          {loading ? (
            <div className={q.workspaceSkeleton} role="status" aria-label="Loading meetings">
              <span className={q.skeletonLabel}>Loading meetings…</span>
              <div className={q.skeletonBrief}><i /><i /></div>
              <div className={q.skeletonRows}>{[0,1,2,3].map(i => <i key={i} />)}</div>
            </div>
          ) : (
            <>
              {!selectedId && receiptNotice}
              {mode === "live" && account && view === "overview" && <WorkspaceSetup account={account} calendarConnected={integrations.google} devicePaired={workspace.deviceStatusLoaded ? Boolean(device) : undefined} hasRecording={hasFirstUpload} onPair={() => navigate("device")} onFirstRecording={() => navigate("device")} />}
              {mode === "live" && account && view === "calendar" && <CalendarConnection email={account.email} connected={integrations.google} />}
              {detailId ? (detailMeeting ? <ConversationDetail
                conversation={detailMeeting} mode={mode} working={working} error={error}
                initialTab={detailTab} initialContactEditing={params.get("edit") === "contact"} initialContactId={params.get("contact")}
                backLabel={detailOrigin.current?.href.includes("view=people") || detailOrigin.current?.href.includes("/people") ? "Back to client history" : detailOrigin.current?.href.includes("view=calendar") || detailOrigin.current?.href.includes("/calendar") ? "Back to calendar" : detailOrigin.current?.href === "/dashboard" || detailOrigin.current?.href.includes("view=overview") || detailOrigin.current?.href === "/" ? "Back to home" : "Back to conversations"}
                onBack={backFromDetail}
                onTask={(id, completed) => void workspace.patchFollowUp(id, { status: completed ? "completed" : "pending" })}
                onEditApproval={setEditing} onUpdateContact={workspace.patchContact} onOpenContact={openClient} onRetryAccepted={() => void workspace.loadLive(false, true)}
              /> : <div className={styles.emptyInline}><h3>Conversation unavailable.</h3><p>It may still be processing, or it isn’t in this workspace.</p><button className={q.textLink} onClick={() => navigate("conversations")}>Back to conversations</button></div>) : null}
              {view === "overview" && <>
                {activeRecordings.length > 0 && <section className={flow.progressList} aria-label="Recordings in progress">
                  <div className={flow.progressHeading}><h2>Recordings in progress</h2></div>
                  {activeRecordings.map(meeting => <div key={meeting.id} className={flow.progressEntry}><h3>{meeting.title}</h3><RecordingProgress meeting={meeting} mode={mode} onOpenAudio={() => openDetail(meeting.id, "Audio")} onRetryAccepted={() => workspace.loadLive(false, true)} /></div>)}
                </section>}
                <div className={q.dailyBrief}>
                  <section className={q.nextAction} aria-label="Next approval">
                    <div className={q.briefHeading}><span className={q.kicker}>FOLLOW-UPS</span><span className={q.approvalCount}>{pending.length} to approve</span></div>
                    <h2>{pending[0]?.title || "No pending approvals"}</h2>
                    <p>{pending[0] ? `${pending[0].contact?.name || "Your client"}${pending[0].contact?.company ? ` · ${pending[0].contact.company}` : ""}${pending[0].details.startAt ? ` · ${dateLabel(pending[0].details.startAt)} at ${timeLabel(pending[0].details.startAt)}` : " · Confirm the meeting details"}` : "New follow-ups will appear here after your meetings."}</p>
                    <div className={q.briefBottom}>
                      <span className={q.smallPeople}><span>{pending[0] ? initials(pending[0].contact?.name || "Client") : null}</span>{pending[0] ? "Awaiting your approval" : "All caught up"}</span>
                      <button className={q.actionButton} onClick={() => pending[0] ? setEditing(pending[0]) : navigate("conversations")}>{pending[0] ? "Review follow-up" : "Conversations"}</button>
                    </div>
                  </section>
                  <section className={q.nextMeeting} aria-label="Next meeting">
                    <div className={q.briefHeading}><span className={q.kicker}>NEXT MEETING</span></div>
                    <h2>{nextMeeting?.title || "No upcoming meetings"}</h2>
                    <p>{nextMeeting ? `${dateLabel(nextMeeting.startAt, { weekday: "short" })} · ${timeLabel(nextMeeting.startAt)}${nextMeeting.contacts[0]?.company ? ` · ${nextMeeting.contacts[0].company}` : ""}` : "Your upcoming meetings will appear here once your calendar is connected."}</p>
                    <div className={q.briefBottom}><span className={q.smallPeople}>{nextMeeting?.contacts.length ? `${nextMeeting.contacts.length} participant${nextMeeting.contacts.length > 1 ? "s" : ""}` : nextMeeting ? "View meeting details" : "Your schedule, in view"}</span><button className={q.textLink} onClick={() => navigate("calendar")}>Open calendar </button></div>
                  </section>
                </div>
                <ConversationJournal meetings={conversations} mode={mode} compact onOpen={openDetail} onAll={() => navigate("conversations")} filters={journalFilters} onFiltersChange={setJournalFilters} onRetryAccepted={() => void workspace.loadLive(false, true)} />
                <div className={q.workspaceNote}><span>Conversation intelligence for your next step.</span><button className={q.deviceStatus} onClick={() => navigate("device")}><i data-offline={!deviceOnline} />{mode === "sample" ? "View sample device" : device ? `${device.name} · ${deviceOnline ? "Connected" : "No recent connection"}` : workspace.deviceStatusLoaded ? "Connect your Quipus" : "View device status"}</button></div>
              </>}
              {view === "conversations" && !detailId && <ConversationJournal meetings={conversations} mode={mode} onOpen={openDetail} onPeople={() => navigate("people")} filters={journalFilters} onFiltersChange={setJournalFilters} onRetryAccepted={() => void workspace.loadLive(false, true)} />}
              {view === "calendar" && (
                <>
                  <div className={styles.calendarLayout}>
                    <section
                      className={styles.calendarSurface}
                      aria-label="Meeting calendar"
                    >
                      <header className={styles.calendarToolbar}>
                        <div className={styles.monthControls}>
                          <h2>{monthLabel}</h2>
                          <button
                            className={styles.iconButton}
                            onClick={() => changeMonth(-1)}
                            aria-label="Previous month"
                          >
                            <ChevronLeft />
                          </button>
                          <button
                            className={styles.iconButton}
                            onClick={() => changeMonth(1)}
                            aria-label="Next month"
                          >
                            <ChevronRight />
                          </button>
                          <button
                            className={styles.todayButton}
                            onClick={() => {
                              setVisibleMonth(today.slice(0, 7));
                              setSelectedDate(today);
                            }}
                          >
                            Today
                          </button>
                        </div>
                        <div
                          className={styles.viewToggle}
                          aria-label="Calendar layout"
                        >
                          <button
                            aria-pressed={layout === "month"}
                            className={
                              layout === "month" ? styles.toggleActive : ""
                            }
                            onClick={() => setLayout("month")}
                          >

                            Month
                          </button>
                          <button
                            aria-pressed={layout === "agenda"}
                            className={
                              layout === "agenda" ? styles.toggleActive : ""
                            }
                            onClick={() => setLayout("agenda")}
                          >

                            Agenda
                          </button>
                        </div>
                      </header>
                      {layout === "month" ? (
                        <>
                          <div className={styles.weekdays}>
                            {[
                              "MON",
                              "TUE",
                              "WED",
                              "THU",
                              "FRI",
                              "SAT",
                              "SUN",
                            ].map((day) => (
                              <span key={day}>{day}</span>
                            ))}
                          </div>
                          <div className={styles.monthGrid}>
                            {grid.map((day) => {
                              const entries = meetings.filter(
                                (meeting) =>
                                  formatDateKey(meeting.startAt) ===
                                  day.isoDate,
                              );
                              return (
                                <div
                                  key={day.isoDate}
                                  className={`${styles.day} ${!day.inCurrentMonth ? styles.otherMonth : ""} ${day.isoDate === selectedDate ? styles.selectedDay : ""}`}
                                >
                                  <button
                                    className={`${styles.dayNumber} ${day.isToday ? styles.todayNumber : ""}`}
                                    aria-label={dateLabel(
                                      `${day.isoDate}T12:00:00Z`,
                                      { weekday: "long", year: "numeric", timeZone: "UTC" },
                                    )}
                                    aria-pressed={day.isoDate === selectedDate}
                                    onClick={() => setSelectedDate(day.isoDate)}
                                  >
                                    {day.dayNumber}
                                  </button>
                                  <div className={styles.dayEvents}>
                                    {entries.slice(0, 3).map((meeting) => (
                                      <button
                                        key={meeting.id}
                                        className={`${styles.eventChip} ${meeting.source === "calendar" || meeting.status === "upcoming" ? styles.scheduledChip : styles.conversationChip}`}
                                        onClick={() =>
                                          openConversation(meeting.id)
                                        }
                                        title={meeting.title}
                                      >
                                        <span className={styles.eventTime}>
                                          {timeLabel(meeting.startAt)}
                                        </span>
                                        <strong>
                                          {meeting.contacts[0]?.name ||
                                            meeting.title}
                                        </strong>
                                        <small>
                                          {meeting.source === "calendar"
                                            ? "Follow-up"
                                            : isConversation(meeting)
                                              ? "Conversation"
                                              : meeting.title}
                                        </small>
                                      </button>
                                    ))}
                                    {entries.length > 3 && (
                                      <button
                                        className={styles.moreEvents}
                                        onClick={() => {
                                          setSelectedDate(day.isoDate);
                                          setLayout("agenda");
                                        }}
                                      >
                                        +{entries.length - 3} more
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <div className={styles.agenda}>
                          {meetings
                            .filter((meeting) =>
                              formatDateKey(meeting.startAt).startsWith(
                                visibleMonth,
                              ),
                            )
                            .sort(
                              (a, b) =>
                                Date.parse(a.startAt) - Date.parse(b.startAt),
                            )
                            .map((meeting) => (
                              <button
                                className={styles.agendaRow}
                                key={meeting.id}
                                onClick={() => openConversation(meeting.id)}
                              >
                                <span className={styles.agendaDate}>
                                  {dateLabel(meeting.startAt, {
                                    day: "2-digit",
                                  })}
                                </span>
                                <span>
                                  <strong>{meeting.title}</strong>
                                  <small>
                                    {meeting.contacts[0]?.company} ·{" "}
                                    {timeLabel(meeting.startAt)}
                                  </small>
                                </span>
                                <span className={styles.typePill}>
                                  {meeting.source === "calendar"
                                    ? "Meeting"
                                    : "Conversation"}
                                </span>

                              </button>
                            ))}
                          {!meetings.some((meeting) =>
                            formatDateKey(meeting.startAt).startsWith(
                              visibleMonth,
                            ),
                          ) && (
                            <div className={styles.emptyInline}>

                              <h3>A little breathing room</h3>
                              <p>No meetings or conversations this month.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                    <aside
                      className={styles.approvalRail}
                      aria-label="Meeting approvals"
                    >
                      <header>
                        <div>
                          <span className={styles.eyebrow}>
                            READY FOR YOUR GO-AHEAD
                          </span>
                          <h2>
                            Approvals{" "}
                            <span className={styles.count}>
                              {pending.length}
                            </span>
                          </h2>
                        </div>

                      </header>
                      <p className={styles.railIntro}>
                        You agreed on the next step.
                        <br />
                        One approval makes it official.
                      </p>
                      {(approvalFilter === "dismissed" ||
                        approvals.some(
                          (approval) => approval.status === "dismissed",
                        )) && (
                        <div className={styles.railFilters}>
                          <button
                            className={
                              approvalFilter === "pending"
                                ? styles.activeFilter
                                : ""
                            }
                            onClick={() => setApprovalFilter("pending")}
                          >
                            Pending
                          </button>
                          <button
                            className={
                              approvalFilter === "dismissed"
                                ? styles.activeFilter
                                : ""
                            }
                            onClick={() => setApprovalFilter("dismissed")}
                          >
                            Dismissed
                          </button>
                        </div>
                      )}
                      {approvals
                        .filter(
                          (approval) => approval.status === approvalFilter,
                        )
                        .map((approval) => {
                          const missing = missingApprovalDetails(
                            approval.details,
                          );
                          return (
                            <article
                              key={approval.id}
                              className={styles.approvalCard}
                            >
                              <div className={styles.approvalIdentity}>
                                <span className={styles.smallAvatar}>
                                  {initials(approval.contact?.name || "Client")}
                                </span>
                                <span>
                                  <strong>
                                    {approval.contact?.name || "Client meeting"}
                                  </strong>
                                  <small>
                                    {approval.contact?.company ||
                                      "From your conversation"}
                                  </small>
                                </span>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => setEditing(approval)}
                                  aria-label={`Edit meeting with ${approval.contact?.name || "client"}`}
                                  disabled={
                                    Boolean(working) ||
                                    approval.status === "dismissed"
                                  }
                                >
                                  Edit
                                </button>
                              </div>
                              <h3>{approval.title}</h3>
                              <div className={styles.approvalTime}>

                                <span>
                                  {approval.details.startAt
                                    ? dateLabel(approval.details.startAt, {
                                        weekday: "short",
                                      })
                                    : "Date to confirm"}
                                </span>
                              </div>
                              <div className={styles.approvalTime}>

                                <span>
                                  {approval.details.startAt
                                    ? timeLabel(approval.details.startAt)
                                    : "Time to confirm"}
                                  {approval.details.durationMinutes
                                    ? ` · ${approval.details.durationMinutes} min`
                                    : ""}
                                </span>
                              </div>
                              {approval.details.attendees.length > 0 && (
                                <p className={styles.attendee}>
                                  {approval.details.attendees.join(", ")}
                                </p>
                              )}
                              {approval.details.evidence && (
                                <blockquote>
                                  “{approval.details.evidence}”
                                </blockquote>
                              )}
                              {missing.length > 0 && (
                                <p className={styles.missing}>
                                  Confirm {missing.join(", ")}.
                                </p>
                              )}
                              <button
                                className={styles.sourceLink}
                                onClick={() =>
                                  openConversation(approval.conversationId)
                                }
                              >
                                View conversation
                              </button>
                              {approval.status === "dismissed" ? (
                                <button
                                  className={styles.secondaryButton}
                                  disabled={Boolean(working)}
                                  onClick={() =>
                                    void workspace.patchFollowUp(approval.id, {
                                      status: "pending",
                                    })
                                  }
                                >
                                  Restore approval
                                </button>
                              ) : (
                                <div className={styles.approvalActions}>
                                  <button
                                    className={styles.primaryButton}
                                    disabled={Boolean(working)}
                                    onClick={() => setEditing(approval)}
                                  >
                                    {working === approval.id ? (
                                      <LoaderCircle className={styles.spin} />
                                    ) : null}
                                    {working === approval.id
                                      ? "Adding…"
                                      : missing.length
                                        ? "Complete details"
                                        : "Review invitation"}
                                  </button>
                                  <button
                                    className={styles.dismissButton}
                                    onClick={() =>
                                      void workspace.patchFollowUp(
                                        approval.id,
                                        { status: "dismissed" },
                                      )
                                    }
                                    disabled={Boolean(working)}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      {approvals.filter(
                        (approval) => approval.status === approvalFilter,
                      ).length === 0 && (
                        <div className={styles.approvalsEmpty}>

                          <h3>
                            {approvalFilter === "pending"
                              ? "You’re all caught up."
                              : "Nothing dismissed."}
                          </h3>
                          <p>
                            Agreed meetings from your conversations will appear
                            here.
                          </p>
                        </div>
                      )}
                      <p className={styles.railFootnote}>

                        {mode === "sample"
                          ? "Sample approvals stay in this browser."
                          : "Invitations are sent only after approval."}
                      </p>
                    </aside>
                  </div>
                </>
              )}

              {view === "people" && selectedContact && <ClientHistory contact={selectedContact} conversations={conversations} onBack={() => navigate("people")} onOpenMeeting={openDetail} onCorrect={() => { const latest = conversations.find(meeting => meeting.contacts.some(contact => contact.id === selectedContact.id)); if (latest) openDetail(latest.id, "Summary", true, selectedContact.id); }} />}
              {view === "people" && !selectedContact && (
                <section>
                  <label className={`${styles.search} ${styles.peopleSearch}`}>

                    <input
                      aria-label="Search people"
                      placeholder="Find a person or company"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <div className={styles.peopleGrid}>
                    {contacts
                      .filter((contact) =>
                        `${contact.name} ${contact.company}`
                          .toLowerCase()
                          .includes(normalizedSearch),
                      )
                      .map((contact) => {
                        const history = conversations.filter((conversation) =>
                          conversation.contacts.some(
                            (item) => item.id === contact.id,
                          ),
                        );
                        return (
                          <button
                            key={contact.id}
                            className={styles.personCard}
                            onClick={() => openClient(contact.id)}
                          >
                            <span className={styles.avatar}>
                              {initials(contact.name)}
                            </span>
                            <h2>{contact.name}</h2>
                            <p>
                              {contact.role || "Client"}
                              {contact.company ? ` · ${contact.company}` : ""}
                            </p>
                            <span className={styles.personEmail}>
                              {contact.email || "No email added"}
                            </span>
                            <footer>
                              <span>
                                {history.length} conversation
                                {history.length === 1 ? "" : "s"}
                              </span>

                            </footer>
                          </button>
                        );
                      })}
                  </div>
                  {!contacts.length && (
                    <div className={styles.emptyInline}>

                      <h3>Build a memory around your clients.</h3>
                      <p>People from your conversations will appear here.</p>
                    </div>
                  )}
                </section>
              )}
              {view === "device" && (
                <LanternDevicePanel
                  mode={mode}
                  integrations={integrations}
                  conversationCount={conversations.length}
                  accountEmail={account?.email}
                  hasRecording={hasFirstUpload}
                />
              )}
              {view === "settings" && (
                <div className={styles.settingsGrid}>
                  <ProfileSettings account={account} sample={mode === "sample"} onSaved={setAccount} />
                  <WhatsAppDelivery sample={mode === "sample"} />
                  <section className={styles.settingsCard}>
                    <h2>Gmail follow-ups</h2>
                    <p>Review a draft, then approve the exact recipient and message before sending.</p>
                    {mode === "live" ? <a className={styles.secondaryButton} href="/api/google/connect?gmail=1&returnTo=%2Fdashboard%2Fsettings">Connect or refresh Gmail</a> : <p>Available in your connected workspace.</p>}
                  </section>
                  <section className={styles.settingsCard}>

                      <h2>Google Calendar</h2>
                    <p>
                      Approve a meeting in Quipus and keep it on your calendar.
                    </p>
                    <span className={styles.connectionState}>
                      <i
                        className={
                          mode === "live" && integrations.google
                            ? styles.greenDot
                            : styles.neutralDot
                        }
                      />
                      {mode === "sample"
                        ? "Sample calendar"
                        : integrations.google === undefined
                          ? "Status unavailable"
                          : integrations.google
                          ? "Connection saved"
                          : "Not connected"}
                    </span>
                    {mode === "live" ? (
                      <a
                        className={styles.secondaryButton}
                        href="/api/google/connect?returnTo=%2Fdashboard%2Fsettings"
                      >
                        {integrations.google
                          ? "Reconnect Google Calendar"
                          : "Connect Google Calendar"}

                      </a>
                    ) : (
                      <Link
                        className={styles.secondaryButton}
                        href={account ? "/dashboard" : "/login?next=/dashboard"}
                      >
                        Open your live workspace
                      </Link>
                    )}
                  </section>
                  <section className={styles.settingsCard}>
                    <h2>Language & region</h2>
                    <p>
                      Choose your language preference for supported controls and processing requests. Quipus’s new navigation currently uses English.
                    </p>
                    <LanguageSwitcher />
                    <div className={styles.region}>
                      <span>Timezone</span>
                      <strong>{timezone}</strong>
                    </div>
                  </section>
                  <section className={styles.settingsCard}>

                    <h2>Access & privacy</h2>
                    <p>
                      Your source recordings, transcripts, and meeting briefs
                      stay private unless you approve sharing or enable delivery to your WhatsApp.
                    </p>
                    <span className={styles.connectionState}>
                      <i
                        className={
                          account ? styles.greenDot : styles.neutralDot
                        }
                      />
                      {account
                        ? `Signed in as ${account.email}`
                        : "You are signed out"}
                    </span>
                    {account ? (
                      <form action="/api/auth/logout" method="post">
                        <button className={styles.signOutButton} type="submit">
                           Sign out
                        </button>
                      </form>
                    ) : (
                      <Link
                        aria-label="Sign in with Google"
                        className={styles.signInButton}
                        href="/login?next=/dashboard"
                      >

                        <span className={styles.signInFull}>Sign in with Google</span>
                        <span className={styles.signInShort}>Sign in</span>
                      </Link>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
          <footer className={styles.pageFooter}>
            <span className={styles.footerBrand}>
              Quipus<span> by Fovea</span>
            </span>
            <span className={styles.footerLinks}>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <span>Listen. Understand. Follow through.</span>
            </span>
          </footer>
        </motion.div>
        </AnimatePresence>
      </main>
      <ConversationModal
        meeting={selectedMeeting}
        meetings={meetings}
        onClose={() => setSelectedId(null)}
        onOpenFull={openDetail}
        onOpenContact={openClient}
        onEditApproval={setEditing}
        onUpdateContact={workspace.patchContact}
        onRetryAccepted={() => void workspace.loadLive(false, true)}
        mode={mode}
        receipt={receiptNotice}
        onTask={(id, completed) =>
          void workspace.patchFollowUp(id, {
            status: completed ? "completed" : "pending",
          })
        }
        working={working}
        error={error}
      />
      <ApprovalDialog
        approval={editing}
        mode={mode}
        working={Boolean(working)}
        executionError={error}
        onClose={() => setEditing(null)}
        onApprove={approve}
      />
      {mode === "live" && (
        <RecordingDialog
          open={recordingOpen}
          onClose={() => setRecordingOpen(false)}
          onProcessed={() => {
            setRecordingOpen(false);
            void workspace.loadLive();
          }}
        />
      )}
      {notice && (
        <div className={styles.toast} role="status">

          <span>{notice}</span>
          <button
            onClick={() => workspace.setNotice(null)}
            aria-label="Dismiss notification"
          >
            Close
          </button>
        </div>
      )}
    </div>
    </WorkspaceTimezone.Provider>
  );
}
