import type {
  Assignment,
  PlanningContext,
  ServiceRequest,
  Technician,
  TimeInterval,
} from "../domain/index.js";

export interface ScheduleInput {
  readonly context: PlanningContext;
  readonly technicians: readonly Technician[];
  readonly requests: readonly ServiceRequest[];
  /** Completed and in-progress work that must remain untouched. */
  readonly protectedAssignments: readonly Assignment[];
  readonly slotIntervalMinutes?: number;
  readonly maxSearchNodes?: number;
}

export interface AssignmentCandidate {
  readonly technicianId: string;
  readonly serviceRequestId: string;
  readonly interval: TimeInterval;
}

export interface RejectionReason {
  readonly code: string;
  readonly message: string;
}

export interface UnassignedRequest {
  readonly serviceRequestId: string;
  readonly reasons: readonly RejectionReason[];
}

export interface ObjectiveScore {
  readonly total: number;
  readonly assignedCount: number;
  readonly priorityScore: number;
  readonly preferredWindowMatches: number;
  readonly workloadImbalancePenalty: number;
}

export interface ScheduleResult {
  readonly assignments: readonly Assignment[];
  readonly unassigned: readonly UnassignedRequest[];
  readonly validation: readonly RejectionReason[];
  readonly objective: ObjectiveScore;
  readonly metadata: {
    readonly algorithm: "bounded-deterministic-backtracking";
    readonly exploredNodes: number;
    readonly searchLimitReached: boolean;
    readonly optimality: "PROVEN" | "BEST_KNOWN";
  };
}
