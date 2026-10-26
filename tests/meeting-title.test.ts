import assert from "node:assert/strict";
import test from "node:test";
import { isPlaceholderMeetingTitle, MEETING_TITLE_MAX_LENGTH, normalizeMeetingTitle, selectMeetingTitle } from "../lib/meeting-title";

const startAt = "2026-10-13T06:00:00Z";

test("generated topic titles replace capture and speaker placeholders", () => {
  const topic = "Bangsar branch pilot planning";
  for (const placeholder of ["Speaker 1", "speaker1", "Unknown speaker", "Conversation 1", "Conversation1", "Recorded conversation", "Business conversation", "Meeting", "Conversation \u00b7 2026-10-13 14:00", "Conversation \u00c3\u0192\u00e2\u20ac\u0161\u00c3\u201a\u00c2\u00b7 2026-10-13 14:00"]) {
    assert.equal(isPlaceholderMeetingTitle(placeholder), true, placeholder);
    assert.equal(selectMeetingTitle({ preferredTitle: placeholder, generatedTitle: topic, startAt }), topic);
  }
});

test("an explicit meaningful title wins over an automatic topic", () => {
  for (const title of [
    "Renewal plan with Chung", "Conversation about retail pricing", "Meeting with Chung",
    "Meeting: quarterly budget review", "Conversation - pricing discussion",
    "Conversation-pricing", "Meeting 2026 strategy review",
    "Conversation 2026-10-13 14:00 budget review", "Speaker 1 - quarterly pricing review",
  ]) {
    assert.equal(isPlaceholderMeetingTitle(title), false, title);
    assert.equal(selectMeetingTitle({ preferredTitle: title, generatedTitle: "Pilot discussion", startAt }), title);
  }
});

test("missing topics use the local capture date and time, never a guessed subject", () => {
  const fallback = selectMeetingTitle({ generatedTitle: null, startAt });
  assert.equal(fallback, "Meeting \u00b7 13 Oct 2026 2:00 pm");
  assert.equal(isPlaceholderMeetingTitle(fallback), true);
  assert.equal(selectMeetingTitle({ startAt, timeZone: "UTC" }), "Meeting \u00b7 13 Oct 2026 6:00 am");
  assert.equal(selectMeetingTitle({ generatedTitle: "Participant 2", startAt: "invalid" }), "Meeting");
  assert.equal(selectMeetingTitle({ startAt, timeZone: "invalid" }), selectMeetingTitle({ startAt }));
});

test("title normalization keeps multilingual text compact and bounded", () => {
  assert.equal(normalizeMeetingTitle("  Bangsar\n  pilot\t review  "), "Bangsar pilot review");
  assert.equal(normalizeMeetingTitle("\u516c\u53f8\u9500\u552e\u5408\u4f5c\u8ba8\u8bba"), "\u516c\u53f8\u9500\u552e\u5408\u4f5c\u8ba8\u8bba");
  const source = "Retail pilot expansion and implementation planning ".repeat(6);
  const title = normalizeMeetingTitle(source);
  assert.ok(title && title.length <= MEETING_TITLE_MAX_LENGTH);
  assert.ok(title.startsWith("Retail pilot expansion"));
  assert.equal(source[title.length], " ", "bounded titles end at a word boundary");
  for (const value of [null, undefined, {}, "", "   ", "Speaker 1", "Untitled"]) assert.equal(normalizeMeetingTitle(value), null);
});
