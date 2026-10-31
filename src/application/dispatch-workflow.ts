import type { Assignment, ServiceRequest, Technician, TimeInterval } from "../domain/index.js";
import {
  diffAssignments,
  generateSchedule,
  replanSchedule,
  scoreAssignments,
  type ObjectiveScore,
  type ReplanResult,
  type ReplanTrigger,
  type RejectionReason,
  type ScheduleResult,
  type UnassignedRequest,
} from "../scheduling/index.js";
import { applyManualOverride } from "./manual-overrides.js";
import {
  ScheduleVersionService,
  VersionStateError,
  type ScheduleTrigger,
  type ScheduleVersion,
} from "./versioning.js";

export interface TechnicianDraft {
  readonly name: string;
  readonly skills: readonly string[];
  readonly assignedRegions: readonly string[];
  readonly maximumWorkloadMinutes: number;
  readonly status: Technician["status"];
  readonly availability: readonly { readonly start: Date; readonly end: Date }[];
}

export interface ServiceRequestDraft {
  readonly title: string;
  readonly region: string;
  readonly requiredSkill: string;
  readonly priority: ServiceRequest["priority"];
  readonly estimatedDurationMinutes: number;
  readonly preferredWindow?: { readonly start: Date; readonly end: Date };
  readonly notes?: string;
  readonly status: ServiceRequest["status"];
  readonly isEmergency: boolean;
}

export interface DispatchSnapshot {
  readonly technicians: readonly Technician[];
  readonly requests: readonly ServiceRequest[];
  readonly protectedAssignments: readonly Assignment[];
  readonly latestVersion?: ScheduleVersion;
}

/** Structurally compatible with the validated AI advisory plan. */
export interface PersistablePlan {
  readonly planId: string;
  readonly assignments: readonly Assignment[];
  readonly unassignedRequests: readonly UnassignedRequest[];
  readonly objective: ObjectiveScore;
  readonly warnings: readonly string[];
  readonly tradeoffs: readonly string[];
  readonly source: string;
}

export interface DispatchRepository {
  listTechnicians(): Promise<readonly Technician[]>;
  createTechnician(draft: TechnicianDraft): Promise<Technician>;
  updateTechnician(id: string, draft: TechnicianDraft): Promise<Technician>;
  listRequests(): Promise<readonly ServiceRequest[]>;
  createRequest(draft: ServiceRequestDraft): Promise<ServiceRequest>;
  updateRequest(id: string, draft: ServiceRequestDraft): Promise<ServiceRequest>;
  getSnapshot(planningDate: string): Promise<DispatchSnapshot>;
}

const assignmentView = (assignment: Assignment) => ({
  technicianId: assignment.technicianId,
  serviceRequestId: assignment.serviceRequestId,
  startsAt: assignment.interval.start.toISOString(),
  endsAt: assignment.interval.end.toISOString(),
  status: assignment.status,
});

export class DispatchWorkflow {
  public constructor(
    private readonly repository: DispatchRepository,
    private readonly versions: ScheduleVersionService,
  ) {}

  public listTechnicians(): Promise<readonly Technician[]> { return this.repository.listTechnicians(); }
  public createTechnician(draft: TechnicianDraft): Promise<Technician> { return this.repository.createTechnician(draft); }
  public updateTechnician(id: string, draft: TechnicianDraft): Promise<Technician> { return this.repository.updateTechnician(id, draft); }
  public listRequests(): Promise<readonly ServiceRequest[]> { return this.repository.listRequests(); }
  public createRequest(draft: ServiceRequestDraft): Promise<ServiceRequest> { return this.repository.createRequest(draft); }
  public updateRequest(id: string, draft: ServiceRequestDraft): Promise<ServiceRequest> { return this.repository.updateRequest(id, draft); }

  public async getWorkbench(planningDate: string): Promise<DispatchSnapshot> {
    return this.repository.getSnapshot(planningDate);
  }

  /**
   * Creates a new immutable PROPOSED version. When a prior version exists the
   * deterministic replanner preserves completed/in-progress work, computes the
   * change set, and records why the replan happened. It never approves.
   */
  public async generateAndPropose(input: {
    planningDate: string;
    operationalTimezone: string;
    dispatcherId: string;
    trigger?: ScheduleTrigger;
    triggerReason?: string;
  }): Promise<{ readonly result: ScheduleResult | ReplanResult; readonly version: ScheduleVersion }> {
    const snapshot = await this.repository.getSnapshot(input.planningDate);
    const latest = snapshot.latestVersion;
    const trigger: ScheduleTrigger = latest === undefined
      ? "INITIAL_PLAN"
      : input.trigger === undefined || input.trigger === "INITIAL_PLAN"
        ? "MANUAL_OVERRIDE"
        : input.trigger;

    let result: ScheduleResult | ReplanResult;
    if (latest === undefined) {
      result = generateSchedule({
        context: { planningDate: input.planningDate, operationalTimezone: input.operationalTimezone },
        technicians: snapshot.technicians,
        requests: snapshot.requests,
        protectedAssignments: snapshot.protectedAssignments,
      });
    } else {
      result = replanSchedule({
        context: { planningDate: input.planningDate, operationalTimezone: input.operationalTimezone },
        technicians: snapshot.technicians,
        requests: snapshot.requests,
        currentAssignments: latest.assignments,
        trigger: trigger as ReplanTrigger,
      });
    }

    const changes = "changes" in result ? result.changes : undefined;
    const version = await this.versions.createProposal({
      planningDate: input.planningDate,
      operationalTimezone: input.operationalTimezone,
      ...(latest === undefined ? {} : { parentVersionId: latest.id }),
      trigger,
      ...(input.triggerReason === undefined ? {} : { triggerReason: input.triggerReason }),
      assignments: result.assignments,
      unassignedRequests: result.unassigned,
      validationResult: result.validation,
      objectiveScore: result.objective,
      optimizationMetadata: result.metadata,
      ...(changes === undefined ? {} : { changes }),
    }, input.dispatcherId);
    return { result, version };
  }

