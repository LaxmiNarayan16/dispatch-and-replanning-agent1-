import { createApp } from "./app.js";
import { createGeminiPlanProvider } from "../ai/index.js";
import { AuthService, DispatchWorkflow, ScheduleVersionService } from "../application/index.js";
import { createPrismaClient, PrismaAuthRepository, PrismaDispatchRepository, PrismaNotificationRepository, PrismaScheduleVersionStore } from "../infrastructure/index.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const prisma = createPrismaClient();
const versionService = new ScheduleVersionService(new PrismaScheduleVersionStore(prisma));
const dispatchWorkflow = new DispatchWorkflow(new PrismaDispatchRepository(prisma), versionService);
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required to start the API server.");
const authService = new AuthService(new PrismaAuthRepository(prisma), authSecret);

const aiProvider = process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL
  ? createGeminiPlanProvider({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL })
  : undefined;

createApp({
  versionService,
  dispatchWorkflow,
  authService,
  notificationRepository: new PrismaNotificationRepository(prisma),
  ...(aiProvider === undefined ? {} : { aiProvider }),
  isDatabaseReady: async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  },
}).listen(port, "0.0.0.0", () => {
  process.stdout.write(`Field Service Dispatch API listening on http://0.0.0.0:${port}\n`);
});
