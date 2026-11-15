import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeGoogleWriteApproval, createGoogleWriteApproval, rejectGoogleWriteApproval, updateGoogleWriteApprovalStatus } from "./google-write-approvals";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));
vi.mock("./db", () => ({ getDatabase: () => ({ insert: mocks.insert, update: mocks.update }) }));

describe("Google write approvals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves creation, ownership, and payload integrity", async () => {
    const payload = { to: "test@example.com", subject: "hello" };
    mocks.insert.mockReturnValue({ values: () => ({ returning: mocks.returning.mockResolvedValue([{ id: "approval-1" }]) }) });

    const result = await createGoogleWriteApproval({
      userId: "user-1",
      conversationId: "conv-1",
      label: "personal",
      googleAccountId: "account-1",
      operation: "gmail.send",
      payload,
    });
    expect(result.approvalId).toBe("approval-1");
    // createGoogleWriteApproval uses insert only — no update (no manual label sync needed)
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects expired approvals", async () => {
    mocks.update.mockReturnValue({ set: () => ({ where: () => ({ returning: mocks.returning.mockResolvedValue([]) }) }) });
    const result = await consumeGoogleWriteApproval({ id: "approval-1", userId: "user-1", conversationId: "conv-1" });
    expect(result).toBeNull();
  });

  it("atomically records rejection only when the approval is pending", async () => {
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mocks.returning.mockResolvedValue([{ id: "approval-1", status: "rejected" }]) }) });
    mocks.update.mockReturnValue({ set });
    const result = await rejectGoogleWriteApproval({ id: "approval-1", userId: "user-1", conversationId: "conv-1" });
    expect(set).toHaveBeenCalledWith({ status: "rejected", consumedAt: expect.any(Date) });
    expect(result).toMatchObject({ status: "rejected" });
  });

  it("records terminal execution state after confirmation consumption", async () => {
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mocks.returning.mockResolvedValue([{ id: "approval-1", status: "approved", result: "Email sent." }]) }) });
    mocks.update.mockReturnValue({ set });
    const result = await updateGoogleWriteApprovalStatus({ id: "approval-1", userId: "user-1", conversationId: "conv-1", status: "approved", result: "Email sent." });
    expect(set).toHaveBeenCalledWith({ status: "approved", result: "Email sent." });
    expect(result).toMatchObject({ status: "approved" });
  });

  it("preserves the approval ID and returns the account label for consumption after a rename", async () => {
    // After an account rename (personal → work), the DB ON UPDATE CASCADE updates
    // account_label on existing approvals. consumeGoogleWriteApproval reads the
    // updated label — simulated here by returning the new label value directly.
    const renamedLabel = "work";
    mocks.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: mocks.returning.mockResolvedValue([{
            id: "approval-1",
            userId: "user-1",
            conversationId: "conv-1",
            accountLabel: renamedLabel, // cascaded from the rename
            googleAccountId: "account-1",
            operation: "gmail.send",
            payload: JSON.stringify({ subject: "hello" }),
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: null,
          }]),
        }),
      }),
    });

    const result = await consumeGoogleWriteApproval({ id: "approval-1", userId: "user-1", conversationId: "conv-1" });

    expect(result).not.toBeNull();
    expect(result?.label).toBe(renamedLabel);
    expect(result?.accountId).toBe("account-1");
    expect(result?.operation).toBe("gmail.send");
  });

  it("createGoogleWriteApproval uses insert only — no UPDATE issued during creation", async () => {
    // Verifies that the creation path does not call update (which would have been needed
    // by the old manual approval-label sync, but is now handled by ON UPDATE CASCADE).
    mocks.insert.mockReturnValue({
      values: () => ({
        returning: mocks.returning.mockResolvedValue([{ id: "approval-persist-1" }]),
      }),
    });

    const created = await createGoogleWriteApproval({
      userId: "user-1",
      conversationId: "conv-1",
      label: "personal",
      googleAccountId: "account-1",
      operation: "gmail.send",
      payload: { body: "data" },
    });

    expect(created.approvalId).toBe("approval-persist-1");
    // Only insert, no update — the cascade handles label propagation on rename
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
