import { localDateKey } from "./device-briefing";
import { validTimezone } from "./quipus-profile";

export type ReportDepth = "quick" | "full" | "actions";
export interface ReportRequest {
  action: "query" | "continue" | "repeat" | "next" | "stop" | "unknown";
  date?: string;
  ordinal?: number;
  minute?: number;
  person?: string;
  depth?: ReportDepth;
  scope?: "day" | "select";
  question?: { topic: "bring" | "needs" | "decisions" | "next" | "concerns" | "people" | "detail"; text: string };
}
const ordinals: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const hourWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const clockNumbers: Record<string, number> = {
  zero: 0, oh: 0, o: 0, ...hourWords, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};
const clockTerm = `(?:\\d+|${Object.keys(clockNumbers).join("|")})`;
const clockTail = new RegExp(`\\b(${clockTerm}(?:[\\s:.-]+${clockTerm})*)\\s*$`, "u");
const malformedClockTail = new RegExp(`\\b${clockTerm}(?:[\\s-]+[\\p{L}\\p{N}]+){1,2}\\s*$`, "u");

/** Consume the whole clock phrase: never reinterpret "one thirty seven" as seven o'clock. */
function parseReportClock(command: string): { minute: number; starts: number[] } | "invalid" | undefined {
  // Keep character positions stable for distinguishing a clock from an ordinal.
  const text = command.replace(/\b\d{4}-\d{2}-\d{2}\b/gu, value => " ".repeat(value.length));
  const times: { minute: number; start: number; end: number }[] = [];
  for (const meridiem of text.matchAll(/(?<![a-z])(?:am|pm)(?![a-z])/gu)) {
    const before = text.slice(0, meridiem.index);
    const tail = before.match(clockTail);
    if (!tail) {
      // "one thirtyseven AM report" is an invalid clock, not permission
      // to read whichever meeting happened to be selected previously.
      if (malformedClockTail.test(before)) return "invalid";
      continue; // "I am" and "what am I to bring?" are not clocks.
    }
    const prefix = before.slice(0, tail.index).trimEnd();
    if (/[+:-]$/u.test(prefix) || /\b(?:or|past|to)$/u.test(prefix)) return "invalid";
    const phrase = tail[1].trim();
    let parts: string[];
    if (/[:.]/u.test(phrase)) {
      if (!/^\d{1,2}\s*[:.]\s*\d{2}$/u.test(phrase)) return "invalid";
      parts = phrase.split(/\s*[:.]\s*/u);
    } else parts = phrase.split(/[\s-]+/u);
    const number = (value: string) => /^\d+$/u.test(value) ? Number(value) : clockNumbers[value];
    const hour = number(parts[0]);
    let minute = 0;
    if (parts.length === 2) minute = number(parts[1]);
    else if (parts.length === 3) {
      const tens = number(parts[1]), units = number(parts[2]);
      if (!((tens === 0 || (tens >= 20 && tens <= 50 && tens % 10 === 0)) && units >= 1 && units <= 9)) return "invalid";
      minute = tens + units;
    } else if (parts.length !== 1) return "invalid";
    if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59)
      return "invalid";
    times.push({ minute: (hour % 12 + (meridiem[0] === "pm" ? 12 : 0)) * 60 + minute, start: tail.index!, end: meridiem.index + meridiem[0].length });
  }
  // An explicit malformed/missing-meridiem numeric clock must not disappear
  // just because other words such as "report" make the overall request valid.
  for (const marker of text.matchAll(/\b\d{1,2}\s*[:.]\s*[a-z\d:-]*/gu)) {
    if (!times.some(time => time.start <= marker.index && time.end >= marker.index + marker[0].length)) return "invalid";
  }
  if (!times.length) return undefined;
  if (new Set(times.map(time => time.minute)).size !== 1) return "invalid";
  return { minute: times[0].minute, starts: times.map(time => time.start) };
}

