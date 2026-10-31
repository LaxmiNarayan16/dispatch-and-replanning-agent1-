import { z } from "zod";

import {
  containsInterval,
  durationMinutes,
  isSupportedTimeZone,
  type Assignment,
  type PlanningContext,
  type ServiceRequest,
  type Technician,
  type TimeInterval,
} from "../domain/index.js";
import {
  generateSchedule,
  scoreAssignments,
  validateManualAssignment,
  type ObjectiveScore,
  type RejectionReason,
  type ScheduleResult,
} from "../scheduling/index.js";

const suggestionSchema = z.object({
  technicianId: z.string().min(1),
  serviceRequestId: z.string().min(1),
  start: z.coerce.date(),
  end: z.coerce.date(),
});

const aiPlanSchema = z.object({
  summary: z.string().min(1).max(2_000),
  assignments: z.array(suggestionSchema).max(500),
  tradeoffs: z.array(z.string().min(1).max(500)).max(10),
  riskyAssignments: z.array(z.object({
    serviceRequestId: z.string().min(1),
    technicianId: z.string().min(1),
    risk: z.string().min(1).max(500),
    mitigation: z.string().min(1).max(500),
  })).max(50),
  missingInformation: z.array(z.string().min(1).max(500)).max(20),
  dispatcherQuestions: z.array(z.string().min(1).max(500)).max(20),
}).strict();

export type AiPlanResponse = z.infer<typeof aiPlanSchema>;

