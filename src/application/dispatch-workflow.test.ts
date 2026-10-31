import { describe, expect, it } from "vitest";

import type { Assignment, ServiceRequest, Technician } from "../domain/index.js";
import { ScheduleVersionService, type AuditEvent, type MockNotification, type ScheduleVersion, type ScheduleVersionDraft, type ScheduleVersionStore, type ScheduleVersionTransaction } from "./index.js";
import { DispatchWorkflow, type DispatchRepository, type DispatchSnapshot } from "./dispatch-workflow.js";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 30, hour));
const window = (start: number, end: number) => ({ start: at(start), end: at(end) });

const technician: Technician = {
  id: "tech-a", name: "Asha", skills: ["HVAC"], assignedRegions: ["CENTRAL"], maximumWorkloadMinutes: 480,
  status: "ACTIVE", workingHours: window(4, 12), availability: [window(4, 12)],
};
const request = (id: string, overrides: Partial<ServiceRequest> = {}): ServiceRequest => ({
  id, title: id, region: "CENTRAL", requiredSkill: "HVAC", priority: 3, estimatedDurationMinutes: 60,
  status: "PENDING", isEmergency: false, ...overrides,
});

class FakeStore implements ScheduleVersionStore, ScheduleVersionTransaction {
  public readonly versions: ScheduleVersion[] = [];
  public readonly audits: AuditEvent[] = [];
  public readonly notifications: MockNotification[] = [];
  public async transaction<T>(work: (transaction: ScheduleVersionTransaction) => Promise<T>): Promise<T> { return work(this); }
  public async getById(id: string) { return this.versions.find((version) => version.id === id); }
  public async getLatestForDate(date: string) { return this.versions.filter((version) => version.planningDate === date).sort((a, b) => b.versionNumber - a.versionNumber)[0]; }
  public async insertProposal(draft: ScheduleVersionDraft, versionNumber: number) {
    const version: ScheduleVersion = { ...draft, id: `version-${versionNumber}`, versionNumber, status: "PROPOSED", generatedAt: new Date() };
    this.versions.push(version);
    return version;
  }
  public async approveIfCurrent() { return undefined; }
  public async rejectIfProposed() { return undefined; }
  public async insertAudit(event: Omit<AuditEvent, "id" | "createdAt">) { this.audits.push({ ...event, id: `audit-${this.audits.length + 1}`, createdAt: new Date() }); }
  public async insertNotifications(items: readonly Omit<MockNotification, "id" | "createdAt">[]) {
    this.notifications.push(...items.map((item, index) => ({ ...item, id: `notification-${this.notifications.length + index + 1}`, createdAt: new Date() })));
  }
}

function repository(snapshot: DispatchSnapshot): DispatchRepository {
  return {
    listTechnicians: async () => snapshot.technicians,
    listRequests: async () => snapshot.requests,
    getSnapshot: async () => snapshot,
    createTechnician: async () => { throw new Error("not used"); },
    updateTechnician: async () => { throw new Error("not used"); },
    createRequest: async () => { throw new Error("not used"); },
    updateRequest: async () => { throw new Error("not used"); },
  };
}

describe("dispatch workflow", () => {
  it("creates an initial proposal, then a replan with parent, trigger, and change entries", async () => {
    const store = new FakeStore();
    let snapshot: DispatchSnapshot = { technicians: [technician], requests: [request("request-a")], protectedAssignments: [] };
    const workflow = new DispatchWorkflow({ ...repository(snapshot), getSnapshot: async () => snapshot }, new ScheduleVersionService(store));
    const initial = await workflow.generateAndPropose({ planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata", dispatcherId: "dispatcher-1" });

    expect(initial.version.trigger).toBe("INITIAL_PLAN");
    expect(initial.result.assignments).toHaveLength(1);
    snapshot = { ...snapshot, latestVersion: initial.version };

    const replan = await workflow.generateAndPropose({
      planningDate: "2026-10-30",
      operationalTimezone: "Asia/Kolkata",
      dispatcherId: "dispatcher-1",
      trigger: "EMERGENCY_REQUEST",
      triggerReason: "Emergency call",
    });

    expect(replan.version.parentVersionId).toBe(initial.version.id);
    expect(replan.version.trigger).toBe("EMERGENCY_REQUEST");
    expect(replan.version.changes?.entries.some((entry) => entry.kind === "PRESERVED")).toBe(true);
    expect(store.audits.filter((audit) => audit.scheduleVersionId === replan.version.id).map((audit) => audit.action)).toEqual([
      "SCHEDULE_PROPOSED",
      "REPLAN_REQUESTED",
    ]);
  });

  it("persists a validated manual override with its audit row and never confirms it", async () => {
    const store = new FakeStore();
    const versions = new ScheduleVersionService(store);
    let snapshot: DispatchSnapshot = { technicians: [technician], requests: [request("request-a")], protectedAssignments: [] };
    const workflow = new DispatchWorkflow({ ...repository(snapshot), getSnapshot: async () => snapshot }, versions);
    const initial = await workflow.generateAndPropose({ planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata", dispatcherId: "dispatcher-1" });
    snapshot = { ...snapshot, latestVersion: initial.version };

    const version = await workflow.createManualOverride({
      planningDate: "2026-10-30",
      operationalTimezone: "Asia/Kolkata",
      dispatcherId: "dispatcher-1",
      technicianId: "tech-a",
      serviceRequestId: "request-a",
      interval: window(7, 8),
      reason: "Customer requested a later slot.",
    });

    expect(version.status).toBe("PROPOSED");
    expect(version.parentVersionId).toBe(initial.version.id);
    expect(version.assignments.find((assignment) => assignment.serviceRequestId === "request-a")?.interval).toEqual(window(7, 8));
    expect(store.audits.at(-1)).toMatchObject({
      action: "ASSIGNMENT_OVERRIDDEN",
      dispatcherId: "dispatcher-1",
      reason: "Customer requested a later slot.",
    });
    expect(store.notifications).toHaveLength(0);
  });

  it("does not duplicate completed work in a replan", async () => {
    const completed: Assignment = { id: "done-a", technicianId: "tech-a", serviceRequestId: "request-done", interval: window(4, 5), status: "COMPLETED" };
    const previous: ScheduleVersion = {
      id: "version-1", versionNumber: 1, status: "APPROVED", planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata",
      trigger: "INITIAL_PLAN", assignments: [completed], unassignedRequests: [], validationResult: [],
      objectiveScore: { total: 0, assignedCount: 0, priorityScore: 0, preferredWindowMatches: 0, workloadImbalancePenalty: 0 },
      optimizationMetadata: {}, generatedAt: new Date(),
    };
    const store = new FakeStore();
    store.versions.push(previous);
    const versions = new ScheduleVersionService(store);
    const workflow = new DispatchWorkflow(repository({
      technicians: [technician],
      requests: [request("request-done", { status: "COMPLETED" }), request("request-b")],
      protectedAssignments: [completed],
      latestVersion: previous,
    }), versions);
    const result = await workflow.generateAndPropose({ planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata", dispatcherId: "dispatcher-1" });

    expect(result.version.assignments.filter((assignment) => assignment.serviceRequestId === "request-done")).toEqual([completed]);
    expect(result.version.assignments.filter((assignment) => assignment.serviceRequestId === "request-b")).toHaveLength(1);
    expect(result.version.changes?.preservedAssignmentIds).toContain("done-a");
  });
});
