import type { Meeting } from "./types";
import { personalGreeting, validTimezone } from "./quipus-profile";
import { workspaceTime } from "./workspace-time";

type GreetingInput = {
  displayName?: string | null;
  date: Date;
  timezone: string;
  meetings: Meeting[];
  pendingCount: number;
  sample?: boolean;
  loading?: boolean;
};

/** Only use a chosen profile name; never guess a name from an email address. */
function greetingName(value?: string | null): string | null {
  const clean = (value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean && !clean.includes("@") ? clean : null;
}

/** Count scheduled meetings that are still ahead, in the account's own day. */
export function workspaceGreeting(input: GreetingInput) {
  const timezone = validTimezone(input.timezone);
  const { dateKey } = workspaceTime(timezone);
  const today = dateKey(input.date);
  const meetingsToday = input.meetings.filter(meeting => {
    const start = Date.parse(meeting.startAt);
    const end = Date.parse(meeting.endAt);
    return (meeting.source === "calendar" || meeting.status === "upcoming")
      && Number.isFinite(start) && Number.isFinite(end)
      && end > input.date.getTime() && dateKey(meeting.startAt) === today;
  }).length;
  const pendingCount = Number.isFinite(input.pendingCount) ? Math.max(0, Math.floor(input.pendingCount)) : 0;
  const title = personalGreeting(greetingName(input.displayName), input.date, timezone);
  const facts = [
    meetingsToday ? `${meetingsToday} meeting${meetingsToday === 1 ? "" : "s"} ahead today.` : "",
    pendingCount ? `${pendingCount} follow-up${pendingCount === 1 ? "" : "s"} ready for review.` : "",
  ].filter(Boolean).join(" ");
  const detail = input.loading ? "Your day, in focus."
    : input.sample ? `Explore the sample workspace.${facts ? ` ${facts}` : ""}`
    : facts || "Make your next conversation count.";
  return { title, detail, meetingsToday, pendingCount };
}
