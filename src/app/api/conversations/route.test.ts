import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "active_conversation_id"
      ? { value: "00000000-0000-4000-8000-000000000001" }
      : undefined,
  }),
}));

vi.mock("../../../lib/conversations", async (importActual) => {
  const actual = await importActual<typeof import("../../../lib/conversations")>();
  return {
    createConversation: vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      sessionId: "00000000-0000-4000-8000-000000000002",
      title: "Check my emails",
      account: "personal",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    listConversations: vi.fn().mockResolvedValue([]),
    getConversation: vi.fn().mockResolvedValue(null),
    updateConversation: vi.fn().mockResolvedValue(null),
    deleteConversation: vi.fn().mockResolvedValue(false),
    // Use the real pure-function implementations so the mock reflects actual
    // dynamic-label validation behaviour (not a hardcoded enum whitelist).
    createConversationTitle: actual.createConversationTitle,
    isAccount: actual.isAccount,
    isUuid: actual.isUuid,
  };
});

import { POST, GET } from "./route";
import { DELETE, GET as GET_ITEM, PATCH } from "./[id]/route";
import * as auth from "../../../lib/auth";
import * as conversationRepository from "../../../lib/conversations";

const validId = "00000000-0000-4000-8000-000000000001";

function request(body: unknown, method = "POST") {
  return new Request("http://localhost/api/conversations", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("conversation API routes", () => {
  it("returns 401 without a server session", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("creates a conversation and sets the active conversation cookie", async () => {
    const response = await POST(request({
      sessionId: "00000000-0000-4000-8000-000000000002",
      title: "Check my emails",
      account: "personal",
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("active_conversation_id=");
  });

  it("lists conversations with the active conversation ID", async () => {
    vi.mocked(conversationRepository.listConversations).mockResolvedValueOnce([
      {
        id: validId,
        sessionId: "00000000-0000-4000-8000-000000000002",
        title: "Check my emails",
        account: "personal",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const response = await GET();
    const data = await response.json();
    expect(data.activeConversationId).toBe(validId);
    expect(data.conversations).toHaveLength(1);
  });

  it("clears the active conversation ID if it does not belong to the user", async () => {
    vi.mocked(conversationRepository.listConversations).mockResolvedValueOnce([]);
    const response = await GET();
    const data = await response.json();
    expect(data.activeConversationId).toBeNull();
    expect(data.conversations).toHaveLength(0);
  });

  it("rejects invalid conversation input", async () => {
    const response = await POST(request({ title: "Missing account" }));
    expect(response.status).toBe(400);
  });

  it("handles item retrieval, updates and deletion", async () => {
    const detailResponse = await GET_ITEM(new Request("http://localhost"), { params: Promise.resolve({ id: validId }) });
    expect(detailResponse.status).toBe(404);

    const updateResponse = await PATCH(
      request({ title: "Renamed" }, "PATCH"),
      { params: Promise.resolve({ id: validId }) },
    );
    expect(updateResponse.status).toBe(404);

    const deleteResponse = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ id: validId }) });
    expect(deleteResponse.status).toBe(404);
    expect(conversationRepository.getConversation).toHaveBeenCalledWith(validId, "user-1");
  });
});
