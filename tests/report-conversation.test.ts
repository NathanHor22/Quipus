import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prepareReportQuery } from "../lib/device-report-session";
import { localDateKey } from "../lib/device-briefing";
import { parseReportRequest, shiftDate } from "../lib/report-request";
import { reportProtocol } from "../lib/report-protocol";
import { claimReportTurn } from "../lib/report-turn";
import { database, device, fixtures, reportSpeech, type Row } from "./helpers/report-fixtures";

function conversations() {
  const fixture = fixtures();
  const today = localDateKey(new Date(), "Asia/Kuala_Lumpur");
  const hours = [4, 7, 8];
  fixture.tables.meetings.forEach((meeting, index) => { meeting.start_at = `${today}T${String(hours[index]).padStart(2, "0")}:00:00Z`; });
  fixture.tables.meeting_contacts = [{ meeting_id: "m1", contacts: { name: "Nigel", user_id: device.userId } }];
  fixture.tables.meeting_insights[1].wants = "They need a two-week pilot.";
  fixture.tables.meeting_insights[1].key_points = ["Bring the working demo and pricing deck.", "Nigel agreed to the pilot."];
  fixture.tables.meeting_evidence = [
    { user_id: device.userId, meeting_id: "m1", source_kind: "conversation", confidence: 0.98, importance: 5, statement: "Bring the calibration certificate.", quote: "Please bring the calibration certificate." },
    { user_id: "another-owner", meeting_id: "m1", source_kind: "conversation", confidence: 1, importance: 5, statement: "Bring the secret file." },
    { user_id: device.userId, meeting_id: "m1", source_kind: "research", confidence: 1, importance: 5, statement: "Bring an invented gift." },
    { user_id: device.userId, meeting_id: "m1", source_kind: "conversation", confidence: 0.2, importance: 5, statement: "Bring uncertain equipment." },
  ];
  return { ...fixture, today };
}
function context(tables: Record<string, Row[]>, id: string | undefined) {
  assert.ok(id);
  return tables.device_report_sessions.find(row => row.id === id)!.state as Record<string, unknown>;
}
function pages(tables: Record<string, Row[]>, id: string | undefined) {
  return tables.device_reports.find(row => row.id === id)!.pages as string[];
}

test("a plain conversational status report asks for a meeting while old profiles retain full-day reports", async () => {
  const { tables, client } = conversations();
  const opening = await prepareReportQuery(client, device, { text: "status report", conversational: true });
  const prompt = reportSpeech(tables, opening.reportId);
  assert.match(prompt, /Which meeting would you like/);
  assert.ok(prompt.length < 300);
  assert.doesNotMatch(prompt, /Point one|working demo|detailed report/);
  const legacy = await prepareReportQuery(client, device, { text: "status report" });
  assert.match(reportSpeech(tables, legacy.reportId), /detailed report/);
  assert.match(reportSpeech(tables, legacy.reportId), /working demo/);
});

test("time, pronoun and person follow-ups remain in the selected meeting without disclosing other owners or research guesses", async () => {
  const { tables, client } = conversations();
  const first = await prepareReportQuery(client, device, { text: "status report", conversational: true });
  const selected = await prepareReportQuery(client, device, { text: "only 3pm", conversational: true, contextId: first.reportContextId });
  assert.match(reportSpeech(tables, selected.reportId), /Nigel|working demo/);
  assert.doesNotMatch(reportSpeech(tables, selected.reportId), /Client 1|Client 3/);
  const answer = await prepareReportQuery(client, device, { text: "what did they ask me to bring?", conversational: true, contextId: selected.reportContextId });
  const speech = reportSpeech(tables, answer.reportId);
  assert.match(speech, /working demo/);
  assert.match(speech, /calibration certificate/);
  assert.doesNotMatch(speech, /secret file|invented gift|uncertain equipment|Client 1/);
  const noon = await prepareReportQuery(client, device, { text: "what about my meeting at 12pm?", conversational: true, contextId: first.reportContextId });
  assert.match(reportSpeech(tables, noon.reportId), /Client 1/);
  assert.doesNotMatch(reportSpeech(tables, noon.reportId), /working demo/);
  const person = await prepareReportQuery(client, device, { text: "what did Nigel ask for?", conversational: true, contextId: first.reportContextId });
  assert.match(reportSpeech(tables, person.reportId), /two-week pilot/);
  assert.equal(parseReportRequest("what did they ask me to bring?", "UTC").person, undefined);
});

