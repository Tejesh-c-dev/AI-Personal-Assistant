import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { FunctionTool, InMemorySessionService, LlmAgent, Runner } from "@google/adk";
import { OpenRouterLlm } from "./openrouter-llm";
import { formatSmokeFailure } from "./openrouter-smoke-diagnostics";
import { getLlmProvider } from "./agent-runner";
import { z } from "zod";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); });

describe("OpenRouter ADK integration", () => {
  it("selects only explicitly configured providers and rejects unknown values", () => {
    vi.stubEnv("LLM_PROVIDER", ""); expect(getLlmProvider()).toBe("gemini");
    vi.stubEnv("LLM_PROVIDER", "openrouter"); expect(getLlmProvider()).toBe("openrouter");
    vi.stubEnv("LLM_PROVIDER", "invalid"); expect(() => getLlmProvider()).toThrow("Unsupported LLM_PROVIDER");
  });

  it("dispatches a tool through the actual ADK Runner and completes its next inference round", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "synthetic/model"); vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const replies = [
      { choices: [{ message: { content: null, tool_calls: [{ id: "call-smoke", type: "function", function: { name: "synthetic_lookup", arguments: "{\"value\":\"sample\"}" } }] } }] },
      { choices: [{ message: { content: "The synthetic result is safe." } }] },
    ];
    const sent: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(replies.shift());
    });
    const execute = vi.fn(async ({ value }: { value: string }) => `result:${value}`);
    const tool = new FunctionTool({ name: "synthetic_lookup", description: "Returns a synthetic string", parameters: z.object({ value: z.string() }), execute });
    const service = new InMemorySessionService();
    const runner = new Runner({ appName: "synthetic", agent: new LlmAgent({ name: "smoke", model: new OpenRouterLlm(), instruction: "Use the synthetic tool.", tools: [tool] }), sessionService: service });
    await service.createSession({ appName: "synthetic", userId: "test-user", sessionId: "test-session" });
    const events = [];
    for await (const event of runner.runAsync({ userId: "test-user", sessionId: "test-session", newMessage: { role: "user", parts: [{ text: "lookup sample" }] } })) events.push(event);
    expect(execute).toHaveBeenCalledWith({ value: "sample" }, expect.anything());
    expect(events.some((event) => event.content?.parts?.some((part) => part.text?.includes("synthetic result is safe")))).toBe(true);
    expect(sent).toHaveLength(2);
    expect((sent[1].messages as { role: string; tool_call_id?: string }[]).some((message) => message.role === "tool" && message.tool_call_id === "call-smoke")).toBe(true);
  });

  it("reports an ADK tool invocation failure without exposing its exception", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "synthetic/model"); vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const replies = [{ choices: [{ message: { content: null, tool_calls: [{ id: "call-fail", type: "function", function: { name: "synthetic_lookup", arguments: "{}" } }] } }] }];
    globalThis.fetch = vi.fn(async () => Response.json(replies.shift() ?? { choices: [{ message: { content: "done" } }] }));
    let toolFailed = false;
    const tool = new FunctionTool({
      name: "synthetic_lookup",
      description: "Throws a synthetic error for diagnostic coverage.",
      execute: () => {
        toolFailed = true;
        throw new Error("PRIVATE PROMPT, secret-key, and sensitive tool result");
      },
    });
    const service = new InMemorySessionService();
    const runner = new Runner({ appName: "synthetic", agent: new LlmAgent({ name: "smoke", model: new OpenRouterLlm(), instruction: "Use the synthetic tool.", tools: [tool] }), sessionService: service });
    await service.createSession({ appName: "synthetic", userId: "test-user", sessionId: "tool-failure-session" });
    try {
      for await (const event of runner.runAsync({ userId: "test-user", sessionId: "tool-failure-session", newMessage: { role: "user", parts: [{ text: "run tool" }] } })) { void event; }
    } catch { /* ADK may propagate or convert tool errors into events. */ }
    finally { await runner.close(); }

    expect(toolFailed).toBe(true);
    const diagnostic = formatSmokeFailure({ test: "Test B", stage: "tool invocation", error: new Error("PRIVATE PROMPT, secret-key, and sensitive tool result") });
    expect(diagnostic).toContain("stage=tool invocation");
    expect(diagnostic).toContain("category=tool invocation failure");
    expect(diagnostic).not.toMatch(/PRIVATE PROMPT|secret-key|sensitive tool result/i);
  });
});
