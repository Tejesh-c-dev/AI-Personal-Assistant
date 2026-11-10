import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const cookieValue = vi.hoisted(() => ({ value: "state" }));
const complete = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => name === "google_oauth_state" ? { value: cookieValue.value } : undefined,
  }),
}));
vi.mock("../../../../../lib/google-oauth", () => ({ completeGoogleAuthorization: complete }));

import { GET } from "./route";

describe("Google OAuth callback", () => {
  beforeEach(() => { vi.clearAllMocks(); cookieValue.value = "state"; });

  it("rejects callbacks without a complete authorization response", async () => {
    const response = await GET(new Request("http://localhost/api/auth/google/callback?state=state"));
    expect(response.status).toBe(400);
  });

  it("rejects a state that does not match the initiating browser cookie", async () => {
    const response = await GET(new Request("http://localhost/api/auth/google/callback?state=attacker-state&code=code"));

    expect(response.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("passes the callback state to transaction consumption and clears the cookie on success", async () => {
    const response = await GET(new Request("http://localhost/api/auth/google/callback?state=state&code=code"));

    expect(response.status).toBe(307);
    expect(complete).toHaveBeenCalledWith(expect.anything(), "state", "code");
    expect(response.headers.get("set-cookie")).toMatch(/google_oauth_state=;/);
  });

  it("rejects a callback when the consumed transaction is invalid or replayed", async () => {
    complete.mockRejectedValueOnce(new Error("The OAuth state is invalid or expired."));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request("http://localhost/api/auth/google/callback?state=state&code=code"));

    expect(response.status).toBe(400);
    expect(complete).toHaveBeenCalledWith(expect.anything(), "state", "code");
    error.mockRestore();
  });
});
