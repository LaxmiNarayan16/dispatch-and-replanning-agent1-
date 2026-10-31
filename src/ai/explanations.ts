import { z } from "zod";

import type { ScheduleResult } from "../scheduling/index.js";

const explanationSchema = z.object({
  summary: z.string().min(1).max(2_000),
  tradeoffs: z.array(z.string().min(1).max(500)).max(10),
  missingInformation: z.array(z.string().min(1).max(500)).max(10),
  dispatcherQuestions: z.array(z.string().min(1).max(500)).max(10),
  highRiskAssignments: z.array(z.object({
    serviceRequestId: z.string().min(1),
    technicianId: z.string().min(1),
    risk: z.string().min(1).max(500),
    mitigation: z.string().min(1).max(500),
  })).max(20),
  unassignedExplanations: z.array(z.object({
    serviceRequestId: z.string().min(1),
    explanation: z.string().min(1).max(1_000),
  })).max(100),
}).strict();

export type AiScheduleExplanation = z.infer<typeof explanationSchema>;

export interface AiExplanationProvider {
  explain(facts: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface AiExplanationResult {
  readonly available: boolean;
  readonly explanation: AiScheduleExplanation;
  readonly warning?: string;
}

function fallback(result: ScheduleResult, warning: string): AiExplanationResult {
  return {
    available: false,
    warning,
    explanation: {
      summary: `Deterministic planner proposed ${result.objective.assignedCount} assignments and left ${result.unassigned.length} requests unassigned.`,
      tradeoffs: ["AI explanation is unavailable; use deterministic constraint results shown for each request."],
      missingInformation: [],
      dispatcherQuestions: [],
      highRiskAssignments: [],
      unassignedExplanations: result.unassigned.map((item) => ({
        serviceRequestId: item.serviceRequestId,
        explanation: item.reasons.map((reason) => reason.message).join(" "),
      })),
    },
  };
}

function buildFacts(result: ScheduleResult): Readonly<Record<string, unknown>> {
  return {
    assignments: result.assignments.map((assignment) => ({
      technicianId: assignment.technicianId,
      serviceRequestId: assignment.serviceRequestId,
      startsAt: assignment.interval.start.toISOString(),
      endsAt: assignment.interval.end.toISOString(),
      status: assignment.status,
    })),
    unassigned: result.unassigned,
    objective: result.objective,
    metadata: result.metadata,
    instructions: "Explain only the supplied facts. Do not propose or create new assignments, technicians, requests, or time windows.",
  };
}

function validateReferences(explanation: AiScheduleExplanation, result: ScheduleResult): string | undefined {
  const assignmentKeys = new Set(result.assignments.map((item) => `${item.serviceRequestId}:${item.technicianId}`));
  const unassignedIds = new Set(result.unassigned.map((item) => item.serviceRequestId));
  if (explanation.highRiskAssignments.some((item) => !assignmentKeys.has(`${item.serviceRequestId}:${item.technicianId}`))) {
    return "AI output referenced an assignment that is not present in the deterministic result.";
  }
  if (explanation.unassignedExplanations.some((item) => !unassignedIds.has(item.serviceRequestId))) {
    return "AI output referenced a request that is not unassigned in the deterministic result.";
  }
  return undefined;
}

export async function explainSchedule(result: ScheduleResult, provider?: AiExplanationProvider): Promise<AiExplanationResult> {
  if (!provider) return fallback(result, "No AI provider is configured.");
  try {
    const parsed = explanationSchema.safeParse(await provider.explain(buildFacts(result)));
    if (!parsed.success) return fallback(result, "AI response did not match the required structured schema.");
    const invalidReference = validateReferences(parsed.data, result);
    if (invalidReference) return fallback(result, invalidReference);
    return { available: true, explanation: parsed.data };
  } catch {
    return fallback(result, "AI provider was unavailable; deterministic planning completed normally.");
  }
}

export const aiExplanationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    tradeoffs: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    dispatcherQuestions: { type: "array", items: { type: "string" } },
    highRiskAssignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          serviceRequestId: { type: "string" }, technicianId: { type: "string" }, risk: { type: "string" }, mitigation: { type: "string" },
        },
        required: ["serviceRequestId", "technicianId", "risk", "mitigation"],
      },
    },
    unassignedExplanations: {
      type: "array",
      items: {
        type: "object",
        properties: { serviceRequestId: { type: "string" }, explanation: { type: "string" } },
        required: ["serviceRequestId", "explanation"],
      },
    },
  },
  required: ["summary", "tradeoffs", "missingInformation", "dispatcherQuestions", "highRiskAssignments", "unassignedExplanations"],
} as const;
