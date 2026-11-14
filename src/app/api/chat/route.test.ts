import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvent } from "@google/adk";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  listGoogleAccounts: vi.fn().mockResolvedValue([]),
  validateAccountLabel: (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9 -]{1,50}$/.test(normalized)) throw new Error("INVALID_LABEL");
    if (normalized === "both") throw new Error("RESERVED_LABEL");
    return normalized;
  },
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
  getConversationMessages: vi.fn().mockResolvedValue([]),
  isAccount: (value: unknown) => typeof value === "string" && (value === "both" || value === "personal" || value === "official" || (/^[a-z0-9 \-]{1,50}$/.test(value.trim().toLowerCase()) && value.trim().toLowerCase() !== "unknown")),
  isUuid: (value: unknown) => typeof value === "string" && value.length === 36,
  updateConversation: vi.fn().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    title: "Check my emails",
    account: "personal",
  }),
}));

const adkMocks = vi.hoisted(() => ({
  createRunner: vi.fn(),
  handleConfirmation: vi.fn(),
}));

vi.mock("../../../lib/adk/agent-runner", () => ({
  createRequestScopedRunner: adkMocks.createRunner,
}));
vi.mock("../../../lib/adk/confirmation-handler", () => ({
  parseConfirmationCommand: (msg: string) => {
    const match = /^\s*confirm\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*$/i.exec(msg);
    return match ? match[1] : null;
  },
  handleConfirmation: adkMocks.handleConfirmation,
}));

import { POST } from "./route";
import * as auth from "../../../lib/auth";
import * as conversationRepository from "../../../lib/conversations";
import { GoogleAuthorizationError } from "../../../lib/google-api";

