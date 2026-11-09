DROP INDEX "conversations_session_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_user_session_id_unique" ON "conversations" USING btree ("user_id","session_id");