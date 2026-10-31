import { intervalsOverlap, type Assignment } from "../domain/index.js";
import type { ObjectiveScore, RejectionReason, ScheduleChangeSet, UnassignedRequest } from "../scheduling/index.js";

export type ScheduleVersionStatus = "PROPOSED" | "APPROVED" | "REJECTED";
export type ScheduleTrigger =
  | "INITIAL_PLAN"
  | "TECHNICIAN_CANCELLATION"
  | "TECHNICIAN_UNAVAILABILITY"
  | "EMERGENCY_REQUEST"
  | "REQUEST_CANCELLATION"
  | "DURATION_CHANGE"
  | "AVAILABILITY_CHANGE"
  | "MANUAL_OVERRIDE";

export interface ScheduleVersionDraft {
  readonly planningDate: string;
  readonly operationalTimezone: string;
  readonly parentVersionId?: string;
  readonly trigger: ScheduleTrigger;
  readonly triggerReason?: string;
  readonly assignments: readonly Assignment[];
  readonly unassignedRequests: readonly UnassignedRequest[];
  readonly validationResult: readonly RejectionReason[];
  readonly objectiveScore: ObjectiveScore;
  readonly optimizationMetadata: Readonly<Record<string, unknown>>;
  readonly changes?: ScheduleChangeSet;
}

export interface ManualOverrideAudit {
  readonly serviceRequestId: string;
  readonly dispatcherId?: string;
  readonly previousValue?: Readonly<Record<string, unknown>>;
  readonly newValue?: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export interface ScheduleVersion extends ScheduleVersionDraft {
  readonly id: string;
  readonly versionNumber: number;
  readonly status: ScheduleVersionStatus;
  readonly generatedAt: Date;
  readonly approvedBy?: string;
  readonly approvedAt?: Date;
}

export interface AuditEvent {
  readonly id: string;
  readonly scheduleVersionId: string;
  readonly action: "SCHEDULE_PROPOSED" | "SCHEDULE_APPROVED" | "SCHEDULE_REJECTED" | "ASSIGNMENT_OVERRIDDEN" | "REPLAN_REQUESTED";
  readonly dispatcherId?: string;
  readonly previousValue?: Readonly<Record<string, unknown>>;
  readonly newValue?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly createdAt: Date;
}

export interface MockNotification {
  readonly id: string;
  readonly technicianId: string;
  readonly scheduleVersionId: string;
  readonly type: "SCHEDULE_APPROVED" | "ASSIGNMENT_CHANGED" | "ASSIGNMENT_REMOVED";
  readonly message: string;
  readonly deliveryStatus: "PENDING" | "DELIVERED" | "FAILED";
  readonly createdAt: Date;
}

export class VersionConflictError extends Error {
  public readonly name = "VersionConflictError";
  public constructor(message: string) {
    super(message);
  }
}

export class VersionStateError extends Error {
  public readonly name = "VersionStateError";
  public constructor(message: string) {
    super(message);
  }
}

export interface ScheduleVersionTransaction {
  getById(id: string): Promise<ScheduleVersion | undefined>;
  getLatestForDate(planningDate: string): Promise<ScheduleVersion | undefined>;
  insertProposal(draft: ScheduleVersionDraft, nextVersionNumber: number): Promise<ScheduleVersion>;
  approveIfCurrent(id: string, approvedBy: string, approvedAt: Date): Promise<ScheduleVersion | undefined>;
  rejectIfProposed(id: string): Promise<ScheduleVersion | undefined>;
  insertAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<void>;
  insertNotifications(notifications: readonly Omit<MockNotification, "id" | "createdAt">[]): Promise<void>;
}

export interface ScheduleVersionStore {
  transaction<T>(work: (transaction: ScheduleVersionTransaction) => Promise<T>): Promise<T>;
}

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function assertVersionIsUsable(draft: ScheduleVersionDraft): void {
  if (draft.validationResult.length > 0) {
    throw new VersionStateError("A schedule with constraint validation failures cannot be proposed.");
  }
  const requests = new Set<string>();
  const activeAssignments: Assignment[] = [];
  for (const assignment of draft.assignments) {
    if (requests.has(assignment.serviceRequestId)) {
      throw new VersionStateError("A schedule version cannot assign one request more than once.");
    }
    requests.add(assignment.serviceRequestId);
    if (
      !Number.isFinite(assignment.interval.start.getTime()) ||
      !Number.isFinite(assignment.interval.end.getTime()) ||
      assignment.interval.start >= assignment.interval.end
    ) {
      throw new VersionStateError("Every assignment interval must have a valid start before its end.");
    }
    if (assignment.status === "CANCELLED") continue;
    // Persistence is the last line of defence against double-booking: no two
    // active assignments for the same technician may overlap in one version.
    if (activeAssignments.some(
      (existing) => existing.technicianId === assignment.technicianId && intervalsOverlap(existing.interval, assignment.interval),
    )) {
      throw new VersionStateError("A technician cannot be double-booked within one schedule version.");
    }
    activeAssignments.push(assignment);
  }
}

export class ScheduleVersionService {
  public constructor(private readonly store: ScheduleVersionStore) {}

