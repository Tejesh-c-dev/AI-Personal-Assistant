--> statement-breakpoint
ALTER TABLE "google_write_approvals" ADD COLUMN "google_account_id" uuid;
--> statement-breakpoint
UPDATE "google_write_approvals" SET "consumed_at" = now() WHERE "consumed_at" IS NULL;
--> statement-breakpoint
DELETE FROM "google_write_approvals";
--> statement-breakpoint
ALTER TABLE "google_write_approvals" ALTER COLUMN "google_account_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_owner_id_type_unique" ON "google_accounts" USING btree ("user_id", "id", "account_type");
--> statement-breakpoint
ALTER TABLE "google_write_approvals" ADD CONSTRAINT "google_write_approvals_label_check" CHECK ("account_label" in ('personal', 'official'));
--> statement-breakpoint
ALTER TABLE "google_write_approvals" ADD CONSTRAINT "google_write_approvals_account_owner_label_fk" FOREIGN KEY ("user_id", "google_account_id", "account_label") REFERENCES "google_accounts"("user_id", "id", "account_type") ON DELETE CASCADE;
