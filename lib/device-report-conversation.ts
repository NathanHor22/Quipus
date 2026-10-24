import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedLantern } from "./lantern-device-auth";
import { localDateKey, splitSpeechPages } from "./device-briefing";
import { createVoicePrompt } from "./device-voice-prompt";
import { assertReportCaptureStopped, snapshotDay, reportMeetingLabel, reportSections, type ReportState, type ReportMeeting, type ReportPlaybackInput, type ReportQueryReply } from "./device-report-data";
import { answerMeetingQuestion } from "./report-meeting-answer";
import { parseReportRequest, selectReportMeetings, type ReportRequest } from "./report-request";
import { validTimezone } from "./quipus-profile";
import { claimReportTurn, ReplacedReportTurnError, REPORT_CONTEXT_MAX_AGE_MS, REPORT_CONTEXT_IDLE_MS } from "./report-turn";

interface ConversationState extends ReportState {
  conversation: true; startedAt: number; closed?: boolean; interactionId?: string; activeInteractionId?: string;
  currentLastSpokenPage?: number; dailyLastSpokenPage?: number;
  pendingQuestion?: ReportRequest["question"]; recentQuestions: string[];
}

function rememberPlayback(state: ConversationState, input: ReportPlaybackInput) {
  if (!input.playbackId || input.playbackPage === undefined) return;
  const next = input.playbackPage;
  const spoken = input.lastSpokenPage !== undefined && input.lastSpokenPage < next
    ? input.lastSpokenPage : next > 0 ? next - 1 : undefined;
  if (state.dailyReportId === input.playbackId) {
    state.dailyPage = next;
    state.dailyLastSpokenPage = spoken;
  }
  if (state.currentReportId === input.playbackId) {
    state.currentPage = next;
    state.currentLastSpokenPage = spoken;
    const pages = state.currentMeetingPages || [];
    const index = pages[spoken ?? next];
    if (index !== undefined && index >= 0) state.selectedIndex = index;
  }
}
function selectionPrompt(state: ConversationState) {
  if (!state.meetings.length) return "There are no recorded meetings for that day yet. You can ask for another date.";
  const choices = state.meetings.slice(0, 3).map(meeting => {
    const time = new Intl.DateTimeFormat("en-MY", { timeZone: state.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(meeting.startAt));
    return `${time}${meeting.person ? ` with ${meeting.person}` : ""}`;
  });
  return `Which meeting would you like? ${choices.join(", ")}${state.meetings.length > 3 ? ", or another meeting" : ""}. You can also ask for the full day.`;
}

export async function prepareReportConversation(client: SupabaseClient, device: AuthenticatedLantern, input: ReportPlaybackInput): Promise<ReportQueryReply> {
  await assertReportCaptureStopped(client, device);
  const now = Date.now();
  const profile = await client.from("profiles").select("timezone").eq("id", device.userId).maybeSingle();
  if (profile.error) throw profile.error;
  const timezone = validTimezone(profile.data?.timezone);
  let contextId = input.contextId;
  const activeInteractionId = input.interactionId || randomUUID();
  const existingTurn = Boolean(contextId);
  if (contextId && !input.turnClaimed) await claimReportTurn(client, device, contextId, activeInteractionId);
  let state: ConversationState | undefined;
  if (contextId) {
    const saved = await client.from("device_report_sessions").select("state").eq("id", contextId)
      .eq("user_id", device.userId).eq("device_id", device.id).gt("expires_at", new Date(now).toISOString()).maybeSingle();
    if (saved.error) throw saved.error;
    const candidate = saved.data?.state as ConversationState | undefined;
    if (candidate?.conversation && !candidate.closed && now - candidate.startedAt < REPORT_CONTEXT_MAX_AGE_MS) {
      if (candidate.activeInteractionId !== activeInteractionId) throw new ReplacedReportTurnError();
      state = candidate;
    }
    else contextId = undefined;
  }
  const request = parseReportRequest(input.text, timezone);
  const expired = Boolean(input.contextId && !state);
  if (state) rememberPlayback(state, input);
  const date = request.date || state?.date || localDateKey(new Date(now), timezone);
  if (!state) state = {
    conversation: true, startedAt: now, recentQuestions: [], date, timezone,
    meetings: await snapshotDay(client, device.userId, date, timezone), selectedIndex: -1,
    depth: "full", dailyPage: 0, currentPage: 0,
  };
  else if (state.date !== date) {
    state.date = date; state.meetings = await snapshotDay(client, device.userId, date, timezone);
    state.selectedIndex = -1; state.pendingQuestion = undefined;
  }
  state.interactionId = input.interactionId;
  state.activeInteractionId = activeInteractionId;
  contextId ||= randomUUID();
  const persist = async () => {
    const expires = state!.closed ? now : Math.min(state!.startedAt + REPORT_CONTEXT_MAX_AGE_MS, now + REPORT_CONTEXT_IDLE_MS);
    if (existingTurn && !expired) {
      const changed = await client.from("device_report_sessions").update({ state, expires_at: new Date(expires).toISOString() })
        .eq("id", contextId).eq("user_id", device.userId).eq("device_id", device.id)
        .eq("state->>activeInteractionId", activeInteractionId).gt("expires_at", new Date(now).toISOString())
        .select("id").maybeSingle();
      if (changed.error) throw changed.error;
      if (!changed.data) throw new ReplacedReportTurnError();
    } else {
      const created = await client.from("device_report_sessions").insert({ id: contextId, user_id: device.userId, device_id: device.id,
        state, expires_at: new Date(expires).toISOString() });
      if (created.error) throw created.error;
    }
  };
  const cancelled = await client.from("device_voice_prompts").update({ status: "completed", result: { speech: "Review cancelled. Nothing has been sent." } })
    .eq("device_id", device.id).eq("user_id", device.userId).eq("status", "pending");
  if (cancelled.error) throw cancelled.error;
  const result = (reportId: string, page: number, intent = "report_answer") => ({ reportId, page, intent,
    reportContextId: contextId, interactionId: input.interactionId, conversational: true });
  const speak = async (sections: string[], selected: ReportMeeting[] = [], daily = false, offerReview = false, intent = "report_answer") => {
    let token: string | undefined;
    const actions = selected.flatMap(meeting => meeting.actions.map(action => action.id));
    if (offerReview && actions.length) {
      const prompt = await createVoicePrompt(client, device, "review", {}, actions,
        `I found ${actions.length} pending action item${actions.length === 1 ? "" : "s"}. Would you like to review them? Each send needs your separate approval.`);
      token = prompt.token; sections.push(prompt.speech);
    }
    const id = randomUUID();
    const pages = sections.flatMap(section => splitSpeechPages(section));
    const meetingPages = sections.flatMap(section => {
      const index = state!.meetings.findIndex(meeting => section.startsWith(reportMeetingLabel(meeting, state!)));
      return splitSpeechPages(section).map(() => index);
    });
    const saved = await client.from("device_reports").insert({ id, user_id: device.userId, device_id: device.id, pages, review_token: token || null });
    if (saved.error) throw saved.error;
    state!.currentReportId = id; state!.currentPage = 0; state!.currentLastSpokenPage = undefined; state!.currentMeetingPages = meetingPages;
    if (daily) {
      state!.dailyReportId = id; state!.dailyPage = 0; state!.dailyLastSpokenPage = undefined;
      state!.dailyDate = state!.date; state!.dailyMeetings = state!.meetings; state!.dailyMeetingPages = meetingPages;
    }
    await persist();
    return result(id, 0, intent);
  };
  if (request.action === "stop") {
    state.closed = true; state.pendingQuestion = undefined;
    await persist();
    return { speech: "Report stopped. Nothing has been sent.", intent: "report_stop", reportContextId: contextId,
      interactionId: input.interactionId, conversational: true };
  }
  if (expired && !request.date && request.scope !== "select") return speak(["That report context has expired. Which meeting and date would you like?"]);
  if (request.action === "unknown") return speak(["Tell me the meeting time or person, ask for the full day, or say I'm done."], [], false, false, "report_clarify");
  if (request.action === "continue" || request.action === "repeat") {
    const daily = request.action === "continue" && request.scope === "day";
    const id = daily ? state.dailyReportId : state.currentReportId;
    const page = request.action === "repeat" ? state.currentLastSpokenPage ?? state.currentPage
      : daily ? state.dailyPage : state.currentPage;
    if (!id) return speak(["There is no paused report yet. Which meeting would you like?"]);
    const previous = await client.from("device_reports").select("pages,review_token").eq("id", id)
      .eq("user_id", device.userId).eq("device_id", device.id).gt("expires_at", new Date(now).toISOString()).maybeSingle();
    if (previous.error) throw previous.error;
    if (!previous.data) return speak(["That playback has expired. Which meeting would you like?"]);
    if (page >= previous.data.pages.length) return speak(["That report has finished. Ask about another meeting, or say I'm done."]);
    if (daily && state.dailyMeetings && state.dailyDate) {
      state.meetings = state.dailyMeetings; state.date = state.dailyDate;
      state.currentMeetingPages = state.dailyMeetingPages; state.selectedIndex = -1;
    }
    if (request.action !== "repeat") { state.currentReportId = id; state.currentPage = page; }
    await persist();
    return { ...result(id, page), ...(request.action === "repeat" ? { playbackMode: "repeat" as const } : {}) };
  }
  const selection: ReportRequest = request.action === "next" ? { action: "query", ordinal: state.selectedIndex + 2 } : request;
  const targeted = selection.ordinal !== undefined || selection.minute !== undefined || Boolean(selection.person);
  if (request.scope === "select") { state.selectedIndex = -1; return speak([selectionPrompt(state)]); }
  let selected: ReportMeeting[];
  if (targeted) selected = selectReportMeetings(state.meetings, selection, timezone);
  else if (request.scope === "day") selected = state.meetings;
  else selected = state.selectedIndex >= 0 ? [state.meetings[state.selectedIndex]].filter(Boolean) : [];
  if (!selected.length && selection.ordinal === undefined &&
      (selection.minute !== undefined || selection.person)) {
    // A stopped upload may finish after this context opened. Refresh only an
    // exact same-day target miss; keep prior ordinal positions and daily pages.
    const refreshed = selectReportMeetings(await snapshotDay(client, device.userId, state.date, timezone), selection, timezone);
    if (refreshed.length) {
      const matches = new Map(refreshed.map(meeting => [meeting.id, meeting]));
      const known = new Set(state.meetings.map(meeting => meeting.id));
      state.meetings = state.meetings.map(meeting => matches.get(meeting.id) || meeting)
        .concat(refreshed.filter(meeting => !known.has(meeting.id)));
    }
    selected = refreshed;
  }
  if (selection.minute !== undefined) {
    // Bounded operational trace only: no transcript, identity or meeting IDs.
    console.info("Report time selection", { minute: selection.minute, date: state.date,
      timezone, available: state.meetings.length, matches: selected.length });
  }
  if (targeted && selected.length !== 1) {
    state.selectedIndex = -1; state.pendingQuestion = request.question;
    return speak([selected.length ? `More than one meeting matches. ${selected.slice(0, 3).map(meeting => reportMeetingLabel(meeting, state!)).join(" ")} Which meeting number?`
      : "I couldn't find a recorded meeting at that time or with that person on this day. Try another time or date."], [], false, false, "report_clarify");
  }
  if (!selected.length && request.scope !== "day") {
    state.pendingQuestion = request.question || state.pendingQuestion;
    return speak([selectionPrompt(state)]);
  }
  if (targeted) state.selectedIndex = state.meetings.findIndex(meeting => meeting.id === selected[0].id);
  const question = request.question || (targeted ? state.pendingQuestion : undefined);
  state.pendingQuestion = undefined;
  if (question && selected.length === 1) {
    state.recentQuestions = [...state.recentQuestions, question.text].slice(-4);
    const answer = await answerMeetingQuestion(client, device.userId, selected[0], question);
    return speak([`${reportMeetingLabel(selected[0], state)} ${answer}`], selected);
  }
  const depth = request.depth || "full";
  state.depth = depth;
  const sections = reportSections(state, selected, depth);
  return speak(sections, selected.filter(meeting => meeting.status === "ready"), request.scope === "day", depth === "actions");
}
