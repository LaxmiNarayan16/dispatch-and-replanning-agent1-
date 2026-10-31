import { randomUUID } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { type Assignment, type ServiceRequest, type Technician } from "../domain/index.js";
import { generateSchedule, scoreAssignments } from "../scheduling/index.js";
import { proposeDispatchPlan, validateAiSuggestions, type AiPlanProvider, type DispatchPlanProposal } from "../ai/index.js";
import { AuthenticationError, AuthService, AuthorizationError, InvalidManualOverrideError, ScheduleVersionService, VersionConflictError, VersionStateError, type AuthUser, type ScheduleVersionDraft } from "../application/index.js";
import { DispatchWorkflow, type ServiceRequestDraft, type TechnicianDraft } from "../application/index.js";
import { AppError } from "./errors.js";
import type { NotificationRepository } from "../infrastructure/prisma-notification-repository.js";

const intervalSchema = z
  .object({ start: z.coerce.date(), end: z.coerce.date() })
  .refine((value) => value.start < value.end, { message: "end must be later than start", path: ["end"] });

const technicianSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  skills: z.array(z.string().min(1)).min(1),
  assignedRegions: z.array(z.string().min(1)).min(1),
  maximumWorkloadMinutes: z.number().int().positive(),
  status: z.enum(["ACTIVE", "UNAVAILABLE", "CANCELLED"]),
  workingHours: intervalSchema,
  availability: z.array(intervalSchema).min(1),
});

const requestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  region: z.string().min(1),
  requiredSkill: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  estimatedDurationMinutes: z.number().int().positive(),
  preferredWindow: intervalSchema.optional(),
  status: z.enum(["PENDING", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  notes: z.string().optional(),
  isEmergency: z.boolean(),
});

const assignmentSchema = z.object({
  id: z.string().min(1),
  technicianId: z.string().min(1),
  serviceRequestId: z.string().min(1),
  interval: intervalSchema,
  status: z.enum(["PROPOSED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
});

const previewSchema = z.object({
  context: z.object({
    planningDate: z.string().date(),
    operationalTimezone: z.string().min(1),
  }),
  technicians: z.array(technicianSchema),
  requests: z.array(requestSchema),
  protectedAssignments: z.array(assignmentSchema).default([]),
  slotIntervalMinutes: z.number().int().positive().optional(),
  maxSearchNodes: z.number().int().positive().optional(),
});

const versionDraftSchema = z.object({
  planningDate: z.string().date(),
  operationalTimezone: z.string().min(1),
  parentVersionId: z.string().min(1).optional(),
  trigger: z.enum(["INITIAL_PLAN", "TECHNICIAN_CANCELLATION", "TECHNICIAN_UNAVAILABILITY", "EMERGENCY_REQUEST", "REQUEST_CANCELLATION", "DURATION_CHANGE", "AVAILABILITY_CHANGE", "MANUAL_OVERRIDE"]),
  triggerReason: z.string().trim().min(1).max(1_000).optional(),
  assignments: z.array(assignmentSchema),
  unassignedRequests: z.array(z.object({ serviceRequestId: z.string().min(1), reasons: z.array(z.object({ code: z.string(), message: z.string() })) })),
  validationResult: z.array(z.object({ code: z.string(), message: z.string() })),
  objectiveScore: z.object({ total: z.number(), assignedCount: z.number().int().nonnegative(), priorityScore: z.number(), preferredWindowMatches: z.number().int().nonnegative(), workloadImbalancePenalty: z.number() }),
  optimizationMetadata: z.record(z.unknown()),
  dispatcherId: z.string().trim().min(1).max(120).optional(),
});

const approvalSchema = z.object({}).strict();
const rejectionSchema = z.object({ reason: z.string().trim().min(1).max(1_000) }).strict();
const technicianDraftSchema = technicianSchema.omit({ id: true, workingHours: true }).extend({ availability: z.array(intervalSchema).min(1) });
const serviceRequestDraftSchema = requestSchema.omit({ id: true });
const generateSchema = z.object({ planningDate: z.string().date(), operationalTimezone: z.string().min(1), trigger: versionDraftSchema.shape.trigger.optional(), triggerReason: z.string().trim().min(1).max(1_000).optional() });
const workbenchQuerySchema = z.object({ planningDate: z.string().date() });
const bootstrapSchema = z.object({ email: z.string().email(), displayName: z.string().trim().min(2).max(120), password: z.string().min(12).max(256) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(256) });
const manualOverrideSchema = z.object({
  planningDate: z.string().date(),
  operationalTimezone: z.string().min(1),
  technicianId: z.string().min(1),
  serviceRequestId: z.string().min(1),
  start: z.coerce.date(),
  end: z.coerce.date(),
  reason: z.string().trim().min(1).max(1_000),
}).refine((value) => value.start < value.end, { message: "end must be later than start", path: ["end"] });
const aiPlanSchema = z.object({
  planningDate: z.string().date(),
  operationalTimezone: z.string().min(1),
});
const aiPlanProposeSchema = aiPlanSchema.extend({
  assignments: z.array(z.object({
    technicianId: z.string().min(1),
    serviceRequestId: z.string().min(1),
    start: z.coerce.date(),
    end: z.coerce.date(),
  })).max(500).optional(),
});

export interface AppDependencies {
  readonly versionService?: ScheduleVersionService;
  readonly dispatchWorkflow?: DispatchWorkflow;
  readonly authService?: AuthService;
  readonly aiProvider?: AiPlanProvider;
  readonly notificationRepository?: NotificationRepository;
  readonly isDatabaseReady?: () => Promise<boolean>;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      actor?: AuthUser;
    }
  }
}

