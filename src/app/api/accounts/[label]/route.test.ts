import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/auth")>()),
  getCurrentUser: vi.fn(),
  deleteGoogleAccount: vi.fn(),
  updateGoogleAccountLabel: vi.fn(),
}));
vi.mock("../../../../lib/google-token-crypto", () => ({ decryptGoogleRefreshToken: vi.fn(() => "refresh-secret") }));
vi.mock("../../../../lib/google-oauth", () => ({ revokeGoogleToken: vi.fn() }));

import { DELETE, PATCH } from "./route";
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

  it("rejects invalid account labels including reserved 'both'", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    const response = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ label: "both" }) });
    expect(response.status).toBe(400);
    expect(auth.deleteGoogleAccount).not.toHaveBeenCalled();
  });

  it("accepts custom dynamic labels", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.deleteGoogleAccount).mockResolvedValueOnce("encrypted-value");

    const response = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ label: "work-project" }) });

    expect(auth.deleteGoogleAccount).toHaveBeenCalledWith("current-user", "work-project");
    expect(response.status).toBe(200);
  });
});

describe("PATCH /api/accounts/[label]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce(null);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "renamed" }),
      }),
      { params: Promise.resolve({ label: "personal" }) },
    );

    expect(response.status).toBe(401);
    expect(auth.updateGoogleAccountLabel).not.toHaveBeenCalled();
  });

  it("rejects invalid current label", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "renamed" }),
      }),
      { params: Promise.resolve({ label: "both" }) },
    );

    expect(response.status).toBe(400);
    expect(auth.updateGoogleAccountLabel).not.toHaveBeenCalled();
  });

  it("rejects invalid new label or reserved 'both'", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "both" }),
      }),
      { params: Promise.resolve({ label: "personal" }) },
    );

    expect(response.status).toBe(400);
    expect(auth.updateGoogleAccountLabel).not.toHaveBeenCalled();
  });

  it("rejects missing new label in body", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ label: "personal" }) },
    );

    expect(response.status).toBe(400);
    expect(auth.updateGoogleAccountLabel).not.toHaveBeenCalled();
  });

  it("returns 404 when the account is not found", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.updateGoogleAccountLabel).mockRejectedValueOnce(new Error("ACCOUNT_NOT_FOUND"));

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "renamed" }),
      }),
      { params: Promise.resolve({ label: "nonexistent" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Account not found." });
  });

  it("returns 409 when the new label is already in use by this user", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.updateGoogleAccountLabel).mockRejectedValueOnce(new Error("ACCOUNT_LABEL_EXISTS"));

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "official" }),
      }),
      { params: Promise.resolve({ label: "personal" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "An account with this label already exists." });
  });

  it("returns 409 for a concurrent rename that collides at the DB unique index", async () => {
    // Simulates: app pre-check passes, but ON UPDATE CASCADE / DB index fires ACCOUNT_LABEL_EXISTS
    // (which updateGoogleAccountLabel translates from SQLSTATE 23505 before rethrowing).
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.updateGoogleAccountLabel).mockRejectedValueOnce(new Error("ACCOUNT_LABEL_EXISTS"));

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "work" }),
      }),
      { params: Promise.resolve({ label: "personal" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "An account with this label already exists." });
  });

  it("returns 500 when updateGoogleAccountLabel throws an unrelated database error", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.updateGoogleAccountLabel).mockRejectedValueOnce(new Error("Database connection lost"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "work" }),
      }),
      { params: Promise.resolve({ label: "personal" }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Conversation history could not be loaded." });
    consoleSpy.mockRestore();
  });

  it("renames the account successfully for the current user", async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValueOnce({ id: "current-user" } as never);
    vi.mocked(auth.updateGoogleAccountLabel).mockResolvedValueOnce(true);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newLabel: "work-email" }),
      }),
      { params: Promise.resolve({ label: "personal" }) },
    );

    expect(auth.updateGoogleAccountLabel).toHaveBeenCalledWith("current-user", "personal", "work-email");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, label: "work-email" });
  });
});

