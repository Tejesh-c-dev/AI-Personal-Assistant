import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const database = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("./db", () => ({ getDatabase: () => database }));

import { deleteGoogleAccount, isAccountLabelUniqueViolation, saveGoogleAccount, updateGoogleAccountLabel } from "./auth";

describe("Google account identity ownership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects linking a Google identity owned by another application user", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "identity-1", userId: "owner-user" }]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    await expect(saveGoogleAccount({
      userId: "attacker-user",
      label: "personal",
      googleSubject: "google-subject",
      email: "person@example.com",
      refreshTokenCiphertext: "encrypted-token",
      grantedScopes: [],
    })).rejects.toThrow("GOOGLE_IDENTITY_ALREADY_LINKED");

    expect(database.select).toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });
});

describe("updateGoogleAccountLabel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws ACCOUNT_NOT_FOUND if old account does not exist for the user", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    await expect(updateGoogleAccountLabel("user-1", "personal", "work")).rejects.toThrow("ACCOUNT_NOT_FOUND");
  });

  it("throws ACCOUNT_LABEL_EXISTS if new label belongs to another account", async () => {
    const limit = vi.fn()
      .mockResolvedValueOnce([{ id: "acc-1", userId: "user-1", label: "personal" }])
      .mockResolvedValueOnce([{ id: "acc-2", userId: "user-1", label: "work" }]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    await expect(updateGoogleAccountLabel("user-1", "personal", "work")).rejects.toThrow("ACCOUNT_LABEL_EXISTS");
  });

  it("updates label via a single UPDATE (no manual approval UPDATE — ON UPDATE CASCADE handles it)", async () => {
    // Before this fix, there were TWO updates:
    //   1. UPDATE google_write_approvals SET account_label = ...
    //   2. UPDATE google_accounts SET label = ...
    // Now only the google_accounts UPDATE is issued; the DB ON UPDATE CASCADE
    // propagates the new label to google_write_approvals atomically.
    const limit = vi.fn()
      .mockResolvedValueOnce([{ id: "acc-1", userId: "user-1", label: "personal" }])
      .mockResolvedValueOnce([]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const where = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValue({ set });

    const result = await updateGoogleAccountLabel("user-1", "personal", "work");
    expect(result).toBe(true);
    // Exactly ONE update call: google_accounts only. The DB ON UPDATE CASCADE
    // propagates the label to google_write_approvals automatically.
    expect(database.update).toHaveBeenCalledTimes(1);
  });

  it("preserves the account UUID and user ownership after rename", async () => {
    const originalAccount = { id: "acc-uuid-unchanged", userId: "user-1", label: "personal" };
    const limit = vi.fn()
      .mockResolvedValueOnce([originalAccount])
      .mockResolvedValueOnce([]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const whereCapture = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where: whereCapture });
    database.update.mockReturnValue({ set });

    await updateGoogleAccountLabel("user-1", "personal", "work");

    // The SET payload must contain only the new label (and updatedAt); id and userId stay put.
    const setPayload = set.mock.calls[0][0] as Record<string, unknown>;
    expect(setPayload.label).toBe("work");
    expect(setPayload).not.toHaveProperty("id");
    expect(setPayload).not.toHaveProperty("userId");
  });

  it("translates a DB unique-violation on google_accounts_user_label_ci_unique into ACCOUNT_LABEL_EXISTS", async () => {
    // Both concurrent requests pass the app pre-check; one wins the index, one loses.
    const limit = vi.fn()
      .mockResolvedValueOnce([{ id: "acc-1", userId: "user-1", label: "personal" }])
      .mockResolvedValueOnce([]); // pre-check sees no collision yet
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const pgUniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "google_accounts_user_label_ci_unique"'),
      { code: "23505", constraint: "google_accounts_user_label_ci_unique" }
    );
    const where = vi.fn().mockRejectedValue(pgUniqueViolation);
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValue({ set });

    await expect(updateGoogleAccountLabel("user-1", "personal", "work")).rejects.toThrow("ACCOUNT_LABEL_EXISTS");
  });

  it("handles driver-wrapped unique violation through cause", async () => {
    const limit = vi.fn()
      .mockResolvedValueOnce([{ id: "acc-1", userId: "user-1", label: "personal" }])
      .mockResolvedValueOnce([]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const driverError = { code: "23505", constraint: "google_accounts_user_label_ci_unique" };
    const wrappedError = new Error("Failed query execution", { cause: driverError });
    const where = vi.fn().mockRejectedValue(wrappedError);
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValue({ set });

    await expect(updateGoogleAccountLabel("user-1", "personal", "work")).rejects.toThrow("ACCOUNT_LABEL_EXISTS");
  });

  it("re-throws unrelated unique violations without converting to ACCOUNT_LABEL_EXISTS", async () => {
    const limit = vi.fn()
      .mockResolvedValueOnce([{ id: "acc-1", userId: "user-1", label: "personal" }])
      .mockResolvedValueOnce([]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const unrelatedUniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "google_accounts_owner_id_label_unique"'),
      { code: "23505", constraint: "google_accounts_owner_id_label_unique" }
    );
    const where = vi.fn().mockRejectedValue(unrelatedUniqueViolation);
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValue({ set });

    await expect(updateGoogleAccountLabel("user-1", "personal", "work")).rejects.toThrow(unrelatedUniqueViolation);
  });

  it("re-throws non-unique-violation DB errors unchanged", async () => {
    const limit = vi.fn()
      .mockResolvedValueOnce([{ id: "acc-1", userId: "user-1", label: "personal" }])
      .mockResolvedValueOnce([]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const connectionError = Object.assign(new Error("connection reset"), { code: "08006" });
    const where = vi.fn().mockRejectedValue(connectionError);
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValue({ set });

    await expect(updateGoogleAccountLabel("user-1", "personal", "work")).rejects.toThrow("connection reset");
  });
});

