import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../lib/auth", () => ({
  getCurrentUser: vi.fn(),
  listGoogleAccounts: vi.fn(),
}));

import { GET } from "./route";
import * as auth from "../../../lib/auth";

describe("GET /api/accounts", () => {
  it("requires authentication", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(auth.listGoogleAccounts).not.toHaveBeenCalled();
  });

  it("lists only safe account fields for the current user", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "user-1" } as never);
    vi.mocked(auth.listGoogleAccounts).mockResolvedValueOnce([{
      id: "account-1", label: "personal", email: "person@example.com", createdAt: new Date(0), updatedAt: new Date(0),
    }] as never);

    const response = await GET();
    const payload = await response.json();

    expect(auth.listGoogleAccounts).toHaveBeenCalledWith("user-1");
    expect(payload.accounts[0]).toEqual(expect.objectContaining({ id: "account-1", label: "personal", email: "person@example.com" }));
    expect(JSON.stringify(payload)).not.toMatch(/refresh.?token|credential|ciphertext/i);
  });
});
