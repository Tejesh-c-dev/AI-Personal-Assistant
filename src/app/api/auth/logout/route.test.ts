import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/auth", () => ({
  clearSessionCookie: vi.fn(),
  invalidateCurrentSession: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "./route";
import * as auth from "../../../../lib/auth";

describe("POST /api/auth/logout", () => {
  it("invalidates the current server session and clears its cookie", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(auth.invalidateCurrentSession).toHaveBeenCalled();
    expect(auth.clearSessionCookie).toHaveBeenCalled();
  });
});
