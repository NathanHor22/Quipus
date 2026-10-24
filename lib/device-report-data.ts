import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey, meetingReportDetails, type DeviceMeetingBrief } from "./device-briefing";
import type { AuthenticatedLantern } from "./lantern-device-auth";
import { validTimezone } from "./quipus-profile";
import { lanternMachineSchema } from "./lantern-state";
import { shiftDate, type ReportDepth } from "./report-request";

export interface ReportMeeting extends DeviceMeetingBrief {
  id: string; startAt: string; person: string; status: string; transcriptAvailable: boolean;
  actions: { id: string; description: string }[];
}
export interface ReportState {
  date: string; timezone: string; meetings: ReportMeeting[]; selectedIndex: number;
  depth: ReportDepth; dailyReportId?: string; dailyPage: number;
  currentReportId?: string; currentPage: number;
  dailyDate?: string; dailyMeetings?: ReportMeeting[];
  currentMeetingPages?: number[]; dailyMeetingPages?: number[];
}
export interface ReportPlaybackInput {
  contextId?: string; playbackId?: string; playbackPage?: number; text: string;
  lastSpokenPage?: number; interactionId?: string; conversational?: boolean; turnClaimed?: boolean;
}

export interface ReportQueryReply {
  reportId?: string; page?: number; speech?: string; intent: string;
  reportContextId?: string; interactionId?: string; conversational?: boolean; playbackMode?: "repeat";
}

