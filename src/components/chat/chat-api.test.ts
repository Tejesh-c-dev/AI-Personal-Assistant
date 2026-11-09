import { describe, expect, it, vi } from "vitest";

import {
  createChatRequest,
  parseAssistantResponse,
  sendChatMessage,
} from "./chat-api";

describe("chat API helpers", () => {
  it("maps the selected account and preserves the conversation session", () => {
    expect(createChatRequest("  Check my emails  ", "conversation-uuid", "Personal")).toEqual({
      message: "Check my emails",
      sessionId: "conversation-uuid",
      account: "personal",
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
});
