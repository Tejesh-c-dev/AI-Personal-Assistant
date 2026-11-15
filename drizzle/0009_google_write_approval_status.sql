ALTER TABLE "google_write_approvals"
  ADD COLUMN "status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "google_write_approvals"
  ADD COLUMN "display_details" text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "google_write_approvals"
  ADD COLUMN "result" text;
--> statement-breakpoint
ALTER TABLE "google_write_approvals"
  ADD CONSTRAINT "google_write_approvals_status_check"
  CHECK ("status" in ('pending', 'confirming', 'approved', 'rejected', 'failed', 'uncertain'));
--> statement-breakpoint
UPDATE "google_write_approvals"
SET "status" = 'uncertain'
WHERE "consumed_at" IS NOT NULL AND "status" = 'pending';
