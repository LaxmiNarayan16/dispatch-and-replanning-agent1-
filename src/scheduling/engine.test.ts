import { describe, expect, it } from "vitest";

import type { Assignment, ServiceRequest, Technician } from "../domain/index.js";
import { generateSchedule } from "./index.js";

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 30, hour, minute));
const window = (startHour: number, endHour: number) => ({ start: at(startHour), end: at(endHour) });

const technician = (overrides: Partial<Technician> = {}): Technician => ({
  id: "tech-a",
  name: "Asha Patel",
  skills: ["ELECTRICAL"],
  assignedRegions: ["NORTH"],
  maximumWorkloadMinutes: 480,
  status: "ACTIVE",
  workingHours: window(4, 12),
  availability: [window(4, 12)],
  ...overrides,
});

const request = (overrides: Partial<ServiceRequest> = {}): ServiceRequest => ({
  id: "request-a",
  title: "Replace control unit",
  region: "NORTH",
  requiredSkill: "ELECTRICAL",
  priority: 5,
  estimatedDurationMinutes: 60,
  status: "PENDING",
  isEmergency: false,
  ...overrides,
});

const protectedAssignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: "protected-a",
  technicianId: "tech-a",
  serviceRequestId: "completed-a",
  interval: window(4, 5),
  status: "COMPLETED",
  ...overrides,
});

function plan(technicians: Technician[], requests: ServiceRequest[], protectedAssignments: Assignment[] = []) {
  return generateSchedule({
    context: { planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata" },
    technicians,
    requests,
    protectedAssignments,
    slotIntervalMinutes: 60,
  });
}

describe("deterministic scheduling engine", () => {
  it("assigns an eligible request and produces stable output", () => {
    const input = [technician()];
    const requests = [request()];
    const first = plan(input, requests);
    const second = plan(input, requests);

    expect(first.assignments).toHaveLength(1);
    expect(first.assignments).toEqual(second.assignments);
    expect(first.metadata.optimality).toBe("PROVEN");
  });

  it("matches skills and regions regardless of entered casing or surrounding whitespace", () => {
    const result = plan(
      [technician({ skills: [" electrician "], assignedRegions: ["south delhi"] })],
      [request({ requiredSkill: "ELECTRICIAN", region: " SOUTH DELHI " })],
    );

    expect(result.assignments).toHaveLength(1);
  });

  it("rejects a skill mismatch", () => {
    const result = plan([technician({ skills: ["HVAC"] })], [request()]);

    expect(result.unassigned[0]?.reasons.map((item) => item.code)).toContain("SKILL_MISMATCH");
  });

  it("rejects a region mismatch", () => {
    const result = plan([technician({ assignedRegions: ["SOUTH"] })], [request()]);

    expect(result.unassigned[0]?.reasons.map((item) => item.code)).toContain("REGION_MISMATCH");
  });

  it("rejects a request that cannot fit availability", () => {
    const result = plan([technician({ availability: [window(4, 5)] })], [request({ estimatedDurationMinutes: 120 })]);

    expect(result.unassigned[0]?.reasons.map((item) => item.code)).toContain("OUTSIDE_AVAILABILITY");
  });

  it("enforces maximum workload", () => {
    const result = plan([technician({ maximumWorkloadMinutes: 60 })], [request(), request({ id: "request-b", priority: 4 })]);

    expect(result.assignments.filter((item) => item.status === "PROPOSED")).toHaveLength(1);
    expect(result.unassigned).toHaveLength(1);
  });

  it("avoids overlaps while allowing adjacent work", () => {
    const result = plan(
      [technician({ availability: [window(4, 6)] })],
      [request(), request({ id: "request-b", priority: 4 })],
    );

    const proposed = result.assignments.filter((item) => item.status === "PROPOSED");
    expect(proposed).toHaveLength(2);
    expect(proposed[0]?.interval.end).toEqual(proposed[1]?.interval.start);
  });

  it("preserves completed work and schedules future work around it", () => {
    const completed = protectedAssignment();
    const result = plan([technician()], [request()], [completed]);

    expect(result.assignments).toContainEqual(completed);
    expect(result.assignments.find((item) => item.status === "PROPOSED")?.interval.start).toEqual(at(5));
  });
});
