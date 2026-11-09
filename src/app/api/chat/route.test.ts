import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const originalFetch = globalThis.fetch;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
});

describe("POST /api/chat", () => {
  it("forwards the account instruction and preserves a valid upstream response", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: "Done" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    const response = await POST(
      makeRequest({
        message: "Check my emails",
        sessionId: "conversation-uuid",
        account: "personal",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ output: "Done" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5678/webhook/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "conversation-uuid",
          user: "Use only the Personal Gmail account.\n\nCheck my emails",
        }),
      }),
    );
  });

  it.each([
    [{ sessionId: "session", account: "personal" }, "missing message"],
    [{ message: "Hello", sessionId: "session", account: "unknown" }, "invalid account"],
    [{ message: "Hello", account: "personal" }, "missing session ID"],
  ])("returns 400 for %s", async (body, _caseName) => {
    void _caseName;
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("returns 400 for invalid JSON", async () => {
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: "{invalid",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 503 when the webhook URL is missing", async () => {
    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "session",
        account: "official",
      }),
    );

    expect(response.status).toBe(503);
  });

  it("returns 502 for an upstream HTTP error while preserving its JSON body", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Workflow failed" }), {
        status: 500,
      }),
    );

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "session",
        account: "both",
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      message: "Workflow failed",
    });
  });

  it("returns 502 when the upstream request fails", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "session",
        account: "personal",
      }),
    );

    expect(response.status).toBe(502);
  });

  it("returns 504 when the upstream request times out", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    vi.stubEnv("N8N_WEBHOOK_TIMEOUT_MS", "1");
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "session",
        account: "personal",
      }),
    );

    expect(response.status).toBe(504);
  });

  it("returns 502 for an invalid upstream response", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "session",
        account: "official",
      }),
    );

    expect(response.status).toBe(502);
  });
});
