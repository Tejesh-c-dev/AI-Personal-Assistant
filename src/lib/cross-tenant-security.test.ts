import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import * as auth from "./auth";
import * as conversations from "./conversations";
import * as approvals from "./google-write-approvals";

describe("Cross-tenant security", () => {
  it("rejects User B from accessing User A's resources", async () => {
    vi.spyOn(conversations, "getConversation").mockResolvedValue(null);
    await expect(conversations.getConversation("conv-A", "user-B")).resolves.toBeNull();
    
    vi.spyOn(approvals, "consumeGoogleWriteApproval").mockResolvedValue(null);
    await expect(approvals.consumeGoogleWriteApproval({ id: "approval-A", userId: "user-B", conversationId: "conv-A" })).resolves.toBeNull();

    vi.spyOn(auth, "findGoogleAccount").mockResolvedValue(null as never);
    await expect(auth.findGoogleAccount("user-B", "personal")).resolves.toBeNull();

    vi.spyOn(auth, "updateGoogleAccountLabel").mockRejectedValue(new Error("ACCOUNT_NOT_FOUND"));
    await expect(auth.updateGoogleAccountLabel("user-B", "personal", "work")).rejects.toThrow("ACCOUNT_NOT_FOUND");

    vi.spyOn(auth, "deleteGoogleAccount").mockResolvedValue(null);
    await expect(auth.deleteGoogleAccount("user-B", "personal")).resolves.toBeNull();
  });
});
