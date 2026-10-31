import {
  containsInterval,
  durationMinutes,
  intervalsOverlap,
  isSupportedTimeZone,
  type Assignment,
  type ServiceRequest,
  type Technician,
  type TimeInterval,
} from "../domain/index.js";
import type {
  AssignmentCandidate,
  ObjectiveScore,
  RejectionReason,
  ScheduleInput,
  ScheduleResult,
  UnassignedRequest,
} from "./types.js";

const DEFAULT_SLOT_INTERVAL_MINUTES = 30;
const DEFAULT_MAX_SEARCH_NODES = 25_000;
const MS_PER_MINUTE = 60_000;

interface CandidateSet {
  readonly request: ServiceRequest;
  readonly candidates: readonly AssignmentCandidate[];
  readonly rejections: readonly RejectionReason[];
}

interface SearchState {
  readonly assignments: readonly Assignment[];
  readonly explicitlyUnassigned: ReadonlySet<string>;
}

function rejection(code: string, message: string): RejectionReason {
  return { code, message };
}

/** User-entered skills and regions are labels, so matching must not depend on casing or whitespace. */
function sameOperationalLabel(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function stableRequestOrder(left: CandidateSet, right: CandidateSet): number {
  return (
    right.request.priority - left.request.priority ||
    left.candidates.length - right.candidates.length ||
    left.request.id.localeCompare(right.request.id)
  );
}

function getEligibilityRejections(technician: Technician, request: ServiceRequest): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const technicianName = technician.name.trim();

  if (technician.status !== "ACTIVE") {
    reasons.push(rejection("TECHNICIAN_INACTIVE", `${technicianName} is ${technician.status}.`));
  }
  if (!technician.skills.some((skill) => sameOperationalLabel(skill, request.requiredSkill))) {
    reasons.push(rejection("SKILL_MISMATCH", `${technicianName} does not have the ${request.requiredSkill} skill.`));
  }
  if (!technician.assignedRegions.some((region) => sameOperationalLabel(region, request.region))) {
    reasons.push(rejection("REGION_MISMATCH", `${technicianName} does not cover ${request.region}.`));
  }
  return reasons;
}

function enumerateSlots(technician: Technician, request: ServiceRequest, slotIntervalMinutes: number): TimeInterval[] {
  const slots: TimeInterval[] = [];
  const durationMs = request.estimatedDurationMinutes * MS_PER_MINUTE;
  const slotMs = slotIntervalMinutes * MS_PER_MINUTE;

  for (const availability of technician.availability) {
    const firstStart = Math.max(availability.start.getTime(), technician.workingHours.start.getTime());
    const latestEnd = Math.min(availability.end.getTime(), technician.workingHours.end.getTime());
    for (let start = firstStart; start + durationMs <= latestEnd; start += slotMs) {
      slots.push({ start: new Date(start), end: new Date(start + durationMs) });
    }
  }
  return slots;
}

function workloadMinutes(technicianId: string, assignments: readonly Assignment[]): number {
  return assignments
    .filter((assignment) => assignment.technicianId === technicianId && assignment.status !== "CANCELLED")
    .reduce((total, assignment) => total + durationMinutes(assignment.interval), 0);
}

function candidateConflicts(candidate: AssignmentCandidate, assignments: readonly Assignment[]): boolean {
  return assignments.some(
    (assignment) =>
      assignment.technicianId === candidate.technicianId &&
      assignment.status !== "CANCELLED" &&
      intervalsOverlap(candidate.interval, assignment.interval),
  );
}

function validateCandidate(
  candidate: AssignmentCandidate,
  technician: Technician,
  request: ServiceRequest,
  assignments: readonly Assignment[],
): RejectionReason[] {
  const reasons = getEligibilityRejections(technician, request);
  if (request.status === "CANCELLED" || request.status === "COMPLETED") {
    reasons.push(rejection("REQUEST_NOT_SCHEDULABLE", `Request "${request.title}" is ${request.status}.`));
  }
  if (!containsInterval(technician.workingHours, candidate.interval)) {
    reasons.push(rejection("OUTSIDE_WORKING_HOURS", "Assignment falls outside working hours."));
  }
  if (!technician.availability.some((window) => containsInterval(window, candidate.interval))) {
    reasons.push(rejection("OUTSIDE_AVAILABILITY", "Assignment falls outside technician availability."));
  }
  if (durationMinutes(candidate.interval) !== request.estimatedDurationMinutes) {
    reasons.push(rejection("INVALID_DURATION", "Assignment duration differs from the request estimate."));
  }
  if (workloadMinutes(technician.id, assignments) + durationMinutes(candidate.interval) > technician.maximumWorkloadMinutes) {
    reasons.push(rejection("WORKLOAD_LIMIT_EXCEEDED", "Assignment would exceed the technician workload limit."));
  }
  if (candidateConflicts(candidate, assignments)) {
    reasons.push(rejection("OVERLAPPING_ASSIGNMENT", "Assignment overlaps existing work."));
  }
  if (assignments.some((assignment) => assignment.serviceRequestId === request.id && assignment.status !== "CANCELLED")) {
    reasons.push(rejection("DUPLICATE_REQUEST_ASSIGNMENT", "Request is already assigned in this schedule."));
  }
  return reasons;
}

