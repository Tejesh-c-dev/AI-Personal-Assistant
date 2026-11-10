import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ findGoogleAccount: vi.fn(), markGoogleAccountRevoked: vi.fn(), decrypt: vi.fn(() => "refresh-secret"), fetch: vi.fn(), insertValues: vi.fn(), returning: vi.fn() }));
vi.mock("./auth", () => ({ findGoogleAccount: mocks.findGoogleAccount, markGoogleAccountRevoked: mocks.markGoogleAccountRevoked, getGoogleConfig: () => ({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://localhost/callback" }) }));
vi.mock("./google-token-crypto", () => ({ decryptGoogleRefreshToken: mocks.decrypt }));
vi.mock("./db", () => ({ getDatabase: () => ({ insert: () => ({ values: mocks.insertValues }), update: () => ({ set: () => ({ where: () => ({ returning: mocks.returning }) }) }) }) }));

import { GoogleAuthorizationError, googleReadBroker, issueGoogleCapability, issueGoogleProposalCapability, verifyGoogleCapability, verifyGoogleProposalCapability } from "./google-api";

const scopes = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.readonly"];
const account = (overrides: Record<string, unknown> = {}) => ({ id: "account-1", userId: "user-1", identityId: "identity-1", accountType: "personal", refreshTokenCiphertext: "ciphertext", grantedScopes: scopes, status: "active", updatedAt: new Date("2026-01-01T00:00:00.000Z"), ...overrides });

describe("Google API broker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.findGoogleAccount.mockReset().mockResolvedValue(account());
    mocks.markGoogleAccountRevoked.mockReset();
    mocks.fetch.mockReset();
    mocks.insertValues.mockReset().mockResolvedValue([]);
    mocks.returning.mockReset().mockResolvedValue([{ nonce: "capability-nonce" }]);
  });

  it("rejects missing scopes before requesting credentials", async () => {
    mocks.findGoogleAccount.mockResolvedValue(account({ grantedScopes: [] }));
    await expect(googleReadBroker.searchGmail("user-1", "personal", "hello")).rejects.toMatchObject({ code: "SCOPE_REQUIRED" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refreshes once and reuses the access token for subsequent reads", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-secret", expires_in: 3600 }), { status: 200 }));
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    await googleReadBroker.searchGmail("user-1", "personal", "hello");
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    await googleReadBroker.searchGmail("user-1", "personal", "world");
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer access-secret");
  });

  it("marks an invalid grant revoked and returns a sanitized reconnect error", async () => {
    mocks.findGoogleAccount.mockResolvedValue(account({ id: "account-invalid-grant" }));
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant", error_description: "private upstream detail" }), { status: 400 }));
    await expect(googleReadBroker.searchGmail("user-1", "personal", "hello")).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    expect(mocks.markGoogleAccountRevoked).toHaveBeenCalledWith("user-1", "personal", "account-invalid-grant");
  });

  it("rejects revoked accounts", async () => {
    mocks.findGoogleAccount.mockResolvedValue(account({ status: "revoked" }));
    await expect(googleReadBroker.searchGmail("user-1", "personal", "hello")).rejects.toBeInstanceOf(GoogleAuthorizationError);
  });

  it("binds signed capabilities to user, label, operation, and expiry", async () => {
    process.env.GOOGLE_CAPABILITY_SECRET = "a-test-secret-that-is-at-least-32-characters-long";
    const token = await issueGoogleCapability("user-1", "personal", ["gmail.search"], 1);
    mocks.findGoogleAccount.mockResolvedValue(account({ id: "replacement-account" }));
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.search")).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    mocks.findGoogleAccount.mockResolvedValue(account());
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.search")).resolves.toBeUndefined();
    mocks.returning.mockResolvedValueOnce([]);
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.search")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(verifyGoogleCapability(token, "user-2", "personal", "gmail.search")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(verifyGoogleCapability(token, "user-1", "official", "gmail.search")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.get")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.search")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("requires a one time write grant bound to the exact payload", async () => {
    process.env.GOOGLE_CAPABILITY_SECRET = "a-test-secret-that-is-at-least-32-characters-long";
    const payload = { to: "person@example.com", subject: "Hello", body: "Approved text" };
    const token = await issueGoogleCapability("user-1", "personal", ["gmail.send"], 60, { "gmail.send": JSON.stringify(payload) });
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.send", { ...payload, body: "changed" })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.send", payload)).resolves.toBeUndefined();
    mocks.returning.mockResolvedValueOnce([]);
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.send", payload)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  });

  it("rejects issuing a confirmed capability after the selected account was replaced", async () => {
    process.env.GOOGLE_CAPABILITY_SECRET = "a-test-secret-that-is-at-least-32-characters-long";
    mocks.findGoogleAccount.mockResolvedValue(account({ id: "replacement-account" }));
    await expect(issueGoogleCapability("user-1", "personal", ["gmail.send"], 300, { "gmail.send": "{}" }, "original-account"))
      .rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("invalidates execution and proposal capabilities when an account row is replaced in place", async () => {
    process.env.GOOGLE_CAPABILITY_SECRET = "a-test-secret-that-is-at-least-32-characters-long";
    const originalVersion = new Date("2026-01-01T00:00:00.000Z");
    mocks.findGoogleAccount.mockResolvedValue(account({ id: "same-account-id", updatedAt: originalVersion }));
    const executionToken = await issueGoogleCapability("user-1", "personal", ["gmail.search"]);
    const proposalToken = await issueGoogleProposalCapability("user-1", "personal", "gmail.send", "conversation-1");

    mocks.findGoogleAccount.mockResolvedValue(account({ id: "same-account-id", identityId: "replacement-identity", updatedAt: originalVersion }));
    await expect(verifyGoogleCapability(executionToken, "user-1", "personal", "gmail.search"))
      .rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    await expect(verifyGoogleProposalCapability(proposalToken, "gmail.send"))
      .rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
  });

  it("rejects execution for a confirmed write when the selected account was replaced", async () => {
    mocks.findGoogleAccount.mockResolvedValue(account({ id: "replacement-account" }));
    await expect(googleReadBroker.sendGmail("user-1", "personal", { to: "a@example.com", subject: "Hi", body: "Approved" }, "original-account"))
      .rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not let a read capability authorize a write", async () => {
    process.env.GOOGLE_CAPABILITY_SECRET = "a-test-secret-that-is-at-least-32-characters-long";
    const token = await issueGoogleCapability("user-1", "personal", ["gmail.search"]);
    await expect(verifyGoogleCapability(token, "user-1", "personal", "gmail.send", { to: "x", subject: "x", body: "x" })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  });
});
