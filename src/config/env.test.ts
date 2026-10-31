import { describe, expect, it } from "vitest";

import { readEnvironment, requireProductionDatabase } from "./env.js";

describe("environment configuration", () => {
  it("uses a stable operational timezone default", () => {
    expect(readEnvironment({}).OPERATIONAL_TIMEZONE).toBe("Asia/Kolkata");
  });

  it("requires a database URL in production", () => {
    expect(() => requireProductionDatabase({ NODE_ENV: "production" })).toThrow("DATABASE_URL");
  });

  it("requires an authentication secret in production", () => {
    expect(() => requireProductionDatabase({ NODE_ENV: "production", DATABASE_URL: "postgresql://user:secret@host.example/db" })).toThrow("AUTH_SECRET");
  });

  it("accepts a secure PostgreSQL connection configuration", () => {
    expect(requireProductionDatabase({ NODE_ENV: "production", DATABASE_URL: "postgresql://user:secret@host.example/db?sslmode=require", AUTH_SECRET: "a".repeat(32) }).DATABASE_URL).toContain("sslmode=require");
  });
});
