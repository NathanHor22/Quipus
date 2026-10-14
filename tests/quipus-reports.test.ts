import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReportRequest, selectReportMeetings } from "../lib/report-request";
import { personalGreeting, firstName, validTimezone } from "../lib/quipus-profile";
import { prepareReportQuery, reportSections, type ReportState } from "../lib/device-report-session";
import type { AuthenticatedLantern } from "../lib/lantern-device-auth";

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

type Row = Record<string, unknown>;
type QueryResult = { data: Row | Row[] | null; error: null };
type Query = {
  select: () => Query;
  order: (key: string) => Query;
  eq: (key: string, value: unknown) => Query;
  neq: (key: string, value: unknown) => Query;
  in: (key: string, values: unknown[]) => Query;
  gt: (key: string, value: string) => Query;
  gte: (key: string, value: string) => Query;
  lt: (key: string, value: string) => Query;
  insert: (row: Row) => Query;
  upsert: (row: Row) => Query;
  update: (row: Row) => Query;
  single: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
};
function reportSpeech(tables: Record<string, Row[]>, reportId: string | undefined) {
  const pages = tables.device_reports.find(row => row.id === reportId)?.pages;
  assert.ok(Array.isArray(pages) && pages.every((page: unknown) => typeof page === "string"));
  return pages.join(" ");
}
function database(tables: Record<string, Row[]>) {
  return { from(table: string) {
    const filters: ((row: Row) => boolean)[] = []; let changes: Row | undefined; let inserted: Row | undefined;
    let upsert = false; const orders: string[] = [];
    const execute = (single = false) => {
      tables[table] ||= [];
      if (inserted) {
        const existing = upsert && tables[table].find(row => row.id === inserted!.id);
        if (existing) Object.assign(existing, structuredClone(inserted));
        else tables[table].push({ id: randomUUID(), expires_at: new Date(Date.now()+7200000).toISOString(), status: "pending", ...structuredClone(inserted) });
      }
      let rows = tables[table].filter(row => filters.every(filter => filter(row)));
      if (inserted) rows = rows.filter(row => row.id === inserted!.id || (!inserted!.id && row === tables[table].at(-1)));
      for (const row of rows) if (changes) Object.assign(row, changes);
      rows.sort((a,b) => { for (const key of orders) { const diff = String(a[key]).localeCompare(String(b[key])); if (diff) return diff; } return 0; });
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    };
    const q: Query = {
      select: () => q, order: (key: string) => { orders.push(key); return q; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
      gt: (key: string, value: string) => { filters.push(row => typeof row[key] === "string" && row[key] > value); return q; },
      gte: (key: string, value: string) => { filters.push(row => typeof row[key] === "string" && row[key] >= value); return q; },
      lt: (key: string, value: string) => { filters.push(row => typeof row[key] === "string" && row[key] < value); return q; },
      insert: (row: Row) => { inserted = row; return q; }, upsert: (row: Row) => { inserted = row; upsert = true; return q; },
      update: (row: Row) => { changes = row; return q; },
      single: async () => execute(true), maybeSingle: async () => execute(true),
      then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(execute()).then(resolve),
    }; return q;
  } } as unknown as SupabaseClient;
}
const device: AuthenticatedLantern = { id: "board-a", userId: "owner-a", name: "Quipus", state: "ready", stateVersion: 1 };
function fixtures() {
  const tables: Record<string, Row[]> = { profiles: [{ id: device.userId, timezone: "Asia/Kuala_Lumpur" }], meetings: [], meeting_insights: [], transcripts: [], device_voice_prompts: [] };
  for (let i = 0; i < 3; i++) {
    tables.meetings.push({ id: `m${i}`, user_id: device.userId, title: `Client ${i+1}`, start_at: `2026-09-21T0${i+1}:00:00Z`, status: "ready", recording_id: `r${i}`, source: "hardware" });
    tables.meeting_insights.push({ user_id: device.userId, meeting_id: `m${i}`, key_points: ["Point one.", "Point two.", `Final detail ${i+1}.`], promised: "A proposal." });
    tables.transcripts.push({ user_id: device.userId, recording_id: `r${i}` });
  }
  return { tables, client: database(tables) };
}
test("report snapshots keep the third meeting stable after a late upload and resume the paused page", async () => {
  const { tables, client } = fixtures();
  const daily = await prepareReportQuery(client, device, { text: "full report for 2026-09-21" });
  tables.meetings.unshift({ ...tables.meetings[0], id: "late", start_at: "2026-09-21T00:00:00Z" });
  const targeted = await prepareReportQuery(client, device, { text: "only the third meeting", contextId: daily.reportContextId, playbackId: daily.reportId, playbackPage: 2 });
  const speech = reportSpeech(tables, targeted.reportId);
  assert.match(speech, /Client 3/); assert.match(speech, /Final detail 3/); assert.doesNotMatch(speech, /Client 2/);
  const resume = await prepareReportQuery(client, device, { text: "continue my daily report", contextId: daily.reportContextId, playbackId: targeted.reportId, playbackPage: 1 });
  assert.equal(resume.reportId, daily.reportId); assert.equal(resume.page, 2);
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
