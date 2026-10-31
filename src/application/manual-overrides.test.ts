import { describe, expect, it } from "vitest";

import type { Assignment, ServiceRequest, Technician } from "../domain/index.js";
import { applyManualOverride, InvalidManualOverrideError } from "./index.js";

const interval = (start: number, end: number) => ({ start: new Date(Date.UTC(2026, 9, 30, start)), end: new Date(Date.UTC(2026, 9, 30, end)) });
const tech: Technician = { id: "tech-a", name: "Asha", skills: ["HVAC"], assignedRegions: ["CENTRAL"], maximumWorkloadMinutes: 480, status: "ACTIVE", workingHours: interval(4, 12), availability: [interval(4, 12)] };
const request: ServiceRequest = { id: "request-a", title: "Inspection", region: "CENTRAL", requiredSkill: "HVAC", priority: 3, estimatedDurationMinutes: 60, status: "PENDING", isEmergency: false };
const protectedAssignment: Assignment = { id: "a-1", technicianId: "tech-a", serviceRequestId: "request-a", interval: interval(4, 5), status: "COMPLETED" };

describe("manual overrides", () => {
  it("accepts a valid dispatcher assignment as a new draft", () => {
    const assignments = applyManualOverride([tech], [request], [], { technicianId: "tech-a", serviceRequestId: "request-a", interval: interval(5, 6) });
    expect(assignments).toContainEqual(expect.objectContaining({ technicianId: "tech-a", status: "PROPOSED" }));
  });

  it("rejects an invalid dispatcher assignment with a constraint reason", () => {
    expect(() => applyManualOverride([tech], [request], [], { technicianId: "tech-a", serviceRequestId: "request-a", interval: interval(12, 13) })).toThrow(InvalidManualOverrideError);
    try {
      applyManualOverride([tech], [request], [], { technicianId: "tech-a", serviceRequestId: "request-a", interval: interval(12, 13) });
    } catch (error) {
      expect((error as InvalidManualOverrideError).reasons.map((reason) => reason.code)).toContain("OUTSIDE_WORKING_HOURS");
    }
  });

  it("rejects changes to completed work", () => {
    expect(() => applyManualOverride([tech], [request], [protectedAssignment], { technicianId: "tech-a", serviceRequestId: "request-a", interval: interval(5, 6) })).toThrow(InvalidManualOverrideError);
  });
});
