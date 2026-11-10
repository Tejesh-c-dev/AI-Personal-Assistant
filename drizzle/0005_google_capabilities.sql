CREATE TABLE IF NOT EXISTS "google_capabilities" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "google_capabilities_expires_at_idx" ON "google_capabilities" USING btree ("expires_at");

CREATE TABLE IF NOT EXISTS "google_write_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"account_label" text NOT NULL,
	"operation" text NOT NULL,
	"payload" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "google_write_approvals_user_conversation_idx" ON "google_write_approvals" USING btree ("user_id", "conversation_id");
