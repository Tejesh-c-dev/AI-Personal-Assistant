--> statement-breakpoint
DELETE FROM "google_write_approvals" AS approval
WHERE NOT EXISTS (
  SELECT 1
  FROM "conversations" AS conversation
  WHERE conversation."id" = approval."conversation_id"
    AND conversation."user_id" = approval."user_id"
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_user_id_id_unique" ON "conversations" USING btree ("user_id", "id");
--> statement-breakpoint
ALTER TABLE "google_write_approvals" ADD CONSTRAINT "google_write_approvals_conversation_owner_fk" FOREIGN KEY ("user_id", "conversation_id") REFERENCES "conversations"("user_id", "id") ON DELETE CASCADE;
