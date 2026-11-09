import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "drizzle-kit";

if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
} else if (existsSync(".env")) {
  loadEnvFile(".env");
}

const migrationDatabaseUrl = process.env.DATABASE_URL_UNPOOLED;
if (!migrationDatabaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED must be configured in .env.local for migrations.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: migrationDatabaseUrl,
  },
});
