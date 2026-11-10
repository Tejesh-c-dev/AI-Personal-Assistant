import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ verifyAny: vi.fn(), verifyProposal: vi.fn(), search: vi.fn(), send: vi.fn(), createApproval: vi.fn() }));
vi.mock("../../../../lib/google-api", () => ({
  GOOGLE_OPERATIONS: ["gmail.search", "gmail.get", "gmail.send", "calendar.list", "calendar.get", "calendar.create", "docs.get", "docs.create", "docs.insert", "docs.export"],
  GoogleAuthorizationError: class GoogleAuthorizationError extends Error { constructor(public code: string) { super(code); } },
  googleBroker: { searchGmail: mocks.search, sendGmail: mocks.send },
  verifyAnyGoogleCapability: mocks.verifyAny,
  verifyGoogleProposalCapability: mocks.verifyProposal,
}));
vi.mock("../../../../lib/google-write-approvals", () => ({ createGoogleWriteApproval: mocks.createApproval }));

import { POST } from "./route";

function makeRequest(body: unknown, authorization?: string) {
  return new Request("http://localhost/api/google/broker", { method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify(body) });
}

describe("POST /api/google/broker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAny.mockResolvedValue({ userId: "server-user", label: "personal" });
    mocks.verifyProposal.mockResolvedValue({ userId: "server-user", label: "personal", conversationId: "server-conversation" });
    mocks.search.mockResolvedValue({ messages: [] });
    mocks.createApproval.mockResolvedValue({ approvalId: "approval-1", expiresAt: "2030-01-01T00:00:00.000Z" });
  });

  it("uses only the signed capability identity and executes its mapped read operation", async () => {
    const response = await POST(makeRequest({ userId: "attacker", account: "official", operation: "gmail.search", input: { query: "hello" } }, "Bearer signed-capability"));
    expect(response.status).toBe(200);
    expect(mocks.verifyAny).toHaveBeenCalledWith("signed-capability", "gmail.search", { query: "hello" });
    expect(mocks.search).toHaveBeenCalledWith("server-user", "personal", "hello", 20);
    await expect(response.json()).resolves.toEqual({ result: { messages: [] } });
  });

  it("rejects a missing capability before accessing Google", async () => {
    const response = await POST(makeRequest({ operation: "gmail.search", input: { query: "hello" } }));
    expect(response.status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("stores write proposals against the server capability account and conversation", async () => {
    const input = { to: "person@example.com", subject: "Hello", body: "Exact approved text" };
    const response = await POST(makeRequest({ action: "propose", operation: "gmail.send", input }, "Bearer proposal-capability"));
    expect(response.status).toBe(201);
    expect(mocks.verifyProposal).toHaveBeenCalledWith("proposal-capability", "gmail.send");
    expect(mocks.createApproval).toHaveBeenCalledWith({ userId: "server-user", conversationId: "server-conversation", label: "personal", operation: "gmail.send", payload: input });
    await expect(response.json()).resolves.toMatchObject({ result: { approvalId: "approval-1" } });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
