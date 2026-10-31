import type { Assignment, ServiceRequest, Technician, TimeInterval } from "../domain/index.js";
import { validateManualAssignment, type RejectionReason } from "../scheduling/index.js";

export class InvalidManualOverrideError extends Error {
  public readonly name = "InvalidManualOverrideError";
  public constructor(public readonly reasons: readonly RejectionReason[]) {
    super(reasons.map((reason) => reason.message).join(" "));
  }
}

export interface ManualOverrideInput {
  readonly technicianId: string;
  readonly serviceRequestId: string;
  readonly interval: TimeInterval;
}

/**
 * Builds a changed draft snapshot. Persistence/audit happens in the version
 * transaction after this validation succeeds; protected work is never edited.
 */
export function applyManualOverride(
  technicians: readonly Technician[],
  requests: readonly ServiceRequest[],
  assignments: readonly Assignment[],
  input: ManualOverrideInput,
): readonly Assignment[] {
  const technician = technicians.find((item) => item.id === input.technicianId);
  const request = requests.find((item) => item.id === input.serviceRequestId);
  if (!technician || !request) {
    throw new InvalidManualOverrideError([{ code: !technician ? "TECHNICIAN_NOT_FOUND" : "REQUEST_NOT_FOUND", message: "Assignment references an unknown record." }]);
  }
  const existingForRequest = assignments.find((item) => item.serviceRequestId === input.serviceRequestId);
  if (existingForRequest?.status === "COMPLETED" || existingForRequest?.status === "IN_PROGRESS") {
    throw new InvalidManualOverrideError([{ code: "PROTECTED_ASSIGNMENT_CHANGED", message: "Completed or in-progress work cannot be changed." }]);
  }
  const remaining = assignments.filter((item) => item.serviceRequestId !== input.serviceRequestId);
  const reasons = validateManualAssignment({ technician, request, interval: input.interval, existingAssignments: remaining });
  if (reasons.length > 0) throw new InvalidManualOverrideError(reasons);
  return [
    ...remaining,
    {
      id: existingForRequest?.id ?? `manual:${input.serviceRequestId}`,
      technicianId: input.technicianId,
      serviceRequestId: input.serviceRequestId,
      interval: input.interval,
      status: "PROPOSED",
    },
  ];
}
