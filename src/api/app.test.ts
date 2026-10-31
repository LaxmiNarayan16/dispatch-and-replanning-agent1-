import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

const actor = { id: "dispatcher-1", email: "d@example.com", displayName: "Dispatcher", role: "DISPATCHER" as const };
const authenticated = { authenticate: async () => actor };
const technician = {
  id: "tech-a", name: "Asha", skills: ["HVAC"], assignedRegions: ["CENTRAL"], maximumWorkloadMinutes: 480,
  status: "ACTIVE" as const,
  workingHours: { start: new Date("2026-10-30T04:00:00.000Z"), end: new Date("2026-10-30T12:00:00.000Z") },
  availability: [{ start: new Date("2026-10-30T04:00:00.000Z"), end: new Date("2026-10-30T12:00:00.000Z") }],
};
const serviceRequest = {
  id: "request-a", title: "Inspect unit", region: "CENTRAL", requiredSkill: "HVAC",
  priority: 3 as const, estimatedDurationMinutes: 60, status: "PENDING" as const, isEmergency: false,
};

describe("API", () => {
  it("returns a request ID from the health endpoint", async () => {
    const response = await request(createApp({ isDatabaseReady: async () => true })).get("/api/v1/health").set("x-request-id", "health-check");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: true });
    expect(response.headers["x-request-id"]).toBe("health-check");
  });

  it("reports degraded health when durable persistence is not configured", async () => {
    const response = await request(createApp()).get("/api/v1/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "degraded", database: false });
  });

  it("rejects an invalid schedule preview payload safely", async () => {
    const response = await request(createApp()).post("/api/v1/schedules/preview").send({ context: {} });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.requestId).toBeTruthy();
  });

  it("returns a safe, traceable error for malformed JSON", async () => {
    const response = await request(createApp()).post("/api/v1/schedules/preview")
      .set("content-type", "application/json").set("x-request-id", "bad-json")
      .send("{not valid json");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
    expect(response.body.requestId).toBe("bad-json");
  });

  it("lists and acknowledges persisted in-app notifications", async () => {
    const repository = {
      list: async () => [{ id: "notice-1", technicianId: "tech-a", technicianName: "Asha", scheduleVersionId: "version-1", scheduleVersionNumber: 2, type: "SCHEDULE_APPROVED", message: "Schedule version 2 has been approved.", deliveryStatus: "PENDING" as const, createdAt: new Date("2026-10-30T04:00:00.000Z") }],
      acknowledge: async (id: string) => id === "notice-1",
    };
    const app = createApp({ authService: authenticated as never, notificationRepository: repository });
    const listed = await request(app).get("/api/v1/notifications").set("authorization", "Bearer test");
    const acknowledged = await request(app).post("/api/v1/notifications/notice-1/acknowledge").set("authorization", "Bearer test").send({});

    expect(listed.status).toBe(200);
    expect(listed.body.data[0].id).toBe("notice-1");
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data).toEqual({ acknowledged: true });
  });

  it("returns deterministic schedule output for a valid preview", async () => {
    const response = await request(createApp())
      .post("/api/v1/schedules/preview")
      .send({
        context: { planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata" },
        technicians: [
          {
            id: "tech-a",
            name: "Asha",
            skills: ["HVAC"],
            assignedRegions: ["CENTRAL"],
            maximumWorkloadMinutes: 480,
            status: "ACTIVE",
            workingHours: { start: "2026-10-30T04:00:00.000Z", end: "2026-10-30T12:00:00.000Z" },
            availability: [{ start: "2026-10-30T04:00:00.000Z", end: "2026-10-30T12:00:00.000Z" }],
          },
        ],
        requests: [
          {
            id: "request-a",
            title: "Inspect unit",
            region: "CENTRAL",
            requiredSkill: "HVAC",
            priority: 5,
            estimatedDurationMinutes: 60,
            status: "PENDING",
            isEmergency: false,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.assignments).toHaveLength(1);
    expect(response.body.data.metadata.algorithm).toBe("bounded-deterministic-backtracking");
  });

  it("requires authentication before an advisory AI plan can be requested", async () => {
    const response = await request(createApp({ authService: authenticated as never })).post("/api/v1/ai/plan").send({
      planningDate: "2026-10-30",
      operationalTimezone: "Asia/Kolkata",
    });

    expect(response.status).toBe(401);
  });

  it("returns a validated advisory plan that still requires approval", async () => {
    const app = createApp({
      authService: authenticated as never,
      dispatchWorkflow: {
        getWorkbench: async () => ({ technicians: [technician], requests: [serviceRequest], protectedAssignments: [] }),
      } as never,
    });
    const response = await request(app).post("/api/v1/ai/plan")
      .set("authorization", "Bearer test")
      .send({ planningDate: "2026-10-30", operationalTimezone: "Asia/Kolkata" });

    expect(response.status).toBe(200);
    expect(response.body.data.requiresApproval).toBe(true);
    expect(response.body.data.persisted).toBe(false);
    expect(response.body.data.assignments).toHaveLength(1);
    expect(response.body.data.assignments[0].technicianId).toBe("tech-a");
  });

  it("re-validates a reviewed AI plan and rejects an invalid time window", async () => {
    const app = createApp({
      authService: authenticated as never,
      dispatchWorkflow: {
        getWorkbench: async () => ({ technicians: [technician], requests: [serviceRequest], protectedAssignments: [] }),
      } as never,
    });
    const response = await request(app).post("/api/v1/ai/plan/propose")
      .set("authorization", "Bearer test")
      .send({
        planningDate: "2026-10-30",
        operationalTimezone: "Asia/Kolkata",
        assignments: [{
          technicianId: "tech-a",
          serviceRequestId: "request-a",
          start: "2026-10-30T20:00:00.000Z",
          end: "2026-10-30T21:00:00.000Z",
        }],
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("INVALID_AI_PLAN");
  });

  it("rejects a manual override without a reason before touching persistence", async () => {
    const app = createApp({ authService: authenticated as never, dispatchWorkflow: {} as never });
    const response = await request(app).post("/api/v1/schedule-overrides")
      .set("authorization", "Bearer test")
      .send({
        planningDate: "2026-10-30",
        operationalTimezone: "Asia/Kolkata",
        technicianId: "tech-a",
        serviceRequestId: "request-a",
        start: "2026-10-30T05:00:00.000Z",
        end: "2026-10-30T06:00:00.000Z",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
