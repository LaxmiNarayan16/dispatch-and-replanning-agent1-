import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://").optional(),
  OPERATIONAL_TIMEZONE: z.string().default("Asia/Kolkata"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(values: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(values);
}

/** Startup validation for a deployed API. The web-only build does not require a database. */
export function requireProductionDatabase(values: NodeJS.ProcessEnv = process.env): Environment {
  const environment = readEnvironment(values);
  if (environment.NODE_ENV === "production" && (!environment.DATABASE_URL || !environment.AUTH_SECRET)) {
    throw new Error("DATABASE_URL and AUTH_SECRET are required in production.");
  }
  return environment;
}