test("date switches use the owner's civil date and never answer an uncaptured detail", async () => {
  const { tables, client, today } = conversations();
  const yesterday = shiftDate(today, -1);
  tables.meetings.push({ ...tables.meetings[0], id: "yesterday", title: "Yesterday client", recording_id: "ry", start_at: `${yesterday}T06:00:00Z` });
  tables.transcripts.push({ user_id: device.userId, recording_id: "ry" });
  tables.meeting_insights.push({ user_id: device.userId, meeting_id: "yesterday", key_points: ["Discussed renewal pricing."] });
  const reply = await prepareReportQuery(client, device, { text: "yesterday at 2pm", conversational: true });
  assert.match(reportSpeech(tables, reply.reportId), /Yesterday client|renewal pricing/);
  assert.equal(context(tables, reply.reportContextId).date, yesterday);
  const missing = await prepareReportQuery(client, device, { text: "what did they ask me to bring?", conversational: true, contextId: reply.reportContextId });
  assert.match(reportSpeech(tables, missing.reportId), /couldn't find that detail/);
  assert.doesNotMatch(reportSpeech(tables, missing.reportId), /working demo/);
});

test("ambiguous times ask for a meeting number and retain the pending question", async () => {
  const { tables, client } = conversations();
  tables.meetings.push({ ...tables.meetings[1], id: "duplicate", title: "Another client", recording_id: "rd" });
  tables.transcripts.push({ user_id: device.userId, recording_id: "rd" });
  tables.meeting_insights.push({ user_id: device.userId, meeting_id: "duplicate", key_points: ["Bring the signed contract."] });
  const reply = await prepareReportQuery(client, device, { text: "what did they ask me to bring at 3pm?", conversational: true });
  assert.match(reportSpeech(tables, reply.reportId), /More than one meeting matches/);
  assert.equal(reply.intent, "report_clarify");
  assert.doesNotMatch(reportSpeech(tables, reply.reportId), /working demo|signed contract/);
  const selected = await prepareReportQuery(client, device, { text: "the second meeting", conversational: true, contextId: reply.reportContextId });
  assert.match(reportSpeech(tables, selected.reportId), /signed contract/);
  assert.doesNotMatch(reportSpeech(tables, selected.reportId), /working demo/);
});

test("explicit whole-day reports retain a stable snapshot and resume after a targeted answer", async () => {
  const { tables, client } = conversations();
  const daily = await prepareReportQuery(client, device, { text: "full breakdown of my day", conversational: true });
  assert.match(reportSpeech(tables, daily.reportId), /Client 1/);
  assert.match(reportSpeech(tables, daily.reportId), /Client 3/);
  tables.meetings.unshift({ ...tables.meetings[0], id: "late", start_at: `${localDateKey(new Date(), "Asia/Kuala_Lumpur")}T01:00:00Z` });
  const third = await prepareReportQuery(client, device, { text: "third meeting", conversational: true,
    contextId: daily.reportContextId, playbackId: daily.reportId, playbackPage: 2, lastSpokenPage: 1 });
  assert.match(reportSpeech(tables, third.reportId), /Client 3/);
  const resumed = await prepareReportQuery(client, device, { text: "continue my daily report", conversational: true,
    contextId: daily.reportContextId, playbackId: third.reportId, playbackPage: 1, lastSpokenPage: 0 });
  assert.equal(resumed.reportId, daily.reportId);
  assert.equal(resumed.page, 2);
});

test("repeat uses the last drained page after completion while continue never replays completed pages", async () => {
  const { tables, client } = conversations();
  const report = await prepareReportQuery(client, device, { text: "only 3pm", conversational: true });
  const count = pages(tables, report.reportId).length;
  const repeated = await prepareReportQuery(client, device, { text: "repeat that", conversational: true,
    contextId: report.reportContextId, playbackId: report.reportId, playbackPage: count, lastSpokenPage: count - 1 });
  assert.equal(repeated.reportId, report.reportId);
  assert.equal(repeated.page, count - 1);
  const completed = await prepareReportQuery(client, device, { text: "continue", conversational: true,
    contextId: report.reportContextId, playbackId: report.reportId, playbackPage: count, lastSpokenPage: count - 1 });
  assert.notEqual(completed.reportId, report.reportId);
  assert.match(reportSpeech(tables, completed.reportId), /has finished/);
});

test("interrupted pages resume only the unfinished page and repeat the previous drained page", async () => {
  const { tables, client } = conversations();
  const report = await prepareReportQuery(client, device, { text: "full report", conversational: true });
  const repeated = await prepareReportQuery(client, device, { text: "repeat that", conversational: true,
    contextId: report.reportContextId, playbackId: report.reportId, playbackPage: 2, lastSpokenPage: 1 });
  assert.equal(repeated.page, 1);
  assert.equal(repeated.playbackMode, "repeat");
  assert.equal(context(tables, report.reportContextId).currentPage, 2);
  const resumed = await prepareReportQuery(client, device, { text: "continue", conversational: true,
    contextId: report.reportContextId, playbackId: report.reportId, playbackPage: 2, lastSpokenPage: 1 });
  assert.equal(resumed.reportId, report.reportId);
  assert.equal(resumed.page, 2);
});

for (const text of ["I'm done", "I\u2019m done", "that's all", "stop the report"]) {
  test(`${text} closes the conversational context and cancels pending approvals without sending`, async () => {
    const { tables, client } = conversations();
    const first = await prepareReportQuery(client, device, { text: "status report", conversational: true });
    tables.device_voice_prompts.push({ id: randomUUID(), user_id: device.userId, device_id: device.id, status: "pending" });
    const stopped = await prepareReportQuery(client, device, { text, conversational: true, contextId: first.reportContextId });
    assert.equal(stopped.intent, "report_stop");
    assert.match(stopped.speech || "", /Nothing has been sent/);
    assert.equal(context(tables, first.reportContextId).closed, true);
    assert.equal(tables.device_voice_prompts.some(row => row.status === "pending" || row.status === "executing"), false);
  });
}

test("report contexts are bounded, expire and never execute approval-like conversation", async () => {
  const { tables, client } = conversations();
  const first = await prepareReportQuery(client, device, { text: "only 3pm", conversational: true });
  for (let index = 0; index < 7; index++) await prepareReportQuery(client, device, {
    text: "what did they ask for?", conversational: true, contextId: first.reportContextId,
  });
  assert.equal((context(tables, first.reportContextId).recentQuestions as string[]).length, 4);
  const unclear = await prepareReportQuery(client, device, { text: "yes send that invitation", conversational: true, contextId: first.reportContextId });
  assert.match(reportSpeech(tables, unclear.reportId), /meeting time or person/);
  assert.equal(tables.device_voice_prompts.some(row => row.status === "executing"), false);
  context(tables, first.reportContextId).startedAt = Date.now() - 3 * 60 * 60 * 1000;
  const expired = await prepareReportQuery(client, device, { text: "third meeting", conversational: true, contextId: first.reportContextId });
  assert.match(reportSpeech(tables, expired.reportId), /expired/);
  assert.doesNotMatch(reportSpeech(tables, expired.reportId), /Client 3/);
});

test("optional conversational protocol fields preserve old binaries and validate cursor/generation inputs", () => {
  const old = reportProtocol(new Request("https://example.test"));
  assert.deepEqual(old, { contextId: undefined, playbackId: undefined, playbackPage: undefined });
  const generation = randomUUID();
  const request = new Request("https://example.test", { headers: {
    "x-quipus-report-mode": "conversation", "x-quipus-interaction-id": generation,
    "x-quipus-playback-page": "3", "x-quipus-last-spoken-page": "2",
  } });
  assert.deepEqual(reportProtocol(request), { ...old, playbackPage: 3, lastSpokenPage: 2, interactionId: generation, conversational: true });
  assert.throws(() => reportProtocol(new Request("https://example.test", { headers: { "x-quipus-last-spoken-page": "-1" } })));
});

test("an abandoned evidence query cannot overwrite a newer claimed meeting turn", async () => {
  const { tables, client } = conversations();
  const initial = await prepareReportQuery(client, device, { text: "only 3pm", conversational: true, interactionId: randomUUID() });
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const delayed = database(tables, { beforeQuery: async table => {
    if (table === "meeting_evidence") { entered(); await held; }
  } });
  const oldGeneration = randomUUID(), newGeneration = randomUUID();
  const abandoned = prepareReportQuery(delayed, device, {
    text: "what did they ask me to bring?", conversational: true,
    contextId: initial.reportContextId, interactionId: oldGeneration,
  });
  await waiting;
  const current = await prepareReportQuery(client, device, {
    text: "only 12pm", conversational: true, contextId: initial.reportContextId, interactionId: newGeneration,
  });
  assert.match(reportSpeech(tables, current.reportId), /Client 1/);
  const expected = structuredClone(context(tables, initial.reportContextId));
  release();
  await assert.rejects(abandoned, /cancelled or replaced/);
  assert.deepEqual(context(tables, initial.reportContextId), expected);
  assert.equal(context(tables, initial.reportContextId).activeInteractionId, newGeneration);
});

test("an older transcription result cannot reclaim the context after a newer command reserved it", async () => {
  const { tables, client } = conversations();
  const opening = await prepareReportQuery(client, device, { text: "status report", conversational: true, interactionId: randomUUID() });
  const contextId = opening.reportContextId!;
  const older = randomUUID(), newer = randomUUID();
  await claimReportTurn(client, device, contextId, older);
  await claimReportTurn(client, device, contextId, newer);
  const current = await prepareReportQuery(client, device, { text: "only 12pm", conversational: true,
    contextId, interactionId: newer, turnClaimed: true });
  const expected = structuredClone(context(tables, contextId));
  await assert.rejects(prepareReportQuery(client, device, { text: "only 3pm", conversational: true,
    contextId, interactionId: older, turnClaimed: true }), /cancelled or replaced/);
  assert.deepEqual(context(tables, contextId), expected);
  assert.match(reportSpeech(tables, current.reportId), /Client 1/);
});

test("turn claims cannot write a foreign owner/device context", async () => {
  const { tables, client } = conversations();
  const opening = await prepareReportQuery(client, device, { text: "status report", conversational: true, interactionId: randomUUID() });
  const before = structuredClone(tables.device_report_sessions);
  assert.equal(await claimReportTurn(client, { ...device, userId: "another-owner" }, opening.reportContextId!, randomUUID()), false);
  assert.equal(await claimReportTurn(client, { ...device, id: "another-board" }, opening.reportContextId!, randomUUID()), false);
  assert.deepEqual(tables.device_report_sessions, before);
});


test("unrecognized conversational turns emit report_clarify; valid selections and legacy reports stay report_answer", async () => {
  const { tables, client } = conversations();
  const opening = await prepareReportQuery(client, device, { text: "status report", conversational: true });
  assert.equal(opening.intent, "report_answer");
  const contextId = opening.reportContextId;
  for (const text of ["purple bananas", "unrelated background chatter"]) {
    const unclear = await prepareReportQuery(client, device, { text, contextId, conversational: true });
    assert.equal(unclear.intent, "report_clarify");
    assert.equal(unclear.reportContextId, contextId);
    assert.match(reportSpeech(tables, unclear.reportId), /Tell me the meeting time or person/);
    assert.equal(tables.device_voice_prompts.filter(row => row.status === "pending").length, 0);
  }
  // A meaningful turn remains available after consecutive unknown input; the
  // firmware controls its local inactivity limit, not a server lifetime cap.
  const selected = await prepareReportQuery(client, device, { text: "only 3pm", contextId, conversational: true });
  assert.equal(selected.intent, "report_answer");
  assert.match(reportSpeech(tables, selected.reportId), /Nigel|working demo/);
  const legacy = await prepareReportQuery(client, device, { text: "purple bananas" });
  assert.equal(legacy.intent, "report_answer");
});


test("1:37AM selects the same local-day meeting despite previous UTC date and recorded seconds", async t => {
  const { tables, client, today } = conversations();
  tables.meetings = [
    { ...tables.meetings[0], title: "Morning meeting", start_at: new Date(`${today}T01:37:58+08:00`).toISOString() },
    { ...tables.meetings[1], title: "Afternoon meeting", start_at: new Date(`${today}T13:37:12+08:00`).toISOString() },
    { ...tables.meetings[2], title: "Next-day meeting", start_at: new Date(`${shiftDate(today, 1)}T01:37:00+08:00`).toISOString() },
  ];
  assert.ok(String(tables.meetings[0].start_at).startsWith(`${shiftDate(today, -1)}T17:37:58`));
  const traces: unknown[][] = [];
  t.mock.method(console, "info", (...args: unknown[]) => { traces.push(args); });
  const opening = await prepareReportQuery(client, device, { text: "status report", conversational: true });
  assert.equal(opening.intent, "report_answer");
  assert.match(reportSpeech(tables, opening.reportId), /1:37 am|1:37 pm/);
  assert.doesNotMatch(reportSpeech(tables, opening.reportId), /Next-day meeting/);
  const morning = await prepareReportQuery(client, device, { text: "the meeting at 1:37AM", conversational: true, contextId: opening.reportContextId });
  assert.equal(morning.intent, "report_answer");
  assert.match(reportSpeech(tables, morning.reportId), /Morning meeting/);
  assert.doesNotMatch(reportSpeech(tables, morning.reportId), /Afternoon meeting|Next-day meeting/);
  assert.equal(context(tables, morning.reportContextId).date, today);
  const afternoon = await prepareReportQuery(client, device, { text: "the meeting at 1:37PM", conversational: true, contextId: opening.reportContextId });
  assert.equal(afternoon.intent, "report_answer");
  assert.match(reportSpeech(tables, afternoon.reportId), /Afternoon meeting/);
  assert.doesNotMatch(reportSpeech(tables, afternoon.reportId), /Morning meeting|Next-day meeting/);
  assert.deepEqual(traces, [
    ["Report time selection", { minute: 97, date: today, timezone: "Asia/Kuala_Lumpur", available: 2, matches: 1 }],
    ["Report time selection", { minute: 817, date: today, timezone: "Asia/Kuala_Lumpur", available: 2, matches: 1 }],
  ]);
});

test("missing or ambiguous targets ask for clarification and valid selection restores ordinary report intent", async () => {
  const { tables, client } = conversations();
  const opening = await prepareReportQuery(client, device, { text: "status report", conversational: true });
  for (const text of ["the meeting at 1:37AM", "the meeting with Someone Missing"]) {
    const miss = await prepareReportQuery(client, device, { text, conversational: true, contextId: opening.reportContextId });
    assert.equal(miss.intent, "report_clarify");
    assert.match(reportSpeech(tables, miss.reportId), /couldn't find a recorded meeting/);
    assert.equal(context(tables, miss.reportContextId).selectedIndex, -1);
  }
  const selected = await prepareReportQuery(client, device, { text: "only 3pm", conversational: true, contextId: opening.reportContextId });
  assert.equal(selected.intent, "report_answer");
  assert.match(reportSpeech(tables, selected.reportId), /working demo/);
  assert.equal(context(tables, selected.reportContextId).selectedIndex, 1);
});


test("an exact late-upload target refreshes one owned civil day without moving old ordinals or daily playback", async () => {
  const { tables, today } = conversations();
  let snapshots = 0;
  const client = database(tables, { beforeQuery: async table => { if (table === "meetings") snapshots++; } });
  const daily = await prepareReportQuery(client, device, { text: "full breakdown of my day", conversational: true });
  const before = structuredClone(context(tables, daily.reportContextId));
  const originalIds = tables.meetings.map(meeting => meeting.id);
  const arrival = { ...tables.meetings[0], id: "late-upload-137", title: "Newly uploaded meeting",
    recording_id: "late-upload-audio", start_at: new Date(`${today}T01:37:58+08:00`).toISOString() };
  tables.meetings.push(arrival);
  tables.meeting_insights.push({ user_id: device.userId, meeting_id: arrival.id, key_points: ["Bring the demo and calibration certificate."] });
  tables.transcripts.push({ user_id: device.userId, recording_id: arrival.recording_id });
  tables.meeting_contacts.push({ meeting_id: arrival.id, contacts: { name: "Alicia", user_id: device.userId } });
  tables.meeting_evidence.push({ user_id: device.userId, meeting_id: arrival.id, source_kind: "conversation",
    confidence: 0.99, importance: 5, statement: "Bring the calibration certificate.", quote: "Please bring the calibration certificate." });
  const selected = await prepareReportQuery(client, device, { text: "the meeting at 1:37AM", conversational: true,
    contextId: daily.reportContextId, playbackId: daily.reportId, playbackPage: 2, lastSpokenPage: 1 });
  assert.equal(selected.intent, "report_answer");
  assert.match(reportSpeech(tables, selected.reportId), /Newly uploaded meeting/);
  const after = context(tables, selected.reportContextId);
  assert.deepEqual((after.meetings as Row[]).map(meeting => meeting.id), [...originalIds, arrival.id]);
  assert.equal(after.selectedIndex, 3);
  assert.equal(after.dailyReportId, before.dailyReportId);
  assert.equal(after.dailyPage, 2);
  assert.deepEqual(after.dailyMeetings, before.dailyMeetings);
  assert.equal(snapshots, 2); // Original snapshot plus one same-day exact miss.
  const pronoun = await prepareReportQuery(client, device, { text: "what did they ask me to bring?", conversational: true,
    contextId: daily.reportContextId });
  assert.match(reportSpeech(tables, pronoun.reportId), /calibration certificate/);
  assert.doesNotMatch(reportSpeech(tables, pronoun.reportId), /Client 1|Client 2|Client 3/);
  const third = await prepareReportQuery(client, device, { text: "third meeting", conversational: true, contextId: daily.reportContextId });
  assert.match(reportSpeech(tables, third.reportId), /Client 3/);
  assert.doesNotMatch(reportSpeech(tables, third.reportId), /Newly uploaded meeting/);
  assert.equal(snapshots, 2);
  const resumed = await prepareReportQuery(client, device, { text: "continue my daily report", conversational: true, contextId: daily.reportContextId });
  assert.equal(resumed.reportId, daily.reportId);
  assert.equal(resumed.page, 2);
});

test("a newly identified person updates the existing slot without duplicate meetings or changing the saved daily snapshot", async () => {
  const { tables, client } = conversations();
  const daily = await prepareReportQuery(client, device, { text: "full breakdown of my day", conversational: true });
  const before = structuredClone(context(tables, daily.reportContextId));
  tables.meeting_contacts.push({ meeting_id: "m0", contacts: { name: "Alicia", user_id: device.userId } });
  const selected = await prepareReportQuery(client, device, { text: "the meeting with Alicia", conversational: true, contextId: daily.reportContextId });
  assert.equal(selected.intent, "report_answer");
  assert.match(reportSpeech(tables, selected.reportId), /Client 1/);
  const after = context(tables, selected.reportContextId);
  assert.deepEqual((after.meetings as Row[]).map(meeting => meeting.id), ["m0", "m1", "m2"]);
  assert.equal((after.meetings as Row[])[0].person, "Alicia");
  assert.equal(after.selectedIndex, 0);
  assert.deepEqual(after.dailyMeetings, before.dailyMeetings);
});

test("a target refresh never guesses another day, owner or nearby minute", async () => {
  const { tables, client, today } = conversations();
  const opening = await prepareReportQuery(client, device, { text: "status report", conversational: true });
  tables.meetings.push(
    { ...tables.meetings[0], id: "yesterday-137", title: "Other day", start_at: new Date(`${shiftDate(today, -1)}T01:37:00+08:00`).toISOString() },
    { ...tables.meetings[0], id: "foreign-137", title: "Foreign owner", user_id: "other-owner", start_at: new Date(`${today}T01:37:00+08:00`).toISOString() },
    { ...tables.meetings[0], id: "nearby-138", title: "Nearby minute", start_at: new Date(`${today}T01:38:00+08:00`).toISOString() },
  );
  const miss = await prepareReportQuery(client, device, { text: "the meeting at 1:37AM", conversational: true, contextId: opening.reportContextId });
  assert.equal(miss.intent, "report_clarify");
  assert.doesNotMatch(reportSpeech(tables, miss.reportId), /Other day|Foreign owner|Nearby minute/);
  assert.equal(context(tables, miss.reportContextId).date, today);
  assert.deepEqual((context(tables, miss.reportContextId).meetings as Row[]).map(meeting => meeting.id), ["m0", "m1", "m2"]);
});
