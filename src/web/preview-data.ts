import type { DispatchAssignment, DispatchTechnician, UnassignedRequest } from "./types.js";

/** Temporary design-time fixture. Production data enters through the scheduling API. */
export const technicians: readonly DispatchTechnician[] = [
  { id: "tech-1", name: "Asha Patel", initials: "AP", role: "HVAC Specialist", utilization: 88, availability: "08:00–17:00", status: "ACTIVE" },
  { id: "tech-2", name: "Daniel Cruz", initials: "DC", role: "Electrical Technician", utilization: 63, availability: "08:00–17:00", status: "AT_RISK" },
  { id: "tech-3", name: "Mei Chen", initials: "MC", role: "Multi-skill Engineer", utilization: 76, availability: "09:00–18:00", status: "ACTIVE" },
  { id: "tech-4", name: "Sam Wilson", initials: "SW", role: "Field Technician", utilization: 0, availability: "Unavailable", status: "UNAVAILABLE" },
];

export const assignments: readonly DispatchAssignment[] = [
  { id: "a-1", technicianId: "tech-1", serviceRequestId: "SR-1042", title: "Chiller diagnostic", priority: 5, startLabel: "08:00", endLabel: "10:00", startHour: 8, durationHours: 2, status: "COMPLETED" },
  { id: "a-2", technicianId: "tech-1", serviceRequestId: "SR-1047", title: "Replace compressor", priority: 5, startLabel: "10:30", endLabel: "13:00", startHour: 10.5, durationHours: 2.5, status: "PROPOSED" },
  { id: "a-3", technicianId: "tech-2", serviceRequestId: "SR-1038", title: "Panel inspection", priority: 3, startLabel: "09:00", endLabel: "10:30", startHour: 9, durationHours: 1.5, status: "PROPOSED" },
  { id: "a-4", technicianId: "tech-2", serviceRequestId: "SR-1051", title: "Emergency outage", priority: 5, startLabel: "11:00", endLabel: "13:00", startHour: 11, durationHours: 2, status: "PROPOSED" },
  { id: "a-5", technicianId: "tech-3", serviceRequestId: "SR-1048", title: "Boiler calibration", priority: 4, startLabel: "09:00", endLabel: "11:00", startHour: 9, durationHours: 2, status: "IN_PROGRESS" },
  { id: "a-6", technicianId: "tech-3", serviceRequestId: "SR-1050", title: "Filter replacement", priority: 2, startLabel: "12:00", endLabel: "13:00", startHour: 12, durationHours: 1, status: "PROPOSED" },
];

export const unassigned: readonly UnassignedRequest[] = [
  { id: "SR-1053", title: "Cooling tower vibration", priority: 5, duration: "2h", reason: "No eligible technician remains in the customer window." },
  { id: "SR-1054", title: "Generator load test", priority: 4, duration: "1h 30m", reason: "Required electrical skill is at capacity." },
];
