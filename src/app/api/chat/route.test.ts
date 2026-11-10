import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("../../../lib/conversations", () => ({
  appendMessage: vi.fn().mockResolvedValue({}),
  createConversation: vi.fn().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    title: "Check my emails",
    account: "personal",
  }),
  createConversationTitle: (value: string) => value.trim().slice(0, 80),
  findConversationBySessionId: vi.fn().mockResolvedValue(null),
  isUuid: (value: unknown) => typeof value === "string" && value.length === 36,
  updateConversation: vi.fn().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    title: "Check my emails",
    account: "personal",
  }),
}));

import { POST } from "./route";
import * as auth from "../../../lib/auth";
import * as conversationRepository from "../../../lib/conversations";

const originalFetch = globalThis.fetch;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe("POST /api/chat", () => {
  it("returns 401 without a server session", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce(null);

    const response = await POST(makeRequest({
      message: "Hello",
      sessionId: "00000000-0000-4000-8000-000000000002",
      account: "personal",
    }));

    expect(response.status).toBe(401);
  });

  it("forwards the account instruction and preserves a valid upstream response", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: "Done" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    const response = await POST(
      makeRequest({
        message: "Check my emails",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "personal",
      }),
    );

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ output: "Done" });
    expect(JSON.stringify(responseBody)).not.toContain("test-webhook-secret");
    expect(conversationRepository.createConversation).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "00000000-0000-4000-8000-000000000002",
      title: "Check my emails",
      account: "personal",
    });
    expect(conversationRepository.appendMessage).toHaveBeenCalledWith({
      conversationId: "00000000-0000-4000-8000-000000000001",
      role: "user",
      content: "Check my emails",
    });
    expect(conversationRepository.appendMessage).toHaveBeenCalledWith({
      conversationId: "00000000-0000-4000-8000-000000000001",
      role: "assistant",
      content: "Done",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5678/webhook/chat",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-N8N-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          sessionId: "00000000-0000-4000-8000-000000000001",
          userId: "user-1",
          googleBrokerUrl: "http://localhost/api/google/broker",
          googleCapabilities: {},
          googleProposalCapabilities: {},
          approvedWrite: null,
          user: "Use only the Personal account for Google operations.\n\nCheck my emails",
        }),
      }),
    );
  });

  it("fails closed when the webhook secret is missing", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "personal",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "The n8n webhook secret is not configured.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["personal", "Use only the Personal account for Google operations."],
    ["official", "Use only the Official account for Google operations."],
    ["both", "For read operations, use both connected accounts and label their results. For writes, use only an explicitly selected account."],
  ] as const)("preserves the %s account workflow instruction", async (account, instruction) => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: "Done" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    await POST(
      makeRequest({
        message: "Check my emails",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5678/webhook/chat",
      expect.objectContaining({
        body: JSON.stringify({
          sessionId: "00000000-0000-4000-8000-000000000001",
          userId: "user-1",
          googleBrokerUrl: "http://localhost/api/google/broker",
          googleCapabilities: {},
          googleProposalCapabilities: {},
          approvedWrite: null,
          user: `${instruction}\n\nCheck my emails`,
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
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "official",
      }),
    );

    expect(response.status).toBe(503);
  });

  it("returns 502 for an upstream HTTP error while preserving its JSON body", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Workflow failed" }), {
        status: 500,
      }),
    );

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "00000000-0000-4000-8000-000000000002",
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
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "personal",
      }),
    );

    expect(response.status).toBe(502);
  });

  it("returns 504 when the upstream request times out", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
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
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "personal",
      }),
    );

    expect(response.status).toBe(504);
  });

  it("uses a 150-second default webhook timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const responsePromise = POST(
      makeRequest({
        message: "Hello",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "personal",
      }),
    );
    await vi.advanceTimersByTimeAsync(150_000);

    await expect(responsePromise).resolves.toHaveProperty("status", 504);
  });

  it("returns 502 for an invalid upstream response", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const response = await POST(
      makeRequest({
        message: "Hello",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "official",
      }),
    );

    expect(response.status).toBe(502);
  });
});
