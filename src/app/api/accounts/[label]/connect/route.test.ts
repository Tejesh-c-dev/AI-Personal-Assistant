import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/auth")>()),
  getCurrentUser: vi.fn(),
}));
vi.mock("../../../../../lib/google-oauth", () => ({
  GOOGLE_ACCOUNT_SCOPES: ["scope-a", "scope-b"],
  beginGoogleAuthorization: vi.fn(),
}));

import { POST } from "./route";
import * as auth from "../../../../../lib/auth";
import * as oauth from "../../../../../lib/google-oauth";

describe("POST /api/accounts/[label]/connect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ label: "personal" }) });

    expect(response.status).toBe(401);
    expect(oauth.beginGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("binds the OAuth transaction to the authenticated user and requested label", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(oauth.beginGoogleAuthorization).mockResolvedValueOnce({ url: "https://accounts.google.com/authorize", state: "state-value" });

    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ label: "official" }) });

    expect(oauth.beginGoogleAuthorization).toHaveBeenCalledWith(["scope-a", "scope-b"], {
      operation: "connect", initiatingUserId: "current-user", accountLabel: "official",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/authorize");
  });

  it("rejects invalid account labels including reserved 'both'", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ label: "both" }) });
    expect(response.status).toBe(400);
    expect(oauth.beginGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("accepts custom dynamic labels", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(oauth.beginGoogleAuthorization).mockResolvedValueOnce({ url: "https://accounts.google.com/authorize", state: "state-value" });

    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ label: "work-project" }) });

    expect(oauth.beginGoogleAuthorization).toHaveBeenCalledWith(["scope-a", "scope-b"], {
      operation: "connect", initiatingUserId: "current-user", accountLabel: "work-project",
    });
    expect(response.status).toBe(303);
  });
});
