import { describe, expect, it, vi } from "vitest";
import { copyApprovalId, createApprovalActionLock } from "./approval-action";

describe("approval actions", () => {
  it("prevents duplicate in-flight action clicks", () => {
    const lock = createApprovalActionLock();
    expect(lock.acquire()).toBe(true);
    expect(lock.acquire()).toBe(false);
    lock.release();
    expect(lock.acquire()).toBe(true);
  });

  it("copies the full approval ID", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await copyApprovalId("approval-uuid", { writeText });
    expect(writeText).toHaveBeenCalledWith("approval-uuid");
  });
});
