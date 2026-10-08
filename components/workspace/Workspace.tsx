"use client";
import { WhatsAppDelivery } from "./WhatsAppDelivery";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { validTimezone } from "@/lib/quipus-profile";
import { workspaceGreeting } from "@/lib/workspace-greeting";
import { isWorkspaceHref, resolveWorkspaceRoute } from "@/lib/workspace-navigation";
import { QuipusHeader, viewPaths } from "./QuipusHeader";
import { ConversationJournal } from "./ConversationJournal";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationModal } from "./ConversationModal";
import { ClientHistory } from "./ClientHistory";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { RecordingProgress } from "./RecordingProgress";
import { getRecordingProgress } from "@/lib/workspace/recording-progress";
import { ApprovalReceiptNotice } from "./ApprovalReceiptNotice";
import flow from "./flow.module.css";
import { ProfileSettings } from "./ProfileSettings";
import { CalendarConnection } from "./CalendarConnection";
import { WorkspaceTimezone } from "./WorkspaceTime";
import q from "./quipus.module.css";
import d from "./dashboard.module.css";
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
  initialNow?: string;
};

const viewLabel: Record<WorkspaceView, string> = {
  overview: "Home", conversations: "Conversations", calendar: "Calendar", people: "People", device: "Devices", settings: "Settings",
};

