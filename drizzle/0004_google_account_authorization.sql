ALTER TABLE "google_accounts" ADD COLUMN "granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_status_check" CHECK ("status" in ('active', 'revoked'));
