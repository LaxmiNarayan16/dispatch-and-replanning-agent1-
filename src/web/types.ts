export type Priority = 1 | 2 | 3 | 4 | 5;

export interface DispatchAssignment {
  readonly id: string;
  readonly technicianId: string;
  readonly serviceRequestId: string;
  readonly title: string;
  readonly priority: Priority;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly startHour: number;
  readonly durationHours: number;
  readonly status: "PROPOSED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED";
}

export interface DispatchTechnician {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly role: string;
  readonly utilization: number;
  readonly availability: string;
  readonly status: "ACTIVE" | "AT_RISK" | "UNAVAILABLE";
}

export interface UnassignedRequest {
  readonly id: string;
  readonly title: string;
  readonly priority: Priority;
  readonly duration: string;
  readonly reason: string;
}
