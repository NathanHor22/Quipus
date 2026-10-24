import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { parseReportRequest, selectReportMeetings } from "../lib/report-request";
import { personalGreeting, firstName, validTimezone } from "../lib/quipus-profile";
import { prepareReportQuery, reportSections, type ReportState } from "../lib/device-report-session";
import { answerVoicePrompt } from "../lib/device-dialogue";
import { device, fixtures, reportSpeech } from "./helpers/report-fixtures";

test("relative report dates use the owner's civil date, including midnight and last Friday", () => {
  const now = new Date("2026-09-21T17:00:00Z");
  assert.equal(parseReportRequest("yesterday's report", "Asia/Kuala_Lumpur", now).date, "2026-09-21");
  assert.equal(parseReportRequest("yesterday's report", "America/New_York", now).date, "2026-09-20");
  assert.equal(parseReportRequest("last Friday's report", "Asia/Kuala_Lumpur", now).date, "2026-09-18");
  assert.equal(parseReportRequest("report for 2026-02-31", "UTC", now).action, "unknown");
});
test("report selectors understand ordinals, spoken times, people and depth without approving actions", () => {
  assert.equal(parseReportRequest("only tell me about the third meeting", "UTC").ordinal, 3);
  assert.equal(parseReportRequest("tell me about the meeting at two pm", "UTC").minute, 840);
  assert.equal(parseReportRequest("the meeting at 2:30 p.m.", "UTC").minute, 870);
  assert.equal(parseReportRequest("what did Nigel ask for?", "UTC").person, "nigel");
  assert.equal(parseReportRequest("full breakdown of my day", "UTC").depth, "full");
  assert.equal(parseReportRequest("just the action items", "UTC").depth, "actions");
  assert.equal(parseReportRequest("continue my daily report", "UTC").action, "continue");
  for (const text of ["yes", "send that email", "approve everything", "start recording"]) assert.equal(parseReportRequest(text, "UTC").action, "unknown");
});
test("time selection keeps ambiguous matches; ordinal selection never guesses", () => {
  const meetings = [1,2].map(n => ({ id: String(n), title: "Nigel meeting", startAt: "2026-09-21T06:00:00Z" }));
  assert.equal(selectReportMeetings(meetings, { action: "query", minute: 840 }, "Asia/Kuala_Lumpur").length, 2);
  assert.equal(selectReportMeetings(meetings, { action: "query", ordinal: 3 }, "UTC").length, 0);
  assert.equal(selectReportMeetings(meetings, { action: "query", minute: 840 }, "UTC").length, 0);
});
test("greetings use actual names and timezone; missing names stay neutral", () => {
  assert.equal(personalGreeting("Nathan Hor", new Date("2026-09-21T00:00:00Z"), "Asia/Kuala_Lumpur"), "Good morning, Nathan.");
  assert.equal(personalGreeting(null, new Date("2026-09-21T10:00:00Z"), "Asia/Kuala_Lumpur"), "Good evening.");
  assert.equal(firstName("  Aisyah  Rahman "), "Aisyah");
  assert.equal(validTimezone("imaginary/zone"), "Asia/Kuala_Lumpur");
});

test("default reports keep every saved detail and resume the same meeting snapshot after a late upload", async () => {
  const { tables, client } = fixtures();
  const deliveryPlan = Array.from({ length: 12 }, (_, index) =>
    `Delivery milestone ${index + 1} requires a demonstration and the client's written approval.`).join(" ");
  Object.assign(tables.meeting_insights[0], {
    intent: "Discuss the renewal.", wants: "A staged rollout.", concern: "Training capacity.",
    next_action: "Confirm the delivery dates.", key_points: ["Point one.", "Point two.", deliveryPlan, "Final detail 1."],
  });
  tables.commitments = [{ user_id: device.userId, meeting_id: "m0", owner_type: "user", description: "Bring the demo.", status: "open" }];
  const daily = await prepareReportQuery(client, device, { text: "report for 2026-09-21" });
  const dailySpeech = reportSpeech(tables, daily.reportId);
  for (const detail of ["Discuss the renewal.", "Point one.", "Point two.", deliveryPlan, "Final detail 1.", "Final detail 2.", "Final detail 3.", "A staged rollout.", "Training capacity.", "A proposal.", "Bring the demo.", "Confirm the delivery dates."]) {
    assert.ok(dailySpeech.includes(detail), `Default report omitted: ${detail}`);
  }
  const pages = tables.device_reports.find(row => row.id === daily.reportId)!.pages as string[];
  assert.ok(pages.length > 4, "Full report must preserve details across multiple speech pages.");
  assert.ok(pages.every(page => page.length <= 650));
  assert.match(dailySpeech, /detailed report for Monday, 21 September 2026/);
  tables.meetings.unshift({ ...tables.meetings[0], id: "late", start_at: "2026-09-21T00:00:00Z" });
  const targeted = await prepareReportQuery(client, device, { text: "only the third meeting", contextId: daily.reportContextId, playbackId: daily.reportId, playbackPage: 2 });
  const speech = reportSpeech(tables, targeted.reportId);
  assert.match(speech, /Client 3/); assert.match(speech, /Final detail 3/); assert.doesNotMatch(speech, /Client 2/);
  const resume = await prepareReportQuery(client, device, { text: "continue my daily report", contextId: daily.reportContextId, playbackId: targeted.reportId, playbackPage: 1 });
  assert.equal(resume.reportId, daily.reportId); assert.equal(resume.page, 2);
});
for (const description of ["quick report", "overview", "short summary"]) {
  test(`explicit ${description} stays concise despite the full-report default`, async () => {
    const { tables, client } = fixtures();
    const report = await prepareReportQuery(client, device, { text: `${description} for 2026-09-21` });
    const speech = reportSpeech(tables, report.reportId);
    assert.match(speech, /Your overview/);
    assert.match(speech, /Point one/);
    for (const client of ["Client 1", "Client 2", "Client 3"]) assert.ok(speech.includes(client));
    assert.doesNotMatch(speech, /Point two|Final detail|A proposal/);
  });
}