/** Optional pluggable model adapter. The model's output is always untrusted. */
export interface AiPlanProvider {
  propose(facts: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface RejectedSuggestion {
  readonly technicianId: string;
  readonly serviceRequestId: string;
  readonly start: string;
  readonly end: string;
  readonly reasons: readonly RejectionReason[];
}

export interface RiskyAssignment {
  readonly serviceRequestId: string;
  readonly technicianId: string;
  readonly risk: string;
  readonly mitigation: string;
}

export interface AgentUnassignedRequest {
  readonly serviceRequestId: string;
  readonly title: string;
  readonly priority: number;
  readonly risk: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly reasons: readonly RejectionReason[];
}

export interface DispatchPlanProposal {
  readonly planId: string;
  /** The agent never confirms work. A dispatcher must approve a persisted version. */
  readonly requiresApproval: true;
  readonly persisted: false;
  readonly source: "AI" | "DETERMINISTIC";
  readonly summary: string;
  readonly assignments: readonly Assignment[];
  readonly rejectedSuggestions: readonly RejectedSuggestion[];
  readonly objective: ObjectiveScore;
  readonly tradeoffs: readonly string[];
  readonly riskyAssignments: readonly RiskyAssignment[];
  readonly unassignedRequests: readonly AgentUnassignedRequest[];
  readonly missingInformation: readonly string[];
  readonly dispatcherQuestions: readonly string[];
  readonly warnings: readonly string[];
}

export interface DispatchPlanInput {
  readonly context: PlanningContext;
  readonly technicians: readonly Technician[];
  readonly requests: readonly ServiceRequest[];
  readonly currentAssignments?: readonly Assignment[];
}

const isProtected = (assignment: Assignment) => assignment.status === "COMPLETED" || assignment.status === "IN_PROGRESS";

function proposedAssignments(result: ScheduleResult): readonly Assignment[] {
  return result.assignments.filter((assignment) => !isProtected(assignment));
}

function validationReasons(technician: Technician | undefined, request: ServiceRequest | undefined, interval: TimeInterval): RejectionReason[] {
  if (!technician) return [{ code: "TECHNICIAN_NOT_FOUND", message: "Suggested technician does not exist." }];
  if (!request) return [{ code: "REQUEST_NOT_FOUND", message: "Suggested service request does not exist." }];
  if (!Number.isFinite(interval.start.getTime()) || !Number.isFinite(interval.end.getTime()) || interval.start >= interval.end) {
    return [{ code: "INVALID_INTERVAL", message: "Suggested interval must have a valid start before its end." }];
  }
  return [];
}

interface ValidatedSuggestions {
  readonly assignments: readonly Assignment[];
  readonly rejected: readonly RejectedSuggestion[];
}

/**
 * Validates every AI suggestion with the deterministic hard-constraint
 * validator before it can appear in the proposal. Unknown technicians,
 * malformed windows, ineligible work, double-booking, and workload overflow
 * are rejected one by one; accepted rows are re-checked against each other.
 */
export function validateAiSuggestions(
  suggestions: readonly z.infer<typeof suggestionSchema>[],
  technicians: readonly Technician[],
  requests: readonly ServiceRequest[],
  protectedAssignments: readonly Assignment[],
): ValidatedSuggestions {
  const accepted: Assignment[] = [...protectedAssignments];
  const rejected: RejectedSuggestion[] = [];

  for (const suggestion of suggestions) {
    const technician = technicians.find((item) => item.id === suggestion.technicianId);
    const request = requests.find((item) => item.id === suggestion.serviceRequestId);
    const interval = { start: suggestion.start, end: suggestion.end };
    let reasons = validationReasons(technician, request, interval);
    if (reasons.length === 0 && technician && request) {
      reasons = [...validateManualAssignment({ technician, request, interval, existingAssignments: accepted })];
    }
    if (reasons.length > 0) {
      rejected.push({
        technicianId: suggestion.technicianId,
        serviceRequestId: suggestion.serviceRequestId,
        start: Number.isFinite(interval.start.getTime()) ? interval.start.toISOString() : "",
        end: Number.isFinite(interval.end.getTime()) ? interval.end.toISOString() : "",
        reasons,
      });
      continue;
    }
    accepted.push({
      id: `ai:${suggestion.serviceRequestId}:${suggestion.technicianId}:${interval.start.toISOString()}`,
      technicianId: suggestion.technicianId,
      serviceRequestId: suggestion.serviceRequestId,
      interval,
      status: "PROPOSED",
    });
  }

  return { assignments: accepted, rejected };
}

function questionsFor(reasons: readonly RejectionReason[], request: ServiceRequest): string[] {
  const questions: string[] = [];
  const codes = new Set(reasons.map((reason) => reason.code));
  if (codes.has("SKILL_MISMATCH")) questions.push(`Can another technician be certified for ${request.requiredSkill}, or is the required skill on ${request.title} incorrect?`);
  if (codes.has("REGION_MISMATCH")) questions.push(`Is a cross-region visit approved for ${request.title} in ${request.region}, or is the region wrong?`);
  if (codes.has("OUTSIDE_AVAILABILITY") || codes.has("OUTSIDE_WORKING_HOURS")) questions.push(`Can a technician extend availability to cover ${request.title}, or should the customer choose another window?`);
  if (codes.has("WORKLOAD_LIMIT_EXCEEDED")) questions.push(`Can the daily workload cap be raised, or should ${request.title} be split across technicians?`);
  if (codes.has("NO_FEASIBLE_CANDIDATE")) questions.push(`Is the ${request.estimatedDurationMinutes}-minute estimate for ${request.title} accurate, and is a tighter customer window required?`);
  return questions;
}

function analyse(
  assignments: readonly Assignment[],
  technicians: readonly Technician[],
  requests: readonly ServiceRequest[],
  deterministic: ScheduleResult,
): Pick<DispatchPlanProposal, "tradeoffs" | "riskyAssignments" | "unassignedRequests" | "missingInformation" | "dispatcherQuestions"> {
  const assignedIds = new Set(assignments.map((assignment) => assignment.serviceRequestId));
  const reasonsByRequest = new Map(deterministic.unassigned.map((item) => [item.serviceRequestId, item.reasons]));
  const unassignedRequests: AgentUnassignedRequest[] = requests
    .filter((request) => request.status !== "CANCELLED" && request.status !== "COMPLETED" && !assignedIds.has(request.id))
    .map((request) => ({
      serviceRequestId: request.id,
      title: request.title,
      priority: request.priority,
      risk: request.isEmergency || request.priority >= 5 ? "CRITICAL" : request.priority >= 4 ? "HIGH" : "MEDIUM",
      reasons: reasonsByRequest.get(request.id) ?? [{ code: "UNASSIGNED", message: "The proposed plan leaves this request unassigned." }],
    }));

  const workload = new Map<string, number>();
  for (const assignment of assignments) {
    workload.set(assignment.technicianId, (workload.get(assignment.technicianId) ?? 0) + durationMinutes(assignment.interval));
  }

  const riskyAssignments: RiskyAssignment[] = [];
  for (const assignment of assignments) {
    const request = requests.find((item) => item.id === assignment.serviceRequestId);
    const technician = technicians.find((item) => item.id === assignment.technicianId);
    if (!request || !technician) continue;
    if (request.isEmergency) {
      riskyAssignments.push({
        serviceRequestId: request.id,
        technicianId: technician.id,
        risk: "Emergency work can displace lower-priority visits and still needs an explicit arrival commitment.",
        mitigation: "Confirm the emergency arrival window with the dispatcher before approval.",
      });
    } else if (request.preferredWindow && !containsInterval(request.preferredWindow, assignment.interval)) {
      riskyAssignments.push({
        serviceRequestId: request.id,
        technicianId: technician.id,
        risk: "Assignment sits outside the customer's preferred window.",
        mitigation: "Obtain customer agreement or move the visit before approval.",
      });
    } else if ((workload.get(technician.id) ?? 0) > technician.maximumWorkloadMinutes * 0.8) {
      riskyAssignments.push({
        serviceRequestId: request.id,
        technicianId: technician.id,
        risk: "Technician is above 80% of the daily workload cap.",
        mitigation: "Keep a travel/overrun buffer or rebalance one visit.",
      });
    }
  }

  const questions = [...new Set(unassignedRequests.flatMap((item) => {
    const request = requests.find((value) => value.id === item.serviceRequestId);
    return request ? questionsFor(item.reasons, request) : [];
  }))];
  for (const item of unassignedRequests) {
    const request = requests.find((value) => value.id === item.serviceRequestId);
    if (request?.isEmergency && !request.notes) questions.push(`What is the emergency contact and latest acceptable arrival for ${request.title}?`);
    if (request && request.preferredWindow === undefined && request.priority >= 4) questions.push(`What is the customer's latest acceptable arrival time for ${request.title}?`);
  }

  const missingInformation = [
    ...(deterministic.validation.length > 0 ? ["Planning context has validation errors that must be corrected."] : []),
    ...(deterministic.metadata.searchLimitReached ? ["The search limit was reached; the plan is best-known rather than proven optimal."] : []),
    ...(requests.some((request) => request.isEmergency && !request.notes) ? ["One or more emergency requests have no operational notes."] : []),
    ...(requests.some((request) => request.preferredWindow === undefined && request.priority >= 4) ? ["High-priority requests are missing preferred or required windows."] : []),
  ];

  const tradeoffs = [
    `The proposal assigns ${assignments.length} of ${requests.filter((request) => request.status !== "CANCELLED" && request.status !== "COMPLETED").length} active requests.`,
    ...(unassignedRequests.length === 0
      ? ["No request is left unassigned, so the main trade-off is technician workload balance rather than coverage."]
      : [`${unassignedRequests.length} request(s) remain unassigned; priority and emergency status decide which work wins constrained capacity.`]),
    "Completed and in-progress assignments are protected, so they are never moved to improve the score.",
    "The plan optimizes coverage, priority, preferred windows, and workload balance; it does not optimize travel time.",
    ...(assignments.some((assignment) => requests.find((request) => request.id === assignment.serviceRequestId)?.preferredWindow === undefined)
      ? ["Some accepted visits have no customer window, so the engine schedules them in available capacity."]
      : []),
  ];

  return {
    tradeoffs,
    riskyAssignments,
    unassignedRequests,
    missingInformation: [...new Set(missingInformation)],
    dispatcherQuestions: [...new Set(questions)],
  };
}

function deterministicPlan(
  deterministic: ScheduleResult,
  technicians: readonly Technician[],
  requests: readonly ServiceRequest[],
  warnings: readonly string[],
): DispatchPlanProposal {
  const analysis = analyse(deterministic.assignments, technicians, requests, deterministic);
  return {
    planId: `plan_${crypto.randomUUID()}`,
    requiresApproval: true,
    persisted: false,
    source: "DETERMINISTIC",
    summary: `Deterministic planner proposed ${deterministic.objective.assignedCount} assignments and left ${deterministic.unassigned.length} requests unassigned.`,
    assignments: deterministic.assignments,
    rejectedSuggestions: [],
    objective: deterministic.objective,
    ...analysis,
    warnings: [...warnings, ...deterministic.validation.map((item) => item.message)],
  };
}

function buildFacts(
  input: DispatchPlanInput,
  deterministic: ScheduleResult,
): Readonly<Record<string, unknown>> {
  return {
    context: input.context,
    technicians: input.technicians.map((technician) => ({
      id: technician.id,
      name: technician.name,
      status: technician.status,
      skills: technician.skills,
      regions: technician.assignedRegions,
      maximumWorkloadMinutes: technician.maximumWorkloadMinutes,
      workingHours: {
        start: technician.workingHours.start.toISOString(),
        end: technician.workingHours.end.toISOString(),
      },
      availability: technician.availability.map((window) => ({
        start: window.start.toISOString(),
        end: window.end.toISOString(),
      })),
    })),
    requests: input.requests.map((request) => ({
      id: request.id,
      title: request.title,
      region: request.region,
      requiredSkill: request.requiredSkill,
      priority: request.priority,
      estimatedDurationMinutes: request.estimatedDurationMinutes,
      preferredWindow: request.preferredWindow === undefined
        ? null
        : { start: request.preferredWindow.start.toISOString(), end: request.preferredWindow.end.toISOString() },
      status: request.status,
      isEmergency: request.isEmergency,
      notes: request.notes ?? null,
    })),
    protectedAssignments: deterministic.assignments.filter(isProtected).map((assignment) => ({
      technicianId: assignment.technicianId,
      serviceRequestId: assignment.serviceRequestId,
      start: assignment.interval.start.toISOString(),
      end: assignment.interval.end.toISOString(),
      status: assignment.status,
    })),
    deterministicResult: {
      assignments: deterministic.assignments.map((assignment) => ({
        technicianId: assignment.technicianId,
        serviceRequestId: assignment.serviceRequestId,
        start: assignment.interval.start.toISOString(),
        end: assignment.interval.end.toISOString(),
      })),
      unassigned: deterministic.unassigned,
      objective: deterministic.objective,
      metadata: deterministic.metadata,
    },
    instructions: [
      "Propose an assignment plan using only the listed technician and request IDs.",
      "Every assignment must fit working hours and one availability window, match skill and region, and use the request's exact duration.",
      "Never overlap two assignments for one technician and never assign one request twice.",
      "Treat completed and in-progress assignments as fixed.",
      "Explain trade-offs, identify risky or unassigned requests, and ask questions when information is missing.",
      "Do not claim the plan is approved; a dispatcher must approve it.",
    ].join(" "),
  };
}

/**
 * Runs the deterministic planner, optionally asks a configured model for an
 * alternative proposal, validates every suggested row, and returns advisory
 * analysis. It never persists a version or confirms an assignment.
 */
export async function proposeDispatchPlan(
  input: DispatchPlanInput,
  provider?: AiPlanProvider,
): Promise<DispatchPlanProposal> {
  const protectedAssignments = (input.currentAssignments ?? []).filter(isProtected);
  const deterministic = generateSchedule({
    context: input.context,
    technicians: input.technicians,
    requests: input.requests,
    protectedAssignments,
  });

  if (!provider) {
    return deterministicPlan(deterministic, input.technicians, input.requests, ["No AI model is configured; the validated deterministic plan is shown."]);
  }
  if (!isSupportedTimeZone(input.context.operationalTimezone)) {
    return deterministicPlan(deterministic, input.technicians, input.requests, ["The operational timezone is invalid; AI advice was skipped."]);
  }

  try {
    const parsed = aiPlanSchema.safeParse(await provider.propose(buildFacts(input, deterministic)));
    if (!parsed.success) {
      return deterministicPlan(deterministic, input.technicians, input.requests, ["AI output did not match the required structured schema; the deterministic plan is shown."]);
    }

    const validated = validateAiSuggestions(parsed.data.assignments, input.technicians, input.requests, protectedAssignments);
    const proposed = proposedAssignments({ ...deterministic, assignments: validated.assignments });
    if (proposed.length === 0 && proposedAssignments(deterministic).length > 0) {
      return deterministicPlan(deterministic, input.technicians, input.requests, [
        "Every AI-suggested assignment failed hard-constraint validation; the deterministic plan is shown instead.",
      ]);
    }

    const warnings = validated.rejected.length > 0
      ? [`${validated.rejected.length} AI suggestion(s) were rejected by deterministic validation.`]
      : [];
    const assignmentKeys = new Set(proposed.map((assignment) => `${assignment.serviceRequestId}:${assignment.technicianId}`));
    const invalidRisks = parsed.data.riskyAssignments.filter((item) => !assignmentKeys.has(`${item.serviceRequestId}:${item.technicianId}`));
    if (invalidRisks.length > 0) warnings.push("AI risk notes referenced assignments outside the validated plan and were discarded.");
    const analysis = analyse(validated.assignments, input.technicians, input.requests, deterministic);
    const knownUnassigned = new Set(analysis.unassignedRequests.map((item) => item.serviceRequestId));
    const aiQuestions = parsed.data.dispatcherQuestions;

    return {
      planId: `plan_${crypto.randomUUID()}`,
      requiresApproval: true,
      persisted: false,
      source: "AI",
      summary: parsed.data.summary,
      assignments: validated.assignments,
      rejectedSuggestions: validated.rejected,
      objective: scoreAssignments(validated.assignments, input.technicians, input.requests),
      ...analysis,
      riskyAssignments: parsed.data.riskyAssignments.filter((item) => !invalidRisks.includes(item)),
      missingInformation: [...new Set([...parsed.data.missingInformation, ...analysis.missingInformation])],
      dispatcherQuestions: [...new Set([...aiQuestions, ...analysis.dispatcherQuestions])],
      warnings,
    };
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message.slice(0, 200)})` : "";
    return deterministicPlan(deterministic, input.technicians, input.requests, [`AI provider was unavailable${detail}; the deterministic plan is shown.`]);
  }
}

/** Gemini-compatible JSON schema for providers that support structured output. */
export const aiPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          technicianId: { type: "string" },
          serviceRequestId: { type: "string" },
          start: { type: "string", format: "date-time" },
          end: { type: "string", format: "date-time" },
        },
        required: ["technicianId", "serviceRequestId", "start", "end"],
      },
    },
    tradeoffs: { type: "array", items: { type: "string" } },
    riskyAssignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          serviceRequestId: { type: "string" },
          technicianId: { type: "string" },
          risk: { type: "string" },
          mitigation: { type: "string" },
        },
        required: ["serviceRequestId", "technicianId", "risk", "mitigation"],
      },
    },
    missingInformation: { type: "array", items: { type: "string" } },
    dispatcherQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "assignments", "tradeoffs", "riskyAssignments", "missingInformation", "dispatcherQuestions"],
} as const;
