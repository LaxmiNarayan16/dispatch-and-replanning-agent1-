import { describe, expect, it } from "vitest";

import type { Assignment } from "../domain/index.js";
import type {
  AuditEvent,
  MockNotification,
  ScheduleVersion,
  ScheduleVersionDraft,
  ScheduleVersionStore,
  ScheduleVersionTransaction,
} from "./versioning.js";
import { ScheduleVersionService, VersionConflictError, VersionStateError } from "./versioning.js";

const assignment: Assignment = {
  id: "a-1",
  technicianId: "tech-1",
  serviceRequestId: "request-1",
  interval: { start: new Date("2026-10-30T04:00:00.000Z"), end: new Date("2026-10-30T05:00:00.000Z") },
  status: "PROPOSED",
};

const draft = (overrides: Partial<ScheduleVersionDraft> = {}): ScheduleVersionDraft => ({
  planningDate: "2026-10-30",
  operationalTimezone: "Asia/Kolkata",
  trigger: "INITIAL_PLAN",
  assignments: [assignment],
  unassignedRequests: [],
  validationResult: [],
  objectiveScore: { total: 10_500, assignedCount: 1, priorityScore: 5, preferredWindowMatches: 0, workloadImbalancePenalty: 0 },
  optimizationMetadata: { algorithm: "bounded-deterministic-backtracking" },
  ...overrides,
});

class FakeStore implements ScheduleVersionStore, ScheduleVersionTransaction {
  public readonly versions: ScheduleVersion[] = [];
  public readonly audits: AuditEvent[] = [];
  public readonly notifications: MockNotification[] = [];

  public async transaction<T>(work: (transaction: ScheduleVersionTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }
  public async getById(id: string): Promise<ScheduleVersion | undefined> { return this.versions.find((version) => version.id === id); }
  public async getLatestForDate(date: string): Promise<ScheduleVersion | undefined> {
    return this.versions.filter((version) => version.planningDate === date).sort((a, b) => b.versionNumber - a.versionNumber)[0];
  }
  public async insertProposal(value: ScheduleVersionDraft, versionNumber: number): Promise<ScheduleVersion> {
    const version: ScheduleVersion = { ...value, id: `version-${versionNumber}`, versionNumber, status: "PROPOSED", generatedAt: new Date() };
    this.versions.push(version);
    return version;
  }
  public async approveIfCurrent(id: string, dispatcherId: string, approvedAt: Date): Promise<ScheduleVersion | undefined> {
    const index = this.versions.findIndex((version) => version.id === id && version.status === "PROPOSED");
    if (index < 0) return undefined;
    const prior = this.versions[index]!;
    const approved: ScheduleVersion = { ...prior, status: "APPROVED", approvedBy: dispatcherId, approvedAt };
    this.versions[index] = approved;
    return approved;
  }
  public async rejectIfProposed(id: string): Promise<ScheduleVersion | undefined> {
    const index = this.versions.findIndex((version) => version.id === id && version.status === "PROPOSED");
    if (index < 0) return undefined;
    const rejected: ScheduleVersion = { ...this.versions[index]!, status: "REJECTED" };
    this.versions[index] = rejected;
    return rejected;
  }
  public async insertAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<void> {
    this.audits.push({ ...event, id: `audit-${this.audits.length + 1}`, createdAt: new Date() });
  }
  public async insertNotifications(items: readonly Omit<MockNotification, "id" | "createdAt">[]): Promise<void> {
    this.notifications.push(...items.map((item, index) => ({ ...item, id: `notification-${this.notifications.length + index + 1}`, createdAt: new Date() })));
  }
}

describe("schedule version approval", () => {
  it("creates an immutable proposal and creates notifications only after approval", async () => {
    const store = new FakeStore();
    const service = new ScheduleVersionService(store);
    const proposal = await service.createProposal(draft(), "dispatcher-1");

    expect(proposal.status).toBe("PROPOSED");
    expect(store.notifications).toHaveLength(0);
    const approved = await service.approve(proposal.id, "dispatcher-1");
    expect(approved.status).toBe("APPROVED");
    expect(store.notifications).toHaveLength(1);
    expect(store.audits.map((item) => item.action)).toEqual(["SCHEDULE_PROPOSED", "SCHEDULE_APPROVED"]);
  });

  it("rejects stale approval when a newer proposal exists", async () => {
    const store = new FakeStore();
    const service = new ScheduleVersionService(store);
    const first = await service.createProposal(draft());
    const second = await service.createProposal(draft({ parentVersionId: first.id, trigger: "EMERGENCY_REQUEST" }));

    await expect(service.approve(first.id, "dispatcher-1")).rejects.toBeInstanceOf(VersionConflictError);
    await expect(service.approve(second.id, "dispatcher-1")).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("refuses proposals with validation failures or duplicate request assignments", async () => {
    const service = new ScheduleVersionService(new FakeStore());
    await expect(service.createProposal(draft({ validationResult: [{ code: "SKILL_MISMATCH", message: "bad" }] }))).rejects.toBeInstanceOf(VersionStateError);
    await expect(service.createProposal(draft({ assignments: [assignment, { ...assignment, id: "a-2" }] }))).rejects.toBeInstanceOf(VersionStateError);
  });

  it("refuses double-booking at the persistence boundary", async () => {
    const service = new ScheduleVersionService(new FakeStore());
    const overlapping: Assignment = {
      ...assignment,
      id: "a-2",
      serviceRequestId: "request-2",
      interval: { start: new Date("2026-10-30T04:30:00.000Z"), end: new Date("2026-10-30T05:30:00.000Z") },
    };

    await expect(service.createProposal(draft({ assignments: [assignment, overlapping] }))).rejects.toBeInstanceOf(VersionStateError);
  });

  it("records a replan reason and manual override audit rows in the same transaction", async () => {
    const store = new FakeStore();
    const service = new ScheduleVersionService(store);
    const first = await service.createProposal(draft());
    const changed: Assignment = {
      ...assignment,
      interval: { start: new Date("2026-10-30T06:00:00.000Z"), end: new Date("2026-10-30T07:00:00.000Z") },
    };
    const second = await service.createProposal(
      draft({ parentVersionId: first.id, trigger: "MANUAL_OVERRIDE", triggerReason: "Customer called", assignments: [changed] }),
      "dispatcher-1",
      [{ serviceRequestId: "request-1", reason: "Customer called", newValue: { startsAt: "2026-10-30T06:00:00.000Z" } }],
    );

    expect(store.audits.filter((item) => item.scheduleVersionId === second.id).map((item) => item.action)).toEqual([
      "SCHEDULE_PROPOSED",
      "REPLAN_REQUESTED",
      "ASSIGNMENT_OVERRIDDEN",
    ]);
    expect(store.audits.at(-1)).toMatchObject({ dispatcherId: "dispatcher-1", reason: "Customer called" });
  });

  it("persists a rejection with its dispatcher audit", async () => {
    const store = new FakeStore();
    const service = new ScheduleVersionService(store);
    const proposal = await service.createProposal(draft());

    await service.reject(proposal.id, "dispatcher-1", "Needs review");
    await expect(store.getById(proposal.id)).resolves.toMatchObject({ status: "REJECTED" });
    expect(store.audits.at(-1)).toMatchObject({ action: "SCHEDULE_REJECTED", reason: "Needs review" });
  });
});