export function Workspace({
  account: initialAccount,
  initialMode,
  initialView = "overview",
  initialNow,
}: WorkspaceProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const reducedMotion = useReducedMotion();
  const { enabled: motionEnabled, setScene } = useQuipusMotion();
  const [account, setAccount] = useState(initialAccount);
  const [journalFilters, setJournalFilters] = useState({ query: "", date: "" });
  const [clock, setClock] = useState(() => {
    const snapshot = new Date(initialNow || Date.now());
    return Number.isFinite(snapshot.getTime()) ? snapshot : new Date();
  });
  const timezone = validTimezone(account?.timezone);
  const { dateKey: formatDateKey, dateLabel, timeLabel } = workspaceTime(timezone);
  useEffect(() => { setAccount(initialAccount); }, [initialAccount]);
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
  const { view, detailId } = resolveWorkspaceRoute(pathname, new URLSearchParams(params.toString()), mode, initialView);
  useEffect(() => { setScene(view); }, [view, setScene]);
  const detailMeeting = detailId ? meetings.find(m => m.id === detailId) : null;
  const requestedTab = params.get("tab");
  const detailTab = requestedTab === "Audio" || requestedTab === "Transcript" || requestedTab === "Actions" ? requestedTab : "Summary";
  const detailOrigin = useRef<{ href: string; scroll: number } | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const pageIdentity = `${view}:${detailId || ""}:${params.get("client") || ""}`;
  const previousPage = useRef(pageIdentity);
  useEffect(() => {
    const nextPage = pageIdentity;
    if (previousPage.current !== nextPage) document.getElementById("main-content")?.focus({ preventScroll: true });
    previousPage.current = nextPage;
  }, [pageIdentity]);
  useEffect(() => {
    if (loading || pendingScroll.current === null) return;
    const position = pendingScroll.current;
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: position, behavior: "instant" });
      pendingScroll.current = null;
    }, reducedMotion || !motionEnabled ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [pageIdentity, historyEpoch, loading, motionEnabled, reducedMotion]);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    formatDateKey(clock).slice(0, 7),
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    formatDateKey(clock),
  );
  const [layout, setLayout] = useState<"month" | "agenda">("month");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MeetingApproval | null>(null);
  const [selectedTab, setSelectedTab] = useState<"Summary" | "Actions" | "Transcript" | "Audio">("Summary");
  const [desktopDock, setDesktopDock] = useState(false);
  const [panelOrigin, setPanelOrigin] = useState<"journal" | "next" | "approval" | "calendar" | "recording" | "other">("journal");
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1100px)");
    const update = () => setDesktopDock(query.matches);
    update();
    if (window.matchMedia("(max-width: 760px)").matches) setLayout("agenda");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const reviewApproval = (approval: MeetingApproval) => {
    if (detailId) setPanelOrigin("other");
    setEditing(approval);
  };
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<"pending" | "dismissed">(
    "pending",
  );
  const [recordingOpen, setRecordingOpen] = useState(false);
  useEffect(() => {
    // Refresh on return to the app, rather than running an animation-time clock.
    const refresh = () => { if (!document.hidden) setClock(new Date()); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const now = clock;
  const today = formatDateKey(now);
  const approvals = useMemo(() => getApprovals(meetings), [meetings]);
  const pending = approvals.filter((approval) => approval.status === "pending")
    .sort((a, b) => (a.details.startAt ? Date.parse(a.details.startAt) : Infinity) - (b.details.startAt ? Date.parse(b.details.startAt) : Infinity));
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
  const greeting = workspaceGreeting({
    displayName: account?.displayName, date: now, timezone, meetings,
    pendingCount: pending.length, sample: mode === "sample", loading,
  });
  const tasks = conversations
    .flatMap((meeting) => meeting.followUps || [])
    .filter(
      (item) =>
        item.type !== "schedule" &&
        item.status !== "completed" &&
      item.status !== "dismissed",
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

  const scrollPositions = useRef(new Map<string, number>());
  const locationKey = () => window.location.pathname + window.location.search;
  const rememberScroll = () => scrollPositions.current.set(locationKey(), window.scrollY);
  const switchUrl = (href: string, scroll: number = 0) => {
    if (!isWorkspaceHref(href, mode)) return;
    rememberScroll();
    pendingScroll.current = scroll;
    if (locationKey() !== href) window.history.pushState(null, "", href);
    else window.scrollTo({ top: scroll, behavior: "instant" });
  };
  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    // Store positions without rendering React on scroll.
    const remember = () => scrollPositions.current.set(locationKey(), window.scrollY);
    const restore = () => {
      setSelectedId(null);
      setEditing(null);
      pendingScroll.current = scrollPositions.current.get(locationKey()) ?? 0;
      setHistoryEpoch(epoch => epoch + 1);
    };
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("scroll", remember);
      window.removeEventListener("popstate", restore);
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);
  const navigate = (next: WorkspaceView) => {
    setSelectedId(null);
    setEditing(null);
    if (mode === "live") switchUrl(viewPaths[next]);
    else {
      const url = new URL("/", window.location.origin);
      url.searchParams.set("mode", "sample"); url.searchParams.set("view", next);
      switchUrl(url.pathname + url.search);
    }
  };
  const openDetail = (id: string, tab: "Summary" | "Actions" | "Transcript" | "Audio" = "Summary", editContact = false, contactId?: string) => {
    detailOrigin.current = { href: locationKey(), scroll: window.scrollY };
    setSelectedId(null);
    setEditing(null);
    const details = new URLSearchParams();
    if (tab !== "Summary") details.set("tab", tab);
    if (editContact) details.set("edit", "contact");
    if (contactId) details.set("contact", contactId);
    if (mode === "live") switchUrl(`/dashboard/conversations/${encodeURIComponent(id)}${details.size ? `?${details}` : ""}`);
    else {
      const url = new URL("/", window.location.origin);
      url.searchParams.set("mode", "sample"); url.searchParams.set("view", "conversations"); url.searchParams.set("conversation", id);
      details.forEach((value, key) => url.searchParams.set(key, value));
      switchUrl(url.pathname + url.search);
    }
  };
  const backFromDetail = () => {
    const origin = detailOrigin.current;
    if (!origin || !isWorkspaceHref(origin.href, mode)) { navigate("conversations"); return; }
    switchUrl(origin.href, origin.scroll);
  };
  const openClient = (id: string) => {
    setSelectedId(null);
    setEditing(null);
    const url = new URL(mode === "live" ? viewPaths.people : "/", window.location.origin);
    if (mode === "sample") { url.searchParams.set("mode", "sample"); url.searchParams.set("view", "people"); }
    url.searchParams.set("client", id);
    switchUrl(url.pathname + url.search);
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
    setPanelOrigin("calendar");
    setSelectedId(receipt.meetingId);
  };
  const receiptNotice = workspace.approvalReceipt && <ApprovalReceiptNotice receipt={workspace.approvalReceipt} onView={viewApprovedEvent} onDismiss={workspace.dismissApprovalReceipt} />;
  const openConversation = (id: string, tab: "Summary" | "Actions" | "Transcript" | "Audio" = "Summary", origin: typeof panelOrigin = "journal") => {
    if (!meetings.some((meeting) => meeting.id === id)) return;
    setEditing(null);
    setSelectedTab(tab);
    setPanelOrigin(origin);
    setSelectedId(id);
  };
  const nextSource = nextMeeting?.sourceConversationId
    ? conversations.find(meeting => meeting.id === nextMeeting.sourceConversationId)
    : nextMeeting;
  const nextPurpose = nextSource?.insight?.promised || nextSource?.insight?.intent;
  const panel = editing ? <ApprovalDialog
    key={editing.id} approval={editing} mode={mode} working={Boolean(working)} executionError={error}
    onClose={() => setEditing(null)} onApprove={approve}
  /> : selectedMeeting ? <ConversationModal
    key={selectedMeeting.id}
    meeting={selectedMeeting} meetings={meetings} initialTab={selectedTab}
    onClose={() => setSelectedId(null)} onOpenFull={openDetail}
    onOpenContact={openClient} onEditApproval={reviewApproval}
    onUpdateContact={workspace.patchContact}
    onRetryAccepted={() => void workspace.loadLive(false, true)}
    mode={mode} receipt={receiptNotice}
    onTask={(id, completed) => void workspace.patchFollowUp(id, { status: completed ? "completed" : "pending" })}
    working={working} error={error}
  /> : null;
  const journalPanel = !desktopDock && panelOrigin === "journal" ? panel : undefined;
  const resetSample = () => {
    setSelectedId(null); setEditing(null); setJournalFilters({ query: "", date: "" }); setSearch("");
    navigate("overview"); workspace.loadSample(true);
  };
  return (
    <WorkspaceTimezone.Provider value={timezone}>
    <div className={styles.shell} data-theme="light" data-workspace-view={view}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <QuipusHeader view={view} sample={mode === "sample"} account={account} navigate={navigate} />
      <main className={d.frame} data-docked={desktopDock && Boolean(panel)} id="main-content" tabIndex={-1}>
        <motion.div className={d.content} key={`${view}:${detailId || ""}`}
          initial={reducedMotion || !motionEnabled ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .4, ease: [0.2, 0.8, 0.2, 1] }}>

          {!detailId && <header className={q.welcome}>
            <div className={q.welcomeCopy}>
              <p className={q.kicker}>{mode === "sample" ? "QUIPUS / SAMPLE WORKSPACE" : view === "overview" ? "YOUR DAY, IN FOCUS" : "QUIPUS / WORKSPACE"}</p>
              {view === "overview" ? <h1>{greeting.title}</h1> : <RevealHeading text={viewLabel[view]} replayKey={view} />}
              {view === "overview" && <><p className={q.greetingContext}>{greeting.detail}</p><p className={q.dateLine}>{new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: timezone }).format(now) + ", " + new Intl.DateTimeFormat("en-GB", { month: "long", day: "numeric", timeZone: timezone }).format(now)}</p></>}
            </div>
            {mode === "sample" && <button className={q.resetSample} disabled={Boolean(working)} onClick={resetSample}>Reset sample data</button>}
          </header>}
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
              {mode === "live" && account && view === "calendar" && integrations.google !== undefined && <CalendarConnection email={account.email} connected={integrations.google} />}
              {detailId ? (detailMeeting ? <ConversationDetail
                conversation={detailMeeting} mode={mode} working={working} error={error}
                initialTab={detailTab} initialContactEditing={params.get("edit") === "contact"} initialContactId={params.get("contact")}
                backLabel={detailOrigin.current?.href.includes("view=people") || detailOrigin.current?.href.includes("/people") ? "Back to client history" : detailOrigin.current?.href.includes("view=calendar") || detailOrigin.current?.href.includes("/calendar") ? "Back to calendar" : detailOrigin.current?.href === "/dashboard" || detailOrigin.current?.href.includes("view=overview") || detailOrigin.current?.href === "/" ? "Back to home" : "Back to conversations"}
                onBack={backFromDetail}
                onTask={(id, completed) => void workspace.patchFollowUp(id, { status: completed ? "completed" : "pending" })}
                onEditApproval={reviewApproval} onUpdateContact={workspace.patchContact} onOpenContact={openClient} onRetryAccepted={() => void workspace.loadLive(false, true)}
              /> : <div className={styles.emptyInline}><h3>Conversation unavailable.</h3><p>It may still be processing, or it isn’t in this workspace.</p><button className={q.textLink} onClick={() => navigate("conversations")}>Back to conversations</button></div>) : null}
              {!desktopDock && detailId && editing && <div className={d.inlinePanel}>{panel}</div>}
              {view === "overview" && <>
                {activeRecordings.length > 0 && <section className={flow.progressList} aria-label="Recordings in progress">
                  <div className={flow.progressHeading}><h2>Recordings in progress</h2></div>
                  {activeRecordings.map(meeting => <div key={meeting.id} className={flow.progressEntry}><h3>{meeting.title}</h3><RecordingProgress meeting={meeting} mode={mode} onOpenAudio={() => openConversation(meeting.id, "Audio", "recording")} onRetryAccepted={() => workspace.loadLive(false, true)} />{!desktopDock && panelOrigin === "recording" && selectedId === meeting.id && <div className={d.inlinePanel}>{panel}</div>}</div>)}
                </section>}
                <div className={q.dailyBrief}>
                  <section className={q.followUps} aria-labelledby="followups-heading">
                    <div className={q.sectionHeading}><h2 id="followups-heading">Ready for review</h2><span className={q.sectionCount} aria-label={`${pending.length} pending follow-ups`}>{pending.length}</span></div>
                    <p className={q.sectionIntro}>Your next steps. Your approval.</p>
                    {pending.length ? <div className={q.approvalList}>{pending.slice(0, 3).map(approval => <article key={approval.id} className={q.pendingItem} data-selected={editing?.id === approval.id}>
                      <div className={q.pendingCopy}><h3>{approval.title}</h3>
                        <p>{approval.contact?.company || approval.contact?.name || "Meeting invitation"}{approval.details.startAt ? " \u00b7 " + dateLabel(approval.details.startAt) + " \u00b7 " + timeLabel(approval.details.startAt) : " \u00b7 Date to confirm"}</p>
                      </div>
                      <button className={q.approvalButton} disabled={Boolean(working)} onClick={() => { setSelectedId(null); setPanelOrigin("approval"); reviewApproval(approval); }}>Review invitation</button>
                      {!desktopDock && panelOrigin === "approval" && editing?.id === approval.id && <div className={d.inlinePanel}>{panel}</div>}
                    </article>)}</div> : <div className={q.emptyState}><h3>You're up to date.</h3><p>Agreed follow-ups will appear here when a conversation is ready.</p></div>}
                    {pending.length > 3 && <button className={q.textLink} onClick={() => navigate("calendar")}>View all follow-ups</button>}
                  </section>
                  <section className={q.nextMeeting} aria-labelledby="next-meeting-heading">
                    <div className={q.sectionHeading}><h2 id="next-meeting-heading">Up next</h2><span className={q.sectionLabel}>ON YOUR CALENDAR</span></div>
                    {nextMeeting ? <>
                      <p className={q.meetingDate}>{dateLabel(nextMeeting.startAt, { weekday: "long" })}</p>
                      <p className={q.meetingTime}>{timeLabel(nextMeeting.startAt)}</p>
                      <h3>{nextMeeting.title}</h3>
                      {nextMeeting.contacts.length > 0 && <p className={q.meetingPeople}>{nextMeeting.contacts.map(contact => contact.name).join(", ")}{nextMeeting.contacts[0]?.company ? " \u00b7 " + nextMeeting.contacts[0].company : ""}</p>}
                      {nextPurpose && nextPurpose !== nextMeeting.title && <p className={q.meetingPurpose}>{nextPurpose}</p>}
                      <button className={q.meetingAction} onClick={() => openConversation(nextMeeting.id, "Summary", "next")}>View meeting details</button>
                      {!desktopDock && panelOrigin === "next" && panel && <div className={d.inlinePanel}>{panel}</div>}
                    </> : <div className={q.emptyState}><h3>A little breathing room.</h3><p>No upcoming meetings on your connected calendar.</p><button className={q.meetingAction} onClick={() => navigate("calendar")}>Open calendar</button></div>}
                  </section>
                </div>
                <ConversationJournal meetings={conversations} mode={mode} compact onOpen={openConversation} onAll={() => navigate("conversations")} filters={journalFilters} onFiltersChange={setJournalFilters} onRetryAccepted={() => void workspace.loadLive(false, true)} selectedId={selectedId} inlineDetails={journalPanel} />
              </>}
              {view === "conversations" && !detailId && <ConversationJournal meetings={conversations} mode={mode} onOpen={openConversation} onPeople={() => navigate("people")} filters={journalFilters} onFiltersChange={setJournalFilters} onRetryAccepted={() => void workspace.loadLive(false, true)} selectedId={selectedId} inlineDetails={journalPanel} />}
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
                            Previous
                          </button>
                          <button
                            className={styles.iconButton}
                            onClick={() => changeMonth(1)}
                            aria-label="Next month"
                          >
                            Next
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
                                          openConversation(meeting.id, "Summary", "calendar")
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
                                onClick={() => openConversation(meeting.id, "Summary", "calendar")}
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
                            CALENDAR
                          </span>
                          <h2>
                            Follow-ups
                          </h2>
                        </div>

                      </header>
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
                                  onClick={() => { setPanelOrigin("calendar"); reviewApproval(approval); }}
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
                                  openConversation(approval.conversationId, "Summary", "calendar")
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
                                    className={q.approvalButton}
                                    disabled={Boolean(working)}
                                    onClick={() => { setPanelOrigin("calendar"); reviewApproval(approval); }}
                                  >
                                    {working === approval.id
                                      ? "Sending invitation…"
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
                  {!desktopDock && panelOrigin === "calendar" && panel && <div className={d.inlinePanel}>{panel}</div>}
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
                    <LanguageSwitcher className={styles.languageControl} showLabel />
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
            </span>
          </footer>
        </motion.div>
        {desktopDock && panel && <motion.aside className={d.dock} aria-label={editing ? "Review approval" : "Conversation details"} initial={motionEnabled && !reducedMotion ? { opacity: 0, x: 20 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: .2, ease: [0.2, 0.8, 0.2, 1] }}>{panel}</motion.aside>}
      </main>
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
