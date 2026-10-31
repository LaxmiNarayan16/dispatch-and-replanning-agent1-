import { z } from "zod";

const utcInstantSchema = z.coerce.date().refine(
  (value) => Number.isFinite(value.getTime()),
  "Expected a valid timestamp.",
);

export const timeIntervalSchema = z
  .object({
    start: utcInstantSchema,
    end: utcInstantSchema,
  })
  .refine((value) => value.start < value.end, {
    message: "Interval end must be later than interval start.",
    path: ["end"],
  });

export const operationalTimezoneSchema = z.string().min(1).superRefine((value, context) => {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a valid IANA timezone." });
  }
});

export const technicianInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  skills: z.array(z.string().trim().min(1).max(80)).min(1),
  assignedRegions: z.array(z.string().trim().min(1).max(80)).min(1),
  maximumWorkloadMinutes: z.number().int().positive().max(24 * 60),
  status: z.enum(["ACTIVE", "UNAVAILABLE", "CANCELLED"]),
});

export const serviceRequestInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    region: z.string().trim().min(1).max(80),
    requiredSkill: z.string().trim().min(1).max(80),
    priority: z.number().int().min(1).max(5),
    estimatedDurationMinutes: z.number().int().positive().max(24 * 60),
    preferredWindow: timeIntervalSchema.optional(),
    notes: z.string().trim().max(4_000).optional(),
    isEmergency: z.boolean().default(false),
  })
  .strict();