  public async createProposal(
    draft: ScheduleVersionDraft,
    dispatcherId?: string,
    overrides: readonly ManualOverrideAudit[] = [],
  ): Promise<ScheduleVersion> {
    assertVersionIsUsable(draft);
    return this.store.transaction(async (transaction) => {
      const latest = await transaction.getLatestForDate(draft.planningDate);
      if (draft.parentVersionId !== undefined && latest?.id !== draft.parentVersionId) {
        throw new VersionConflictError("The parent schedule version is no longer current.");
      }
      if (draft.parentVersionId === undefined && latest !== undefined) {
        throw new VersionConflictError("Initial planning requires an empty schedule history for this date.");
      }
      const version = await transaction.insertProposal(draft, (latest?.versionNumber ?? 0) + 1);
      await transaction.insertAudit({
        scheduleVersionId: version.id,
        action: "SCHEDULE_PROPOSED",
        ...(dispatcherId === undefined ? {} : { dispatcherId }),
        newValue: {
          trigger: draft.trigger,
          parentVersionId: draft.parentVersionId ?? null,
          ...(draft.changes === undefined ? {} : { changes: draft.changes }),
        },
        ...(draft.triggerReason === undefined ? {} : { reason: draft.triggerReason }),
      });
      if (draft.trigger !== "INITIAL_PLAN" && draft.parentVersionId !== undefined) {
        await transaction.insertAudit({
          scheduleVersionId: version.id,
          action: "REPLAN_REQUESTED",
          ...(dispatcherId === undefined ? {} : { dispatcherId }),
          previousValue: { parentVersionId: draft.parentVersionId },
          newValue: { trigger: draft.trigger, changes: draft.changes ?? null },
          ...(draft.triggerReason === undefined ? {} : { reason: draft.triggerReason }),
        });
      }
      for (const override of overrides) {
        const overrideDispatcher = override.dispatcherId ?? dispatcherId;
        await transaction.insertAudit({
          scheduleVersionId: version.id,
          action: "ASSIGNMENT_OVERRIDDEN",
          ...(overrideDispatcher === undefined ? {} : { dispatcherId: overrideDispatcher }),
          ...(override.previousValue === undefined ? {} : { previousValue: override.previousValue }),
          ...(override.newValue === undefined ? {} : { newValue: override.newValue }),
          reason: override.reason,
        });
      }
      return version;
    });
  }

