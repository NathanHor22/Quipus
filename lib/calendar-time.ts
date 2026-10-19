/** Wall-clock conversion rejects DST gaps and ambiguity rather than guessing. */
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u;
const OFFSET = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:\d{2})$/u;

export function assertTimeZone(zone: string): string {
  if (!zone || zone.length > 100) throw new RangeError("Invalid calendar timezone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
  } catch {
    throw new RangeError("Invalid calendar timezone.");
  }
  return zone;
}

function fields(epoch: number, timeZone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epoch);
  return ["year", "month", "day", "hour", "minute", "second"].map((key) =>
    Number(parts.find((part) => part.type === key)?.value),
  );
}

function localAnchor(value: string): number {
  const match = LOCAL.exec(value);
  if (!match) throw new RangeError("Use an ISO calendar date and time.");
  const values = match.slice(1, 7).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = values;
  const epoch = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    Number((match[7] ?? "").padEnd(3, "0")),
  );
  const date = new Date(epoch);
  if (
    year < 1000 ||
    year > 9999 ||
    [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ].some((part, index) => part !== values[index])
  ) {
    throw new RangeError("Invalid calendar date and time.");
  }
  return epoch;
}

function offsetAt(epoch: number, zone: string): number {
  const [y, m, d, h, min, s] = fields(epoch, zone);
  return Date.UTC(y, m - 1, d, h, min, s) - Math.floor(epoch / 1000) * 1000;
}

export function calendarInstant(value: string, zone = "Asia/Kuala_Lumpur"): number {
  assertTimeZone(zone);
  const trimmed = value.trim();
  const explicit = OFFSET.exec(trimmed);
  if (explicit) {
    const anchor = localAnchor(explicit[1]);
    if (explicit[2] === "Z") return anchor;
    const hours = Number(explicit[2].slice(1, 3));
    const minutes = Number(explicit[2].slice(4, 6));
    if (hours > 23 || minutes > 59) throw new RangeError("Invalid UTC offset.");
    return anchor - (explicit[2][0] === "+" ? 1 : -1) * (hours * 60 + minutes) * 60_000;
  }
  const anchor = localAnchor(trimmed);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36])
    offsets.add(offsetAt(anchor + delta * 3_600_000, zone));
  const expected = new Date(anchor)
    .toISOString()
    .slice(0, 19)
    .replace("T", "-")
    .replaceAll(":", "-")
    .split("-")
    .join("|");
  const candidates = [...offsets]
    .map((offset) => anchor - offset)
    .filter(
      (epoch) =>
        fields(epoch, zone)
          .map((part, i) => String(part).padStart(i === 0 ? 4 : 2, "0"))
          .join("|") === expected,
    );
  if (candidates.length !== 1)
    throw new RangeError(
      candidates.length
        ? "This time occurs twice. Include its UTC offset."
        : "This local time does not exist in this timezone.",
    );
  return candidates[0];
}

export function calendarRfc3339(epoch: number, zone = "Asia/Kuala_Lumpur"): string {
  assertTimeZone(zone);
  if (!Number.isFinite(epoch)) throw new RangeError("Invalid calendar instant.");
  const values = fields(epoch, zone).map((part, i) => String(part).padStart(i === 0 ? 4 : 2, "0"));
  const offset = Math.round(offsetAt(epoch, zone) / 60_000);
  const sign = offset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return (
    values.slice(0, 3).join("-") + "T" + values.slice(3).join(":") + sign + hours + ":" + minutes
  );
}
