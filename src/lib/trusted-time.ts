export interface TrustedTimeContext {
  referenceInstant: string;
  timezone: string;
  localDate: string;
  localTime: string;
  utcOffset: string;
  weekday: string;
}

export function isValidIanaTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || !timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0);
    return true;
  } catch { return false; }
}

function partsAt(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function createTrustedTimeContext(timezone: string, clock: () => Date = () => new Date()): TrustedTimeContext {
  if (!isValidIanaTimezone(timezone)) throw new Error("Invalid IANA timezone");
  const instant = clock();
  const parts = partsAt(instant, timezone);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  const offsetMinutes = Math.round((Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - instant.getTime()) / 60000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return {
    referenceInstant: instant.toISOString(), timezone, localDate, localTime,
    utcOffset: `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`,
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(instant),
  };
}

export interface ResolvedCalendarTime {
  referenceInstant: string;
  timezone: string;
  localStart: string;
  localEnd: string;
  startDateTime: string;
  endDateTime: string;
  durationMinutes: number;
  durationSource: "explicit" | "inferred";
}

function localParts(date: string, time: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !tm) return null;
  const [, y, mo, d] = match.map(Number);
  const [, h, m] = tm.map(Number);
  const test = new Date(Date.UTC(y, mo - 1, d, h, m));
  if (test.getUTCFullYear() !== y || test.getUTCMonth() !== mo - 1 || test.getUTCDate() !== d || h > 23 || m > 59) return null;
  return { y, mo, d, h, m };
}

function matchesLocal(instant: Date, timezone: string, expected: string) {
  const p = partsAt(instant, timezone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === expected;
}

function resolveLocal(date: string, time: string, timezone: string): Date | "nonexistent" | "ambiguous" | null {
  if (!localParts(date, time)) return null;
  const expected = `${date}T${time}`;
  const naive = Date.parse(`${expected}:00Z`);
  const matches: Date[] = [];
  for (let delta = -14 * 60; delta <= 14 * 60; delta++) {
    const candidate = new Date(naive + delta * 60000);
    if (matchesLocal(candidate, timezone, expected)) matches.push(candidate);
  }
  if (matches.length === 0) return "nonexistent";
  if (matches.length > 1) return "ambiguous";
  return matches[0];
}

export type CalendarResolution = { ok: true; value: ResolvedCalendarTime } | { ok: false; message: string };

export function resolveCalendarTime(input: {
  reference: TrustedTimeContext; date: string; time: string; timezone?: string;
  durationMinutes?: number; kind?: "event" | "alarm" | "reminder";
}): CalendarResolution {
  const timezone = input.timezone || input.reference.timezone;
  if (!isValidIanaTimezone(timezone)) return { ok: false, message: "The event timezone is invalid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time) || !localParts(input.date, input.time)) return { ok: false, message: "Use a valid local event date (YYYY-MM-DD) and 24-hour time (HH:mm)." };
  const duration = input.durationMinutes ?? (input.kind === "alarm" || input.kind === "reminder" ? 1 : 30);
  if (!Number.isInteger(duration) || duration < 1 || duration > 10080) return { ok: false, message: "Event duration must be between 1 minute and 7 days." };
  const start = resolveLocal(input.date, input.time, timezone);
  if (start === "nonexistent") return { ok: false, message: `That local time does not exist in ${timezone} because of a daylight saving transition. Ask the user to choose another time.` };
  if (start === "ambiguous") return { ok: false, message: `That local time occurs twice in ${timezone} because of a daylight saving transition. Ask the user which occurrence they mean.` };
  if (!start) return { ok: false, message: "The event date or time is invalid." };
  const referenceDateInEventZone = partsAt(new Date(input.reference.referenceInstant), timezone);
  const eventZoneToday = `${referenceDateInEventZone.year}-${referenceDateInEventZone.month}-${referenceDateInEventZone.day}`;
  if (input.date === eventZoneToday && start.getTime() <= Date.parse(input.reference.referenceInstant)) return { ok: false, message: "That time today has already passed. Ask whether the user meant tomorrow; do not move it automatically." };
  const end = new Date(start.getTime() + duration * 60000);
  const endParts = partsAt(end, timezone);
  const localEnd = `${endParts.year}-${endParts.month}-${endParts.day}T${endParts.hour}:${endParts.minute}`;
  return { ok: true, value: {
    referenceInstant: input.reference.referenceInstant, timezone,
    localStart: `${input.date}T${input.time}`, localEnd,
    startDateTime: rfc3339InZone(start, timezone),
    endDateTime: rfc3339InZone(end, timezone),
    durationMinutes: duration, durationSource: input.durationMinutes === undefined ? "inferred" : "explicit",
  } };
}

function offsetFor(instant: Date, timezone: string) {
  const p = partsAt(instant, timezone);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const mins = Math.round((wall - instant.getTime()) / 60000);
  const sign = mins < 0 ? "-" : "+"; const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function rfc3339InZone(instant: Date, timezone: string) {
  const p = partsAt(instant, timezone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offsetFor(instant, timezone)}`;
}
