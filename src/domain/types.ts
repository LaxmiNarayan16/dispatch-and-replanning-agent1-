export type UtcInstant = Date;

export interface TimeInterval {
  readonly start: UtcInstant;
  readonly end: UtcInstant;
}

export type TechnicianStatus = "ACTIVE" | "UNAVAILABLE" | "CANCELLED";
export type ServiceRequestStatus = "PENDING" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type AssignmentStatus = "PROPOSED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface Technician {
  readonly id: string;
  readonly name: string;
  readonly skills: readonly string[];
  readonly assignedRegions: readonly string[];
  readonly maximumWorkloadMinutes: number;
  readonly status: TechnicianStatus;
  readonly workingHours: TimeInterval;
  readonly availability: readonly TimeInterval[];
}

export interface ServiceRequest {
  readonly id: string;
  readonly title: string;
  readonly region: string;
  readonly requiredSkill: string;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly estimatedDurationMinutes: number;
  readonly preferredWindow?: TimeInterval;
  readonly status: ServiceRequestStatus;
  readonly notes?: string;
  readonly isEmergency: boolean;
}

export interface Assignment {
  readonly id: string;
  readonly technicianId: string;
  readonly serviceRequestId: string;
  readonly interval: TimeInterval;
  readonly status: AssignmentStatus;
}

export interface PlanningContext {
  readonly planningDate: string;
  readonly operationalTimezone: string;
}
