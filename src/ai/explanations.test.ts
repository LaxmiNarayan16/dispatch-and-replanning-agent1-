import { describe, expect, it } from "vitest";

import { explainSchedule, type AiExplanationProvider } from "./explanations.js";
import type { ScheduleResult } from "../scheduling/index.js";

const result: ScheduleResult = {
  assignments: [{
    id: "a-1", technicianId: "tech-1", serviceRequestId: "request-1",
    interval: { start: new Date("2026-10-30T04:00:00.000Z"), end: new Date("2026-10-30T05:00:00.000Z") }, status: "PROPOSED",
  }],
  unassigned: [{ serviceRequestId: "request-2", reasons: [{ code: "SKILL_MISMATCH", message: "No eligible technician." }] }],
  validation: [],
  objective: { total: 10_000, assignedCount: 1, priorityScore: 0, preferredWindowMatches: 0, workloadImbalancePenalty: 0 },
  metadata: { algorithm: "bounded-deterministic-backtracking", exploredNodes: 2, searchLimitReached: false, optimality: "PROVEN" },
};

const validProvider: AiExplanationProvider = {
  async explain() {
    return {
      summary: "One request is scheduled.", tradeoffs: [], missingInformation: [], dispatcherQuestions: [],
      highRiskAssignments: [{ serviceRequestId: "request-1", technicianId: "tech-1", risk: "Tight window", mitigation: "Confirm access." }],
      unassignedExplanations: [{ serviceRequestId: "request-2", explanation: "No eligible technician." }],
    };
  },
};

describe("AI schedule explanations", () => {
  it("accepts structured explanations that reference only actual results", async () => {
    await expect(explainSchedule(result, validProvider)).resolves.toMatchObject({ available: true });
  });

  it("falls back when the AI provider is unavailable", async () => {
    const unavailable: AiExplanationProvider = { async explain() { throw new Error("unavailable"); } };
    await expect(explainSchedule(result, unavailable)).resolves.toMatchObject({ available: false, warning: expect.stringContaining("unavailable") });
  });

  it("rejects AI references to a nonexistent assignment", async () => {
    const invalid: AiExplanationProvider = {
      async explain() {
        return {
          summary: "bad", tradeoffs: [], missingInformation: [], dispatcherQuestions: [],
          highRiskAssignments: [{ serviceRequestId: "unknown", technicianId: "tech-1", risk: "bad", mitigation: "bad" }], unassignedExplanations: [],
        };
      },
    };
    await expect(explainSchedule(result, invalid)).resolves.toMatchObject({ available: false, warning: expect.stringContaining("referenced") });
  });
});
