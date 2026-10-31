import { describe, expect, it } from "vitest";

import type { Assignment, ServiceRequest, Technician } from "../domain/index.js";
import { proposeDispatchPlan, type AiPlanProvider } from "./planning-agent.js";

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 30, hour, minute));
const window = (start: number, end: number) => ({ start: at(start), end: at(end) });

const technician: Technician = {
  id: "tech-a",
  name: "Asha",
  skills: ["HVAC"],
  assignedRegions: ["CENTRAL"],
  maximumWorkloadMinutes: 480,
  status: "ACTIVE",
  workingHours: window(4, 12),
  availability: [window(4, 12)],
};

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

const provider = (payload: unknown): AiPlanProvider => ({ propose: async () => payload });

const base = {
  context: { planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata" },
  technicians: [technician],
  requests: [request("request-a"), request("request-b")],
};

const emptyAnalysis = { tradeoffs: [], riskyAssignments: [], missingInformation: [], dispatcherQuestions: [] };

describe("AI dispatch planning agent", () => {
  it("returns the deterministic plan and always requires dispatcher approval", async () => {
    const plan = await proposeDispatchPlan(base);

    expect(plan.source).toBe("DETERMINISTIC");
    expect(plan.persisted).toBe(false);
    expect(plan.requiresApproval).toBe(true);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.warnings.join(" ")).toContain("No AI model");
  });

  it("rejects unknown technicians and out-of-window suggestions, falling back safely", async () => {
    const plan = await proposeDispatchPlan(base, provider({
      summary: "bad plan",
      assignments: [
        { technicianId: "tech-missing", serviceRequestId: "request-a", start: at(4).toISOString(), end: at(5).toISOString() },
        { technicianId: "tech-a", serviceRequestId: "request-b", start: at(20).toISOString(), end: at(21).toISOString() },
      ],
      ...emptyAnalysis,
    }));

    expect(plan.source).toBe("DETERMINISTIC");
    expect(plan.assignments).toHaveLength(2);
    expect(plan.warnings.join(" ")).toContain("failed hard-constraint validation");
    expect(plan.assignments.every((assignment) => assignment.technicianId === "tech-a")).toBe(true);
  });

  it("accepts a valid AI plan but rejects a suggested double-booking", async () => {
    const plan = await proposeDispatchPlan(base, provider({
      summary: "Prioritize the first request.",
      assignments: [
        { technicianId: "tech-a", serviceRequestId: "request-a", start: at(4).toISOString(), end: at(5).toISOString() },
        { technicianId: "tech-a", serviceRequestId: "request-b", start: at(4, 30).toISOString(), end: at(5, 30).toISOString() },
      ],
      ...emptyAnalysis,
    }));

    expect(plan.source).toBe("AI");
    expect(plan.assignments).toHaveLength(1);
    expect(plan.rejectedSuggestions).toHaveLength(1);
    expect(plan.rejectedSuggestions[0]?.reasons.map((reason) => reason.code)).toContain("OVERLAPPING_ASSIGNMENT");
    expect(plan.warnings.join(" ")).toContain("rejected by deterministic validation");
  });

  it("flags unassigned risky work and asks for missing information", async () => {
    const plan = await proposeDispatchPlan({
      ...base,
      requests: [request("request-a"), request("emergency", { requiredSkill: "Electrical", isEmergency: true, priority: 5 })],
    });

    expect(plan.unassignedRequests).toContainEqual(expect.objectContaining({ serviceRequestId: "emergency", risk: "CRITICAL" }));
    expect(plan.dispatcherQuestions.join(" ")).toContain("certified");
    expect(plan.dispatcherQuestions.join(" ")).toContain("emergency contact");
    expect(plan.missingInformation.length).toBeGreaterThan(0);
  });

  it("never lets an AI suggestion replace completed work", async () => {
    const completed: Assignment = {
      id: "done-a",
      technicianId: "tech-a",
      serviceRequestId: "request-a",
      interval: window(4, 5),
      status: "COMPLETED",
    };
    const plan = await proposeDispatchPlan({
      context: base.context,
      technicians: [technician],
      requests: [request("request-a", { status: "COMPLETED" }), request("request-b")],
      currentAssignments: [completed],
    }, provider({
      summary: "Move completed work.",
      assignments: [
        { technicianId: "tech-a", serviceRequestId: "request-a", start: at(6).toISOString(), end: at(7).toISOString() },
        { technicianId: "tech-a", serviceRequestId: "request-b", start: at(5).toISOString(), end: at(6).toISOString() },
      ],
      ...emptyAnalysis,
    }));

    expect(plan.assignments).toContainEqual(completed);
    expect(plan.assignments.filter((assignment) => assignment.serviceRequestId === "request-a")).toHaveLength(1);
  });
});
