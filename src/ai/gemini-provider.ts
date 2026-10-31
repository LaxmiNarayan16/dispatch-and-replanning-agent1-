import { aiPlanJsonSchema, type AiPlanProvider } from "./planning-agent.js";

export interface GeminiPlanProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Maximum number of retries after the first request for transient failures. */
  readonly maxRetries?: number;
  /** Base retry delay in milliseconds; each subsequent retry doubles it. */
  readonly retryDelayMs?: number;
  /** Injectable only to keep retry behaviour deterministic in tests. */
  readonly sleep?: (delayMs: number) => Promise<void>;
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly { readonly text?: string }[];
    };
  }[];
}

const defaultSleep = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * Minimal Gemini adapter. The response is returned as untrusted text and is
 * parsed/validated by the planning agent; it is never treated as an assignment.
 */
export function createGeminiPlanProvider(options: GeminiPlanProviderOptions): AiPlanProvider {
  const request = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 750;
  const sleep = options.sleep ?? defaultSleep;

  return {
    async propose(facts) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          const response = await request(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [{
                  role: "user",
                  parts: [{ text: `Facts:\n${JSON.stringify(facts)}` }],
                }],
                generationConfig: {
                  temperature: 0.2,
                  responseMimeType: "application/json",
                  responseJsonSchema: aiPlanJsonSchema,
                },
              }),
            },
          );
          if (response.ok) {
            const body = await response.json() as GeminiResponse;
            const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Gemini returned no structured text.");
            return JSON.parse(text) as unknown;
          }

          if (!isTransientStatus(response.status) || attempt === maxRetries) {
            throw new Error(`Gemini request failed with ${response.status}${attempt > 0 ? ` after ${attempt + 1} attempts` : ""}.`);
          }

          const delayMs = Math.min(retryAfterMs(response) ?? retryDelayMs * 2 ** attempt, 5_000);
          await sleep(delayMs);
        }

        throw new Error("Gemini request failed before a response was received.");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
