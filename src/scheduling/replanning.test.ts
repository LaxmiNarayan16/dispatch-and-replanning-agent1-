import { describe, expect, it } from "vitest";

import type { Assignment, ServiceRequest, Technician } from "../domain/index.js";
import { affectedTechnicianIds, replanSchedule, type ReplanTrigger } from "./index.js";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 30, hour));
const window = (start: number, end: number) => ({ start: at(start), end: at(end) });

const technician = (id: string, overrides: Partial<Technician> = {}): Technician => ({
  id,
  name: id,
  skills: ["HVAC"],
  assignedRegions: ["CENTRAL"],
  maximumWorkloadMinutes: 480,
  status: "ACTIVE",
  workingHours: window(4, 12),
  availability: [window(4, 12)],
  ...overrides,
});

const request = (id: string, overrides: Partial<ServiceRequest> = {}): ServiceRequest => ({
  id,
  title: id,
  region: "CENTRAL",
  requiredSkill: "HVAC",
  priority: 3,
  estimatedDurationMinutes: 60,
  status: "PENDING",
  isEmergency: false,
  ...overrides,
});

const assignment = (id: string, requestId: string, technicianId: string, status: Assignment["status"]): Assignment => ({
  id,
  serviceRequestId: requestId,
  technicianId,
  interval: window(4, 5),
  status,
});

function replan(
  technicians: Technician[],
  requests: ServiceRequest[],
  currentAssignments: Assignment[],
  trigger: ReplanTrigger = "TECHNICIAN_CANCELLATION",
) {
  return replanSchedule({
    context: { planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata" },
    technicians,
    requests,
    currentAssignments,
    trigger,
    slotIntervalMinutes: 60,
  });
}

describe("replanning workflow", () => {
  it("preserves a completed assignment while replanning future work", () => {
    const completed = assignment("completed-a", "request-completed", "tech-a", "COMPLETED");
    const result = replan([technician("tech-a")], [request("request-future")], [completed]);

    expect(result.assignments).toContainEqual(completed);
    expect(result.changes.preservedAssignmentIds).toContain("completed-a");
  });

  it("preserves in-progress work", () => {
    const inProgress = assignment("in-progress-a", "request-active", "tech-a", "IN_PROGRESS");
    const result = replan([technician("tech-a")], [request("request-future")], [inProgress]);

    expect(result.assignments).toContainEqual(inProgress);
    expect(result.changes.preservedAssignmentIds).toContain("in-progress-a");
  });

  it("reassigns future work after a technician cancellation", () => {
    const future = assignment("confirmed-a", "request-a", "tech-a", "CONFIRMED");
    const result = replan(
      [technician("tech-a", { status: "CANCELLED" }), technician("tech-b")],
      [request("request-a")],
      [future],
    );

    expect(result.assignments.find((item) => item.serviceRequestId === "request-a")?.technicianId).toBe("tech-b");
    expect(result.changes.reassignedRequestIds).toEqual(["request-a"]);
    expect(affectedTechnicianIds([future], [technician("tech-a", { status: "CANCELLED" }), technician("tech-b")])).toEqual(["tech-a"]);
  });

  it("prioritizes an emergency request when capacity forces a trade-off", () => {
    const current = assignment("confirmed-low", "low-priority", "tech-a", "CONFIRMED");
    const result = replan(
      [technician("tech-a", { availability: [window(4, 5)] })],
      [request("low-priority", { priority: 1 }), request("emergency", { priority: 5, isEmergency: true })],
      [current],
      "EMERGENCY_REQUEST",
    );

    expect(result.assignments.map((item) => item.serviceRequestId)).toContain("emergency");
    expect(result.unassigned.map((item) => item.serviceRequestId)).toContain("low-priority");
    expect(result.changes.removedRequestIds).toContain("low-priority");
    expect(result.trigger).toBe("EMERGENCY_REQUEST");
  });

  it("does not resurrect a cancelled request", () => {
    const result = replan([technician("tech-a")], [request("cancelled", { status: "CANCELLED" })], []);

    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0]?.reasons.map((reason) => reason.code)).toContain("REQUEST_NOT_SCHEDULABLE");
  });
});