describe("isAccountLabelUniqueViolation helper", () => {
  it("returns true for direct unique violation on google_accounts_user_label_ci_unique", () => {
    expect(
      isAccountLabelUniqueViolation({
        code: "23505",
        constraint: "google_accounts_user_label_ci_unique",
      })
    ).toBe(true);
  });

  it("returns true when constraint name is in error message with 23505 code", () => {
    expect(
      isAccountLabelUniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "google_accounts_user_label_ci_unique"',
      })
    ).toBe(true);
  });

  it("returns true for wrapped error via cause", () => {
    const wrapped = new Error("DrizzleQueryError", {
      cause: {
        code: "23505",
        constraint: "google_accounts_user_label_ci_unique",
      },
    });
    expect(isAccountLabelUniqueViolation(wrapped)).toBe(true);
  });

  it("returns true for deeply nested wrapped error (cause.cause)", () => {
    const nested = {
      cause: {
        cause: {
          code: "23505",
          constraint: "google_accounts_user_label_ci_unique",
        },
      },
    };
    expect(isAccountLabelUniqueViolation(nested)).toBe(true);
  });

  it("returns false for unrelated constraint violation with 23505", () => {
    expect(
      isAccountLabelUniqueViolation({
        code: "23505",
        constraint: "google_accounts_owner_id_label_unique",
      })
    ).toBe(false);

    expect(
      isAccountLabelUniqueViolation({
        code: "23505",
        constraint: "google_identities_subject_unique",
      })
    ).toBe(false);
  });

  it("returns false for non-23505 error codes even if constraint matches", () => {
    expect(
      isAccountLabelUniqueViolation({
        code: "23503",
        constraint: "google_accounts_user_label_ci_unique",
      })
    ).toBe(false);
  });

  it("returns false for null, undefined, primitive, or non-matching errors", () => {
    expect(isAccountLabelUniqueViolation(null)).toBe(false);
    expect(isAccountLabelUniqueViolation(undefined)).toBe(false);
    expect(isAccountLabelUniqueViolation("error string")).toBe(false);
    expect(isAccountLabelUniqueViolation(12345)).toBe(false);
    expect(isAccountLabelUniqueViolation(new Error("generic failure"))).toBe(false);
    expect(isAccountLabelUniqueViolation({})).toBe(false);
  });
});

describe("deleteGoogleAccount (disconnect)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes only the specified user's account and returns its refresh token ciphertext", async () => {
    const account = { id: "acc-1", userId: "user-1", label: "personal", refreshTokenCiphertext: "encrypted-token" };
    const limit = vi.fn().mockResolvedValue([account]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const where = vi.fn().mockResolvedValue([]);
    database.delete.mockReturnValue({ where });

    const result = await deleteGoogleAccount("user-1", "personal");
    expect(result).toBe("encrypted-token");
    // The delete includes both account id and userId conditions (cross-tenant safety).
    expect(database.delete).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not DELETE if the account does not belong to the user", async () => {
    // deleteGoogleAccount does a SELECT first; if no account found for (userId, label),
    // it returns null without issuing a DELETE.
    const limit = vi.fn().mockResolvedValue([]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    const result = await deleteGoogleAccount("user-1", "personal");
    expect(result).toBeNull();
    expect(database.delete).not.toHaveBeenCalled();
  });
});
