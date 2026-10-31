import { createApp } from "../src/api/app.js";
import { createGeminiPlanProvider } from "../src/ai/index.js";
import { AuthService, DispatchWorkflow, ScheduleVersionService } from "../src/application/index.js";
import { readEnvironment } from "../src/config/index.js";
import { createPrismaClient, PrismaAuthRepository, PrismaDispatchRepository, PrismaNotificationRepository, PrismaScheduleVersionStore } from "../src/infrastructure/index.js";

type VercelRequest = {
  url?: string;
};

function restoreApiPath(request: VercelRequest): void {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const routedPath = requestUrl.searchParams.get("__fieldops_api_path");
  if (!routedPath) return;

  const normalizedPath = routedPath.replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath.split("/").some((segment) => segment === "..")) return;

  requestUrl.searchParams.delete("__fieldops_api_path");
  const search = requestUrl.searchParams.toString();
  request.url = `/api/${normalizedPath}${search ? `?${search}` : ""}`;
}

const environment = readEnvironment();
const prisma = environment.DATABASE_URL ? createPrismaClient() : undefined;
const versionService = prisma ? new ScheduleVersionService(new PrismaScheduleVersionStore(prisma)) : undefined;
const dispatchWorkflow = prisma && versionService ? new DispatchWorkflow(new PrismaDispatchRepository(prisma), versionService) : undefined;
const authService = prisma && environment.AUTH_SECRET ? new AuthService(new PrismaAuthRepository(prisma), environment.AUTH_SECRET) : undefined;
const aiProvider = environment.GEMINI_API_KEY && environment.GEMINI_MODEL
  ? createGeminiPlanProvider({ apiKey: environment.GEMINI_API_KEY, model: environment.GEMINI_MODEL })
  : undefined;

const app = createApp({
  ...(versionService === undefined ? {} : { versionService }),
  ...(dispatchWorkflow === undefined ? {} : { dispatchWorkflow }),
  ...(authService === undefined ? {} : { authService }),
  ...(prisma === undefined ? {} : { notificationRepository: new PrismaNotificationRepository(prisma) }),
  ...(aiProvider === undefined ? {} : { aiProvider }),
  isDatabaseReady: async () => {
    if (!prisma) return false;
    await prisma.$queryRaw`SELECT 1`;
    return true;
  },
});

/**
 * Vercel Hobby maps this single file to one Serverless Function. The rewrite
 * records the requested API suffix in a query parameter; restore it before
 * Express performs its normal route matching.
 */
export default function handler(request: VercelRequest, response: unknown): unknown {
  restoreApiPath(request);
  return app(request as never, response as never);
}
