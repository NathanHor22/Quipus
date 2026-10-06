"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Contact, Meeting, ScheduleDetails } from "@/lib/types";
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
  const generation = useRef(0);
  const actionLock = useRef(false);
  const liveRefreshRunning = useRef(false);
  const metadataRefreshedAt = useRef(0);
  const devicePaired = useRef(false);
  const owner = useRef(accountIdentity);
  owner.current = accountIdentity;

  const loadSample = useCallback((reset = false) => {
    generation.current++;
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
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "sample");
    window.history.replaceState({}, "", url);
    if (reset) setNotice("Sample workspace reset.");
  }, []);

  const loadLive = useCallback(
    async (allowSample = false, silent = false) => {
      if (silent && (liveRefreshRunning.current || actionLock.current)) return;
      if (silent) liveRefreshRunning.current = true;
      const current = ++generation.current;
      const requestOwner = owner.current;
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
      try {
        const response = await fetch("/api/meetings", { cache: "no-store" });
        const payload = await response.json();
        if (current !== generation.current || requestOwner !== owner.current) return;
        if (!response.ok)
          throw new Error(
            payload.error || "Your workspace could not be loaded.",
          );
        if (payload.source === "seed") {
          if (allowSample) {
            loadSample();
            return;
          }
          throw new Error(
            "Your workspace is not connected yet. You can explore the sample workspace while it is being set up.",
          );
        }
        setMeetings(payload.meetings || []);
        if (!silent || Date.now() - metadataRefreshedAt.current >= (devicePaired.current ? 30_000 : 10_000)) {
          const [integrationRequest, deviceRequest] = await Promise.allSettled([
            fetch("/api/integrations", { cache: "no-store" }),
            fetch("/api/devices", { cache: "no-store" }),
          ]);
          if (
            integrationRequest.status === "fulfilled" &&
            integrationRequest.value.ok &&
            current === generation.current
          ) {
            const integrationPayload = await integrationRequest.value.json();
            if (current !== generation.current || requestOwner !== owner.current) return;
            setIntegrations(integrationPayload.integrations || {});
            metadataRefreshedAt.current = Date.now();
          }
          if (
            deviceRequest.status === "fulfilled" &&
            deviceRequest.value.ok &&
            current === generation.current
          ) {
            const devicePayload = (await deviceRequest.value.json()) as {
              devices?: WorkspaceDeviceSummary[];
            };
            if (current !== generation.current || requestOwner !== owner.current) return;
            setDevice(devicePayload.devices?.[0] || null);
            setDeviceStatusLoaded(true);
            devicePaired.current = Boolean(devicePayload.devices?.length);
            metadataRefreshedAt.current = Date.now();
          }
        }
      } catch (cause) {
        if (!silent && current === generation.current && requestOwner === owner.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Your workspace could not be loaded.",
          );
      } finally {
        if (!silent && current === generation.current && requestOwner === owner.current) setLoading(false);
        if (silent) liveRefreshRunning.current = false;
      }
    },
    [loadSample],
  );

  useEffect(() => {
    setApprovalReceipt(null);
    setNotice(null);
    metadataRefreshedAt.current = 0;
    devicePaired.current = false;
    if (initialMode === "sample") loadSample();
    else void loadLive(true);
    return () => {
      generation.current++;
    };
  }, [accountIdentity, initialMode, loadLive, loadSample]);

  useEffect(() => {
    if (mode !== "live" || loading) return;
    const refresh = () => void loadLive(false, true);
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
    return () => {
      disposed = true;
      clearTimeout(debounce);
      if (channel) void supabase?.removeChannel(channel);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [loading, loadLive, mode]);

  useEffect(() => {
    if (mode !== "sample" || loading) return;
    try {
      localStorage.setItem(
        SAMPLE_STORAGE_KEY,
        JSON.stringify({ version: 1, meetings }),
      );
      localStorage.removeItem(LEGACY_SAMPLE_STORAGE_KEY);
    } catch {
      setNotice(
        "Changes are available in this tab. Browser storage is unavailable.",
      );
    }
  }, [mode, meetings, loading]);

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
        setNotice("Added to your sample calendar. No invitation was sent.");
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
      setNotice("Meeting added to Google Calendar. Invitation sent.");
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
      setMeetings((current) => updateApproval(current, id, changes));
      if (changes.status === "dismissed") setNotice("Approval dismissed.");
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
      setMeetings((current) =>
        current.map((meeting) => ({
          ...meeting,
          contacts: meeting.contacts.map((contact) =>
            contact.id === id ? { ...contact, ...saved } : contact,
          ),
        })),
      );
      setNotice("Contact details updated.");
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
    loadSample,
    loadLive,
    setError,
    setNotice,
  };
}
