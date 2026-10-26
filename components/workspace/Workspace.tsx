"use client";
import { WorkspaceIntroduction } from "./WorkspaceIntroduction";
import { useWorkspaceIntroduction } from "./useWorkspaceIntroduction";
import { WhatsAppDelivery } from "./WhatsAppDelivery";
import { whatsappEnabled } from "@/lib/features";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { workspaceTime } from "@/lib/workspace-time";
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
import { isWorkspaceHref, primaryWorkspaceView, resolveWorkspaceRoute, sampleWorkspacePath } from "@/lib/workspace-navigation";
import { QuipusHeader, viewPaths } from "./QuipusHeader";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationModal } from "./ConversationModal";
import { ClientHistory } from "./ClientHistory";
import { PeopleConnections } from "./PeopleConnections";
import { WorkspaceCalendar } from "./WorkspaceCalendar";
import { CalendarDayMeetings } from "./CalendarDayMeetings";
import { calendarMeetings } from "@/lib/workspace/calendar-visibility";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { RecordingProgress } from "./RecordingProgress";
import { getRecordingProgress } from "@/lib/workspace/recording-progress";
import { ApprovalReceiptNotice } from "./ApprovalReceiptNotice";
import flow from "./flow.module.css";
import { ProfileSettings } from "./ProfileSettings";
import { SettingsSection } from "./SettingsSection";
import { GoogleConnectionSettings } from "./GoogleConnectionSettings";
import { CalendarConnection } from "./CalendarConnection";
import { WorkspaceTimezone } from "./WorkspaceTime";
import q from "./quipus.module.css";
import d from "./dashboard.module.css";
import { useWorkspace } from "./useWorkspace";
import { useMediaQuery } from "@/components/hooks/useMediaQuery";
import { ApprovalDialog } from "./ApprovalDialog";
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
  introductionCompletedAt?: string | null;
};

type WorkspaceProps = {
  account: WorkspaceAccount | null;
  initialMode: WorkspaceMode;
  initialView?: WorkspaceView;
  initialConversationId?: string;
  initialNow?: string;
};

const viewLabel: Record<WorkspaceView, string> = {
  overview: "Home", conversations: "Conversations", calendar: "Calendar", people: "Your connection", device: "Devices", settings: "Settings",
};

export function Workspace(props: WorkspaceProps) {
  return <WorkspaceSession key={JSON.stringify([props.initialMode, props.account?.email || null])} {...props} />;
}

