CREATE TABLE "google_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_subject" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_identities" ADD CONSTRAINT "google_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "google_identities_subject_unique" ON "google_identities" USING btree ("google_subject");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_identities_user_id_id_unique" ON "google_identities" USING btree ("user_id","id");
--> statement-breakpoint
INSERT INTO "google_identities" ("user_id", "google_subject", "email", "created_at", "updated_at")
SELECT "id", "google_subject", "email", "created_at", "updated_at" FROM "users"
ON CONFLICT ("google_subject") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"account_type" text NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_accounts_type_check" CHECK ("account_type" in ('personal', 'official'))
);
--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_identity_owner_fk" FOREIGN KEY ("user_id", "identity_id") REFERENCES "public"."google_identities"("user_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_user_type_unique" ON "google_accounts" USING btree ("user_id","account_type");
--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD COLUMN "operation" text DEFAULT 'login' NOT NULL;
--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD COLUMN "initiating_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD COLUMN "account_type" text;
--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_initiating_user_id_users_id_fk" FOREIGN KEY ("initiating_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_operation_check" CHECK ("operation" in ('login', 'connect'));
--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_account_type_check" CHECK ("account_type" is null or "account_type" in ('personal', 'official'));
--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_connect_user_check" CHECK (("operation" = 'login' and "initiating_user_id" is null and "account_type" is null) or ("operation" = 'connect' and "initiating_user_id" is not null and "account_type" is not null));
