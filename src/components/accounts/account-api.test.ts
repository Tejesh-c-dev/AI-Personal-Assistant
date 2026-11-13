import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  disconnectAccount,
  fetchAccounts,
  renameAccount,
  validateAccountLabelClient,
} from "./account-api";

describe("validateAccountLabelClient", () => {
  it("normalizes and accepts valid labels", () => {
    expect(validateAccountLabelClient("  personal  ")).toEqual({
      valid: true,
      normalized: "personal",
    });
    expect(validateAccountLabelClient("Work-Account")).toEqual({
      valid: true,
      normalized: "work-account",
    });
    expect(validateAccountLabelClient("client inbox 1")).toEqual({
      valid: true,
      normalized: "client inbox 1",
    });
  });

  it("rejects empty labels", () => {
    const res = validateAccountLabelClient("   ");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/required/i);
  });

  it("rejects reserved 'both' label", () => {
    const res = validateAccountLabelClient("Both");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/reserved/i);
  });

  it("rejects labels longer than 50 characters", () => {
    const res = validateAccountLabelClient("a".repeat(51));
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/50 characters/i);
  });

  it("rejects labels with special characters", () => {
    expect(validateAccountLabelClient("user@email.com").valid).toBe(false);
    expect(validateAccountLabelClient("work/folder").valid).toBe(false);
    expect(validateAccountLabelClient("client#1").valid).toBe(false);
  });
});

describe("account-api network operations", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchAccounts parses and returns account list", async () => {
    const accountsData = [
      {
        id: "acc-1",
        label: "personal",
        email: "alice@gmail.com",
        grantedScopes: ["scope1"],
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accounts: accountsData }),
    } as Response);

    const result = await fetchAccounts();
    expect(global.fetch).toHaveBeenCalledWith("/api/accounts", expect.objectContaining({
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    }));
    expect(result).toEqual(accountsData);

    global.fetch = originalFetch;
  });

  it("fetchAccounts throws an error on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Database offline" }),
    } as Response);

    await expect(fetchAccounts()).rejects.toThrow("Database offline");
    global.fetch = originalFetch;
  });

  it("renameAccount validates input and makes PATCH request", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    await renameAccount("personal", "work-inbox");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/accounts/personal",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ newLabel: "work-inbox" }),
      }),
    );

    global.fetch = originalFetch;
  });

  it("renameAccount rejects invalid new labels client-side before fetching", async () => {
    global.fetch = vi.fn();

    await expect(renameAccount("personal", "both")).rejects.toThrow(/reserved/i);
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it("renameAccount surfaces API errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "An account with this label already exists." }),
    } as Response);

    await expect(renameAccount("personal", "official")).rejects.toThrow("An account with this label already exists.");
    global.fetch = originalFetch;
  });

  it("disconnectAccount makes DELETE request", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ disconnected: true }),
    } as Response);

    await disconnectAccount("work-inbox");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/accounts/work-inbox",
      expect.objectContaining({ method: "DELETE" }),
    );

    global.fetch = originalFetch;
  });

  it("disconnectAccount surfaces API errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Account not found." }),
    } as Response);

    await expect(disconnectAccount("unknown")).rejects.toThrow("Account not found.");
    global.fetch = originalFetch;
  });
});

