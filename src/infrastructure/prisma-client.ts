import { createRequire } from "node:module";
import type { PrismaClientLike } from "./prisma-version-store.js";

declare global {
  // eslint-disable-next-line no-var
  var __fieldOpsPrisma: RuntimePrismaClient | undefined;
}

export interface RuntimePrismaClient extends PrismaClientLike {
  $queryRaw(query: TemplateStringsArray): Promise<unknown>;
}

/** Reuses one client in local dev; serverless deployments create one per warm runtime. */
export function createPrismaClient(): RuntimePrismaClient {
  if (globalThis.__fieldOpsPrisma) return globalThis.__fieldOpsPrisma;
  const require = createRequire(import.meta.url);
  const module = require("@prisma/client") as { PrismaClient?: new () => RuntimePrismaClient };
  if (!module.PrismaClient) throw new Error("Prisma client is unavailable. Run prisma generate during build/deployment.");
  const client = new module.PrismaClient();
  if (process.env.NODE_ENV !== "production") globalThis.__fieldOpsPrisma = client;
  return client;
}
