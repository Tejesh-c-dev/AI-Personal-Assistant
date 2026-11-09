import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => name === "google_oauth_state" ? { value: "state" } : undefined,
  }),
}));

import { GET } from "./route";

describe("Google OAuth callback", () => {
  it("rejects callbacks without a complete authorization response", async () => {
    const response = await GET(new Request("http://localhost/api/auth/google/callback?state=state"));
    expect(response.status).toBe(400);
  });
});
