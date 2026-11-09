import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    title: text("title").notNull(),
    account: text("account").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversations_session_id_unique").on(table.sessionId),
    index("conversations_updated_at_idx").on(table.updatedAt),
    check("conversations_account_check", sql`${table.account} in ('personal', 'official', 'both')`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_created_at_idx").on(table.conversationId, table.createdAt),
    check("messages_role_check", sql`${table.role} in ('user', 'assistant')`),
  ],
);

export const conversationRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