export function shiftDate(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}
export function isReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
/** Narrow report controls. This parser never creates or approves an action. */
export function parseReportRequest(text: string, timezone: string, now = new Date()): ReportRequest {
  if (text.length > 512) return { action: "unknown" };
  const command = text.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019]/gu, "'")
    .replace(/(?<!\p{L})([ap])\s*\.?\s*m\.?(?!\p{L})/gu, "$1m")
    .replace(/[\u2010-\u2015]/gu, "-").replace(/\s+/gu, " ")
    .replace(/\b(the|at)(?=\d{1,2}(?:[:.]\d{2})?\s*[ap]m\b)/gu, "$1 ").trim();
  if (/^(?:(?:computer|quipus)[, ]+)?(?:i'?m done|i am done|done|stop(?: (?:the|my))?(?: report)?|cancel(?: (?:the|my) report)?|end (?:the )?report|finish (?:the )?report|never mind|nevermind|that'?s all|thanks|thank you)[.!]?$/u.test(command)) return { action: "stop" };
  if (/\b(?:continue|resume)(?: my| the)?(?: daily| day| full)? report\b|^(?:continue|resume)[.!]?$/u.test(command)) {
    return { action: "continue", ...(/\b(?:daily|day|full) report\b/u.test(command) ? { scope: "day" as const } : {}) };
  }
  if (/\b(?:repeat that|say that again|repeat report)\b|^repeat[.!]?$/u.test(command)) return { action: "repeat" };
  if (/\bnext (?:meeting|conversation)\b/u.test(command)) return { action: "next" };
  const today = localDateKey(now, validTimezone(timezone));
  const request: ReportRequest = { action: "query" };
  const explicit = command.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) {
    if (!isReportDate(explicit[1])) return { action: "unknown" };
    request.date = explicit[1];
  } else if (/\bday before yesterday\b/.test(command)) request.date = shiftDate(today, -2);
  else if (/\b(?:yesterday|previous day|semalam)\b/.test(command)) request.date = shiftDate(today, -1);
  else if (/\b(?:today|hari ini)\b/.test(command)) request.date = today;
  else {
    const weekday = command.match(/\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekday) {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      request.date = shiftDate(today, -((dow - weekdays.indexOf(weekday[1]) + 7) % 7 || 7));
    }
  }
  const ordinal = command.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) (?:meeting|conversation)\b/)
    || command.match(/\b(?:meeting|conversation)(?: number)? (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/)
    || command.match(/^(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?: one)?[.!]?$/);
  if (ordinal) request.ordinal = ordinals[ordinal[1]] || hourWords[ordinal[1]] || parseInt(ordinal[1], 10);
  const clock = parseReportClock(command);
  if (clock === "invalid") return { action: "unknown" };
  if (clock) {
    request.minute = clock.minute;
    // "meeting one thirty-seven AM" names a time, not meeting number one.
    if (ordinal?.index !== undefined && clock.starts.some(start => start >= ordinal.index! && start < ordinal.index! + ordinal[0].length))
      delete request.ordinal;
  }
  const person = command.match(/\b(?:meeting|conversation)(?: i had)? with (.+?)(?:[?.!]|$)/)
    || command.match(/\bwhat did (.+?) (?:ask|want|say|need|promise|discuss)\b/);
  if (person) {
    const name = person[1].replace(/\b(?:today|yesterday|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gu, "").trim().slice(0, 100);
    if (!/^(?:they|them|he|him|she|her|we|us|i|me|you|the client|the contact|the person)$/u.test(name)) request.person = name;
  }
  if (/\b(?:what|who|when|how|remind me|did they|did he|did she)\b/u.test(command) && !/\bwhat (?:about|happened today)\b/u.test(command)) {
    const topic = /\b(?:bring|take along|prepare|pack)\b/u.test(command) ? "bring"
      : /\b(?:ask|want|need|request|require)\b/u.test(command) ? "needs"
      : /\b(?:decide|decided|decision|agree|agreed)\b/u.test(command) ? "decisions"
      : /\b(?:next|action|follow.up|promise|commitment)\b/u.test(command) ? "next"
      : /\b(?:concern|risk|worr|objection)\w*/u.test(command) ? "concerns"
      : /\b(?:who|people|attend|participant)\w*/u.test(command) ? "people" : "detail";
    request.question = { topic, text: text.trim().slice(0, 240) };
  }
  if (/\b(?:action items?|actions only|just the actions|follow[ -]?ups?)\b/.test(command)) request.depth = "actions";
  else if (/\b(?:full|detailed|breakdown|detail)\b/.test(command)) request.depth = "full";
  else if (/\b(?:quick|overview|brief|short|summary)\b/.test(command)) request.depth = "quick";
  if (/^(?:(?:computer|quipus)[, ]+)?(?:status report|status|laporan status)[.!]?$/u.test(command)) request.scope = "select";
  else if (/\b(?:whole day|full day|my day|all (?:my |the )?(?:meetings|conversations)|daily (?:report|briefing)|(?:full|complete|quick|short|detailed) report)\b/u.test(command) && !request.ordinal && request.minute === undefined && !request.person) request.scope = "day";
  if (!request.date && !request.ordinal && request.minute === undefined && !request.person && !request.depth && !request.question && !/\b(?:status|report|meetings|laporan)\b/u.test(command)) return { action: "unknown" };
  return request;
}

export interface SelectableMeeting { id: string; title: string; startAt: string; person?: string; }
export function selectReportMeetings<T extends SelectableMeeting>(meetings: T[], request: ReportRequest, timezone: string): T[] {
  if (request.ordinal !== undefined) return request.ordinal > 0 && request.ordinal <= meetings.length ? [meetings[request.ordinal - 1]] : [];
  return meetings.filter(meeting => {
    if (request.person) {
      const needle = request.person.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const haystack = `${meeting.person || ""} ${meeting.title}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
      if (!needle || !haystack.includes(needle)) return false;
    }
    if (request.minute !== undefined) {
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: validTimezone(timezone), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(meeting.startAt));
      const [hour, minute] = time.split(":").map(Number);
      if (hour * 60 + minute !== request.minute) return false;
    }
    return true;
  });
}
