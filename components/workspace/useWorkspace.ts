"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeMeetingTitle } from "@/lib/meeting-title";
import { canHideRecording, updateCalendarVisibility } from "@/lib/workspace/calendar-visibility";
import type { Contact, Meeting, ScheduleDetails } from "@/lib/types";
import { useBrowserStorageSnapshot } from "@/components/hooks/useBrowserStorageSnapshot";
import { getBrowserSupabase } from "@/lib/supabase/client";
import {
  approveSample,
  liveApprovalRequest,
  updateApproval,
  type MeetingApproval,
  type WorkspaceMode,
} from "@/lib/workspace/model";
import {
  createSampleWorkspace,
  LEGACY_SAMPLE_STORAGE_KEY,
  readSampleWorkspace,
  SAMPLE_STORAGE_KEY,
} from "@/lib/workspace/sample";

export type WorkspaceDeviceSummary = {
  id: string;
  name: string;
  status: string;
  battery_level: number | null;
  last_seen_at: string | null;
};

export type ApprovalReceipt = {
  meetingId: string;
  title: string;
  startAt: string;
  attendees: string[];
  mode: WorkspaceMode;
};

export function useWorkspace(initialMode: WorkspaceMode, accountIdentity: string | null = null) {
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({});
  const [device, setDevice] = useState<WorkspaceDeviceSummary | null>(null);
  const [deviceStatusLoaded, setDeviceStatusLoaded] = useState(false);
  const [approvalReceipt, setApprovalReceipt] = useState<ApprovalReceipt | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [calendarUndo, setCalendarUndo] = useState<string | null>(null);
  const generation = useRef(0);
  const actionLock = useRef(false);
  const liveRefreshRunning = useRef<symbol | null>(null);
  const activeRequests = useRef(new Set<AbortController>());
  const metadataRefreshedAt = useRef(0);
  const devicePaired = useRef(false);
  const owner = useRef<symbol | null>(null);
  const storedSample = useBrowserStorageSnapshot(
    initialMode === "sample" ? SAMPLE_STORAGE_KEY : null,
    { fallbackKey: LEGACY_SAMPLE_STORAGE_KEY },
  );
  const [sampleRestored, setSampleRestored] = useState(initialMode !== "sample");
  if (!sampleRestored && storedSample !== null) {
    setSampleRestored(true);
    setMeetings((readSampleWorkspace(storedSample) || createSampleWorkspace()).meetings);
    setLoading(false);
  }

  const persistSample = useCallback((next: Meeting[]) => {
    try {
      localStorage.setItem(SAMPLE_STORAGE_KEY, JSON.stringify({ version: 1, meetings: next }));
      localStorage.removeItem(LEGACY_SAMPLE_STORAGE_KEY);
    } catch {
      setNotice("Changes are available in this tab. Browser storage is unavailable.");
    }
  }, []);

  const disposeRequests = useCallback(() => {
    owner.current = null;
    generation.current++;
    activeRequests.current.forEach(controller => controller.abort());
    activeRequests.current.clear();
    liveRefreshRunning.current = null;
  }, []);

  const loadSample = useCallback((reset = false) => {
    generation.current++;
    activeRequests.current.forEach(controller => controller.abort());
    activeRequests.current.clear();
    liveRefreshRunning.current = null;
    let data = createSampleWorkspace();
    try {
      if (!reset)
        data =
          readSampleWorkspace(localStorage.getItem(SAMPLE_STORAGE_KEY)) ||
          readSampleWorkspace(localStorage.getItem(LEGACY_SAMPLE_STORAGE_KEY)) ||
          data;
    } catch {
      /* Memory-only sample remains usable when storage is unavailable. */
    }
    setMode("sample");
    setMeetings(data.meetings);
    setLoading(false);
    setError(null);
    setIntegrations({});
    setDevice(null);
    setDeviceStatusLoaded(false);
    setApprovalReceipt(null);
    setCalendarUndo(null);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "sample");
    window.history.replaceState({}, "", url);
    if (reset) setNotice("Sample workspace reset.");
    persistSample(data.meetings);
  }, [persistSample]);

  const refreshLive = useCallback(
    (silent = false) => {
      if (silent && (liveRefreshRunning.current || actionLock.current)) return;
      const refreshId = Symbol("workspace-refresh");
      liveRefreshRunning.current = refreshId;
      const controller = new AbortController();
      activeRequests.current.add(controller);
      let deadline = window.setTimeout(() => controller.abort(), 15_000);
      let meetingsLoaded = false;
      const current = ++generation.current;
      const requestOwner = owner.current;
      return fetch("/api/meetings", { cache: "no-store", signal: controller.signal }).then(async response => {
        const payload = await response.json();
        if (current !== generation.current || requestOwner !== owner.current) return;
        if (!response.ok)
          throw new Error(
            payload.error || "Your workspace could not be loaded.",
          );
        if (payload.source === "seed") {
          throw new Error(
            "Your workspace is not connected yet. Please retry or open the separate sample workspace.",
          );
        }
        setMeetings(payload.meetings || []);
        meetingsLoaded = true;
        // Optional account/device checks must not hold the meeting content behind a loader.
        setLoading(false);
        if (!silent || Date.now() - metadataRefreshedAt.current >= (devicePaired.current ? 30_000 : 10_000)) {
          window.clearTimeout(deadline);
          deadline = window.setTimeout(() => controller.abort(), 8_000);
          const [integrationRequest, deviceRequest] = await Promise.allSettled([
            fetch("/api/integrations", { cache: "no-store", signal: controller.signal })
              .then(async response => ({ response, payload: await response.json() })),
            fetch("/api/devices", { cache: "no-store", signal: controller.signal })
              .then(async response => ({ response, payload: await response.json() })),
          ]);
          if (
            integrationRequest.status === "fulfilled" &&
            integrationRequest.value.response.ok &&
            current === generation.current
          ) {
            const integrationPayload = integrationRequest.value.payload;
            if (current !== generation.current || requestOwner !== owner.current) return;
            setIntegrations(integrationPayload?.integrations || {});
            metadataRefreshedAt.current = Date.now();
          }
          if (
            deviceRequest.status === "fulfilled" &&
            deviceRequest.value.response.ok &&
            current === generation.current
          ) {
            const devicePayload = deviceRequest.value.payload as {
              devices?: WorkspaceDeviceSummary[];
            };
            if (current !== generation.current || requestOwner !== owner.current) return;
            setDevice(devicePayload?.devices?.[0] || null);
            setDeviceStatusLoaded(true);
            devicePaired.current = Boolean(devicePayload?.devices?.length);
            metadataRefreshedAt.current = Date.now();
          }
        }
      }).catch((cause: unknown) => {
        if (!silent && !meetingsLoaded && current === generation.current && requestOwner === owner.current)
          setError(
            controller.signal.aborted
              ? "Your workspace took too long to load. Please try again."
              : cause instanceof Error
                ? cause.message
                : "Your workspace could not be loaded.",
          );
      }).finally(() => {
        if (current === generation.current && requestOwner === owner.current) setLoading(false);
        window.clearTimeout(deadline);
        activeRequests.current.delete(controller);
        if (liveRefreshRunning.current === refreshId) liveRefreshRunning.current = null;
      });
    },
    [],
  );

  const loadLive = useCallback((silent = false) => {
    if (!silent) {
      setMode("live");
      setMeetings([]);
      setLoading(true);
      setError(null);
      setIntegrations({});
      setDevice(null);
      setDeviceStatusLoaded(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("mode");
      window.history.replaceState({}, "", url);
    }
    return refreshLive(silent);
  }, [refreshLive]);

  useEffect(() => {
    owner.current = Symbol(accountIdentity || "sample-workspace");
    metadataRefreshedAt.current = 0;
    devicePaired.current = false;
    if (initialMode === "live") void refreshLive(false);
    return disposeRequests;
  }, [accountIdentity, initialMode, refreshLive, disposeRequests]);

  useEffect(() => {
    if (mode !== "live" || loading) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadLive(true);
    };
    const supabase = getBrowserSupabase();
    let disposed = false;
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    void supabase?.auth.getUser().then(({ data }) => {
      if (disposed || !data.user) return;
      channel = supabase.channel(`recording-updates-${data.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "lantern_sessions", filter: `user_id=eq.${data.user.id}` }, () => {
          clearTimeout(debounce); debounce = setTimeout(refresh, 400);
        }).subscribe();
    }).catch(() => { /* The polling fallback remains active if realtime auth fails. */ });
    const interval = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearTimeout(debounce);
      if (channel) void supabase?.removeChannel(channel);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loading, loadLive, mode]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const approve = async (
    approval: MeetingApproval,
  ): Promise<Meeting | null> => {
    if (actionLock.current) return null;
    actionLock.current = true;
    if (mode === "live") generation.current++;
    setWorking(approval.id);
    setError(null);
    const actionOwner = owner.current;
    try {
      if (mode === "sample") {
        const next = approveSample(meetings, approval);
        setMeetings(next);
        // The persistent receipt is the single approval confirmation.
        setNotice(null);
        persistSample(next);
        const created = (
          next.find((meeting) => meeting.sourceApprovalId === approval.id) ||
          null
        );
        if (created) setApprovalReceipt({ meetingId: created.id, title: created.title, startAt: created.startAt, attendees: [...approval.details.attendees], mode });
        return created;
      }
      const response = await fetch("/api/actions/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(liveApprovalRequest(approval)),
      });
      const payload = await response.json();
      if (actionOwner !== owner.current) return null;
      if (!response.ok || !payload.event)
        throw new Error(
          payload.error || "The calendar invitation could not be created.",
        );
      const created: Meeting = {
        id: payload.meetingId || `calendar:${payload.event.id}`,
        title: payload.event.summary,
        startAt: payload.event.startAt,
        endAt: payload.event.endAt,
        status: "upcoming",
        source: "calendar",
        calendarEventId: payload.event.id,
        sourceConversationId: approval.conversationId,
        sourceApprovalId: approval.id,
        contacts:
          meetings.find((meeting) => meeting.id === approval.conversationId)
            ?.contacts || [],
      };
      setMeetings((current) => [
        ...updateApproval(
          current.filter((meeting) => meeting.id !== created.id),
          approval.id,
          { status: "completed", schedule: approval.details },
        ),
        created,
      ]);
      // The persistent receipt is the single approval confirmation.
      setNotice(null);
      setApprovalReceipt({ meetingId: created.id, title: created.title, startAt: created.startAt, attendees: [...approval.details.attendees], mode });
      return created;
    } catch (cause) {
      if (actionOwner !== owner.current) return null;
      setError(
        cause instanceof Error
          ? cause.message
          : "The meeting could not be approved.",
      );
      return null;
    } finally {
      actionLock.current = false;
      setWorking(null);
    }
  };

  const patchFollowUp = async (
    id: string,
    changes: {
      status?: "pending" | "completed" | "dismissed";
      schedule?: ScheduleDetails;
    },
  ) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    if (mode === "live") generation.current++;
    setWorking(id);
    setError(null);
    const actionOwner = owner.current;
    try {
      if (mode === "live") {
        if (id.startsWith("sample:"))
          throw new Error("Sample items cannot update your workspace.");
        const response = await fetch(
          `/api/follow-ups/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(changes),
          },
        );
        const payload = await response.json();
        if (actionOwner !== owner.current) return false;
        if (!response.ok || !payload.persisted)
          throw new Error(payload.error || "The change could not be saved.");
      }
      if (changes.status === "dismissed") setNotice("Approval dismissed.");
      if (mode === "sample") {
        const next = updateApproval(meetings, id, changes);
        setMeetings(next);
        persistSample(next);
      } else {
        setMeetings((current) => updateApproval(current, id, changes));
      }
      return true;
    } catch (cause) {
      if (actionOwner !== owner.current) return false;
      setError(
        cause instanceof Error
          ? cause.message
          : "The change could not be saved.",
      );
      return false;
    } finally {
      actionLock.current = false;
      setWorking(null);
    }
  };

  const patchContact = async (
    id: string,
    changes: Pick<Contact, "name" | "company" | "role" | "email">,
  ) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    if (mode === "live") generation.current++;
    setWorking(`contact:${id}`);
    setError(null);
    const actionOwner = owner.current;
    try {
      let saved: Contact = { id, ...changes };
      if (mode === "live") {
        if (id.startsWith("sample:"))
          throw new Error("Sample contacts cannot update your workspace.");
        const response = await fetch(`/api/contacts/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(changes),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          contact?: Contact;
          error?: string;
        };
        if (actionOwner !== owner.current) return false;
        if (!response.ok || !payload.contact)
          throw new Error(payload.error || "The contact could not be updated.");
        saved = payload.contact;
      }
      const updateContacts = (current: Meeting[]) => current.map((meeting) => ({
        ...meeting,
        contacts: meeting.contacts.map((contact) =>
          contact.id === id ? { ...contact, ...saved } : contact,
        ),
      }));
      setNotice("Contact details updated.");
      if (mode === "sample") {
        const next = updateContacts(meetings);
        setMeetings(next);
        persistSample(next);
      } else {
        setMeetings(updateContacts);
      }
      return true;
    } catch (cause) {
      if (actionOwner !== owner.current) return false;
      setError(
        cause instanceof Error
          ? cause.message
          : "The contact could not be updated.",
      );
      return false;
    } finally {
      actionLock.current = false;
      setWorking(null);
    }
  };

  const updateMeetingTitle = async (id: string, title?: string, expectedTitle?: string): Promise<boolean> => {
    const meeting = meetings.find(item => item.id === id);
    if (actionLock.current || !meeting) return false;
    const nextTitle = title === undefined ? null : normalizeMeetingTitle(title);
    if (title !== undefined && !nextTitle) { setError("Enter a short title about this meeting."); return false; }
    if (mode === "sample" && title === undefined) return false;
    actionLock.current = true;
    if (mode === "live") generation.current++;
    setWorking(`title:${id}`);
    setError(null);
    const actionOwner = owner.current;
    try {
      let savedTitle = nextTitle;
      if (mode === "live") {
        if (id.startsWith("sample:")) throw new Error("Sample meetings cannot update your workspace.");
        const response = await fetch(`/api/meetings/${encodeURIComponent(id)}/title`, {
          method: title === undefined ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...(title === undefined ? {} : { title: nextTitle }), expectedTitle: expectedTitle ?? meeting.title }),
        });
        const payload = await response.json().catch(() => ({})) as { title?: string; persisted?: boolean; error?: string };
        if (actionOwner !== owner.current) return false;
        if (!response.ok || !payload.persisted || !normalizeMeetingTitle(payload.title)) throw new Error(payload.error || "The meeting title could not be saved.");
        savedTitle = payload.title!;
      } else if (expectedTitle !== undefined && meeting.title !== expectedTitle) {
        throw new Error("This meeting was renamed elsewhere. Reopen Rename and try again.");
      }
      if (!savedTitle) return false;
      const update = (current: Meeting[]) => current.map(item => item.id === id ? { ...item, title: savedTitle! } : item);
      if (mode === "sample") { const next = update(meetings); setMeetings(next); persistSample(next); }
      else setMeetings(update);
      setNotice("Meeting title updated.");
      return true;
    } catch (cause) {
      if (actionOwner === owner.current) setError(cause instanceof Error ? cause.message : "The meeting title could not be saved.");
      return false;
    } finally {
      actionLock.current = false;
      setWorking(null);
    }
  };
  const patchMeetingTitle = (id: string, title: string, expectedTitle?: string) => updateMeetingTitle(id, title, expectedTitle);
  const generateMeetingTitle = (id: string, expectedTitle?: string) => updateMeetingTitle(id, undefined, expectedTitle);

  const setCalendarVisibility = async (id: string, hidden: boolean): Promise<boolean> => {
    const meeting = meetings.find(item => item.id === id);
    if (actionLock.current || !meeting || !canHideRecording(meeting)) return false;
    actionLock.current = true;
    if (mode === "live") generation.current++;
    setWorking(`calendar:${id}`);
    setError(null);
    const actionOwner = owner.current;
    try {
      if (mode === "live") {
        if (id.startsWith("sample:")) throw new Error("Sample recordings cannot update your workspace.");
        const response = await fetch(`/api/meetings/${encodeURIComponent(id)}/calendar-visibility`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hidden }),
        });
        const payload = await response.json().catch(() => ({}));
        if (actionOwner !== owner.current) return false;
        if (!response.ok || !payload.persisted)
          throw new Error(payload.error || "Calendar visibility could not be saved.");
        generation.current++;
      }
      if (mode === "sample") {
        const next = updateCalendarVisibility(meetings, id, hidden);
        setMeetings(next);
        persistSample(next);
      } else {
        setMeetings(current => updateCalendarVisibility(current, id, hidden));
      }
      setCalendarUndo(hidden ? id : null);
      setNotice(hidden ? "Hidden from calendar. Audio and history are kept." : "Recording restored to calendar.");
      return true;
    } catch (cause) {
      if (actionOwner !== owner.current) return false;
      setError(cause instanceof Error ? cause.message : "Calendar visibility could not be saved.");
      return false;
    } finally {
      actionLock.current = false;
      setWorking(null);
    }
  };

  return {
    mode,
    meetings,
    loading,
    error,
    notice,
    integrations,
    device,
    deviceStatusLoaded,
    approvalReceipt,
    dismissApprovalReceipt: () => setApprovalReceipt(null),
    working,
    approve,
    patchFollowUp,
    patchContact,
    patchMeetingTitle,
    generateMeetingTitle,
    setCalendarVisibility,
    calendarUndo: notice === "Hidden from calendar. Audio and history are kept." ? calendarUndo : null,
    loadSample,
    loadLive,
    setError,
    setNotice,
  };
}
