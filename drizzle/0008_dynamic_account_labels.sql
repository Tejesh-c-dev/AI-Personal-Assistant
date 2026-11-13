--> statement-breakpoint
-- Step 1: Rename google_accounts.account_type to label
ALTER TABLE "google_accounts" RENAME COLUMN "account_type" TO "label";

--> statement-breakpoint
-- Step 2: Drop the hardcoded enum CHECK constraint on google_accounts
ALTER TABLE "google_accounts" DROP CONSTRAINT IF EXISTS "google_accounts_type_check";

--> statement-breakpoint
-- Step 2b: Add CHECK constraint on google_accounts.label matching application validation rules
-- 1-50 chars, trimmed, only lowercase alphanumeric, spaces, and hyphens, and cannot be 'both'.
ALTER TABLE "google_accounts"
  ADD CONSTRAINT "google_accounts_label_check"
  CHECK (
    "label" <> 'both'
    AND length("label") BETWEEN 1 AND 50
    AND "label" = trim("label")
    AND "label" ~ '^[a-z0-9 \-]{1,50}$'
  );

--> statement-breakpoint
-- Step 3: Drop existing FK on google_write_approvals BEFORE dropping the unique index it references.
-- (google_write_approvals_account_owner_label_fk references google_accounts_owner_id_type_unique.
--  PostgreSQL refuses to drop that index while this FK depends on it.)
ALTER TABLE "google_write_approvals"
  DROP CONSTRAINT IF EXISTS "google_write_approvals_account_owner_label_fk";

--> statement-breakpoint
-- Step 4: Drop the old enum-based CHECK constraint on google_write_approvals
ALTER TABLE "google_write_approvals"
  DROP CONSTRAINT IF EXISTS "google_write_approvals_label_check";

--> statement-breakpoint
-- Step 5: Drop old unique indexes on google_accounts (now safe — their dependent FK was dropped above)
DROP INDEX IF EXISTS "google_accounts_user_type_unique";
DROP INDEX IF EXISTS "google_accounts_owner_id_type_unique";

--> statement-breakpoint
-- Step 6: Add case-insensitive unique label index per user
CREATE UNIQUE INDEX "google_accounts_user_label_ci_unique"
  ON "google_accounts" (user_id, LOWER(label));

--> statement-breakpoint
-- Step 7: Add composite unique index for FK from google_write_approvals
CREATE UNIQUE INDEX "google_accounts_owner_id_label_unique"
  ON "google_accounts" (user_id, id, label);

--> statement-breakpoint
-- Step 8: Re-add relaxed CHECK constraint (any non-empty string up to 50 chars)
ALTER TABLE "google_write_approvals"
  ADD CONSTRAINT "google_write_approvals_label_check"
  CHECK (length("account_label") BETWEEN 1 AND 50);

--> statement-breakpoint
-- Step 9: Re-add FK referencing the renamed label column.
-- ON UPDATE CASCADE ensures that when google_accounts.label is changed by a rename,
-- the new label is propagated atomically to all matching google_write_approvals rows.
-- This preserves pending approvals across account renames without any manual UPDATE.
ALTER TABLE "google_write_approvals"
  ADD CONSTRAINT "google_write_approvals_account_owner_label_fk"
  FOREIGN KEY ("user_id", "google_account_id", "account_label")
  REFERENCES "google_accounts" ("user_id", "id", "label")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

--> statement-breakpoint
-- Step 10: Rename oauth_transactions.account_type to account_label
ALTER TABLE "oauth_transactions" RENAME COLUMN "account_type" TO "account_label";

--> statement-breakpoint
-- Step 11: Drop old CHECK constraints on oauth_transactions
ALTER TABLE "oauth_transactions" DROP CONSTRAINT IF EXISTS "oauth_transactions_account_type_check";
ALTER TABLE "oauth_transactions" DROP CONSTRAINT IF EXISTS "oauth_transactions_connect_user_check";

--> statement-breakpoint
-- Step 12: Re-add CHECK constraints with new column name and relaxed label rule
ALTER TABLE "oauth_transactions"
  ADD CONSTRAINT "oauth_transactions_account_label_check"
  CHECK (
    "account_label" IS NULL OR
    (length("account_label") BETWEEN 1 AND 50)
  );

ALTER TABLE "oauth_transactions"
  ADD CONSTRAINT "oauth_transactions_connect_user_check"
  CHECK (
    ("operation" = 'login'   AND "initiating_user_id" IS NULL AND "account_label" IS NULL) OR
    ("operation" = 'connect' AND "initiating_user_id" IS NOT NULL AND "account_label" IS NOT NULL)
  );

--> statement-breakpoint
-- Step 13: Drop the conversations hardcoded account CHECK constraint
--          Validation is now enforced at the application layer.
ALTER TABLE "conversations"
  DROP CONSTRAINT IF EXISTS "conversations_account_check";

--> statement-breakpoint
-- Step 14: Restore a database-level CHECK constraint on conversations.account that
-- mirrors the isAccount() validation in src/lib/conversations.ts.
-- Accepted values:
--   • The sentinel 'both' (use both connected accounts for read operations)
--   • Any label matching ^[a-z0-9 \-]{1,50}$ (lowercase alphanumeric, hyphens, spaces)
-- IMPORTANT: This CHECK validates format only. It does NOT prove that the label
-- belongs to the conversation's owner. Application-layer isAccount() validation
-- remains in place. No normalized account-reference redesign is introduced here.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_account_check"
  CHECK (
    "account" = 'both'
    OR (
      length("account") BETWEEN 1 AND 50
      AND "account" ~ '^[a-z0-9 \-]{1,50}$'
    )
  );
