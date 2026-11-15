import { describe, expect, it, vi } from "vitest";

import {
  actOnApproval,
  createChatRequest,
  parseAssistantResponse,
  sendChatMessage,
  streamChatMessage,
} from "./chat-api";

describe("chat API helpers", () => {
  it("posts only the exact approval and conversation identity to the local action endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "approved", result: "Event created." }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(actOnApproval("approval-uuid", "conversation-uuid", "confirm")).resolves.toMatchObject({ status: "approved", result: "Event created." });
    expect(fetcher).toHaveBeenCalledWith("/api/approvals/approval-uuid", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ conversationId: "conversation-uuid", action: "confirm" }),
    }));
    vi.unstubAllGlobals();
  });

  it("maps the selected account and preserves the conversation session", () => {
    expect(createChatRequest("  Check my emails  ", "conversation-uuid", "Personal")).toEqual({
      message: "Check my emails",
      sessionId: "conversation-uuid",
      account: "personal",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(createChatRequest("Check work", "conversation-uuid", "Official").account).toBe("official");
    expect(createChatRequest("Check both", "conversation-uuid", "Both").account).toBe("both");
  });

  it("forwards the request and extracts output from the API response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ output: "Your inbox is clear." }), { status: 200 }),
    );

    await expect(sendChatMessage("Check my emails", "conversation-uuid", "Personal", fetcher))
      .resolves.toBe("Your inbox is clear.");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        body: JSON.stringify({
          message: "Check my emails",
          sessionId: "conversation-uuid",
          account: "personal",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }),
    );
  });

  it("supports a direct string response", () => {
    expect(parseAssistantResponse("  Hello there. ")).toBe("Hello there.");
  });

  it("extracts the first non-empty output from the n8n response array", () => {
    expect(
      parseAssistantResponse([
        { output: "  " },
        { output: "  Your calendar is clear. " },
        { output: "A later response" },
      ]),
    ).toBe("Your calendar is clear.");
  });

  it("rejects empty responses", () => {
    expect(() => parseAssistantResponse([])).toThrow(
      "The assistant returned an unsupported response.",
    );
    expect(() => parseAssistantResponse([{ output: "  " }])).toThrow(
      "The assistant returned an unsupported response.",
    );
  });

  it("surfaces known API errors without displaying raw JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "The n8n webhook is not configured." }), { status: 503 }),
    );

    await expect(sendChatMessage("Hello", "conversation-uuid", "Personal", fetcher))
      .rejects.toThrow("The n8n webhook is not configured.");
    expect(() => parseAssistantResponse({ unexpected: { raw: "data" } }))
      .toThrow("The assistant returned an unsupported response.");
  });

  describe("streamChatMessage", () => {
    it("parses SSE event stream and fires callbacks in order", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"start","requestId":"req-1"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"activity","id":"a1","label":"Searching Gmail","status":"running"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"activity","id":"a1","label":"Searching Gmail","status":"completed"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"approval_required","approvalId":"app-1","account":"personal","operation":"gmail.send","expiresAt":"2026-11-15T00:00:00Z","details":{"to":"user@test.com"}}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"text_delta","text":"I found 3 emails."}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"final","messageId":"msg-1"}\n\n'));
          controller.close();
        },
      });

      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
      );

      const events: string[] = [];
      const activities: unknown[] = [];
      let approval: unknown = null;
      let text = "";
      let finalId = "";

      await streamChatMessage({
        message: "Search emails",
        sessionId: "sess-1",
        account: "personal",
        onStart: (reqId) => events.push(`start:${reqId}`),
        onActivity: (act) => activities.push(act),
        onApprovalRequired: (app) => { approval = app; },
        onTextDelta: (delta) => { text += delta; },
        onFinal: (id) => { finalId = id; },
        fetcher,
      });

      expect(events).toEqual(["start:req-1"]);
      expect(activities).toEqual([
        { id: "a1", label: "Searching Gmail", status: "running" },
        { id: "a1", label: "Searching Gmail", status: "completed" },
      ]);
      expect(approval).toEqual({
        approvalId: "app-1",
        account: "personal",
        operation: "gmail.send",
        expiresAt: "2026-11-15T00:00:00Z",
        details: { to: "user@test.com" },
      });
      expect(text).toBe("I found 3 emails.");
      expect(finalId).toBe("msg-1");
    });

    it("handles HTTP error response before stream starts", async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: "Google authorization required" }), { status: 403 }),
      );

      const onError = vi.fn();
      await expect(
        streamChatMessage({
          message: "Hi",
          sessionId: "sess-1",
          account: "personal",
          onError,
          fetcher,
        }),
      ).rejects.toThrow("Google authorization required");

      expect(onError).toHaveBeenCalledWith("Google authorization required");
    });
  });
});