  /**
   * Persists a validated agent plan only as a new PROPOSED version. This does
   * not confirm work: the dispatcher still has to approve it explicitly.
   */
  public async persistPlanProposal(input: {
    plan: PersistablePlan;
    planningDate: string;
    operationalTimezone: string;
    dispatcherId: string;
  }): Promise<ScheduleVersion> {
    const snapshot = await this.repository.getSnapshot(input.planningDate);
    const latest = snapshot.latestVersion;
    const trigger: ScheduleTrigger = latest === undefined ? "INITIAL_PLAN" : "MANUAL_OVERRIDE";
    return this.versions.createProposal({
      planningDate: input.planningDate,
      operationalTimezone: input.operationalTimezone,
      ...(latest === undefined ? {} : { parentVersionId: latest.id }),
      trigger,
      triggerReason: "Agent proposal validated by deterministic constraints; dispatcher approval still required.",
      assignments: input.plan.assignments,
      unassignedRequests: input.plan.unassignedRequests.map((item) => ({
        serviceRequestId: item.serviceRequestId,
        reasons: item.reasons as readonly RejectionReason[],
      })),
      validationResult: [],
      objectiveScore: input.plan.objective,
      optimizationMetadata: {
        algorithm: "ai-advisory-proposal",
        planId: input.plan.planId,
        source: input.plan.source,
        warnings: input.plan.warnings,
        tradeoffs: input.plan.tradeoffs,
      },
      ...(latest === undefined ? {} : { changes: diffAssignments(latest.assignments, input.plan.assignments) }),
    }, input.dispatcherId);
  }

  /**
   * Applies one dispatcher edit through the same hard validators as the
   * planner, then persists a child proposal plus an ASSIGNMENT_OVERRIDDEN
   * audit row. Approval is still a separate explicit action.
   */
  public async createManualOverride(input: {
    planningDate: string;
    operationalTimezone: string;
    dispatcherId: string;
    technicianId: string;
    serviceRequestId: string;
    interval: TimeInterval;
    reason: string;
  }): Promise<ScheduleVersion> {
    const snapshot = await this.repository.getSnapshot(input.planningDate);
    const latest = snapshot.latestVersion;
    if (latest === undefined) {
      throw new VersionStateError("A manual override requires an existing schedule version for this date.");
    }

    const assignments = applyManualOverride(
      snapshot.technicians,
      snapshot.requests,
      latest.assignments,
      {
        technicianId: input.technicianId,
        serviceRequestId: input.serviceRequestId,
        interval: input.interval,
      },
    );

    const assignedIds = new Set(assignments.map((assignment) => assignment.serviceRequestId));
    const previousUnassigned = new Map(latest.unassignedRequests.map((item) => [item.serviceRequestId, item]));
    const unassignedRequests = snapshot.requests
      .filter((request) => request.status !== "CANCELLED" && request.status !== "COMPLETED" && !assignedIds.has(request.id))
      .map((request) => previousUnassigned.get(request.id) ?? {
        serviceRequestId: request.id,
        reasons: [{ code: "UNASSIGNED_IN_MANUAL_PROPOSAL", message: "Request is not assigned in the manually edited proposal." }],
      });

    const previous = latest.assignments.find((assignment) => assignment.serviceRequestId === input.serviceRequestId);
    return this.versions.createProposal({
      planningDate: input.planningDate,
      operationalTimezone: input.operationalTimezone,
      parentVersionId: latest.id,
      trigger: "MANUAL_OVERRIDE",
      triggerReason: input.reason,
      assignments,
      unassignedRequests,
      validationResult: [],
      objectiveScore: scoreAssignments(assignments, snapshot.technicians, snapshot.requests),
      optimizationMetadata: {
        algorithm: "manual-override",
        parentVersionId: latest.id,
        editedServiceRequestId: input.serviceRequestId,
      },
      changes: diffAssignments(latest.assignments, assignments),
    }, input.dispatcherId, [{
      serviceRequestId: input.serviceRequestId,
      dispatcherId: input.dispatcherId,
      ...(previous === undefined ? {} : { previousValue: assignmentView(previous) }),
      newValue: {
        technicianId: input.technicianId,
        serviceRequestId: input.serviceRequestId,
        startsAt: input.interval.start.toISOString(),
        endsAt: input.interval.end.toISOString(),
        status: "PROPOSED",
      },
      reason: input.reason,
    }]);
  }
}
