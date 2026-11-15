import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getConversation: vi.fn(), handleConfirmation: vi.fn(),
  listGoogleWriteApprovals: vi.fn(), rejectGoogleWriteApproval: vi.fn(),
}));
vi.mock("../../../../lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("../../../../lib/conversations", () => ({ getConversation: mocks.getConversation, isUuid: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) }));
vi.mock("../../../../lib/adk/confirmation-handler", () => ({ handleConfirmation: mocks.handleConfirmation }));
vi.mock("../../../../lib/google-write-approvals", () => ({ listGoogleWriteApprovals: mocks.listGoogleWriteApprovals, rejectGoogleWriteApproval: mocks.rejectGoogleWriteApproval }));

import { GET, POST } from "./route";

const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const conversationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const approvalId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const conversation = { id: conversationId };

function post(action: string, id = approvalId, convId = conversationId) {
  return POST(new Request(`http://localhost/api/approvals/${id}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, conversationId: convId }),
  }), { params: Promise.resolve({ id }) });
}

describe("approval action API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.getConversation.mockResolvedValue({ conversation, messages: [] });
    mocks.listGoogleWriteApprovals.mockResolvedValue([{ approvalId, status: "pending" }]);
  });

  it("confirms through the deterministic handler using only approval and conversation identity", async () => {
    mocks.handleConfirmation.mockResolvedValue({ output: "Email sent." });
    mocks.listGoogleWriteApprovals.mockResolvedValueOnce([{ approvalId, status: "approved" }]);
    const response = await post("confirm");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "approved", result: "Email sent." });
    expect(mocks.handleConfirmation).toHaveBeenCalledWith({ approvalId, user, conversation });
  });

  it("rejects through the atomic secure cancellation function", async () => {
    mocks.rejectGoogleWriteApproval.mockResolvedValue({ id: approvalId, status: "rejected" });
    const response = await post("reject");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "rejected" });
    expect(mocks.rejectGoogleWriteApproval).toHaveBeenCalledWith({ id: approvalId, userId: user.id, conversationId });
    expect(mocks.handleConfirmation).not.toHaveBeenCalled();
  });

  it("does not permit a user without conversation ownership to confirm or reject", async () => {
    mocks.getConversation.mockResolvedValue(null);
    expect((await post("confirm")).status).toBe(404);
    expect((await post("reject")).status).toBe(404);
    expect(mocks.handleConfirmation).not.toHaveBeenCalled();
    expect(mocks.rejectGoogleWriteApproval).not.toHaveBeenCalled();
  });

  it("returns the authoritative expired status when rejection loses to expiry", async () => {
    mocks.rejectGoogleWriteApproval.mockResolvedValue(null);
    mocks.listGoogleWriteApprovals.mockResolvedValue([{ approvalId, status: "expired" }]);
    const response = await post("reject");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: "expired" });
  });

  it.each(["expired", "rejected"] as const)("does not confirm an approval in %s state", async (status) => {
    mocks.handleConfirmation.mockRejectedValue(new Error("This approval has expired, already been used, or does not exist for this conversation."));
    mocks.listGoogleWriteApprovals.mockResolvedValue([{ approvalId, status }]);
    const response = await post("confirm");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status });
  });

  it("does not reject an already approved approval", async () => {
    mocks.rejectGoogleWriteApproval.mockResolvedValue(null);
    mocks.listGoogleWriteApprovals.mockResolvedValue([{ approvalId, status: "approved" }]);
    const response = await post("reject");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: "approved" });
  });

  it("returns failed or uncertain execution state without suggesting a retry", async () => {
    mocks.handleConfirmation.mockRejectedValue(new Error("CONFIRMATION_EXECUTION_FAILED"));
    mocks.listGoogleWriteApprovals.mockResolvedValue([{ approvalId, status: "uncertain" }]);
    const response = await post("confirm");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: "uncertain" });
  });

  it("returns only safe status data from the owner-scoped read endpoint", async () => {
    mocks.listGoogleWriteApprovals.mockResolvedValue([{ approvalId, status: "pending", operation: "gmail.send", details: { to: "a@example.com" } }]);
    const response = await GET(new Request(`http://localhost/api/approvals/${approvalId}?conversationId=${conversationId}`), { params: Promise.resolve({ id: approvalId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ approval: { approvalId, status: "pending", details: { to: "a@example.com" } } });
  });
});