export async function snapshotDay(client: SupabaseClient, userId: string, date: string, timezone: string): Promise<ReportMeeting[]> {
  // Wider UTC window accommodates all civil timezones, including DST days.
  const rows = await client.from("meetings").select("id,title,start_at,status,recording_id")
    .eq("user_id", userId).neq("source", "calendar")
    .gte("start_at", `${shiftDate(date, -1)}T00:00:00Z`).lt("start_at", `${shiftDate(date, 2)}T00:00:00Z`)
    .order("start_at", { ascending: true }).order("id", { ascending: true });
  if (rows.error) throw rows.error;
  const meetings = (rows.data || []).filter(row => localDateKey(row.start_at, timezone) === date);
  if (!meetings.length) return [];
  const ids = meetings.map(row => row.id);
  const recordingIds = meetings.map(row => row.recording_id).filter(Boolean);
  const [insights, actions, commitments, contacts, transcripts] = await Promise.all([
    client.from("meeting_insights").select("meeting_id,intent,next_action,key_points,wants,concern,promised").eq("user_id", userId).in("meeting_id", ids),
    client.from("follow_ups").select("id,meeting_id,description").eq("user_id", userId).in("meeting_id", ids).in("status", ["pending", "approved"]),
    client.from("commitments").select("meeting_id,owner_type,description,due_at,status").eq("user_id", userId).in("meeting_id", ids),
    client.from("meeting_contacts").select("meeting_id,contacts(name,user_id)").in("meeting_id", ids),
    recordingIds.length ? client.from("transcripts").select("recording_id").eq("user_id", userId).in("recording_id", recordingIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [insights, actions, commitments, contacts, transcripts]) if (result.error) throw result.error;
  return meetings.map(row => {
    const insight = insights.data?.find(item => item.meeting_id === row.id);
    return {
      id: row.id, title: row.title, startAt: row.start_at, status: row.status,
      person: (contacts.data || []).filter(item => item.meeting_id === row.id).flatMap(item => Array.isArray(item.contacts) ? item.contacts : [item.contacts])
        .filter(item => item && item.user_id === userId).map(item => item.name).join(", "),
      transcriptAvailable: Boolean(transcripts.data?.some(item => item.recording_id === row.recording_id)),
      keyPoints: Array.isArray(insight?.key_points) ? insight.key_points.filter((item): item is string => typeof item === "string") : [],
      intent: insight?.intent, wants: insight?.wants, concern: insight?.concern, promised: insight?.promised, nextAction: insight?.next_action,
      actions: (actions.data || []).filter(item => item.meeting_id === row.id).map(item => ({ id: item.id, description: item.description })),
      commitments: (commitments.data || []).filter(item => item.meeting_id === row.id).map(item =>
        `${item.owner_type === "user" ? "You" : "The contact"}: ${item.description}${item.due_at ? `, due ${new Intl.DateTimeFormat("en-MY", { timeZone: timezone, dateStyle: "medium" }).format(new Date(item.due_at))}` : ""}. ${item.status === "completed" ? "Completed." : "Still open."}`),
    };
  });
}

export async function deviceReportManifest(client: SupabaseClient, userId: string, limit = 5) {
  const profile = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  if (profile.error) throw profile.error;
  const timezone = validTimezone(profile.data?.timezone);
  const today = localDateKey(new Date(), timezone);
  const meetings = await snapshotDay(client, userId, today, timezone);
  return meetings.slice(-Math.max(1, Math.min(limit, 5))).reverse().map((meeting) => ({
    id: meeting.id,
    title: meeting.title.slice(0, 48),
    time: new Intl.DateTimeFormat("en-MY", { timeZone: timezone, hour: "numeric", minute: "2-digit" })
      .format(new Date(meeting.startAt)),
    status: meeting.status === "ready" ? "READY" : meeting.status === "processing" ? "PROCESSING" : "PENDING",
    summary: meeting.status === "ready"
      ? (meeting.intent || meeting.keyPoints[0] || "Summary available in the dashboard.").slice(0, 144)
      : "Saved safely. Quipus is still preparing this meeting.",
    action: meeting.status === "ready"
      ? (meeting.actions[0]?.description || meeting.nextAction || meeting.commitments?.[0] || "No pending action.").slice(0, 96)
      : "No action until processing finishes.",
  }));
}
export function reportMeetingLabel(meeting: ReportMeeting, state: ReportState): string {
  const number = state.meetings.findIndex(item => item.id === meeting.id) + 1;
  const time = new Intl.DateTimeFormat("en-MY", { timeZone: state.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(meeting.startAt));
  return `Meeting ${number}, recorded at ${time}: ${meeting.title}.`;
}
/** Each meeting starts a separate speech section; detailed mode keeps all points. */
export function reportSections(state: ReportState, selected: ReportMeeting[], depth: ReportDepth): string[] {
  const date = new Intl.DateTimeFormat("en-MY", { timeZone: "UTC", dateStyle: "full" }).format(new Date(`${state.date}T12:00:00Z`));
  const sections = [`Your ${depth === "full" ? "detailed report" : depth === "actions" ? "action items" : "overview"} for ${date}. Times are in ${state.timezone.replaceAll("_", " ")}.`];
  if (!selected.length) return [...sections, "There are no recorded conversations for this date. A recording still uploading may not appear yet."];
  for (const meeting of selected) {
    let details: string[];
    if (meeting.status !== "ready") details = [meeting.status === "processing" ? "This recording is still processing. Its summary is not ready yet." : "The summary is unavailable. Please check this recording in your dashboard."];
    else if (depth === "actions") details = [...(meeting.commitments || []), ...meeting.actions.map(item => item.description)];
    else if (depth === "full") details = meetingReportDetails(meeting);
    else details = [meeting.intent || meeting.keyPoints[0] || "", meeting.nextAction ? `Next step: ${meeting.nextAction}` : ""].filter(Boolean);
    sections.push(`${reportMeetingLabel(meeting, state)} ${details.length ? details.join(" ") : "No extracted details are available."}${!meeting.transcriptAvailable && meeting.status === "ready" ? " The source transcript is unavailable; these are saved summary details." : ""}`);
  }
  return sections;
}

/** A report may read older meetings during upload only with proof capture ended. */
export async function assertReportCaptureStopped(client: SupabaseClient, device: AuthenticatedLantern) {
  if (device.state === "ready") return;
  const denied = "Finish the current recording before requesting a report.";
  // device_state is a control-plane snapshot, not proof of an active microphone.
  // Pairing, report mode and finalized offline imports can leave it behind the
  // physical device. The owned live capture slot is authoritative below.
  const { data: session, error } = await client.from("lantern_sessions")
    .select("id,state,machine,capture_ended_at,recording_started_at,recording_id,audio_received_at,audio_event_id,transcript_received_at,transcript_segments,final_transcription,meeting_id")
    .eq("device_id", device.id).eq("user_id", device.userId)
    .is("ended_at", null).is("offline_import_fingerprint", null).maybeSingle();
  if (error) throw new Error("Could not verify that recording has stopped.");
  const endedAt = typeof session?.capture_ended_at === "string"
    ? Date.parse(session.capture_ended_at) : Number.NaN;
  // A finalized offline import does not occupy the live control slot. A stale
  // non-capture device status must not block read-only access to older meetings.
  if (!session) return;
  // An expired question that never received consent is not a recording. Reading
  // historical reports must not be trapped by that abandoned control slot.
  // Keep the slot untouched, and fail closed on any capture or malformed proof.
  if (device.state === "awaiting_recording_consent" && session.state === device.state &&
      [session.capture_ended_at, session.recording_started_at, session.recording_id,
        session.audio_received_at, session.audio_event_id, session.transcript_received_at,
        session.final_transcription, session.meeting_id].every(value => value === null) &&
      (session.transcript_segments === null ||
        (Array.isArray(session.transcript_segments) && session.transcript_segments.length === 0))) {
    const consent = lanternMachineSchema.safeParse(session.machine);
    if (consent.success && consent.data.state === "awaiting_recording_consent" &&
        consent.data.sessionId === session.id && consent.data.recordingStartedAt === null &&
        consent.data.consentConfirmedAt === null && consent.data.prompt?.kind === "recording_consent" &&
        Date.parse(consent.data.prompt.expiresAt) < Date.now()) return;
  }
  if (!["finalising", "processing"].includes(session.state) ||
      !Number.isFinite(endedAt) || endedAt > Date.now() + 120_000) {
    console.warn("Report blocked by unclosed live capture", {
      deviceState: device.state, captureState: session.state,
      validCaptureEnd: Number.isFinite(endedAt),
    });
    throw new Error(denied);
  }
}
