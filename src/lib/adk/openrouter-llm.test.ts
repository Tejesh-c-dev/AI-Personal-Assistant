import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { LlmRequest } from "@google/adk";
import { OpenRouterError, OpenRouterLlm } from "./openrouter-llm";

const request = (contents: LlmRequest["contents"] = []): LlmRequest => ({
  contents,
  config: { systemInstruction: "system rule", tools: [{ functionDeclarations: [{ name: "lookup", description: "lookup", parametersJsonSchema: { type: "object", properties: {} } }] }] },
  liveConnectConfig: {}, toolsDict: {},
});
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); });

describe("OpenRouterLlm", () => {
  it("translates text and sends closed privacy routing requirements", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "Hello" } }] })); globalThis.fetch = fetch;
    const result = [];
    for await (const item of new OpenRouterLlm().generateContentAsync(request([{ role: "user", parts: [{ text: "hi" }] }]))) result.push(item);
    expect(result[0].content?.parts).toEqual([{ text: "Hello" }]);
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true, allow_fallbacks: false });
    expect(body.messages).toEqual([{ role: "system", content: "system rule" }, { role: "user", content: "hi" }]);
  });

  it("returns parallel tool calls with their IDs and parsed arguments for ADK", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({
      choices: [{
        message: {
          content: null, tool_calls: [
            { id: "call-a", type: "function", function: { name: "lookup", arguments: "{\"q\":1}" } },
            { id: "call-b", type: "function", function: { name: "lookup", arguments: "{}" } },
          ]
        }
      }]
    }));
    const result = [];
    for await (const item of new OpenRouterLlm().generateContentAsync(request())) result.push(item);
    expect(result[0].content?.parts).toEqual([{ functionCall: { id: "call-a", name: "lookup", args: { q: 1 } } }, { functionCall: { id: "call-b", name: "lookup", args: {} } }]);
  });

  it("preserves tool result IDs and prior turns in the following request", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "done" } }] })); globalThis.fetch = fetch;
    const history = [
      { role: "user", parts: [{ text: "first" }] },
      { role: "model", parts: [{ functionCall: { id: "call-7", name: "lookup", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { id: "call-7", name: "lookup", response: { result: "ok" } } }, { text: "next" }] },
    ];
    for await (const item of new OpenRouterLlm().generateContentAsync(request(history))) { void item; }
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).messages).toEqual([
      { role: "system", content: "system rule" }, { role: "user", content: "first" },
      { role: "assistant", content: null, tool_calls: [{ id: "call-7", type: "function", function: { name: "lookup", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-7", content: "{\"result\":\"ok\"}" }, { role: "user", content: "next" },
    ]);
  });

  it("sanitizes HTTP, malformed payload, and configuration errors", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    const expected = new Map([
      [400, "invalid request"], [401, "invalid API key"], [402, "account/payment restriction"],
      [403, "permission or privacy restriction"], [408, "timeout"], [429, "rate limit"],
      [502, "upstream provider failure"], [503, "no eligible provider"],
    ]);
    for (const [status, category] of expected) {
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: status, message: "PRIVATE PROMPT, secret-key, and provider details" } }, { status }));
      let failure: unknown;
      try { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(OpenRouterError);
      expect((failure as OpenRouterError).diagnostics).toMatchObject({ stage: "OpenRouter response", httpStatus: status, openRouterErrorCode: status, httpError: true, category });
      expect(JSON.stringify((failure as OpenRouterError).diagnostics)).not.toMatch(/PRIVATE PROMPT|secret-key|provider details/i);
    }
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ choices: [] }, { headers: { "x-openrouter-generation-id": "gen-safe-17" } }));
    let malformed: unknown;
    try { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } } catch (error) { malformed = error; }
    expect((malformed as OpenRouterError).diagnostics).toMatchObject({ stage: "response validation", category: "invalid response", requestId: "gen-safe-17", httpError: false });

    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(async () => { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } }).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(new OpenRouterError("UPSTREAM").message).not.toContain("secret");
  });

  it("classifies HTTP 200 error objects and reports only safe error metadata", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({
      id: "gen-safe-200",
      error: { code: 503, message: "PRIVATE PROMPT with secret-key", metadata: { error_type: "provider_error", provider_code: 451 } },
    }));
    let failure: unknown;
    try { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(OpenRouterError);
    expect((failure as OpenRouterError).diagnostics).toMatchObject({
      stage: "OpenRouter response", httpStatus: 200, openRouterErrorCode: 503,
      errorType: "provider_error", providerCode: 451, requestId: "gen-safe-200",
      httpError: false, category: "no eligible provider",
    });
    expect(JSON.stringify((failure as OpenRouterError).diagnostics)).not.toMatch(/PRIVATE PROMPT|secret-key/i);
  });

  it("normalizes a no-endpoint 404 without exposing its message", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: 404, message: "No endpoints found matching PRIVATE PROMPT data policy for secret-key" } }, { status: 404 }));
    let failure: unknown;
    try { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } } catch (error) { failure = error; }
    expect((failure as OpenRouterError).diagnostics).toMatchObject({ httpStatus: 404, category: "no eligible provider", httpError: true });
    expect(JSON.stringify((failure as OpenRouterError).diagnostics)).not.toMatch(/PRIVATE PROMPT|secret-key|data policy/i);
  });

  it("classifies HTTP 403 and 503 without printing raw error bodies", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    for (const [status, category] of [[403, "permission or privacy restriction"], [503, "no eligible provider"]] as const) {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("private prompt secret-key raw body", { status }));
      let failure: unknown;
      try { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } } catch (error) { failure = error; }
      expect((failure as OpenRouterError).diagnostics).toMatchObject({ httpStatus: status, httpError: true, category });
      expect(JSON.stringify((failure as OpenRouterError).diagnostics)).not.toMatch(/private prompt|secret-key|raw body/i);
    }
  });

  it("sanitizes network errors and marks adapter timeouts", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("private prompt and credential details"));
    await expect(async () => { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } }).rejects.toMatchObject({ code: "UPSTREAM", message: "OpenRouter inference request failed." });
    vi.stubEnv("OPENROUTER_TIMEOUT_MS", "1");
    globalThis.fetch = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    await expect(async () => { for await (const item of new OpenRouterLlm().generateContentAsync(request())) { void item; } }).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("fails closed when an ADK tool is not a function declaration", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model"); vi.stubEnv("OPENROUTER_API_KEY", "secret-key");
    const fetch = vi.fn(); globalThis.fetch = fetch;
    const unsupported = { ...request(), config: { tools: [{ googleSearch: {} }] } } as unknown as LlmRequest;
    await expect(async () => { for await (const item of new OpenRouterLlm().generateContentAsync(unsupported)) { void item; } }).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails clearly for streaming and live connections", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    const llm = new OpenRouterLlm();
    await expect(llm.connect()).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("streams text SSE chunks progressively and yields final turn-complete response", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    vi.stubEnv("OPENROUTER_API_KEY", "secret-key");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"world!"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
    globalThis.fetch = fetch;

    const items = [];
    for await (const item of new OpenRouterLlm().generateContentAsync(request([{ role: "user", parts: [{ text: "hi" }] }]), true)) {
      items.push(item);
    }

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      content: { role: "model", parts: [{ text: "Hello " }] },
      partial: true,
    });
    expect(items[1]).toEqual({
      content: { role: "model", parts: [{ text: "world!" }] },
      partial: true,
    });
    expect(items[2]).toEqual({
      content: { role: "model", parts: [{ text: "Hello world!" }] },
      partial: false,
      turnComplete: true,
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.stream).toBe(true);
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true, allow_fallbacks: false });
  });

  it("handles multi-byte UTF-8 characters split across chunk boundaries", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    vi.stubEnv("OPENROUTER_API_KEY", "secret-key");

    // "✨" is 3 bytes: 0xE2, 0x9C, 0xA8
    const part1 = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Sparkle: \u2728"}}]}\n\n');
    // Split the stream right in the middle of a multi-byte sequence
    const slicePoint = part1.length - 6; // inside the encoded character
    const chunkA = part1.slice(0, slicePoint);
    const chunkB = part1.slice(slicePoint);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunkA);
        controller.enqueue(chunkB);
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));

    const items = [];
    for await (const item of new OpenRouterLlm().generateContentAsync(request(), true)) {
      items.push(item);
    }

    expect(items.length).toBeGreaterThanOrEqual(1);
    const lastItem = items[items.length - 1];
    expect(lastItem.partial).toBe(false);
    expect((lastItem.content?.parts?.[0] as { text: string })?.text).toContain("✨");
  });

  it("assembles fragmented tool call arguments across multiple streaming chunks", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    vi.stubEnv("OPENROUTER_API_KEY", "secret-key");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Chunk 1: Tool call ID and function name
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"lookup","arguments":"{\\"query\\":"}}]}}]}\n\n'));
        // Chunk 2: Fragmented argument
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"important\\"}"}}]}}]}\n\n'));
        // Chunk 3: DONE
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));

    const items = [];
    for await (const item of new OpenRouterLlm().generateContentAsync(request(), true)) {
      items.push(item);
    }

    // Tool call must NOT be emitted until completely assembled and validated
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      content: {
        role: "model",
        parts: [{ functionCall: { id: "call_123", name: "lookup", args: { query: "important" } } }],
      },
      partial: false,
    });
  });

  it("assembles parallel multiple tool calls correctly", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    vi.stubEnv("OPENROUTER_API_KEY", "secret-key");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"lookup","arguments":"{\\"q\\":1}"}},{"index":1,"id":"call-2","function":{"name":"lookup","arguments":"{\\"q\\":2}"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));

    const items = [];
    for await (const item of new OpenRouterLlm().generateContentAsync(request(), true)) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].content?.parts).toEqual([
      { functionCall: { id: "call-1", name: "lookup", args: { q: 1 } } },
      { functionCall: { id: "call-2", name: "lookup", args: { q: 2 } } },
    ]);
  });

  it("supports multiple tool rounds with tool results and streaming follow-up", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    vi.stubEnv("OPENROUTER_API_KEY", "secret-key");

    const encoder = new TextEncoder();
    // First round stream: yields tool call
    const stream1 = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"round1-call","function":{"name":"lookup","arguments":"{\\"topic\\":\\"testing\\"}"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    // Second round stream: yields follow-up text
    const stream2 = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Found test results."}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(stream1, { headers: { "Content-Type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(stream2, { headers: { "Content-Type": "text/event-stream" } }));
    globalThis.fetch = fetchMock;

    const llm = new OpenRouterLlm();

    // Round 1
    const round1Items = [];
    for await (const item of llm.generateContentAsync(request([{ role: "user", parts: [{ text: "find info" }] }]), true)) {
      round1Items.push(item);
    }
    expect(round1Items).toHaveLength(1);
    expect(round1Items[0].content?.parts).toEqual([
      { functionCall: { id: "round1-call", name: "lookup", args: { topic: "testing" } } },
    ]);

    // Round 2 (with tool result)
    const historyWithToolResult: LlmRequest["contents"] = [
      { role: "user", parts: [{ text: "find info" }] },
      { role: "model", parts: [{ functionCall: { id: "round1-call", name: "lookup", args: { topic: "testing" } } }] },
      { role: "user", parts: [{ functionResponse: { id: "round1-call", name: "lookup", response: { count: 3 } } }] },
    ];
    const round2Items = [];
    for await (const item of llm.generateContentAsync(request(historyWithToolResult), true)) {
      round2Items.push(item);
    }
    expect(round2Items).toHaveLength(2); // partial delta + final complete
    expect(round2Items[1].content?.parts).toEqual([{ text: "Found test results." }]);

    // Verify messages sent to OpenRouter in round 2 included the tool result
    const round2Body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(round2Body.messages).toContainEqual({
      role: "tool",
      tool_call_id: "round1-call",
      content: JSON.stringify({ count: 3 }),
    });
  });

  it("sanitizes in-stream error events safely", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    vi.stubEnv("OPENROUTER_API_KEY", "secret-key");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"error":{"code":429,"message":"Rate limit exceeded for user sk-or-secret"}}\n\n'));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));

    let caught: unknown;
    try {
      for await (const item of new OpenRouterLlm().generateContentAsync(request(), true)) {
        void item;
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OpenRouterError);
    expect((caught as OpenRouterError).diagnostics).toMatchObject({
      stage: "OpenRouter response",
      category: "rate limit",
      openRouterErrorCode: 429,
    });
    expect(JSON.stringify((caught as OpenRouterError).diagnostics)).not.toMatch(/secret|sk-or/i);
  });

  it("sanitizes malformed in-stream JSON safely", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "provider/model");
    vi.stubEnv("OPENROUTER_API_KEY", "secret-key");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {invalid-json\n\n"));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));

    await expect(async () => {
      for await (const item of new OpenRouterLlm().generateContentAsync(request(), true)) {
        void item;
      }
    }).rejects.toMatchObject({
      code: "UPSTREAM",
      diagnostics: expect.objectContaining({ category: "invalid response" }),
    });
  });
});
