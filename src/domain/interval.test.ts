import { describe, expect, it } from "vitest";

import { DomainValidationError, containsInterval, durationMinutes, intervalsOverlap, isSupportedTimeZone } from "./index.js";

const interval = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

describe("half-open time intervals", () => {
  it("accepts adjacent assignments without overlap", () => {
    expect(
      intervalsOverlap(
        interval("2026-10-30T04:00:00.000Z", "2026-10-30T05:00:00.000Z"),
        interval("2026-10-30T05:00:00.000Z", "2026-10-30T06:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("detects a genuine overlap", () => {
    expect(
      intervalsOverlap(
        interval("2026-10-30T04:00:00.000Z", "2026-10-30T05:30:00.000Z"),
        interval("2026-10-30T05:00:00.000Z", "2026-10-30T06:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("requires a valid non-empty interval", () => {
    expect(() => durationMinutes(interval("2026-10-30T05:00:00.000Z", "2026-10-30T05:00:00.000Z"))).toThrow(
      DomainValidationError,
    );
  });

  it("checks complete containment and duration", () => {
    const day = interval("2026-10-30T04:00:00.000Z", "2026-10-30T12:00:00.000Z");
    const visit = interval("2026-10-30T05:00:00.000Z", "2026-10-30T06:30:00.000Z");

    expect(containsInterval(day, visit)).toBe(true);
    expect(durationMinutes(visit)).toBe(90);
  });

  it("validates IANA timezones", () => {
    expect(isSupportedTimeZone("Asia/Kolkata")).toBe(true);
    expect(isSupportedTimeZone("not/a-timezone")).toBe(false);
  });
});
