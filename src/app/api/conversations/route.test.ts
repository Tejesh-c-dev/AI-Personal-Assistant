import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "active_conversation_id"
      ? { value: "00000000-0000-4000-8000-000000000001" }
      : undefined,
  }),
}));

vi.mock("../../../lib/conversations", () => ({
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
  createConversationTitle: (value: string) => value.trim().slice(0, 80),
  isAccount: (value: unknown) => value === "personal" || value === "official" || value === "both",
  isUuid: (value: unknown) => typeof value === "string" && value.length === 36,
}));

import { POST, GET } from "./route";
import { DELETE, GET as GET_ITEM, PATCH } from "./[id]/route";

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
    const response = await GET();
    await expect(response.json()).resolves.toEqual({
      conversations: [],
      activeConversationId: validId,
    });
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
  });
});
