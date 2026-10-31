export const validationCodes = [
  "INVALID_INTERVAL",
  "INVALID_TIMEZONE",
  "TECHNICIAN_NOT_FOUND",
  "REQUEST_NOT_FOUND",
  "TECHNICIAN_INACTIVE",
  "SKILL_MISMATCH",
  "REGION_MISMATCH",
  "OUTSIDE_WORKING_HOURS",
  "OUTSIDE_AVAILABILITY",
  "WORKLOAD_LIMIT_EXCEEDED",
  "OVERLAPPING_ASSIGNMENT",
  "DUPLICATE_REQUEST_ASSIGNMENT",
  "PROTECTED_ASSIGNMENT_CHANGED",
] as const;

export type ValidationCode = (typeof validationCodes)[number];

export class DomainValidationError extends Error {
  public readonly name = "DomainValidationError";

  public constructor(
    public readonly code: ValidationCode,
    message: string,
  ) {
    super(message);
  }
}