export interface ManualAssignmentValidationInput {
  readonly technician: Technician;
  readonly request: ServiceRequest;
  readonly interval: TimeInterval;
  readonly existingAssignments: readonly Assignment[];
}

/** Validates a dispatcher-selected assignment using the same hard constraints as the planner. */
export function validateManualAssignment(input: ManualAssignmentValidationInput): readonly RejectionReason[] {
  return validateCandidate(
    {
      technicianId: input.technician.id,
      serviceRequestId: input.request.id,
      interval: input.interval,
    },
    input.technician,
    input.request,
    input.existingAssignments,
  );
}

function makeCandidates(input: ScheduleInput, request: ServiceRequest, slotIntervalMinutes: number): CandidateSet {
  if (request.status === "CANCELLED" || request.status === "COMPLETED") {
    return {
      request,
      candidates: [],
      rejections: [rejection("REQUEST_NOT_SCHEDULABLE", `Request "${request.title}" is ${request.status}.`)],
    };
  }

  const candidates: AssignmentCandidate[] = [];
  const rejections: RejectionReason[] = [];
  for (const technician of [...input.technicians].sort((a, b) => a.id.localeCompare(b.id))) {
    const eligibilityFailures = getEligibilityRejections(technician, request);
    if (eligibilityFailures.length > 0) {
      rejections.push(...eligibilityFailures);
      continue;
    }

    for (const interval of enumerateSlots(technician, request, slotIntervalMinutes)) {
      const candidate = { technicianId: technician.id, serviceRequestId: request.id, interval };
      const failures = validateCandidate(candidate, technician, request, input.protectedAssignments);
      if (failures.length === 0) candidates.push(candidate);
      else rejections.push(...failures);
    }

    if (
      enumerateSlots(technician, request, slotIntervalMinutes).length === 0 &&
      !technician.availability.some((availability) => durationMinutes(availability) >= request.estimatedDurationMinutes)
    ) {
      rejections.push(rejection("OUTSIDE_AVAILABILITY", `${technician.name.trim()} has no availability window long enough for the ${request.estimatedDurationMinutes}-minute visit.`));
    }
  }

  return {
    request,
    candidates: candidates.sort(
      (a, b) =>
        a.technicianId.localeCompare(b.technicianId) ||
        a.interval.start.getTime() - b.interval.start.getTime() ||
        a.interval.end.getTime() - b.interval.end.getTime(),
    ),
    rejections: deduplicateRejections(rejections),
  };
}