const originalFetch = globalThis.fetch;

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
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
    vi.stubEnv("USE_ADK", "false");
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
    expect(adkMocks.createRunner).not.toHaveBeenCalled();
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
          "ngrok-skip-browser-warning": "true",
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

  it("returns a safe 502 for an upstream HTTP error", async () => {
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
    await expect(response.json()).resolves.toEqual({ error: "The chat provider could not complete your request." });
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

  describe("Google ADK Orchestration (USE_ADK=true)", () => {
    it("routes confirmation command to handleConfirmation when USE_ADK=true", async () => {
      vi.stubEnv("USE_ADK", "true");
      adkMocks.handleConfirmation.mockResolvedValueOnce({ output: "✓ Email sent successfully via your 'personal' account." });

      const response = await POST(
        makeRequest({
          message: "CONFIRM 11111111-2222-4333-8444-555555555555",
          sessionId: "00000000-0000-4000-8000-000000000002",
          account: "personal",
        }),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ output: "✓ Email sent successfully via your 'personal' account." });
      expect(adkMocks.handleConfirmation).toHaveBeenCalledWith({
        approvalId: "11111111-2222-4333-8444-555555555555",
        user: expect.objectContaining({ id: "user-1" }),
        conversation: expect.objectContaining({ id: "00000000-0000-4000-8000-000000000001" }),
        selectedAccount: "personal",
      });
    });

    it("returns a stable client error when confirmation validation fails", async () => {
      vi.stubEnv("USE_ADK", "true");
      adkMocks.handleConfirmation.mockRejectedValueOnce(new Error("Account mismatch"));

      const response = await POST(
        makeRequest({
          message: "CONFIRM 11111111-2222-4333-8444-555555555555",
          sessionId: "00000000-0000-4000-8000-000000000002",
          account: "both",
        }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("The selected account does not match this approval.");
      expect(JSON.stringify(json)).not.toContain("Account mismatch");
      expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });

    it("returns a safe server error when confirmation execution fails", async () => {
      vi.stubEnv("USE_ADK", "true");
      adkMocks.handleConfirmation.mockRejectedValueOnce(new Error("provider token SQL stack"));
      const response = await POST(makeRequest({
        message: "CONFIRM 11111111-2222-4333-8444-555555555555",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "personal",
      }));
      const body = await response.text();
      expect(response.status).toBe(500);
      expect(body).toBe('{"error":"The confirmation could not be completed."}');
      expect(body).not.toMatch(/provider token|SQL|stack/);
    });

    it("executes ADK runner when USE_ADK=true for normal chat turn", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.stubEnv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/chat");
      vi.stubEnv("N8N_WEBHOOK_SECRET", "test-webhook-secret");
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      const priorMessage = {
        id: "prior-message",
        conversationId: "00000000-0000-4000-8000-000000000001",
        role: "user" as const,
        content: "Earlier synthetic question",
        createdAt: new Date("2026-11-13T10:00:00Z"),
      };
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([{ label: "personal", status: "active" }] as never);
      vi.mocked(conversationRepository.getConversationMessages).mockResolvedValueOnce([priorMessage]);
      let submittedMessage = "";
      const appendEvent = vi.fn().mockResolvedValue({});
      const mockRunAsync = vi.fn(async function* ({ newMessage }: { newMessage: { parts: { text: string }[] } }) {
        submittedMessage = newMessage.parts.map((part) => part.text).join("\n");
        yield createEvent({
          invocationId: "inv-1",
          author: "personal_assistant",
          content: {
            role: "model",
            parts: [{ text: "Please connect a Google account before I can access Gmail." }],
          },
        });
      });

      adkMocks.createRunner.mockReturnValueOnce({
        runner: { runAsync: mockRunAsync },
        sessionService: {
          createSession: vi.fn().mockResolvedValue({ events: [] }),
          appendEvent,
        },
        appName: "ai-personal-assistant",
      });

      const response = await POST(
        makeRequest({
          message: "List my emails",
          sessionId: "00000000-0000-4000-8000-000000000002",
          account: "personal",
        }),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ output: "Please connect a Google account before I can access Gmail." });
      expect(conversationRepository.getConversationMessages).toHaveBeenCalledTimes(1);
      expect(appendEvent).toHaveBeenCalledTimes(1);
      expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
        event: expect.objectContaining({
          content: expect.objectContaining({ parts: [{ text: "Earlier synthetic question" }] }),
        }),
      }));
      expect(JSON.stringify(appendEvent.mock.calls)).not.toContain("List my emails");
      expect(conversationRepository.appendMessage).toHaveBeenCalledTimes(2);
      expect(conversationRepository.appendMessage).toHaveBeenNthCalledWith(1, {
        conversationId: "00000000-0000-4000-8000-000000000001",
        role: "user",
        content: "List my emails",
      });
      expect(conversationRepository.appendMessage).toHaveBeenNthCalledWith(2, {
        conversationId: "00000000-0000-4000-8000-000000000001",
        role: "assistant",
        content: "Please connect a Google account before I can access Gmail.",
      });
      expect(submittedMessage).toBe("Use only the Personal account for Google operations.\n\nList my emails");
      expect(mockRunAsync).toHaveBeenCalledTimes(1);
      expect(mockRunAsync).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
      expect(
        vi.mocked(conversationRepository.appendMessage).mock.invocationCallOrder[0],
      ).toBeLessThan(mockRunAsync.mock.invocationCallOrder[0]);
      expect(adkMocks.createRunner).toHaveBeenCalledWith({
        user: expect.objectContaining({ id: "user-1" }),
        conversation: expect.objectContaining({ id: "00000000-0000-4000-8000-000000000001" }),
        selectedAccount: "personal",
        connectedLabels: ["personal"],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns a deterministic connection instruction without invoking the model when no active account exists", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([
        { label: "personal", status: "revoked" },
      ] as never);

      const response = await POST(makeRequest({
        message: "Check my email",
        sessionId: "00000000-0000-4000-8000-000000000002",
        account: "personal",
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        output: "No Google account is connected. Connect a Google account before I can access Gmail, Calendar, or Docs.",
      });
      expect(adkMocks.createRunner).not.toHaveBeenCalled();
      expect(conversationRepository.appendMessage).toHaveBeenNthCalledWith(2, {
        conversationId: "00000000-0000-4000-8000-000000000001",
        role: "assistant",
        content: "No Google account is connected. Connect a Google account before I can access Gmail, Calendar, or Docs.",
      });
    });

    it("normalizes mixed-case selected and connected labels before creating tools", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([{ label: "Work-Account", status: "active" }] as never);
      adkMocks.createRunner.mockReturnValueOnce({
        runner: { runAsync: async function* () {} },
        sessionService: { createSession: vi.fn().mockResolvedValue({ events: [] }) },
      });

      await POST(makeRequest({ message: "Hello", sessionId: "00000000-0000-4000-8000-000000000002", account: " WORK-ACCOUNT " }));

      expect(adkMocks.createRunner).toHaveBeenCalledWith(expect.objectContaining({ selectedAccount: "work-account", connectedLabels: ["work-account"] }));
    });

    it("returns generic safe errors and request-correlated logs for runner failures", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([{ label: "personal", status: "active" }] as never);
      adkMocks.createRunner.mockImplementationOnce(() => { throw new Error("SQL private prompt capability-token"); });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await POST(makeRequest({ message: "private prompt", sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" }));
      const body = await response.text();

      expect(response.status).toBe(502);
      expect(body).toBe('{"error":"The assistant is temporarily unavailable."}');
      const requestId = response.headers.get("X-Request-ID");
      expect(requestId).toBeTruthy();
      expect(JSON.stringify(log.mock.calls)).toContain(requestId);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private prompt");
      expect(JSON.stringify(log.mock.calls)).not.toContain("capability-token");
      log.mockRestore();
    });

    it("returns a safe hydration error", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([{ label: "personal", status: "active" }] as never);
      adkMocks.createRunner.mockReturnValueOnce({
        runner: { runAsync: async function* () {} },
        sessionService: { createSession: vi.fn().mockRejectedValue(new Error("SQL stack private-data")) },
      });
      const response = await POST(makeRequest({ message: "Hello", sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" }));
      const body = await response.text();
      expect(response.status).toBe(502);
      expect(body).not.toMatch(/SQL|stack|private-data/);
    });

    it("returns a safe database error with a request ID", async () => {
      vi.mocked(conversationRepository.findConversationBySessionId).mockRejectedValueOnce(new Error("SQL private prompt token"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await POST(makeRequest({ message: "Hello", sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" }));
      const body = await response.text();
      expect(response.status).toBe(500);
      expect(body).not.toMatch(/SQL|private prompt|token/);
      expect(JSON.stringify(log.mock.calls)).toContain(response.headers.get("X-Request-ID"));
      log.mockRestore();
    });

    it("maps Google authorization failures to a safe 403", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockRejectedValueOnce(new GoogleAuthorizationError("RECONNECT_REQUIRED"));
      const response = await POST(makeRequest({ message: "Hello", sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" }));
      const body = await response.text();
      expect(response.status).toBe(403);
      expect(body).not.toContain("RECONNECT_REQUIRED");
      expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });
  });

  describe("Real-time Streaming over SSE", () => {
    function parseSseEvents(text: string): Array<Record<string, unknown>> {
      const events: Array<Record<string, unknown>> = [];
      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          try {
            events.push(JSON.parse(trimmed.slice(5).trim()));
          } catch {}
        }
      }
      return events;
    }

    it("streams events over SSE when requested via Accept header", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([{ label: "personal", status: "active" }] as never);

      const mockRunAsync = async function* () {
        yield createEvent({
          invocationId: "inv-1",
          author: "personal_assistant",
          content: { role: "model", parts: [{ text: "Hello " }] },
          partial: true,
        });
        yield createEvent({
          invocationId: "inv-2",
          author: "personal_assistant",
          content: { role: "model", parts: [{ text: "from stream!" }] },
          partial: true,
        });
        yield createEvent({
          invocationId: "inv-3",
          author: "personal_assistant",
          content: { role: "model", parts: [{ text: "Hello from stream!" }] },
          partial: false,
          turnComplete: true,
        });
      };

      adkMocks.createRunner.mockReturnValueOnce({
        runner: { runAsync: mockRunAsync },
        sessionService: { createSession: vi.fn().mockResolvedValue({ events: [] }), appendEvent: vi.fn() },
        appName: "ai-personal-assistant",
      });

      const response = await POST(
        makeRequest(
          { message: "Hi", sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" },
          { Accept: "text/event-stream" },
        ),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
      expect(response.headers.get("X-Request-ID")).toBeTruthy();

      const text = await response.text();
      const events = parseSseEvents(text);

      expect(events[0]).toMatchObject({ type: "start" });
      expect(events[1]).toEqual({ type: "text_delta", text: "Hello " });
      expect(events[2]).toEqual({ type: "text_delta", text: "from stream!" });
      expect(events[3]).toMatchObject({ type: "final", messageId: expect.any(String) });

      // Verify user message and final assistant message persisted
      expect(conversationRepository.appendMessage).toHaveBeenCalledWith({
        conversationId: "00000000-0000-4000-8000-000000000001",
        role: "user",
        content: "Hi",
      });
      expect(conversationRepository.appendMessage).toHaveBeenCalledWith({
        conversationId: "00000000-0000-4000-8000-000000000001",
        role: "assistant",
        content: "Hello from stream!",
      });
    });

    it("emits tool activities and approval preview cards during streaming", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([{ label: "personal", status: "active" }] as never);

      const mockRunAsync = async function* () {
        // Model requests tool call
        yield createEvent({
          invocationId: "inv-call",
          author: "personal_assistant",
          content: {
            role: "model",
            parts: [{ functionCall: { id: "call-gmail", name: "personal_gmail_search", args: { query: "tax" } } }],
          },
          partial: false,
        });

        // Tool execution result
        yield createEvent({
          invocationId: "inv-resp",
          author: "personal_assistant",
          content: {
            role: "user",
            parts: [{ functionResponse: { id: "call-gmail", name: "personal_gmail_search", response: { messages: [] } } }],
          },
          partial: false,
        });

        // Model requests proposal tool
        yield createEvent({
          invocationId: "inv-prop",
          author: "personal_assistant",
          content: {
            role: "model",
            parts: [{ functionCall: { id: "call-prop", name: "personal_propose_send_email", args: { to: "a@b.com" } } }],
          },
          partial: false,
        });

        // Proposal response
        yield createEvent({
          invocationId: "inv-prop-resp",
          author: "personal_assistant",
          content: {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call-prop",
                  name: "personal_propose_send_email",
                  response: {
                    approvalId: "app-test-uuid",
                    expiresAt: "2026-11-15T00:00:00Z",
                    status: "pending_confirmation",
                    proposedEmail: {
                      account: "personal",
                      to: "a@b.com",
                      subject: "Draft",
                      bodyPreview: "Hello",
                    },
                  },
                },
              },
            ],
          },
          partial: false,
        });

        // Final text delta & completion
        yield createEvent({
          invocationId: "inv-text",
          author: "personal_assistant",
          content: { role: "model", parts: [{ text: "Proposal ready." }] },
          partial: true,
        });
        yield createEvent({
          invocationId: "inv-done",
          author: "personal_assistant",
          content: { role: "model", parts: [{ text: "Proposal ready." }] },
          partial: false,
          turnComplete: true,
        });
      };

      adkMocks.createRunner.mockReturnValueOnce({
        runner: { runAsync: mockRunAsync },
        sessionService: { createSession: vi.fn().mockResolvedValue({ events: [] }), appendEvent: vi.fn() },
        appName: "ai-personal-assistant",
      });

      const response = await POST(
        makeRequest(
          { message: "Search tax and send email", sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" },
          { Accept: "text/event-stream" },
        ),
      );

      const events = parseSseEvents(await response.text());

      // 1. Tool 1 running & completed
      expect(events).toContainEqual({
        type: "activity",
        id: "call-gmail",
        label: "Searching Gmail",
        status: "running",
      });
      expect(events).toContainEqual({
        type: "activity",
        id: "call-gmail",
        label: "Searching Gmail",
        status: "completed",
      });

      // 2. Proposal tool running & completed
      expect(events).toContainEqual({
        type: "activity",
        id: "call-prop",
        label: "Preparing email approval",
        status: "running",
      });
      expect(events).toContainEqual({
        type: "activity",
        id: "call-prop",
        label: "Preparing email approval",
        status: "completed",
      });

      // 3. Approval preview emitted
      expect(events).toContainEqual({
        type: "approval_required",
        approvalId: "app-test-uuid",
        operation: "gmail.send",
        account: "personal",
        expiresAt: "2026-11-15T00:00:00Z",
        details: { to: "a@b.com", subject: "Draft", bodyPreview: "Hello" },
      });

      // 4. Text delta & final
      expect(events).toContainEqual({ type: "text_delta", text: "Proposal ready." });
      expect(events[events.length - 1]).toMatchObject({ type: "final" });
    });

    it("streams confirmation execution over SSE", async () => {
      vi.stubEnv("USE_ADK", "true");
      adkMocks.handleConfirmation.mockResolvedValueOnce({ output: "✓ Email sent successfully." });

      const confirmationId = "00000000-0000-4000-8000-000000000099";
      const response = await POST(
        makeRequest(
          { message: `CONFIRM ${confirmationId}`, sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" },
          { Accept: "text/event-stream" },
        ),
      );

      expect(response.status).toBe(200);
      const events = parseSseEvents(await response.text());
      expect(events[0]).toMatchObject({ type: "start" });
      expect(events[1]).toEqual({ type: "text_delta", text: "✓ Email sent successfully." });
      expect(events[2]).toMatchObject({ type: "final" });
    });

    it("streams safe error event when confirmation fails", async () => {
      vi.stubEnv("USE_ADK", "true");
      adkMocks.handleConfirmation.mockRejectedValueOnce(new Error("This approval has expired"));

      const confirmationId = "00000000-0000-4000-8000-000000000099";
      const response = await POST(
        makeRequest(
          { message: `CONFIRM ${confirmationId}`, sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" },
          { Accept: "text/event-stream" },
        ),
      );

      const events = parseSseEvents(await response.text());
      expect(events).toContainEqual({
        type: "error",
        error: "This approval is no longer available.",
      });
    });

    it("streams connection instruction when no Google account is connected", async () => {
      vi.stubEnv("USE_ADK", "true");
      vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([] as never);

      const response = await POST(
        makeRequest(
          { message: "Check email", sessionId: "00000000-0000-4000-8000-000000000002", account: "personal" },
          { Accept: "text/event-stream" },
        ),
      );

      const events = parseSseEvents(await response.text());
      expect(events[1]).toMatchObject({
        type: "text_delta",
        text: "No Google account is connected. Connect a Google account before I can access Gmail, Calendar, or Docs.",
      });
      expect(events[2]).toMatchObject({ type: "final" });
    });
  });
});