function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction): void {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : undefined;
  const parserType = typeof error === "object" && error !== null && "type" in error ? (error as { type?: unknown }).type : undefined;
  if (parserType === "entity.parse.failed") {
    response.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." }, requestId: request.requestId });
    return;
  }
  if (status === 413 || parserType === "entity.too.large") {
    response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload exceeds the 1 MB limit." }, requestId: request.requestId });
    return;
  }
  if (error instanceof z.ZodError) {
    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Request payload is invalid.", details: error.flatten() },
      requestId: request.requestId,
    });
    return;
  }
  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: { code: error.code, message: error.message }, requestId: request.requestId });
    return;
  }
  if (error instanceof VersionConflictError) {
    response.status(409).json({ error: { code: "VERSION_CONFLICT", message: error.message }, requestId: request.requestId });
    return;
  }
  if (error instanceof VersionStateError) {
    response.status(422).json({ error: { code: "INVALID_VERSION_STATE", message: error.message }, requestId: request.requestId });
    return;
  }
  if (error instanceof InvalidManualOverrideError) {
    response.status(422).json({
      error: { code: "INVALID_MANUAL_OVERRIDE", message: error.message, details: error.reasons },
      requestId: request.requestId,
    });
    return;
  }
  if (error instanceof AuthenticationError) {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: error.message }, requestId: request.requestId });
    return;
  }
  if (error instanceof AuthorizationError) {
    response.status(403).json({ error: { code: "FORBIDDEN", message: error.message }, requestId: request.requestId });
    return;
  }
  if (code === "P2025") {
    response.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "The requested record no longer exists." }, requestId: request.requestId });
    return;
  }
  if (code === "P2002") {
    response.status(409).json({ error: { code: "DUPLICATE_RECORD", message: "A record with those unique details already exists." }, requestId: request.requestId });
    return;
  }
  if (code === "P2003") {
    response.status(409).json({ error: { code: "REFERENCE_CONFLICT", message: "This change conflicts with related operational records." }, requestId: request.requestId });
    return;
  }
  console.error(JSON.stringify({ event: "unhandled_api_error", requestId: request.requestId, path: request.path, method: request.method, error: error instanceof Error ? error.name : "UnknownError" }));
  response.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    requestId: request.requestId,
  });
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    request.requestId = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const requireActor = async (request: Request, roles?: readonly AuthUser["role"][]): Promise<AuthUser> => {
    if (!dependencies.authService) throw new AppError("AUTH_UNAVAILABLE", "Authentication is not configured.", 503);
    const header = request.header("authorization");
    if (!header?.startsWith("Bearer ")) throw new AuthenticationError("A bearer session token is required.");
    const actor = await dependencies.authService.authenticate(header.slice(7));
    if (roles && !roles.includes(actor.role)) throw new AuthorizationError("Your role is not permitted to perform this action.");
    request.actor = actor;
    return actor;
  };

  app.get("/api/v1/health", async (_request, response, next) => {
    try {
      const database = dependencies.isDatabaseReady ? await dependencies.isDatabaseReady() : false;
      response.status(database ? 200 : 503).json({ status: database ? "ok" : "degraded", database });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/bootstrap", async (request, response, next) => {
    try {
      if (!dependencies.authService) throw new AppError("AUTH_UNAVAILABLE", "Authentication is not configured.", 503);
      const user = await dependencies.authService.bootstrap(bootstrapSchema.parse(request.body));
      const session = await dependencies.authService.login(request.body.email, request.body.password);
      response.status(201).json({ data: { user, token: session.token }, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/login", async (request, response, next) => {
    try {
      if (!dependencies.authService) throw new AppError("AUTH_UNAVAILABLE", "Authentication is not configured.", 503);
      response.status(200).json({ data: await dependencies.authService.login(loginSchema.parse(request.body).email, request.body.password), requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/auth/me", async (request, response, next) => {
    try { response.status(200).json({ data: await requireActor(request), requestId: request.requestId }); } catch (error) { next(error); }
  });

  app.get("/api/v1/notifications", async (request, response, next) => {
    try {
      await requireActor(request);
      if (!dependencies.notificationRepository) throw new AppError("PERSISTENCE_UNAVAILABLE", "Notification storage is not configured.", 503);
      response.status(200).json({ data: await dependencies.notificationRepository.list(), requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/notifications/:notificationId/acknowledge", async (request, response, next) => {
    try {
      await requireActor(request);
      if (!dependencies.notificationRepository) throw new AppError("PERSISTENCE_UNAVAILABLE", "Notification storage is not configured.", 503);
      const acknowledged = await dependencies.notificationRepository.acknowledge(z.string().min(1).parse(request.params.notificationId));
      response.status(200).json({ data: { acknowledged }, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/schedules/preview", (request, response, next) => {
    try {
      const input = previewSchema.parse(request.body);
      const result = generateSchedule({
        context: input.context,
        technicians: input.technicians as Technician[],
        requests: input.requests as ServiceRequest[],
        protectedAssignments: input.protectedAssignments as Assignment[],
        ...(input.slotIntervalMinutes === undefined ? {} : { slotIntervalMinutes: input.slotIntervalMinutes }),
        ...(input.maxSearchNodes === undefined ? {} : { maxSearchNodes: input.maxSearchNodes }),
      });
      response.status(200).json({ data: result, requestId: request.requestId });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/technicians", async (_request, response, next) => {
    try {
      await requireActor(_request);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      response.status(200).json({ data: await dependencies.dispatchWorkflow.listTechnicians(), requestId: response.req.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/technicians", async (request, response, next) => {
    try {
      await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const draft = technicianDraftSchema.parse(request.body);
      const technician = await dependencies.dispatchWorkflow.createTechnician(draft as TechnicianDraft);
      response.status(201).json({ data: technician, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.patch("/api/v1/technicians/:technicianId", async (request, response, next) => {
    try {
      await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const technician = await dependencies.dispatchWorkflow.updateTechnician(z.string().min(1).parse(request.params.technicianId), technicianDraftSchema.parse(request.body) as TechnicianDraft);
      response.status(200).json({ data: technician, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/service-requests", async (_request, response, next) => {
    try {
      await requireActor(_request);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      response.status(200).json({ data: await dependencies.dispatchWorkflow.listRequests(), requestId: response.req.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/service-requests", async (request, response, next) => {
    try {
      await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const draft = serviceRequestDraftSchema.parse(request.body);
      const serviceRequest = await dependencies.dispatchWorkflow.createRequest(draft as ServiceRequestDraft);
      response.status(201).json({ data: serviceRequest, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.patch("/api/v1/service-requests/:requestId", async (request, response, next) => {
    try {
      await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const serviceRequest = await dependencies.dispatchWorkflow.updateRequest(z.string().min(1).parse(request.params.requestId), serviceRequestDraftSchema.parse(request.body) as ServiceRequestDraft);
      response.status(200).json({ data: serviceRequest, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/workbench", async (request, response, next) => {
    try {
      await requireActor(request);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const { planningDate } = workbenchQuerySchema.parse(request.query);
      response.status(200).json({ data: await dependencies.dispatchWorkflow.getWorkbench(planningDate), requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/schedules/generate", async (request, response, next) => {
    try {
      const actor = await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const input = generateSchema.parse(request.body);
      response.status(201).json({ data: await dependencies.dispatchWorkflow.generateAndPropose({
        planningDate: input.planningDate,
        operationalTimezone: input.operationalTimezone,
        dispatcherId: actor.id,
        ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
        ...(input.triggerReason === undefined ? {} : { triggerReason: input.triggerReason }),
      }), requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/schedule-overrides", async (request, response, next) => {
    try {
      const actor = await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const input = manualOverrideSchema.parse(request.body);
      const version = await dependencies.dispatchWorkflow.createManualOverride({
        planningDate: input.planningDate,
        operationalTimezone: input.operationalTimezone,
        dispatcherId: actor.id,
        technicianId: input.technicianId,
        serviceRequestId: input.serviceRequestId,
        interval: { start: input.start, end: input.end },
        reason: input.reason,
      });
      response.status(201).json({ data: version, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/ai/plan", async (request, response, next) => {
    try {
      await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const input = aiPlanSchema.parse(request.body);
      const snapshot = await dependencies.dispatchWorkflow.getWorkbench(input.planningDate);
      const plan = await proposeDispatchPlan({
        context: { planningDate: input.planningDate, operationalTimezone: input.operationalTimezone },
        technicians: snapshot.technicians,
        requests: snapshot.requests,
        currentAssignments: snapshot.latestVersion?.assignments ?? snapshot.protectedAssignments,
      }, dependencies.aiProvider);
      response.status(200).json({ data: plan, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/ai/plan/propose", async (request, response, next) => {
    try {
      const actor = await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.dispatchWorkflow) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent dispatch storage is not configured.", 503);
      const input = aiPlanProposeSchema.parse(request.body);
      const snapshot = await dependencies.dispatchWorkflow.getWorkbench(input.planningDate);
      const currentAssignments = snapshot.latestVersion?.assignments ?? snapshot.protectedAssignments;

      let plan: DispatchPlanProposal;
      if (input.assignments !== undefined) {
        // The dispatcher reviewed these exact rows. Re-validate them server-side
        // rather than trusting the client or a second, potentially different AI run.
        const protectedAssignments = currentAssignments.filter(
          (assignment) => assignment.status === "COMPLETED" || assignment.status === "IN_PROGRESS",
        );
        const protectedRequests = new Set(protectedAssignments.map((assignment) => assignment.serviceRequestId));
        const reviewed = input.assignments.filter((item) => !protectedRequests.has(item.serviceRequestId));
        const validated = validateAiSuggestions(reviewed, snapshot.technicians, snapshot.requests, protectedAssignments);
        if (validated.rejected.length > 0) {
          throw new AppError(
            "INVALID_AI_PLAN",
            `The reviewed plan failed hard-constraint validation: ${validated.rejected.flatMap((item) => item.reasons.map((reason) => reason.message)).join(" ")}`,
            422,
          );
        }
        const assignedIds = new Set(validated.assignments.map((assignment) => assignment.serviceRequestId));
        const previousUnassigned = new Map((snapshot.latestVersion?.unassignedRequests ?? []).map((item) => [item.serviceRequestId, item]));
        plan = {
          planId: `plan_${randomUUID()}`,
          requiresApproval: true as const,
          persisted: false as const,
          source: "AI" as const,
          summary: "Dispatcher-reviewed agent plan.",
          assignments: validated.assignments,
          rejectedSuggestions: [],
          objective: scoreAssignments(validated.assignments, snapshot.technicians, snapshot.requests),
          tradeoffs: [],
          riskyAssignments: [],
          unassignedRequests: snapshot.requests
            .filter((item) => item.status !== "CANCELLED" && item.status !== "COMPLETED" && !assignedIds.has(item.id))
            .map((item) => ({
              serviceRequestId: item.id,
              title: item.title,
              priority: item.priority,
              risk: item.isEmergency || item.priority >= 5 ? "CRITICAL" as const : item.priority >= 4 ? "HIGH" as const : "MEDIUM" as const,
              reasons: previousUnassigned.get(item.id)?.reasons ?? [{ code: "UNASSIGNED", message: "The reviewed plan leaves this request unassigned." }],
            })),
          missingInformation: [],
          dispatcherQuestions: [],
          warnings: [],
        };
      } else {
        plan = await proposeDispatchPlan({
          context: { planningDate: input.planningDate, operationalTimezone: input.operationalTimezone },
          technicians: snapshot.technicians,
          requests: snapshot.requests,
          currentAssignments,
        }, dependencies.aiProvider);
      }

      const version = await dependencies.dispatchWorkflow.persistPlanProposal({
        plan,
        planningDate: input.planningDate,
        operationalTimezone: input.operationalTimezone,
        dispatcherId: actor.id,
      });
      response.status(201).json({ data: { plan, version }, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/schedule-versions", async (request, response, next) => {
    try {
      const actor = await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.versionService) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent schedule storage is not configured.", 503);
      const { dispatcherId: _dispatcherId, ...draft } = versionDraftSchema.parse(request.body);
      const version = await dependencies.versionService.createProposal(draft as ScheduleVersionDraft, actor.id);
      response.status(201).json({ data: version, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/schedule-versions/:versionId/approve", async (request, response, next) => {
    try {
      const actor = await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.versionService) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent schedule storage is not configured.", 503);
      approvalSchema.parse(request.body);
      const version = await dependencies.versionService.approve(request.params.versionId, actor.id);
      response.status(200).json({ data: version, requestId: request.requestId });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/schedule-versions/:versionId/reject", async (request, response, next) => {
    try {
      const actor = await requireActor(request, ["ADMIN", "DISPATCHER"]);
      if (!dependencies.versionService) throw new AppError("PERSISTENCE_UNAVAILABLE", "Persistent schedule storage is not configured.", 503);
      const { reason } = rejectionSchema.parse(request.body);
      await dependencies.versionService.reject(request.params.versionId, actor.id, reason);
      response.status(204).send();
    } catch (error) { next(error); }
  });

  app.use((_request, _response, next) => next(new AppError("NOT_FOUND", "Route not found.", 404)));
  app.use(errorHandler);
  return app;
}