function WorkspaceSession({
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
  const [previousAccount, setPreviousAccount] = useState(initialAccount);
  if (previousAccount !== initialAccount) {
    setPreviousAccount(initialAccount);
    setAccount(initialAccount);
  }
  const [journalFilters, setJournalFilters] = useState({ query: "", date: "" });
  const [clock, setClock] = useState(() => {
    const snapshot = new Date(initialNow || Date.now());
    return Number.isFinite(snapshot.getTime()) ? snapshot : new Date();
  });
  const timezone = validTimezone(account?.timezone);
  const { dateKey: formatDateKey, dateLabel, timeLabel } = workspaceTime(timezone);
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
  const [detailOrigin, setDetailOrigin] = useState<{ href: string; scroll: number } | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const pageIdentity = `${view}:${detailId || ""}:${params.get("client") || ""}`;
  const routeIdentity = pathname + "?" + params.toString();
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
  }, [pageIdentity, routeIdentity, historyEpoch, loading, motionEnabled, reducedMotion]);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    formatDateKey(clock).slice(0, 7),
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    formatDateKey(clock),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MeetingApproval | null>(null);
  const [selectedTab, setSelectedTab] = useState<"Summary" | "Actions" | "Transcript" | "Audio">("Summary");
  const desktopDock = useMediaQuery("(min-width: 900px)");
  const [calendarBrowse, setCalendarBrowse] = useState<{ date: string; hidden: boolean } | null>(null);
  const [panelOrigin, setPanelOrigin] = useState<"approval" | "calendar" | "recording" | "other">("other");
  const reviewApproval = (approval: MeetingApproval) => {
    if (detailId) setPanelOrigin("other");
    setEditing(approval);
  };
  const [approvalFilter, setApprovalFilter] = useState<"pending" | "dismissed">(
    "pending",
  );
  const followUpsRef = useRef<HTMLElement>(null);
  const [calendarOpenEpoch, setCalendarOpenEpoch] = useState(0);
  const calendarOrigin = useRef<{ scroll: number; trigger: HTMLElement | null } | null>(null);
  const rememberCalendarOrigin = () => {
    setCalendarOpenEpoch(value => value + 1);
    calendarOrigin.current = { scroll: window.scrollY, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  };
  const restoreCalendarOrigin = () => {
    const origin = calendarOrigin.current;
    if (desktopDock || panelOrigin !== "calendar" || !origin) return;
    requestAnimationFrame(() => {
      if (origin.trigger?.isConnected) origin.trigger.focus({ preventScroll: true });
      window.scrollTo({ top: origin.scroll, behavior: "instant" });
    });
  };
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
  const greeting = workspaceGreeting({
    displayName: account?.displayName, date: now, timezone, meetings,
    pendingCount: pending.length, sample: mode === "sample", loading,
  });
  const introduction = useWorkspaceIntroduction({
    mode,
    accountId: account?.email || null,
    ready: !loading && view === "overview" && !detailId && !selectedId && !editing,
    completedAt: account?.introductionCompletedAt,
    onComplete: async () => {
      if (mode !== "live" || !account) return;
      const response = await fetch("/api/profile/introduction", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!response.ok) throw new Error("Introduction preference could not be saved.");
      const result = await response.json() as { completedAt: string };
      setAccount(current => current ? { ...current, introductionCompletedAt: result.completedAt } : null);
    },
  });
  const selectedMeeting =
    meetings.find((meeting) => meeting.id === selectedId) || null;

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
      setCalendarBrowse(null);
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
  const navigate = (requested: WorkspaceView) => {
    const next = primaryWorkspaceView(requested);
    setSelectedId(null);
    setEditing(null);
    setCalendarBrowse(null);
    if (mode === "live") switchUrl(viewPaths[next] + (requested === "device" ? "?section=device" : ""));
    else {
      const url = new URL(sampleWorkspacePath, window.location.origin);
      url.searchParams.set("mode", "sample"); url.searchParams.set("view", next);
      if (requested === "device") url.searchParams.set("section", "device");
      switchUrl(url.pathname + url.search);
    }
  };
  const openDetail = (id: string, tab: "Summary" | "Actions" | "Transcript" | "Audio" = "Summary", editContact = false, contactId?: string) => {
    setDetailOrigin({ href: locationKey(), scroll: window.scrollY });
    setSelectedId(null);
    setEditing(null);
    setCalendarBrowse(null);
    const details = new URLSearchParams();
    if (tab !== "Summary") details.set("tab", tab);
    if (editContact) details.set("edit", "contact");
    if (contactId) details.set("contact", contactId);
    if (mode === "live") switchUrl(`/dashboard/conversations/${encodeURIComponent(id)}${details.size ? `?${details}` : ""}`);
    else {
      const url = new URL(sampleWorkspacePath, window.location.origin);
      url.searchParams.set("mode", "sample"); url.searchParams.set("view", "conversations"); url.searchParams.set("conversation", id);
      details.forEach((value, key) => url.searchParams.set(key, value));
      switchUrl(url.pathname + url.search);
    }
  };
  const backFromDetail = () => {
    const origin = detailOrigin;
    if (!origin || !isWorkspaceHref(origin.href, mode)) { navigate("people"); return; }
    switchUrl(origin.href, origin.scroll);
  };
  const openClient = (id: string) => {
    setSelectedId(null);
    setEditing(null);
    setCalendarBrowse(null);
    const url = new URL(mode === "live" ? viewPaths.people : sampleWorkspacePath, window.location.origin);
    if (mode === "sample") { url.searchParams.set("mode", "sample"); url.searchParams.set("view", "people"); }
    url.searchParams.set("client", id);
    switchUrl(url.pathname + url.search);
  };
  const replayIntroduction = () => {
    navigate("overview");
    introduction.start();
  };
  const nextIntroductionStep = () => {
    if (introduction.step === 1) navigate("people");
    introduction.next();
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
    pendingScroll.current = null;
    calendarOrigin.current = null;
    setCalendarOpenEpoch(value => value + 1);
    setPanelOrigin("calendar");
    setSelectedId(receipt.meetingId);
  };
  const receiptNotice = workspace.approvalReceipt && <ApprovalReceiptNotice receipt={workspace.approvalReceipt} onView={viewApprovedEvent} onDismiss={workspace.dismissApprovalReceipt} />;
  const openConversation = (id: string, tab: "Summary" | "Actions" | "Transcript" | "Audio" = "Summary", origin: typeof panelOrigin = "other", preserveCalendarOrigin = false) => {
    if (!meetings.some((meeting) => meeting.id === id)) return;
    if (origin === "calendar") {
      if (preserveCalendarOrigin) setCalendarOpenEpoch(value => value + 1);
      else rememberCalendarOrigin();
    }
    setEditing(null);
    setSelectedTab(tab);
    setPanelOrigin(origin);
    setSelectedId(id);
  };
  const browseCalendarDay = (date: string, hidden: boolean) => {
    rememberCalendarOrigin();
    setSelectedId(null); setEditing(null);
    setPanelOrigin("calendar");
    setCalendarBrowse({ date, hidden });
  };
  const openCalendarMeeting = (id: string) => {
    setCalendarBrowse(null);
    if (panelOrigin === "calendar" && selectedId === id && !editing) {
      setSelectedId(null);
      calendarOrigin.current = null;
      return;
    }
    const meeting = meetings.find(item => item.id === id);
    if (meeting) setSelectedDate(formatDateKey(meeting.startAt));
    openConversation(id, "Summary", "calendar");
  };
  const dayMeetings = calendarBrowse ? calendarMeetings(meetings, calendarBrowse.hidden)
    .filter(meeting => formatDateKey(meeting.startAt) === calendarBrowse.date)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)) : [];
  const calendarDayPanel = calendarBrowse ? <CalendarDayMeetings
    date={calendarBrowse.date} meetings={dayMeetings} working={Boolean(working)}
    onOpen={id => openConversation(id, "Summary", "calendar", true)}
    onClose={() => { setCalendarBrowse(null); restoreCalendarOrigin(); }}
    onVisibilityChange={workspace.setCalendarVisibility}
  /> : null;
  const panel = editing ? <ApprovalDialog
    key={editing.id} approval={editing} mode={mode} working={Boolean(working)} executionError={error}
    onClose={() => { setEditing(null); if (!selectedId) restoreCalendarOrigin(); }} onApprove={approve}
  /> : selectedMeeting ? <ConversationModal
    key={selectedMeeting.id}
    meeting={selectedMeeting} meetings={meetings} initialTab={selectedTab}
    onClose={() => { setSelectedId(null); if (!calendarBrowse) restoreCalendarOrigin(); }}
    onOpenContact={openClient} onEditApproval={reviewApproval}
    onRenameMeeting={workspace.patchMeetingTitle} onGenerateTitle={mode === "live" ? workspace.generateMeetingTitle : undefined} onUpdateContact={workspace.patchContact}
    onRetryAccepted={() => void workspace.loadLive(true)}
    mode={mode} receipt={receiptNotice}
    onTask={(id, completed) => void workspace.patchFollowUp(id, { status: completed ? "completed" : "pending" })}
    working={working} error={error}
  /> : calendarDayPanel;
  const remainingApprovals = approvalFilter === "pending" ? pending.slice(3) : approvals.filter(approval => approval.status === "dismissed");
  const showFollowUps = pending.length > 3 || approvals.some(approval => approval.status === "dismissed");
  const resetSample = () => {
    setSelectedId(null); setEditing(null); setCalendarBrowse(null); setJournalFilters({ query: "", date: "" });
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
              {detailId ? (detailMeeting ? <ConversationDetail
                conversation={detailMeeting} mode={mode} working={working} error={error}
                initialTab={detailTab} initialContactEditing={params.get("edit") === "contact"} initialContactId={params.get("contact")}
                backLabel={detailOrigin?.href.includes("view=people") || detailOrigin?.href.includes("/people") ? "Back to client history" : detailOrigin?.href.includes("view=calendar") || detailOrigin?.href.includes("/calendar") ? "Back to calendar" : detailOrigin?.href === "/dashboard" || detailOrigin?.href.includes("view=overview") || detailOrigin?.href === sampleWorkspacePath || detailOrigin?.href === sampleWorkspacePath + "?mode=sample" ? "Back to home" : "Back to conversations"}
                onBack={backFromDetail}
                onTask={(id, completed) => void workspace.patchFollowUp(id, { status: completed ? "completed" : "pending" })}
                onEditApproval={reviewApproval} onRenameMeeting={workspace.patchMeetingTitle} onGenerateTitle={mode === "live" ? workspace.generateMeetingTitle : undefined} onUpdateContact={workspace.patchContact} onOpenContact={openClient} onRetryAccepted={() => void workspace.loadLive(true)}
              /> : <div className={styles.emptyInline}><h3>Conversation unavailable.</h3><p>It may still be processing, or it isn’t in this workspace.</p><button className={q.textLink} onClick={() => navigate("conversations")}>Back to conversations</button></div>) : null}
              {!desktopDock && detailId && editing && <div className={d.inlinePanel}>{panel}</div>}
              {view === "overview" && <>
                {activeRecordings.length > 0 && <section className={flow.progressList} aria-label="Recordings in progress">
                  <div className={flow.progressHeading}><h2>Recordings in progress</h2></div>
                  {activeRecordings.map(meeting => <div key={meeting.id} className={flow.progressEntry}><h3>{meeting.title}</h3><RecordingProgress meeting={meeting} mode={mode} onOpenAudio={() => openConversation(meeting.id, "Audio", "recording")} onRetryAccepted={() => workspace.loadLive(true)} />{!desktopDock && panelOrigin === "recording" && selectedId === meeting.id && <div className={d.inlinePanel}>{panel}</div>}</div>)}
                </section>}
                <section className={styles.homeReviews} aria-label="Follow-ups to review" data-workspace-intro="approvals">
                  {pending.length ? <div className={q.approvalList}>{pending.slice(0, 3).map(approval => <article key={approval.id} className={q.pendingItem} data-selected={editing?.id === approval.id}>
                    <div className={q.pendingCopy}><h2>{approval.title}</h2>
                      <p>{approval.contact?.company || approval.contact?.name || "Meeting invitation"}{approval.details.startAt ? " \u00b7 " + dateLabel(approval.details.startAt) + " \u00b7 " + timeLabel(approval.details.startAt) : " \u00b7 Date to confirm"}</p>
                    </div>
                    <div className={styles.reviewActions}>
                      <button className={q.approvalButton} disabled={Boolean(working)} onClick={() => { setSelectedId(null); setCalendarBrowse(null); setPanelOrigin("approval"); reviewApproval(approval); }}>Review invitation</button>
                      <button className={styles.dismissButton} disabled={Boolean(working)} onClick={() => void workspace.patchFollowUp(approval.id, { status: "dismissed" })}>Dismiss</button>
                    </div>
                    {!desktopDock && panelOrigin === "approval" && editing?.id === approval.id && <div className={d.inlinePanel}>{panel}</div>}
                  </article>)}</div> : <p className={styles.reviewEmpty}>Nothing to review. Lucky you.</p>}
                  {pending.length > 3 && <button className={q.textLink} onClick={() => { setApprovalFilter("pending"); followUpsRef.current?.scrollIntoView({ block: "start", behavior: reducedMotion || !motionEnabled ? "instant" : "smooth" }); }}>View {pending.length - 3} more follow-ups</button>}
                </section>
                {mode === "live" && account && (params.get("google") === "error" || params.get("google") === "denied") && <CalendarConnection email={account.email} connected={integrations.google} />}
                <div className={styles.homeCalendar}>
                  <WorkspaceCalendar meetings={meetings} today={today} visibleMonth={visibleMonth} selectedDate={selectedDate}
                    onMonthChange={month => { setVisibleMonth(month); if (panelOrigin === "calendar") { setSelectedId(null); setEditing(null); setCalendarBrowse(null); } }}
                    onDateChange={date => { setSelectedDate(date); if (panelOrigin === "calendar") { setSelectedId(null); setEditing(null); setCalendarBrowse(null); } }}
                    onOpenMeeting={openCalendarMeeting} onBrowseDay={browseCalendarDay}
                    onVisibilityChange={workspace.setCalendarVisibility} working={Boolean(working)} selectedId={selectedId}
                    detailKey={!desktopDock && panelOrigin === "calendar" && panel ? `${editing?.id || selectedId || calendarBrowse?.date}:${calendarOpenEpoch}` : null}
                    detail={!desktopDock && panelOrigin === "calendar" ? panel : undefined}
                  />
                </div>
                {showFollowUps && <section ref={followUpsRef} className={styles.followUpSection}>
                    <aside
                      className={styles.approvalRail}
                      aria-label="Meeting approvals"
                    >
                      <header>
                        <div>
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
                      {remainingApprovals.map((approval) => {
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
                                  onClick={() => { rememberCalendarOrigin(); setSelectedId(null); setCalendarBrowse(null); setPanelOrigin("calendar"); reviewApproval(approval); }}
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
                                    onClick={() => { rememberCalendarOrigin(); setSelectedId(null); setCalendarBrowse(null); setPanelOrigin("calendar"); reviewApproval(approval); }}
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
                      {remainingApprovals.length === 0 && (
                        <div className={styles.approvalsEmpty}>

                          <h3>
                            {approvalFilter === "pending"
                              ? "You’re all caught up."
                              : "Nothing dismissed."}
                          </h3>
                        </div>
                      )}
                      <p className={styles.railFootnote}>

                        {mode === "sample"
                          ? "Sample approvals stay in this browser."
                          : "Invitations are sent only after approval."}
                      </p>
                    </aside>
                </section>}
              </>}

              {view === "people" && selectedContact && <ClientHistory mode={mode} contact={selectedContact} conversations={conversations} onBack={() => navigate("people")} onOpenMeeting={openDetail} onCorrect={() => { const latest = conversations.find(meeting => meeting.contacts.some(contact => contact.id === selectedContact.id)); if (latest) openDetail(latest.id, "Summary", true, selectedContact.id); }} />}
              {view === "people" && !selectedContact && <PeopleConnections
                contacts={contacts} conversations={conversations} mode={mode}
                filters={journalFilters} onFiltersChange={setJournalFilters}
                onOpenClient={openClient} onOpenConversation={openDetail}
                onRetryAccepted={() => void workspace.loadLive(true)}
              />}
              {view === "settings" && (
                <div className={styles.settingsGrid}>
                  <SettingsSection id="your-quipus" title="Your Quipus" defaultOpen={params.get("section") === "device" || params.get("view") === "device" || pathname === viewPaths.device}>
                    <LanternDevicePanel embedded mode={mode} integrations={integrations} conversationCount={conversations.length} accountEmail={account?.email} hasRecording={hasFirstUpload} />
                  </SettingsSection>
                  <SettingsSection title="Profile">
                    <ProfileSettings embedded account={account} sample={mode === "sample"} onSaved={setAccount} />
                  </SettingsSection>
                  <SettingsSection title="Google Calendar">
                    <GoogleConnectionSettings embedded sample={mode === "sample"} accountIdentity={account?.email} />
                  </SettingsSection>
                  <SettingsSection title="Gmail follow-ups">
                    <p>Review a draft before sending.</p>
                    {mode === "live" ? <a className={styles.secondaryButton} href="/api/google/connect?gmail=1&returnTo=%2Fdashboard%2Fsettings">Connect or refresh Gmail</a> : <p>Available in your connected workspace.</p>}
                  </SettingsSection>
                  <SettingsSection title="WhatsApp">
                    <WhatsAppDelivery embedded sample={mode === "sample"} />
                  </SettingsSection>
                  <SettingsSection title="Language">
                    <LanguageSwitcher className={styles.languageControl} showLabel />
                  </SettingsSection>
                  <SettingsSection title="Access & privacy">
                    <p>Your recordings, transcripts and meeting briefs stay private unless you approve sharing{whatsappEnabled() ? " or enable delivery to your WhatsApp" : ""}.</p>
                    <span className={styles.connectionState}>
                      <i className={account ? styles.greenDot : styles.neutralDot} />
                      {account ? `Signed in as ${account.email}` : "You are signed out"}
                    </span>
                    {account ? <form action="/api/auth/logout" method="post">
                      <button className={styles.signOutButton} type="submit">Sign out</button>
                    </form> : <Link aria-label="Sign in with Google" className={styles.signInButton} href="/login?next=/dashboard">
                      <span className={styles.signInFull}>Sign in with Google</span><span className={styles.signInShort}>Sign in</span>
                    </Link>}
                  </SettingsSection>
                  <SettingsSection title="Quick introduction">
                    <button type="button" className={styles.secondaryButton} onClick={replayIntroduction}>Replay introduction</button>
                  </SettingsSection>
                </div>
              )}
            </>
          )}
          <footer className={styles.pageFooter}>
            <span className={styles.footerBrand}>
              Quipus<span> by Fovea</span>
            </span>
            <span className={styles.footerLinks}>
              <button type="button" className={styles.textButton} onClick={replayIntroduction}>Quick introduction</button>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </span>
          </footer>
        </motion.div>
        {desktopDock && panel && <motion.aside className={d.dock} aria-label={editing ? "Review approval" : selectedId ? "Conversation details" : "Day meetings"} initial={motionEnabled && !reducedMotion ? { opacity: 0, x: 20 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: .2, ease: [0.2, 0.8, 0.2, 1] }}>{panel}</motion.aside>}
      </main>
      <WorkspaceIntroduction step={introduction.step} onNext={nextIntroductionStep} onDismiss={introduction.dismiss} />
      {notice && (
        <div className={styles.toast} role="status">

          <span>{notice}</span>
          {workspace.calendarUndo && (
            <button type="button" disabled={Boolean(working)} onClick={() => {
              if (workspace.calendarUndo) void workspace.setCalendarVisibility(workspace.calendarUndo, false);
            }}>
              Undo
            </button>
          )}
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
