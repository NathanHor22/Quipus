import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey, splitSpeechPages } from "./device-briefing";
import { createVoicePrompt } from "./device-voice-prompt";
import type { AuthenticatedLantern } from "./lantern-device-auth";
import { validTimezone } from "./quipus-profile";
import { parseReportRequest, selectReportMeetings, type ReportRequest } from "./report-request";
import { assertReportCaptureStopped, snapshotDay, reportMeetingLabel, reportSections, type ReportMeeting, type ReportState, type ReportPlaybackInput, type ReportQueryReply } from "./device-report-data";
import { prepareReportConversation } from "./device-report-conversation";
export { assertReportCaptureStopped, snapshotDay, deviceReportManifest, reportMeetingLabel, reportSections } from "./device-report-data";
export type { ReportMeeting, ReportState, ReportPlaybackInput } from "./device-report-data";

export async function prepareReportQuery(client: SupabaseClient, device: AuthenticatedLantern, input: ReportPlaybackInput): Promise<ReportQueryReply> {
  return input.conversational ? prepareReportConversation(client, device, input) : prepareLegacyReportQuery(client, device, input);
}

async function prepareLegacyReportQuery(client: SupabaseClient, device: AuthenticatedLantern, input: ReportPlaybackInput) {
  await assertReportCaptureStopped(client, device);
  const profile = await client.from("profiles").select("timezone").eq("id", device.userId).maybeSingle();
  if (profile.error) throw profile.error;
  const timezone = validTimezone(profile.data?.timezone);
  let contextId = input.contextId;
  let state: ReportState | undefined;
  if (contextId) {
    const saved = await client.from("device_report_sessions").select("state").eq("id", contextId)
      .eq("user_id", device.userId).eq("device_id", device.id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (saved.error) throw saved.error;
    if (saved.data) state = saved.data.state as ReportState;
    else contextId = undefined;
  }
  const request = parseReportRequest(input.text, timezone);
  const expired = Boolean(input.contextId && !state);
  const targetDate = request.date || state?.date || localDateKey(new Date(), timezone);
  const freshDaily = request.action === "query" && Boolean(request.date) && request.ordinal === undefined && request.minute === undefined && !request.person;
  if (!state || state.date !== targetDate || freshDaily) {
    state = { date: targetDate, timezone, meetings: await snapshotDay(client, device.userId, targetDate, timezone), selectedIndex: -1, depth: "full",
      dailyReportId: state?.dailyReportId, dailyPage: state?.dailyPage || 0, dailyDate: state?.dailyDate,
      dailyMeetings: state?.dailyMeetings, dailyMeetingPages: state?.dailyMeetingPages, currentPage: 0 };
  }
  if (input.playbackId && input.playbackPage !== undefined) {
    if (state.dailyReportId === input.playbackId) state.dailyPage = input.playbackPage;
    if (state.currentReportId === input.playbackId) {
      state.currentPage = input.playbackPage;
      const index = state.currentMeetingPages?.[input.playbackPage];
      if (index !== undefined && index >= 0) state.selectedIndex = index;
    }
  }
  contextId ||= randomUUID();
  const persist = async () => {
    const result = await client.from("device_report_sessions").upsert({ id: contextId, user_id: device.userId, device_id: device.id, state,
      expires_at: new Date(Date.now() + 7200000).toISOString() });
    if (result.error) throw result.error;
  };
  // A new report request invalidates prior spoken approvals. A yes in report
  // context can never execute one of those prompts.
  const cancelled = await client.from("device_voice_prompts").update({ status: "completed", result: { speech: "That review was cancelled. Ask for a new report to review actions." } })
    .eq("device_id", device.id).eq("user_id", device.userId).eq("status", "pending");
  if (cancelled.error) throw cancelled.error;

  const storeSpeech = async (sections: string[], selected: ReportMeeting[] = [], daily = false, intent = "report_answer") => {
    const ids = selected.flatMap(meeting => meeting.actions.map(action => action.id));
    let token: string | undefined;
    if (ids.length) {
      const prompt = await createVoicePrompt(client, device, "review", {}, ids,
        `I found ${ids.length} pending action item${ids.length === 1 ? "" : "s"}. Would you like to review them? Say yes or no. Each send needs your approval.`);
      token = prompt.token;
      sections.push(prompt.speech);
    } else if (selected.length) sections.push("Report complete. You can ask for another meeting, a full breakdown, or another date.");
    const id = randomUUID();
    const pages = sections.flatMap(section => splitSpeechPages(section));
    const meetingPages = sections.flatMap(section => {
      const index = selected.findIndex(meeting => section.startsWith(reportMeetingLabel(meeting, state!)));
      const ordinal = index < 0 ? -1 : state!.meetings.findIndex(meeting => meeting.id === selected[index].id);
      return splitSpeechPages(section).map(() => ordinal);
    });
    const saved = await client.from("device_reports").insert({ id, user_id: device.userId, device_id: device.id, pages, review_token: token || null });
    if (saved.error) throw saved.error;
    state!.currentReportId = id; state!.currentPage = 0;
    state!.currentMeetingPages = meetingPages;
    if (daily) { state!.dailyReportId = id; state!.dailyPage = 0; state!.dailyDate = state!.date; state!.dailyMeetings = state!.meetings; state!.dailyMeetingPages = meetingPages; }
    await persist();
    return { reportId: id, page: 0, reportContextId: contextId, intent };
  };
  if (request.action === "stop") return storeSpeech(["Report stopped. Nothing has been sent."], [], false, "report_stop");
  if (expired && !request.date && (["continue", "repeat", "next"].includes(request.action) || request.ordinal !== undefined || request.minute !== undefined || request.person)) return storeSpeech(["Your earlier report has expired. Ask for a new report and its date."]);
  if (request.action === "unknown") return storeSpeech(["You can ask for today's report, yesterday, a full breakdown, the third meeting, or a meeting at a specific time. Nothing has been sent."]);
  if (request.action === "continue" || request.action === "repeat") {
    const id = request.action === "continue" ? state.dailyReportId : state.currentReportId;
    const page = request.action === "continue" ? state.dailyPage : state.currentPage;
    if (!id) return storeSpeech(["There is no paused report yet. Ask for a daily report first."]);
    if (request.action === "continue" && state.dailyMeetings && state.dailyDate) {
      state.date = state.dailyDate; state.meetings = state.dailyMeetings; state.currentMeetingPages = state.dailyMeetingPages;
    }
    const previous = await client.from("device_reports").select("pages,review_token").eq("id", id).eq("user_id", device.userId).eq("device_id", device.id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (previous.error || !previous.data) return storeSpeech(["That playback has expired. Ask for a fresh report and its date."]);
    if (page >= previous.data.pages.length) return storeSpeech(["That report already finished. Ask for another meeting, date, or a new full report."]);
    if (previous.data.review_token) {
      const review = await client.from("device_voice_prompts").select("remaining_ids").eq("id", previous.data.review_token).eq("user_id", device.userId).eq("device_id", device.id).maybeSingle();
      if (review.error) throw review.error;
      if (review.data?.remaining_ids?.length) {
        const prompt = await createVoicePrompt(client, device, "review", {}, review.data.remaining_ids, "Review pending actions?");
        const refreshed = await client.from("device_reports").update({ review_token: prompt.token }).eq("id", id).eq("user_id", device.userId).eq("device_id", device.id);
        if (refreshed.error) throw refreshed.error;
      }
    }
    state.currentReportId = id; state.currentPage = page;
    await persist();
    // A resumed report offers a fresh review; individual send approvals from
    // the interrupted exchange stay cancelled and cannot be replayed.
    return { reportId: id, page, reportContextId: contextId, intent: "report_answer" };
  }
  const selection: ReportRequest = request.action === "next" ? { action: "query", ordinal: state.selectedIndex + 2 } : request;
  const selected = selectReportMeetings(state.meetings, selection, state.timezone);
  const targeted = selection.ordinal !== undefined || selection.minute !== undefined || Boolean(selection.person);
  if (targeted && !selected.length) return storeSpeech([`I couldn't find that recorded meeting on ${state.date}. There are ${state.meetings.length} conversations in this report. Say a meeting number, another date, or stop.`]);
  if (targeted && selected.length > 1) return storeSpeech([`More than one recording matches. ${selected.map(meeting => reportMeetingLabel(meeting, state!)).join(" ")} Say the meeting number.`]);
  if (targeted) state.selectedIndex = state.meetings.findIndex(meeting => meeting.id === selected[0].id);
  state.depth = selection.depth || (targeted ? "full" : state.depth);
  return storeSpeech(reportSections(state, selected, state.depth), selected.filter(meeting => meeting.status === "ready"), !targeted);
}
