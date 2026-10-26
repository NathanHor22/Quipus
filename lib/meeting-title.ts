import { validTimezone } from "./quipus-profile";

export const MEETING_TITLE_MAX_LENGTH = 80;

/** Device labels and diarization placeholders are not subjects for a meeting. */
export function isPlaceholderMeetingTitle(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  const title = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (/^(?:speaker|participant)\s*#?\s*\d+$/iu.test(title)
    || /^(?:unknown|unidentified)(?:\s+(?:speaker|participant|person|contact))?(?:\s*\d+)?$/iu.test(title)
    || /^(?:not identified|untitled|new recording)$/iu.test(title)
    // Older firmware writes have a mis-decoded middle-dot before the ISO date.
    || /^(?:meeting|conversation|recording|session)\s+(?:\S*[\u00c2\u00c3]\S*\s+)?\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:[ap]m|Z|[+-]\d{2}:\d{2}))?)?$/iu.test(title)) return true;
  const generic = /^(?:(?:recorded|uploaded|business|new)\s+)?(?:meeting|conversation|recording|audio|session)(.*)$/iu.exec(title);
  if (!generic) return false;
  const suffix = generic[1].trim().replace(/^[-:#\u00b7\u2013\u2014]\s*/u, "");
  // A topic after a generic prefix is still a meaningful owner-authored title.
  // Only the bare label, a counter, or a concrete capture date/time is generic.
  return !suffix
    || /^\d+$/u.test(suffix)
    || /^\d{1,2}:\d{2}(?:\s*[ap]m)?$/iu.test(suffix)
    || /^\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:[ap]m|Z|[+-]\d{2}:\d{2}))?)?$/iu.test(suffix)
    || /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\s+\d{4}(?:\s+\d{1,2}:\d{2}(?:\s*[ap]m)?)?$/iu.test(suffix);
}

/** Bounds a generated title without making the rest of a valid recap fail. */
export function normalizeMeetingTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").replace(/\p{Cc}+/gu, " ").replace(/\s+/gu, " ").trim();
  if (isPlaceholderMeetingTitle(text)) return null;
  if (text.length <= MEETING_TITLE_MAX_LENGTH) return text;
  let end = MEETING_TITLE_MAX_LENGTH;
  // Avoid cutting a UTF-16 surrogate pair. Prefer a word boundary for spaced text.
  const lastUnit = text.charCodeAt(end - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) end--;
  const clipped = text.slice(0, end);
  const boundary = clipped.lastIndexOf(" ");
  return (boundary > MEETING_TITLE_MAX_LENGTH / 2 ? clipped.slice(0, boundary) : clipped).trim();
}

type MeetingTitleOptions = {
  generatedTitle?: unknown;
  preferredTitle?: unknown;
  startAt: string;
  timeZone?: string;
};

/** Explicit user names win; all capture providers share the same neutral fallback. */
export function selectMeetingTitle({ generatedTitle, preferredTitle, startAt, timeZone }: MeetingTitleOptions): string {
  const title = normalizeMeetingTitle(preferredTitle) || normalizeMeetingTitle(generatedTitle);
  if (title) return title;
  const date = new Date(startAt);
  if (!Number.isFinite(date.getTime())) return "Meeting";
  const zone = validTimezone(timeZone);
  const label = new Intl.DateTimeFormat("en-MY", { timeZone: zone, day: "numeric", month: "short", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-MY", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  return `Meeting \u00b7 ${label} ${time}`;
}
