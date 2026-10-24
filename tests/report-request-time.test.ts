import assert from "node:assert/strict";
import test from "node:test";
import { parseReportRequest, selectReportMeetings } from "../lib/report-request";

const timezone = "Asia/Kuala_Lumpur";
test("natural and STT-rendered minute selectors select 1:37 AM rather than their final spoken number", () => {
  for (const text of ["I want the 1:37am one", "the1:37AM one", "the 1:37 a.m. one", "1.37 am", "1 37 AM",
    "one thirty-seven a.m.", "I want the one thirty seven a.m. one", "one thirty-seven AM",
    "the meeting one thirty seven a. m.", "the meeting at 1:37AM", "at1:37AM", "one 37 am"]) {
    const request = parseReportRequest(text, timezone);
    assert.equal(request.action, "query", text);
    assert.equal(request.minute, 97, text);
    assert.equal(request.ordinal, undefined, text);
    assert.equal(request.date, undefined, "an undated time selector must retain its conversation day");
  }
});
test("spoken minute words and midnight/noon retain exact twelve-hour semantics", () => {
  for (const [text, minute] of [
    ["twelve am", 0], ["twelve oh one am", 1], ["twelve pm", 720],
    ["one oh seven am", 67], ["one zero seven pm", 787], ["one fifteen pm", 795],
    ["one thirty pm", 810], ["one forty-five pm", 825], ["one fifty nine pm", 839],
    ["11:59PM", 1439], ["at two pm", 840],
  ] as const) assert.equal(parseReportRequest(text, timezone).minute, minute, text);
});
test("malformed or conflicting clocks never fall back to a valid-looking suffix", () => {
  for (const text of ["one sixty seven am", "one thirty seventy am", "one hundred am", "thirteen am", "0:37am", "13:37am",
    "1:60am", "1:7am", "-1:37am", "one twenty seven eight am", "1:37am or 2:00am", "one or two am",
    "quarter past one am", "one thirty seven am or one thirty eight am", "the 1:37 one",
    "one thirtyseven AM report", "1:xxAM report", "the report at 1:xx AM", "report at 1:37", "1:37am or 2:xxam report"]) {
    assert.equal(parseReportRequest(text, timezone).action, "unknown", text);
  }
});
test("explicit dates stay explicit while an ordinal outside the clock is preserved", () => {
  const now = new Date("2026-10-25T01:00:00Z");
  const previous = parseReportRequest("yesterday at one thirty seven am", timezone, now);
  assert.equal(previous.date, "2026-10-24"); assert.equal(previous.minute, 97);
  const dated = parseReportRequest("2026-10-24 1:37am", timezone, now);
  assert.equal(dated.date, "2026-10-24"); assert.equal(dated.minute, 97);
  const ordinal = parseReportRequest("the second meeting at 1:37am", timezone);
  assert.equal(ordinal.ordinal, 2); assert.equal(ordinal.minute, 97);
});
test("en-MY displayed minutes match exact local minutes including seconds, never adjacent minutes or another timezone", () => {
  const meetings = [
    { id: "a", title: "First", startAt: "2026-10-24T17:37:01Z" },
    { id: "b", title: "Second", startAt: "2026-10-24T17:37:59Z" },
    { id: "early", title: "Earlier", startAt: "2026-10-24T17:36:59Z" },
    { id: "late", title: "Later", startAt: "2026-10-24T17:38:00Z" },
    { id: "afternoon", title: "PM", startAt: "2026-10-25T05:37:00Z" },
  ];
  const displayed = new Intl.DateTimeFormat("en-MY", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(meetings[0].startAt));
  const request = parseReportRequest(`I want the ${displayed} one`, timezone);
  assert.equal(request.minute, 97);
  assert.deepEqual(selectReportMeetings(meetings, request, timezone).map(item => item.id), ["a", "b"], "same-minute ambiguity must remain unresolved");
  assert.deepEqual(selectReportMeetings(meetings, request, "UTC"), []);
});

test("ordinary questions containing the verb am are still questions rather than malformed clocks", () => {
  const request = parseReportRequest("what am I supposed to bring?", timezone);
  assert.equal(request.action, "query");
  assert.equal(request.minute, undefined);
  assert.equal(request.question?.topic, "bring");
});
