import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/auth", () => ({ getCurrentUser: vi.fn(), deleteGoogleAccount: vi.fn() }));
vi.mock("../../../../lib/google-token-crypto", () => ({ decryptGoogleRefreshToken: vi.fn(() => "refresh-secret") }));
vi.mock("../../../../lib/google-oauth", () => ({ revokeGoogleToken: vi.fn() }));

import { DELETE } from "./route";
import * as auth from "../../../../lib/auth";
import * as oauth from "../../../../lib/google-oauth";

describe("DELETE /api/accounts/[label]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce(null);

    const response = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ label: "personal" }) });

    expect(response.status).toBe(401);
    expect(auth.deleteGoogleAccount).not.toHaveBeenCalled();
  });

  it("deletes only the current user's account", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.deleteGoogleAccount).mockResolvedValueOnce("encrypted-value");

    const response = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ label: "official" }) });

    expect(auth.deleteGoogleAccount).toHaveBeenCalledWith("current-user", "official");
    expect(response.status).toBe(200);
  });

  it("keeps the account disconnected when Google revocation fails", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.deleteGoogleAccount).mockResolvedValueOnce("encrypted-value");
    vi.mocked(oauth.revokeGoogleToken).mockRejectedValueOnce(new Error("Google unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ label: "personal" }) });

    expect(auth.deleteGoogleAccount).toHaveBeenCalledWith("current-user", "personal");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ disconnected: true });
    error.mockRestore();
  });
});
