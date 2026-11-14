import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  Pool: vi.fn(() => ({ kind: "pool" })),
  neon: vi.fn((url: string) => ({ kind: "neon-client", url })),
  drizzleHttp: vi.fn(() => ({ kind: "neon-database" })),
  drizzleNode: vi.fn(() => ({ kind: "local-database" })),
}));

vi.mock("pg", () => ({ Pool: mocks.Pool }));
vi.mock("@neondatabase/serverless", () => ({ neon: mocks.neon }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: mocks.drizzleHttp }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzleNode }));

import { getDatabase } from "./index";

describe("database adapter selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "postgres://user:pass@localhost:5432/app",
    "postgres://user:pass@127.0.0.1:5432/app",
    "postgres://user:pass@[::1]:5432/app",
  ])("uses node-postgres for loopback URL %s", (databaseUrl) => {
    vi.stubEnv("DATABASE_URL", databaseUrl);

    expect(getDatabase()).toEqual({ kind: "local-database" });
    expect(mocks.Pool).toHaveBeenCalledWith({ connectionString: databaseUrl });
    expect(mocks.drizzleNode).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ schema: expect.any(Object) }));
    expect(mocks.neon).not.toHaveBeenCalled();
    expect(mocks.drizzleHttp).not.toHaveBeenCalled();
  });

  it("uses Neon HTTP for hosted database URLs", () => {
    const databaseUrl = "postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/app";
    vi.stubEnv("DATABASE_URL", databaseUrl);

    expect(getDatabase()).toEqual({ kind: "neon-database" });
    expect(mocks.neon).toHaveBeenCalledWith(databaseUrl);
    expect(mocks.drizzleHttp).toHaveBeenCalledWith({ client: { kind: "neon-client", url: databaseUrl }, schema: expect.any(Object) });
    expect(mocks.Pool).not.toHaveBeenCalled();
    expect(mocks.drizzleNode).not.toHaveBeenCalled();
  });
});
