import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({
  consumeOAuthTransaction: vi.fn(),
  createOAuthTransaction: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn(),
  getGoogleConfig: vi.fn(() => ({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://localhost:3000/api/auth/google/callback",
  })),
  randomToken: vi.fn()
    .mockReturnValueOnce("state")
    .mockReturnValueOnce("nonce")
    .mockReturnValueOnce("verifier"),
  setSessionCookie: vi.fn(),
  upsertGoogleUser: vi.fn(),
}));

import { beginGoogleAuthorization, completeGoogleAuthorization } from "./google-oauth";
import * as auth from "./auth";

describe("Google OAuth", () => {
  it("requests only OpenID profile and email scopes with PKCE", async () => {
    const authorization = await beginGoogleAuthorization();
    const url = new URL(authorization.url);

    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(authorization.state).toBe("state");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("nonce")).toBe("nonce");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.createOAuthTransaction).toHaveBeenCalledWith({
      state: "state",
      nonce: "nonce",
      codeVerifier: "verifier",
    });
  });

  it("rejects an invalid or expired state before exchanging a code", async () => {
    vi.mocked(auth.consumeOAuthTransaction).mockResolvedValueOnce(null as never);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(completeGoogleAuthorization({} as never, "bad-state", "code")).rejects.toThrow("state is invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
