import type { Assignment, ServiceRequest, Technician } from "../domain/index.js";
import type { DispatchRepository, DispatchSnapshot, ServiceRequestDraft, TechnicianDraft } from "../application/dispatch-workflow.js";
import type { ScheduleVersion } from "../application/versioning.js";

type Database = Record<string, any>;
const dayStart = (date: string) => new Date(`${date}T00:00:00.000Z`);

function asTechnician(row: any): Technician {
  const availability = row.availabilityWindows.map((item: any) => ({ start: item.startsAt, end: item.endsAt }));
  const start = availability.reduce((value: Date, item: { start: Date }) => item.start < value ? item.start : value, availability[0]?.start ?? new Date(0));
  const end = availability.reduce((value: Date, item: { end: Date }) => item.end > value ? item.end : value, availability[0]?.end ?? new Date(0));
  return { id: row.id, name: row.name, skills: row.skills, assignedRegions: row.assignedRegions, maximumWorkloadMinutes: row.maximumWorkloadMinutes, status: row.status, workingHours: { start, end }, availability };
}

function asRequest(row: any): ServiceRequest {
  const preferredWindow = row.preferredWindowStart && row.preferredWindowEnd ? { start: row.preferredWindowStart, end: row.preferredWindowEnd } : undefined;
  return { id: row.id, title: row.title, region: row.region, requiredSkill: row.requiredSkill, priority: row.priority, estimatedDurationMinutes: row.estimatedDurationMin, ...(preferredWindow === undefined ? {} : { preferredWindow }), status: row.status, ...(row.notes === null ? {} : { notes: row.notes }), isEmergency: row.isEmergency };
}

function asVersion(row: any): ScheduleVersion {
  return {
    id: row.id, planningDate: row.planningDate.toISOString().slice(0, 10), operationalTimezone: row.operationalTimezone, versionNumber: row.versionNumber,
    ...(row.parentVersionId ? { parentVersionId: row.parentVersionId } : {}), trigger: row.trigger, ...(row.triggerReason ? { triggerReason: row.triggerReason } : {}),
    assignments: row.assignments.map((item: any) => ({ id: item.id, technicianId: item.technicianId, serviceRequestId: item.serviceRequestId, interval: { start: item.startsAt, end: item.endsAt }, status: item.status })),
    unassignedRequests: row.unassignedRequests, validationResult: row.validationResult, objectiveScore: row.objectiveScore, optimizationMetadata: row.optimizationMetadata,
    ...(row.changes === null || row.changes === undefined ? {} : { changes: row.changes }),
    status: row.status, generatedAt: row.generatedAt, ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}), ...(row.approvedAt ? { approvedAt: row.approvedAt } : {}),
  };
}

export class PrismaDispatchRepository implements DispatchRepository {
  public constructor(private readonly database: Database) {}
  public async listTechnicians(): Promise<readonly Technician[]> {
    const rows = await this.database.technician.findMany({ include: { availabilityWindows: { orderBy: { startsAt: "asc" } } }, orderBy: { name: "asc" } });
    return rows.map(asTechnician);
  }
  public async createTechnician(draft: TechnicianDraft): Promise<Technician> {
    // `availability` is an application DTO; it belongs in the related
    // TechnicianAvailability rows, not in the Technician model itself.
    const { availability, ...technician } = draft;
    const row = await this.database.technician.create({
      data: {
        ...technician,
        availabilityWindows: { create: availability.map((item) => ({ startsAt: item.start, endsAt: item.end })) },
      },
      include: { availabilityWindows: true },
    });
    return asTechnician(row);
  }
  public async updateTechnician(id: string, draft: TechnicianDraft): Promise<Technician> {
    const { availability, ...technician } = draft;
    const row = await this.database.technician.update({
      where: { id },
      data: {
        ...technician,
        availabilityWindows: { deleteMany: {}, create: availability.map((item) => ({ startsAt: item.start, endsAt: item.end })) },
      },
      include: { availabilityWindows: true },
    });
    return asTechnician(row);
  }
  public async listRequests(): Promise<readonly ServiceRequest[]> {
    const rows = await this.database.serviceRequest.findMany({ orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
    return rows.map(asRequest);
  }
  public async createRequest(draft: ServiceRequestDraft): Promise<ServiceRequest> {
    const row = await this.database.serviceRequest.create({ data: { title: draft.title, region: draft.region, requiredSkill: draft.requiredSkill, priority: draft.priority, estimatedDurationMin: draft.estimatedDurationMinutes, preferredWindowStart: draft.preferredWindow?.start ?? null, preferredWindowEnd: draft.preferredWindow?.end ?? null, notes: draft.notes ?? null, status: draft.status, isEmergency: draft.isEmergency } });
    return asRequest(row);
  }
  public async updateRequest(id: string, draft: ServiceRequestDraft): Promise<ServiceRequest> {
    const row = await this.database.serviceRequest.update({ data: { title: draft.title, region: draft.region, requiredSkill: draft.requiredSkill, priority: draft.priority, estimatedDurationMin: draft.estimatedDurationMinutes, preferredWindowStart: draft.preferredWindow?.start ?? null, preferredWindowEnd: draft.preferredWindow?.end ?? null, notes: draft.notes ?? null, status: draft.status, isEmergency: draft.isEmergency }, where: { id } });
    return asRequest(row);
  }
  public async getSnapshot(planningDate: string): Promise<DispatchSnapshot> {
    const [technicians, requests, latest] = await Promise.all([
      this.listTechnicians(), this.listRequests(),
      this.database.scheduleVersion.findFirst({ where: { planningDate: dayStart(planningDate) }, orderBy: { versionNumber: "desc" }, include: { assignments: true } }),
    ]);
    const latestVersion = latest ? asVersion(latest) : undefined;
    const protectedAssignments: Assignment[] = latestVersion?.assignments.filter((item) => item.status === "COMPLETED" || item.status === "IN_PROGRESS") ?? [];
    return { technicians, requests, protectedAssignments, ...(latestVersion === undefined ? {} : { latestVersion }) };
  }
}