  public async approve(versionId: string, dispatcherId: string): Promise<ScheduleVersion> {
    return this.store.transaction(async (transaction) => {
      const proposed = await transaction.getById(versionId);
      if (!proposed) throw new VersionStateError("Schedule version was not found.");
      if (proposed.status !== "PROPOSED") throw new VersionStateError("Only a proposed schedule can be approved.");
      const latest = await transaction.getLatestForDate(proposed.planningDate);
      if (latest?.id !== proposed.id) throw new VersionConflictError("A newer schedule version exists; approval is stale.");

      const approved = await transaction.approveIfCurrent(versionId, dispatcherId, new Date());
      if (!approved) throw new VersionConflictError("Schedule approval conflicted with another update.");
      await transaction.insertAudit({
        scheduleVersionId: approved.id,
        action: "SCHEDULE_APPROVED",
        dispatcherId,
        previousValue: { status: "PROPOSED" },
        newValue: { status: "APPROVED" },
      });
      const technicianIds = [...new Set(approved.assignments.map((assignment) => assignment.technicianId))].sort();
      const notifications: Omit<MockNotification, "id" | "createdAt">[] = technicianIds.map((technicianId) => ({
        technicianId,
        scheduleVersionId: approved.id,
        type: "SCHEDULE_APPROVED",
        message: `Schedule version ${approved.versionNumber} has been approved.`,
        deliveryStatus: "PENDING",
      }));

      // Confirmed changes also produce mocked notification rows. This is still
      // inside the approval transaction, so a failed approval sends nothing.
      if (approved.parentVersionId !== undefined) {
        const parent = await transaction.getById(approved.parentVersionId);
        if (parent) {
          const previousByRequest = new Map(parent.assignments.map((assignment) => [assignment.serviceRequestId, assignment]));
          const nextByRequest = new Map(approved.assignments.map((assignment) => [assignment.serviceRequestId, assignment]));
          const changed = new Set<string>();
          const removed = new Set<string>();
          for (const assignment of approved.assignments) {
            const before = previousByRequest.get(assignment.serviceRequestId);
            if (
              !before ||
              before.technicianId !== assignment.technicianId ||
              before.interval.start.getTime() !== assignment.interval.start.getTime() ||
              before.interval.end.getTime() !== assignment.interval.end.getTime()
            ) {
              changed.add(assignment.technicianId);
            }
          }
          for (const assignment of parent.assignments) {
            if (!nextByRequest.has(assignment.serviceRequestId)) removed.add(assignment.technicianId);
          }
          for (const technicianId of [...changed].sort()) {
            notifications.push({
              technicianId,
              scheduleVersionId: approved.id,
              type: "ASSIGNMENT_CHANGED",
              message: `Your assignments changed in approved schedule version ${approved.versionNumber}.`,
              deliveryStatus: "PENDING",
            });
          }
          for (const technicianId of [...removed].sort()) {
            notifications.push({
              technicianId,
              scheduleVersionId: approved.id,
              type: "ASSIGNMENT_REMOVED",
              message: `An assignment was removed from your schedule in approved version ${approved.versionNumber}.`,
              deliveryStatus: "PENDING",
            });
          }
        }
      }

      await transaction.insertNotifications(notifications);
      return approved;
    });
  }

  public async reject(versionId: string, dispatcherId: string, reason: string): Promise<void> {
    if (reason.trim().length === 0) throw new VersionStateError("A rejection reason is required.");
    return this.store.transaction(async (transaction) => {
      const version = await transaction.getById(versionId);
      if (!version) throw new VersionStateError("Schedule version was not found.");
      if (version.status !== "PROPOSED") throw new VersionStateError("Only a proposed schedule can be rejected.");
      const rejected = await transaction.rejectIfProposed(versionId);
      if (!rejected) throw new VersionConflictError("Schedule rejection conflicted with another update.");
      await transaction.insertAudit({
        scheduleVersionId: versionId,
        action: "SCHEDULE_REJECTED",
        dispatcherId,
        previousValue: { status: "PROPOSED" },
        newValue: { status: "REJECTED" },
        reason,
      });
    });
  }
}