function deduplicateRejections(rejections: readonly RejectionReason[]): RejectionReason[] {
  const known = new Set<string>();
  return rejections.filter((reason) => {
    const key = `${reason.code}:${reason.message}`;
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
}

/** Scores any assignment set with the same objective used by the planner and manual overrides. */
export function scoreAssignments(
  assignments: readonly Assignment[],
  technicians: readonly Technician[],
  requests: readonly ServiceRequest[],
): ObjectiveScore {
  const planned = assignments.filter((assignment) => assignment.status === "PROPOSED");
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const priorityScore = planned.reduce((sum, assignment) => sum + (requestById.get(assignment.serviceRequestId)?.priority ?? 0), 0);
  const preferredWindowMatches = planned.filter((assignment) => {
    const preferred = requestById.get(assignment.serviceRequestId)?.preferredWindow;
    return preferred !== undefined && containsInterval(preferred, assignment.interval);
  }).length;
  const workloads = technicians.map((technician) => workloadMinutes(technician.id, assignments));
  const average = workloads.reduce((sum, amount) => sum + amount, 0) / Math.max(workloads.length, 1);
  const workloadImbalancePenalty = workloads.reduce((sum, amount) => sum + Math.abs(amount - average), 0);

  return {
    assignedCount: planned.length,
    priorityScore,
    preferredWindowMatches,
    workloadImbalancePenalty,
    total: planned.length * 10_000 + priorityScore * 100 + preferredWindowMatches * 10 - workloadImbalancePenalty,
  };
}

function compareScores(left: ObjectiveScore, right: ObjectiveScore): number {
  return (
    left.total - right.total ||
    left.assignedCount - right.assignedCount ||
    left.priorityScore - right.priorityScore ||
    left.preferredWindowMatches - right.preferredWindowMatches
  );
}

function toAssignment(candidate: AssignmentCandidate): Assignment {
  return {
    id: `proposed:${candidate.serviceRequestId}:${candidate.technicianId}:${candidate.interval.start.toISOString()}`,
    technicianId: candidate.technicianId,
    serviceRequestId: candidate.serviceRequestId,
    interval: candidate.interval,
    status: "PROPOSED",
  };
}

export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const validation: RejectionReason[] = [];
  if (!isSupportedTimeZone(input.context.operationalTimezone)) {
    validation.push(rejection("INVALID_TIMEZONE", "Planning context must specify a valid IANA timezone."));
  }
  const protectedIds = new Set<string>();
  for (const assignment of input.protectedAssignments) {
    if (protectedIds.has(assignment.serviceRequestId)) validation.push(rejection("DUPLICATE_REQUEST_ASSIGNMENT", "Protected work assigns a request more than once."));
    protectedIds.add(assignment.serviceRequestId);
  }

  const slotIntervalMinutes = input.slotIntervalMinutes ?? DEFAULT_SLOT_INTERVAL_MINUTES;
  const maxSearchNodes = input.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES;
  if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes <= 0) {
    validation.push(rejection("INVALID_SLOT_INTERVAL", "Slot interval must be a positive whole number of minutes."));
  }
  if (validation.length > 0) {
    return emptyResult(input, validation, 0, false);
  }

  const requestSets = input.requests
    .filter((request) => !protectedIds.has(request.id))
    .map((request) => makeCandidates(input, request, slotIntervalMinutes))
    .sort(stableRequestOrder);

  let exploredNodes = 0;
  let limitReached = false;
  let best: SearchState = { assignments: input.protectedAssignments, explicitlyUnassigned: new Set() };
  let bestScore = scoreAssignments(best.assignments, input.technicians, input.requests);

  function search(index: number, state: SearchState): void {
    if (exploredNodes >= maxSearchNodes) {
      limitReached = true;
      return;
    }
    exploredNodes += 1;
    if (index === requestSets.length) {
      const currentScore = scoreAssignments(state.assignments, input.technicians, input.requests);
      if (compareScores(currentScore, bestScore) > 0) {
        best = state;
        bestScore = currentScore;
      }
      return;
    }

    const current = requestSets[index]!;
    for (const candidate of current.candidates) {
      const technician = input.technicians.find((item) => item.id === candidate.technicianId);
      if (!technician) continue;
      if (validateCandidate(candidate, technician, current.request, state.assignments).length > 0) continue;
      search(index + 1, {
        assignments: [...state.assignments, toAssignment(candidate)],
        explicitlyUnassigned: state.explicitlyUnassigned,
      });
    }
    search(index + 1, {
      assignments: state.assignments,
      explicitlyUnassigned: new Set([...state.explicitlyUnassigned, current.request.id]),
    });
  }

  search(0, best);
  const selectedIds = new Set(best.assignments.map((assignment) => assignment.serviceRequestId));
  const unassigned: UnassignedRequest[] = requestSets
    .filter((set) => !selectedIds.has(set.request.id))
    .map((set) => ({
      serviceRequestId: set.request.id,
      reasons:
        set.candidates.length === 0
          ? set.rejections.length > 0
            ? set.rejections
            : [rejection("NO_FEASIBLE_CANDIDATE", "No feasible assignment candidate exists.")]
          : [rejection("DISPLACED_BY_OBJECTIVE", "No candidate remained in the best feasible schedule.")],
    }));

  return {
    assignments: best.assignments,
    unassigned,
    validation,
    objective: bestScore,
    metadata: {
      algorithm: "bounded-deterministic-backtracking",
      exploredNodes,
      searchLimitReached: limitReached,
      optimality: limitReached ? "BEST_KNOWN" : "PROVEN",
    },
  };
}

function emptyResult(input: ScheduleInput, validation: readonly RejectionReason[], exploredNodes: number, limitReached: boolean): ScheduleResult {
  return {
    assignments: input.protectedAssignments,
    unassigned: input.requests.map((request) => ({
      serviceRequestId: request.id,
      reasons: validation,
    })),
    validation,
    objective: scoreAssignments(input.protectedAssignments, input.technicians, input.requests),
    metadata: {
      algorithm: "bounded-deterministic-backtracking",
      exploredNodes,
      searchLimitReached: limitReached,
      optimality: limitReached ? "BEST_KNOWN" : "PROVEN",
    },
  };
}
