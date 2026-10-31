import type {
  AuditEvent,
  MockNotification,
  ScheduleVersion,
  ScheduleVersionDraft,
  ScheduleVersionStore,
  ScheduleVersionTransaction,
} from "../application/index.js";

/**
 * The deliberately small Prisma surface used by the application layer. Keeping
 * this structural lets the domain compile independently of generated Prisma code.
 */
export interface PrismaTransactionLike {
  scheduleVersion: {
    findUnique(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  auditEvent: { create(args: unknown): Promise<unknown> };
  mockNotification: { createMany(args: unknown): Promise<unknown> };
}

export interface PrismaClientLike extends PrismaTransactionLike {
  $transaction<T>(work: (transaction: PrismaTransactionLike) => Promise<T>): Promise<T>;
}

type DatabaseVersion = {
  id: string;
  planningDate: Date;
  operationalTimezone: string;
  versionNumber: number;
  parentVersionId: string | null;
  trigger: ScheduleVersion["trigger"];
  triggerReason: string | null;
  status: ScheduleVersion["status"];
  assignments: unknown[];
  unassignedRequests: unknown;
  validationResult: unknown;
  objectiveScore: unknown;
  optimizationMetadata: unknown;
  changes: unknown;
  generatedAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
};

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

function mapVersion(value: unknown): ScheduleVersion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as DatabaseVersion;
  return {
    id: row.id,
    planningDate: row.planningDate.toISOString().slice(0, 10),
    operationalTimezone: row.operationalTimezone,
    versionNumber: row.versionNumber,
    ...(row.parentVersionId === null ? {} : { parentVersionId: row.parentVersionId }),
    trigger: row.trigger,
    ...(row.triggerReason === null ? {} : { triggerReason: row.triggerReason }),
    assignments: row.assignments.map((assignment) => {
      const item = assignment as {
        id: string; technicianId: string; serviceRequestId: string; startsAt: Date; endsAt: Date; status: ScheduleVersion["assignments"][number]["status"];
      };
      return {
        id: item.id,
        technicianId: item.technicianId,
        serviceRequestId: item.serviceRequestId,
        interval: { start: item.startsAt, end: item.endsAt },
        status: item.status,
      };
    }),
    unassignedRequests: row.unassignedRequests as ScheduleVersion["unassignedRequests"],
    validationResult: row.validationResult as ScheduleVersion["validationResult"],
    objectiveScore: row.objectiveScore as ScheduleVersion["objectiveScore"],
    optimizationMetadata: row.optimizationMetadata as ScheduleVersion["optimizationMetadata"],
    ...(row.changes === null || row.changes === undefined
      ? {}
      : { changes: row.changes as NonNullable<ScheduleVersion["changes"]> }),
    status: row.status,
    generatedAt: row.generatedAt,
    ...(row.approvedBy === null ? {} : { approvedBy: row.approvedBy }),
    ...(row.approvedAt === null ? {} : { approvedAt: row.approvedAt }),
  };
}

class PrismaVersionTransaction implements ScheduleVersionTransaction {
  public constructor(private readonly transaction: PrismaTransactionLike) {}

  public async getById(id: string): Promise<ScheduleVersion | undefined> {
    return mapVersion(await this.transaction.scheduleVersion.findUnique({ where: { id }, include: { assignments: true } }));
  }

  public async getLatestForDate(planningDate: string): Promise<ScheduleVersion | undefined> {
    return mapVersion(
      await this.transaction.scheduleVersion.findFirst({
        where: { planningDate: new Date(`${planningDate}T00:00:00.000Z`) },
        orderBy: { versionNumber: "desc" },
        include: { assignments: true },
      }),
    );
  }

  public async insertProposal(draft: ScheduleVersionDraft, nextVersionNumber: number): Promise<ScheduleVersion> {
    const version = await this.transaction.scheduleVersion.create({
      data: {
        planningDate: new Date(`${draft.planningDate}T00:00:00.000Z`),
        operationalTimezone: draft.operationalTimezone,
        versionNumber: nextVersionNumber,
        parentVersionId: draft.parentVersionId ?? null,
        trigger: draft.trigger,
        triggerReason: draft.triggerReason ?? null,
        status: "PROPOSED",
        unassignedRequests: asJson(draft.unassignedRequests),
        validationResult: asJson(draft.validationResult),
        objectiveScore: asJson(draft.objectiveScore),
        optimizationMetadata: asJson(draft.optimizationMetadata),
        changes: draft.changes === undefined ? null : asJson(draft.changes),
        assignments: {
          create: draft.assignments.map((assignment) => ({
            technicianId: assignment.technicianId,
            serviceRequestId: assignment.serviceRequestId,
            startsAt: assignment.interval.start,
            endsAt: assignment.interval.end,
            status: assignment.status,
          })),
        },
      },
      include: { assignments: true },
    });
    const mapped = mapVersion(version);
    if (!mapped) throw new Error("Prisma created an invalid schedule version record.");
    return mapped;
  }

  public async approveIfCurrent(id: string, approvedBy: string, approvedAt: Date): Promise<ScheduleVersion | undefined> {
    const updated = await this.transaction.scheduleVersion.updateMany({
      where: { id, status: "PROPOSED" },
      data: { status: "APPROVED", approvedBy, approvedAt },
    });
    return updated.count === 1 ? this.getById(id) : undefined;
  }

  public async rejectIfProposed(id: string): Promise<ScheduleVersion | undefined> {
    const updated = await this.transaction.scheduleVersion.updateMany({ where: { id, status: "PROPOSED" }, data: { status: "REJECTED" } });
    return updated.count === 1 ? this.getById(id) : undefined;
  }

  public async insertAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<void> {
    await this.transaction.auditEvent.create({
      data: {
        scheduleVersionId: event.scheduleVersionId,
        action: event.action,
        dispatcherId: event.dispatcherId ?? null,
        previousValue: event.previousValue === undefined ? null : asJson(event.previousValue),
        newValue: event.newValue === undefined ? null : asJson(event.newValue),
        reason: event.reason ?? null,
      },
    });
  }

  public async insertNotifications(items: readonly Omit<MockNotification, "id" | "createdAt">[]): Promise<void> {
    if (items.length === 0) return;
    await this.transaction.mockNotification.createMany({ data: items });
  }
}

export class PrismaScheduleVersionStore implements ScheduleVersionStore {
  public constructor(private readonly client: PrismaClientLike) {}
  public async transaction<T>(work: (transaction: ScheduleVersionTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction((transaction) => work(new PrismaVersionTransaction(transaction)));
  }
}
