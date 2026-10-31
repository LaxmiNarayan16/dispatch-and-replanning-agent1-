import { describe, expect, it, vi } from "vitest";

import { createGeminiPlanProvider } from "./gemini-provider.js";

const successResponse = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: "ok" }) }] } }],
}), { status: 200, headers: { "content-type": "application/json" } });

describe("Gemini plan provider", () => {
  it("retries a transient rate limit and returns the later structured response", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn(async () => undefined);
    const provider = createGeminiPlanProvider({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: request,
      sleep,
    });

    await expect(provider.propose({ planningDate: "2026-10-31" })).resolves.toEqual({ summary: "ok" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("does not retry a non-transient Gemini error", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad request", { status: 400 }));
    const provider = createGeminiPlanProvider({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: request,
      sleep: async () => undefined,
    });

    await expect(provider.propose({})).rejects.toThrow("Gemini request failed with 400");
    expect(request).toHaveBeenCalledOnce();
  });
});
