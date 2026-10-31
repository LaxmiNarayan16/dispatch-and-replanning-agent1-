import { DomainValidationError } from "./errors.js";
import type { TimeInterval } from "./types.js";

const MS_PER_MINUTE = 60_000;

export function assertValidInterval(interval: TimeInterval): void {
  if (!Number.isFinite(interval.start.getTime()) || !Number.isFinite(interval.end.getTime())) {
    throw new DomainValidationError("INVALID_INTERVAL", "Interval timestamps must be valid UTC instants.");
  }

  if (interval.start >= interval.end) {
    throw new DomainValidationError("INVALID_INTERVAL", "Interval end must be later than interval start.");
  }
}

/** Half-open comparison: [a.start, a.end) overlaps [b.start, b.end) only when both are open. */
export function intervalsOverlap(left: TimeInterval, right: TimeInterval): boolean {
  assertValidInterval(left);
  assertValidInterval(right);
  return left.start < right.end && right.start < left.end;
}

export function containsInterval(container: TimeInterval, candidate: TimeInterval): boolean {
  assertValidInterval(container);
  assertValidInterval(candidate);
  return container.start <= candidate.start && candidate.end <= container.end;
}

export function durationMinutes(interval: TimeInterval): number {
  assertValidInterval(interval);
  return (interval.end.getTime() - interval.start.getTime()) / MS_PER_MINUTE;
}

export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
