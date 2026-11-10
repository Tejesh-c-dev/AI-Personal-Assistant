import { afterEach, describe, expect, it, vi } from "vitest";

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
  saveGoogleAccount: vi.fn(),
}));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn().mockResolvedValue({ payload: { nonce: "nonce", sub: "google-subject", email: "person@example.com", email_verified: true } }),
}));

import { beginGoogleAuthorization, completeGoogleAuthorization } from "./google-oauth";
import * as auth from "./auth";
import * as jose from "jose";
import { decryptGoogleRefreshToken } from "./google-token-crypto";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Google OAuth", () => {
  it("requests only OpenID profile and email scopes with PKCE", async () => {
    const authorization = await beginGoogleAuthorization();
    const url = new URL(authorization.url);

    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(authorization.state).toBe("state");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("nonce")).toBe("nonce");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      await import("node:crypto").then(({ createHash }) => createHash("sha256").update("verifier").digest("base64url")),
    );
    expect(auth.createOAuthTransaction).toHaveBeenCalledWith({
      state: "state",
      nonce: "nonce",
      codeVerifier: "verifier",
    });
  });

  it("stores connect operation ownership and account type in its transaction", async () => {
    vi.mocked(auth.randomToken)
      .mockReturnValueOnce("connect-state")
      .mockReturnValueOnce("connect-nonce")
      .mockReturnValueOnce("connect-verifier");
    await beginGoogleAuthorization([], { operation: "connect", initiatingUserId: "user-1", accountType: "official" });
    expect(auth.createOAuthTransaction).toHaveBeenLastCalledWith({
      state: "connect-state",
      nonce: "connect-nonce",
      codeVerifier: "connect-verifier",
      operation: "connect",
      initiatingUserId: "user-1",
      accountType: "official",
    });
  });

  it("rejects an invalid or expired state before exchanging a code", async () => {
    vi.mocked(auth.consumeOAuthTransaction).mockResolvedValueOnce(null as never);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(completeGoogleAuthorization({} as never, "bad-state", "code")).rejects.toThrow("state is invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("uses a consumed transaction's PKCE verifier and persists an encrypted token under its initiating user and label", async () => {
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.mocked(auth.getGoogleConfig).mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost/callback" });
    vi.mocked(auth.consumeOAuthTransaction).mockResolvedValueOnce({
      operation: "connect", initiatingUserId: "initiator", accountType: "official", codeVerifier: "pkce-verifier", nonce: "nonce",
    } as never);
    vi.mocked(jose.jwtVerify).mockResolvedValue({ payload: { nonce: "nonce", sub: "google-subject", email: "person@example.com", email_verified: true } } as never);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "signed-id-token", refresh_token: "plain-refresh-token" }), { status: 200 }));

    await completeGoogleAuthorization({} as never, "state", "authorization-code");

    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get("code_verifier")).toBe("pkce-verifier");
    expect(auth.consumeOAuthTransaction).toHaveBeenCalledWith("state");
    expect(auth.saveGoogleAccount).toHaveBeenCalledWith(expect.objectContaining({
      userId: "initiator", accountType: "official", googleSubject: "google-subject", email: "person@example.com",
    }));
    const persisted = vi.mocked(auth.saveGoogleAccount).mock.calls.at(-1)?.[0].refreshTokenCiphertext;
    expect(persisted).toBeDefined();
    expect(persisted).not.toContain("plain-refresh-token");
    expect(decryptGoogleRefreshToken(persisted!)).toBe("plain-refresh-token");
  });

  it("rejects a connect callback without a refresh token", async () => {
    vi.mocked(auth.getGoogleConfig).mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost/callback" });
    vi.mocked(auth.consumeOAuthTransaction).mockResolvedValueOnce({
      operation: "connect", initiatingUserId: "initiator", accountType: "personal", codeVerifier: "verifier", nonce: "nonce",
    } as never);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "signed-id-token" }), { status: 200 }));

    await expect(completeGoogleAuthorization({} as never, "state", "code")).rejects.toThrow("could not be completed");
    expect(auth.saveGoogleAccount).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not transfer a Google identity linked to another application user", async () => {
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.mocked(auth.getGoogleConfig).mockReturnValue({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost/callback" });
    vi.mocked(auth.consumeOAuthTransaction).mockResolvedValueOnce({
      operation: "connect", initiatingUserId: "initiator", accountType: "personal", codeVerifier: "verifier", nonce: "nonce",
    } as never);
    vi.mocked(jose.jwtVerify).mockResolvedValue({ payload: { nonce: "nonce", sub: "google-subject", email: "person@example.com", email_verified: true } } as never);
    vi.mocked(auth.saveGoogleAccount).mockRejectedValueOnce(new Error("GOOGLE_IDENTITY_ALREADY_LINKED"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "signed-id-token", refresh_token: "refresh" }), { status: 200 }));

    await expect(completeGoogleAuthorization({} as never, "state", "code")).rejects.toThrow("GOOGLE_IDENTITY_ALREADY_LINKED");
    expect(auth.saveGoogleAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: "initiator", accountType: "personal" }));
  });
});