test("explicit actions-only reports omit the full narrative and preserve the approval boundary", async () => {
  const { tables, client } = fixtures();
  tables.follow_ups = [{ id: "action-a", user_id: device.userId, meeting_id: "m0", description: "Send the pricing proposal.", status: "pending" }];
  tables.commitments = [{ user_id: device.userId, meeting_id: "m0", owner_type: "user", description: "Bring the demo.", status: "open" }];
  const report = await prepareReportQuery(client, device, { text: "actions only for 2026-09-21" });
  const speech = reportSpeech(tables, report.reportId);
  assert.match(speech, /Your action items/);
  assert.match(speech, /Bring the demo/);
  assert.match(speech, /Send the pricing proposal/);
  assert.doesNotMatch(speech, /Point one|Point two|Final detail|A proposal/);
  assert.match(speech, /Each send needs your approval/);
  assert.equal(tables.follow_ups[0].status, "pending");
  assert.equal(tables.device_voice_prompts.some(row => row.status === "executing"), false);
});

test("a targeted meeting can explicitly request a quick overview", async () => {
  const { tables, client } = fixtures();
  const daily = await prepareReportQuery(client, device, { text: "report for 2026-09-21" });
  const targeted = await prepareReportQuery(client, device, {
    text: "quick overview of the third meeting", contextId: daily.reportContextId,
  });
  const speech = reportSpeech(tables, targeted.reportId);
  assert.match(speech, /Client 3/);
  assert.match(speech, /Point one/);
  assert.doesNotMatch(speech, /Client 1|Client 2|Point two|Final detail/);
});

test("foreign and expired report contexts reveal nothing; report requests cancel pending send approvals", async () => {
  const { tables, client } = fixtures();
  const daily = await prepareReportQuery(client, device, { text: "full report for 2026-09-21" });
  const stranger = { ...device, userId: "owner-b", id: "board-b" };
  const other = await prepareReportQuery(client, stranger, { text: "repeat that", contextId: daily.reportContextId });
  assert.notEqual(other.reportContextId, daily.reportContextId);
  assert.doesNotMatch(reportSpeech(tables, other.reportId), /Client/);
  tables.device_voice_prompts.push({ id: "approval", user_id: device.userId, device_id: device.id, status: "pending", kind: "email_send" });
  const stop = await prepareReportQuery(client, device, { text: "stop", contextId: daily.reportContextId });
  assert.equal(stop.intent, "report_stop");
  assert.equal(tables.device_voice_prompts.find(row => row.id === "approval")!.status, "completed");
  const state = tables.device_report_sessions.find(row => row.id === daily.reportContextId)!;
  state.expires_at = "2000-01-01T00:00:00Z";
  const expired = await prepareReportQuery(client, device, { text: "continue", contextId: daily.reportContextId });
  assert.match(reportSpeech(tables, expired.reportId), /expired/);
  const lostOrdinal = await prepareReportQuery(client, device, { text: "only the third meeting", contextId: daily.reportContextId });
  assert.match(reportSpeech(tables, lostOrdinal.reportId), /expired/);
  assert.doesNotMatch(reportSpeech(tables, lostOrdinal.reportId), /Client 3/);
});
test("processing and missing-transcript states are spoken honestly", () => {
  const state: ReportState = { date: "2026-09-21", timezone: "UTC", depth: "full", dailyPage: 0, currentPage: 0, selectedIndex: -1, meetings: [
    { id: "a", title: "Not ready", startAt: "2026-09-21T02:00:00Z", status: "processing", person: "", transcriptAvailable: false, actions: [], keyPoints: ["Do not read unfinished extraction"] },
  ] };
  const speech = reportSections(state, state.meetings, "full").join(" ");
  assert.match(speech, /still processing/); assert.doesNotMatch(speech, /Do not read unfinished/);
});


test("a proved stopped upload can read full older reports while send approvals stay blocked",async()=>{
  const {tables,client}=fixtures();
  const stopped={id:"uploading",device_id:device.id,user_id:device.userId,state:"finalising",capture_ended_at:"2026-09-21T05:00:00Z",ended_at:null,offline_import_fingerprint:null};
  tables.lantern_sessions=[stopped];
  const before=structuredClone(stopped);const recovering={...device,state:"error" as const};
  const report=await prepareReportQuery(client,recovering,{text:"full report for 2026-09-21"});
  const speech=reportSpeech(tables,report.reportId);
  assert.match(speech,/Client 3/);assert.match(speech,/Final detail 3/);
  assert.deepEqual(stopped,before);
  const approval=await answerVoicePrompt(client,recovering,randomUUID(),"yes");
  assert.match(approval.speech,/Finish the current recording/u);
  assert.equal(tables.device_voice_prompts.some(row=>row.status==="executing"),false);
});
