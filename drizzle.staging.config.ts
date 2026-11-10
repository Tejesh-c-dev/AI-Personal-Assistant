import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "drizzle-kit";

if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
} else if (existsSync(".env")) {
  loadEnvFile(".env");
}

const stagingDatabaseUrl = process.env.STAGING_DATABASE_URL_UNPOOLED;
if (!stagingDatabaseUrl) {
  throw new Error("STAGING_DATABASE_URL_UNPOOLED must be configured for staging migrations.");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(stagingDatabaseUrl);
} catch {
  throw new Error("STAGING_DATABASE_URL_UNPOOLED must be a valid PostgreSQL URL.");
}

if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname || !parsedUrl.username || !parsedUrl.pathname.slice(1)) {
  throw new Error("STAGING_DATABASE_URL_UNPOOLED must be a complete PostgreSQL connection URL.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: stagingDatabaseUrl,
  },
});
