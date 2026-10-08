import test from "node:test";
import assert from "node:assert/strict";
import type { Meeting } from "../lib/types";
import { workspaceGreeting } from "../lib/workspace-greeting";

const scheduled = (id: string, startAt: string, endAt: string): Meeting => ({
  id, startAt, endAt, title: "Client meeting", source: "calendar", status: "upcoming", contacts: [],
});

test("greetings use profile time and name without guessing a name from an email", () => {
  const base = { date: new Date("2026-10-08T02:00:00Z"), meetings: [], pendingCount: 0 };
  assert.equal(workspaceGreeting({ ...base, displayName: "  Nathan Hor  ", timezone: "Asia/Kuala_Lumpur" }).title, "Good morning, Nathan.");
  assert.equal(workspaceGreeting({ ...base, displayName: "nathan@example.com", timezone: "America/Los_Angeles" }).title, "Good evening.");
  assert.equal(workspaceGreeting({ ...base, displayName: "", timezone: "invalid-zone" }).title, "Good morning.");
});

test("the day summary excludes past, next-day and recorded conversations in the selected timezone", () => {
  const meetings = [
    scheduled("ended", "2026-10-08T00:00:00Z", "2026-10-08T01:00:00Z"),
    scheduled("ongoing", "2026-10-08T01:30:00Z", "2026-10-08T02:30:00Z"),
    scheduled("later", "2026-10-08T06:00:00Z", "2026-10-08T07:00:00Z"),
    scheduled("tomorrow", "2026-10-08T17:00:00Z", "2026-10-08T18:00:00Z"),
    { ...scheduled("recorded", "2026-10-08T06:00:00Z", "2026-10-08T07:00:00Z"), source: "hardware" as const, status: "ready" as const },
    scheduled("invalid", "invalid", "invalid"),
  ];
  const greeting = workspaceGreeting({ displayName: "Nathan", date: new Date("2026-10-08T02:00:00Z"), timezone: "Asia/Kuala_Lumpur", meetings, pendingCount: 1 });
  assert.equal(greeting.meetingsToday, 2);
  assert.equal(greeting.detail, "2 meetings ahead today. 1 follow-up ready for review.");
});

test("loading and sample summaries do not imply real user activity or completed deals", () => {
  const base = { date: new Date("2026-10-08T02:00:00Z"), timezone: "Asia/Kuala_Lumpur", meetings: [], pendingCount: 2 };
  assert.equal(workspaceGreeting({ ...base, loading: true }).detail, "Your day, in focus.");
  assert.equal(workspaceGreeting({ ...base, sample: true }).detail, "Explore the sample workspace. 2 follow-ups ready for review.");
  assert.equal(workspaceGreeting({ ...base, pendingCount: 0 }).detail, "Make your next conversation count.");
});
