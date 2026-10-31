import type { Assignment, ServiceRequest, Technician } from "../domain/index.js";
import { generateSchedule } from "./engine.js";
import type { ScheduleInput, ScheduleResult } from "./types.js";

export type ReplanTrigger =
  | "TECHNICIAN_CANCELLATION"
  | "TECHNICIAN_UNAVAILABILITY"
  | "EMERGENCY_REQUEST"
  | "REQUEST_CANCELLATION"
  | "DURATION_CHANGE"
  | "AVAILABILITY_CHANGE"
  | "MANUAL_OVERRIDE";

export interface ReplanInput extends Omit<ScheduleInput, "protectedAssignments"> {
  readonly currentAssignments: readonly Assignment[];
  readonly trigger: ReplanTrigger;
}

export type ScheduleChangeKind = "ADDED" | "REMOVED" | "REASSIGNED" | "RESCHEDULED" | "PRESERVED";

export interface ScheduleChangeEntry {
  readonly serviceRequestId: string;
  readonly kind: ScheduleChangeKind;
  readonly from?: {
    readonly technicianId: string;
    readonly start: string;
    readonly end: string;
  };
  readonly to?: {
    readonly technicianId: string;
    readonly start: string;
    readonly end: string;
  };
}

export interface ScheduleChangeSet {
  readonly preservedAssignmentIds: readonly string[];
  readonly addedRequestIds: readonly string[];
  readonly removedRequestIds: readonly string[];
  readonly reassignedRequestIds: readonly string[];
  readonly rescheduledRequestIds: readonly string[];
  /** Human-readable before/after rows for the dispatcher-facing change summary. */
  readonly entries: readonly ScheduleChangeEntry[];
}

export interface ReplanResult extends ScheduleResult {
  readonly trigger: ReplanTrigger;
  readonly changes: ScheduleChangeSet;
}

function isProtected(assignment: Assignment): boolean {
  return assignment.status === "COMPLETED" || assignment.status === "IN_PROGRESS";
}

function sameInterval(left: Assignment, right: Assignment): boolean {
  return (
    left.interval.start.getTime() === right.interval.start.getTime() &&
    left.interval.end.getTime() === right.interval.end.getTime()
  );
}

const assignmentView = (assignment: Assignment) => ({
  technicianId: assignment.technicianId,
  start: assignment.interval.start.toISOString(),
  end: assignment.interval.end.toISOString(),
});

/** Compares two assignment snapshots by request ID without mutating either side. */
export function diffAssignments(previous: readonly Assignment[], next: readonly Assignment[]): ScheduleChangeSet {
  const previousByRequest = new Map(previous.map((assignment) => [assignment.serviceRequestId, assignment]));
  const nextByRequest = new Map(next.map((assignment) => [assignment.serviceRequestId, assignment]));
  const preservedAssignmentIds: string[] = [];
  const addedRequestIds: string[] = [];
  const removedRequestIds: string[] = [];
  const reassignedRequestIds: string[] = [];
  const rescheduledRequestIds: string[] = [];
  const entries: ScheduleChangeEntry[] = [];

  for (const [requestId, previousAssignment] of previousByRequest) {
    const nextAssignment = nextByRequest.get(requestId);
    if (!nextAssignment) {
      removedRequestIds.push(requestId);
      entries.push({ serviceRequestId: requestId, kind: "REMOVED", from: assignmentView(previousAssignment) });
      continue;
    }
    if (previousAssignment.technicianId !== nextAssignment.technicianId) {
      reassignedRequestIds.push(requestId);
      entries.push({
        serviceRequestId: requestId,
        kind: "REASSIGNED",
        from: assignmentView(previousAssignment),
        to: assignmentView(nextAssignment),
      });
    }
    if (!sameInterval(previousAssignment, nextAssignment)) {
      rescheduledRequestIds.push(requestId);
      if (previousAssignment.technicianId === nextAssignment.technicianId) {
        entries.push({
          serviceRequestId: requestId,
          kind: "RESCHEDULED",
          from: assignmentView(previousAssignment),
          to: assignmentView(nextAssignment),
        });
      }
    }
    if (
      previousAssignment.technicianId === nextAssignment.technicianId &&
      sameInterval(previousAssignment, nextAssignment)
    ) {
      preservedAssignmentIds.push(previousAssignment.id);
      entries.push({ serviceRequestId: requestId, kind: "PRESERVED", to: assignmentView(nextAssignment) });
    }
  }

  for (const [requestId, nextAssignment] of nextByRequest) {
    if (!previousByRequest.has(requestId)) {
      addedRequestIds.push(requestId);
      entries.push({ serviceRequestId: requestId, kind: "ADDED", to: assignmentView(nextAssignment) });
    }
  }

  const byId = (left: string, right: string) => left.localeCompare(right);
  return {
    preservedAssignmentIds: preservedAssignmentIds.sort(byId),
    addedRequestIds: addedRequestIds.sort(byId),
    removedRequestIds: removedRequestIds.sort(byId),
    reassignedRequestIds: reassignedRequestIds.sort(byId),
    rescheduledRequestIds: rescheduledRequestIds.sort(byId),
    entries: entries.sort((left, right) => left.serviceRequestId.localeCompare(right.serviceRequestId) || left.kind.localeCompare(right.kind)),
  };
}

/**
 * Produces a new draft only. Completed and in-progress assignments are immutable
 * inputs; confirmed/proposed future work is deliberately reconsidered by the engine.
 */
export function replanSchedule(input: ReplanInput): ReplanResult {
  const protectedAssignments = input.currentAssignments.filter(isProtected);
  const result = generateSchedule({
    context: input.context,
    technicians: input.technicians,
    requests: input.requests,
    protectedAssignments,
    ...(input.slotIntervalMinutes === undefined ? {} : { slotIntervalMinutes: input.slotIntervalMinutes }),
    ...(input.maxSearchNodes === undefined ? {} : { maxSearchNodes: input.maxSearchNodes }),
  });

  return {
    ...result,
    trigger: input.trigger,
    changes: diffAssignments(input.currentAssignments, result.assignments),
  };
}

export function affectedTechnicianIds(
  currentAssignments: readonly Assignment[],
  technicians: readonly Technician[],
): readonly string[] {
  const eligibleIds = new Set(technicians.filter((technician) => technician.status === "ACTIVE").map((technician) => technician.id));
  return [...new Set(currentAssignments.filter((assignment) => !isProtected(assignment) && !eligibleIds.has(assignment.technicianId)).map((assignment) => assignment.technicianId))].sort();
}

export function activeRequests(requests: readonly ServiceRequest[]): readonly ServiceRequest[] {
  return requests.filter((request) => request.status !== "CANCELLED" && request.status !== "COMPLETED");
}
