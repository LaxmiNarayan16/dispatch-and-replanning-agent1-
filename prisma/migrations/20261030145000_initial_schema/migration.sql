-- Baseline schema generated from prisma/schema.prisma with Prisma migrate diff.
CREATE TYPE "TechnicianStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'CANCELLED');
CREATE TYPE "ServiceRequestStatus" AS ENUM ('PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AssignmentStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ScheduleVersionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');
CREATE TYPE "ScheduleTrigger" AS ENUM ('INITIAL_PLAN', 'TECHNICIAN_CANCELLATION', 'TECHNICIAN_UNAVAILABILITY', 'EMERGENCY_REQUEST', 'REQUEST_CANCELLATION', 'DURATION_CHANGE', 'AVAILABILITY_CHANGE', 'MANUAL_OVERRIDE');
CREATE TYPE "AuditAction" AS ENUM ('SCHEDULE_PROPOSED', 'SCHEDULE_APPROVED', 'SCHEDULE_REJECTED', 'ASSIGNMENT_OVERRIDDEN', 'REPLAN_REQUESTED');
CREATE TYPE "NotificationType" AS ENUM ('SCHEDULE_APPROVED', 'ASSIGNMENT_CHANGED', 'ASSIGNMENT_REMOVED');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "Technician" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "skills" TEXT[], "assignedRegions" TEXT[],
  "maximumWorkloadMinutes" INTEGER NOT NULL, "status" "TechnicianStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Technician_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TechnicianWorkingHours" (
  "id" TEXT NOT NULL, "technicianId" TEXT NOT NULL, "weekday" INTEGER NOT NULL, "startMinute" INTEGER NOT NULL, "endMinute" INTEGER NOT NULL,
  CONSTRAINT "TechnicianWorkingHours_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TechnicianAvailability" (
  "id" TEXT NOT NULL, "technicianId" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TechnicianAvailability_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ServiceRequest" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "region" TEXT NOT NULL, "requiredSkill" TEXT NOT NULL, "priority" INTEGER NOT NULL,
  "estimatedDurationMin" INTEGER NOT NULL, "preferredWindowStart" TIMESTAMP(3), "preferredWindowEnd" TIMESTAMP(3), "notes" TEXT,
  "status" "ServiceRequestStatus" NOT NULL DEFAULT 'PENDING', "isEmergency" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ScheduleVersion" (
  "id" TEXT NOT NULL, "planningDate" DATE NOT NULL, "operationalTimezone" TEXT NOT NULL, "versionNumber" INTEGER NOT NULL,
  "parentVersionId" TEXT, "trigger" "ScheduleTrigger" NOT NULL, "triggerReason" TEXT,
  "status" "ScheduleVersionStatus" NOT NULL DEFAULT 'PROPOSED', "unassignedRequests" JSONB NOT NULL, "validationResult" JSONB NOT NULL,
  "objectiveScore" JSONB NOT NULL, "optimizationMetadata" JSONB NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AssignmentSnapshot" (
  "id" TEXT NOT NULL, "scheduleVersionId" TEXT NOT NULL, "technicianId" TEXT NOT NULL, "serviceRequestId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "status" "AssignmentStatus" NOT NULL DEFAULT 'PROPOSED',
  "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false, CONSTRAINT "AssignmentSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL, "scheduleVersionId" TEXT NOT NULL, "action" "AuditAction" NOT NULL, "dispatcherId" TEXT,
  "previousValue" JSONB, "newValue" JSONB, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MockNotification" (
  "id" TEXT NOT NULL, "technicianId" TEXT NOT NULL, "scheduleVersionId" TEXT NOT NULL, "type" "NotificationType" NOT NULL,
  "message" TEXT NOT NULL, "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MockNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Technician_status_idx" ON "Technician"("status");
CREATE UNIQUE INDEX "TechnicianWorkingHours_technicianId_weekday_key" ON "TechnicianWorkingHours"("technicianId", "weekday");
CREATE INDEX "TechnicianAvailability_technicianId_startsAt_endsAt_idx" ON "TechnicianAvailability"("technicianId", "startsAt", "endsAt");
CREATE INDEX "ServiceRequest_status_priority_idx" ON "ServiceRequest"("status", "priority");
CREATE INDEX "ScheduleVersion_planningDate_status_idx" ON "ScheduleVersion"("planningDate", "status");
CREATE UNIQUE INDEX "ScheduleVersion_planningDate_versionNumber_key" ON "ScheduleVersion"("planningDate", "versionNumber");
CREATE INDEX "AssignmentSnapshot_scheduleVersionId_technicianId_startsAt_endsAt_idx" ON "AssignmentSnapshot"("scheduleVersionId", "technicianId", "startsAt", "endsAt");
CREATE UNIQUE INDEX "AssignmentSnapshot_scheduleVersionId_serviceRequestId_key" ON "AssignmentSnapshot"("scheduleVersionId", "serviceRequestId");
CREATE INDEX "AuditEvent_scheduleVersionId_createdAt_idx" ON "AuditEvent"("scheduleVersionId", "createdAt");
CREATE INDEX "MockNotification_scheduleVersionId_technicianId_idx" ON "MockNotification"("scheduleVersionId", "technicianId");

ALTER TABLE "TechnicianWorkingHours" ADD CONSTRAINT "TechnicianWorkingHours_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicianAvailability" ADD CONSTRAINT "TechnicianAvailability_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "ScheduleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentSnapshot" ADD CONSTRAINT "AssignmentSnapshot_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentSnapshot" ADD CONSTRAINT "AssignmentSnapshot_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentSnapshot" ADD CONSTRAINT "AssignmentSnapshot_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MockNotification" ADD CONSTRAINT "MockNotification_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MockNotification" ADD CONSTRAINT "MockNotification_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
