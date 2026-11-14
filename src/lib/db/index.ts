import "server-only";

import { isIP } from "node:net";
import { Pool } from "pg";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Conversation history is unavailable because DATABASE_URL is not configured.");
    this.name = "DatabaseUnavailableError";
  }
}

const localPools = new Map<string, Pool>();

function isLoopbackDatabaseUrl(value: string): boolean {
  let hostname: string;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
    hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }

  if (hostname === "localhost" || hostname === "::1") return true;
  return isIP(hostname) === 4 && hostname.startsWith("127.");
}

export function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DatabaseUnavailableError();
  }

  if (isLoopbackDatabaseUrl(databaseUrl)) {
    let pool = localPools.get(databaseUrl);
    if (!pool) {
      pool = new Pool({ connectionString: databaseUrl });
      localPools.set(databaseUrl, pool);
    }
    return drizzleNode(pool, { schema });
  }

  return drizzle({ client: neon(databaseUrl), schema });
}
