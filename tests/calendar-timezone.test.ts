import assert from "node:assert/strict";
import test from "node:test";
import { calendarInstant, calendarRfc3339 } from "../lib/calendar-time";
import { hasCalendarGrants } from "../lib/google-connection";
import { GOOGLE_OAUTH_SCOPES, buildGoogleCalendarInsert } from "../lib/providers/google-calendar";

test("Calendar wall times use the selected user's zone, including DST", () => {
  assert.equal(
    new Date(calendarInstant("2026-10-20T14:00", "America/New_York")).toISOString(),
    "2026-10-20T18:00:00.000Z",
  );
  assert.equal(
    calendarRfc3339(calendarInstant("2026-10-20T14:00", "Europe/London"), "Europe/London"),
    "2026-10-20T14:00:00+01:00",
  );
});
test("nonexistent and ambiguous DST times require clarification", () => {
  assert.throws(() => calendarInstant("2026-03-08T02:30", "America/New_York"), /does not exist/);
  assert.throws(() => calendarInstant("2026-11-01T01:30", "America/New_York"), /twice/);
  assert.equal(
    new Date(calendarInstant("2026-11-01T01:30-04:00", "America/New_York")).toISOString(),
    "2026-11-01T05:30:00.000Z",
  );
});
test("invalid dates, offsets and timezone values fail closed", () => {
  for (const input of [
    "2026-02-30T10:00Z",
    "2026-13-01T10:00",
    "2026-01-01T25:00",
    "2026-01-01T10:00+25:00",
  ]) {
    assert.throws(() => calendarInstant(input));
  }
  assert.throws(() => calendarInstant("2026-01-01T10:00", "wrong"));
});
test("event timezone is preserved at provider boundary", () => {
  const event = buildGoogleCalendarInsert({
    approved: true,
    summary: "Demo",
    startAt: "2026-10-20T14:00",
    timeZone: "America/New_York",
    attendees: ["client@example.com"],
  });
  assert.equal(event.parameters.requestBody.start?.timeZone, "America/New_York");
  assert.equal(event.startAt, "2026-10-20T14:00:00-04:00");
});
test("partial Google consent is not reported as Calendar connected", () => {
  assert.equal(hasCalendarGrants([...GOOGLE_OAUTH_SCOPES]), true);
  assert.equal(hasCalendarGrants([GOOGLE_OAUTH_SCOPES[0]]), false);
  assert.equal(hasCalendarGrants(["https://www.googleapis.com/auth/calendar"]), true);
  assert.equal(hasCalendarGrants([]), false);
});
