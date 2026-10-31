import { describe, expect, it, vi } from "vitest";

import { PrismaDispatchRepository } from "./prisma-dispatch-repository.js";

describe("PrismaDispatchRepository", () => {
  it("writes availability as related records, never as a Technician column", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "tech-1", name: "Asha Patel", skills: ["HVAC"], assignedRegions: ["CENTRAL"], maximumWorkloadMinutes: 480, status: "ACTIVE",
      availabilityWindows: [{ startsAt: new Date("2026-10-30T08:00:00.000Z"), endsAt: new Date("2026-10-30T17:00:00.000Z") }],
    });
    const repository = new PrismaDispatchRepository({ technician: { create } });

    await repository.createTechnician({
      name: "Asha Patel", skills: ["HVAC"], assignedRegions: ["CENTRAL"], maximumWorkloadMinutes: 480, status: "ACTIVE",
      availability: [{ start: new Date("2026-10-30T08:00:00.000Z"), end: new Date("2026-10-30T17:00:00.000Z") }],
    });

    const data = create.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("availability");
    expect(data.availabilityWindows.create).toEqual([{ startsAt: new Date("2026-10-30T08:00:00.000Z"), endsAt: new Date("2026-10-30T17:00:00.000Z") }]);
  });
});
