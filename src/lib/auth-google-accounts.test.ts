import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const database = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("./db", () => ({ getDatabase: () => database }));

import { saveGoogleAccount } from "./auth";

describe("Google account identity ownership", () => {
  it("rejects linking a Google identity owned by another application user", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "identity-1", userId: "owner-user" }]);
    database.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });

    await expect(saveGoogleAccount({
      userId: "attacker-user",
      accountType: "personal",
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
