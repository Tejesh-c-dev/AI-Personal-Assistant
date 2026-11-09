import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Conversation history is unavailable because DATABASE_URL is not configured.");
    this.name = "DatabaseUnavailableError";
  }
}

export function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DatabaseUnavailableError();
  }

  return drizzle({ client: neon(databaseUrl), schema });
}
