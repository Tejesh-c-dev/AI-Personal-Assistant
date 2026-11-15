import { describe, expect, it } from "vitest";
import { createTrustedTimeContext, isValidIanaTimezone, resolveCalendarTime } from "./trusted-time";

describe("trusted scheduling time", () => {
  const fixed = () => new Date("2026-01-01T01:30:00.000Z");
  it("derives independent local dates from one fixed instant", () => {
    expect(createTrustedTimeContext("America/Los_Angeles", fixed)).toMatchObject({ localDate: "2025-12-31", localTime: "17:30:00", weekday: "Wednesday", utcOffset: "-08:00" });
    expect(createTrustedTimeContext("Asia/Tokyo", fixed)).toMatchObject({ localDate: "2026-01-01", localTime: "10:30:00", weekday: "Thursday", utcOffset: "+09:00" });
  });
  it("validates browser zones and honors a separate event zone", () => {
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
    expect(isValidIanaTimezone("Mars/Olympus")).toBe(false);
    const result = resolveCalendarTime({ reference: createTrustedTimeContext("Asia/Tokyo", fixed), date: "2026-01-02", time: "12:00", timezone: "America/New_York" });
    expect(result).toMatchObject({ ok: true, value: { timezone: "America/New_York", startDateTime: "2026-01-02T12:00:00-05:00", durationMinutes: 30, durationSource: "inferred" } });
  });
  it("applies default durations and keeps explicitly chosen duration", () => {
    const ref = createTrustedTimeContext("UTC", () => new Date("2026-01-01T00:00:00Z"));
    expect(resolveCalendarTime({ reference: ref, date: "2026-01-01", time: "12:00" })).toMatchObject({ ok: true, value: { localStart: "2026-01-01T12:00", localEnd: "2026-01-01T12:30", durationMinutes: 30 } });
    expect(resolveCalendarTime({ reference: ref, date: "2026-01-01", time: "01:00", kind: "alarm" })).toMatchObject({ ok: true, value: { localEnd: "2026-01-01T01:01", durationMinutes: 1 } });
    expect(resolveCalendarTime({ reference: ref, date: "2026-01-01", time: "12:00", durationMinutes: 90 })).toMatchObject({ ok: true, value: { localEnd: "2026-01-01T13:30", durationSource: "explicit" } });
  });
  it("resolves 12 AM and 12 PM local clock values on dates that cross midnight", () => {
    const ref = createTrustedTimeContext("America/Los_Angeles", () => new Date("2026-01-01T07:30:00Z"));
    expect(resolveCalendarTime({ reference: ref, date: "2026-01-01", time: "00:00" })).toMatchObject({ ok: true, value: { localStart: "2026-01-01T00:00" } });
    expect(resolveCalendarTime({ reference: ref, date: "2026-01-01", time: "12:00" })).toMatchObject({ ok: true, value: { localStart: "2026-01-01T12:00" } });
  });
  it("rejects past same-day times and DST gaps or overlaps", () => {
    const ref = createTrustedTimeContext("America/New_York", () => new Date("2026-03-08T12:00:00Z"));
    expect(resolveCalendarTime({ reference: ref, date: "2026-03-08", time: "08:00" }).ok).toBe(false);
    expect(resolveCalendarTime({ reference: ref, date: "2026-03-08", time: "02:30" })).toMatchObject({ ok: false, message: expect.stringContaining("does not exist") });
    expect(resolveCalendarTime({ reference: ref, date: "2026-11-01", time: "01:30" })).toMatchObject({ ok: false, message: expect.stringContaining("occurs twice") });
  });
});
