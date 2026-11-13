import { relations, sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    googleSubject: text("google_subject").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    picture: text("picture"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_google_subject_unique").on(table.googleSubject), index("users_email_idx").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const googleIdentities = pgTable(
  "google_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    googleSubject: text("google_subject").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("google_identities_subject_unique").on(table.googleSubject),
    uniqueIndex("google_identities_user_id_id_unique").on(table.userId, table.id),
  ],
);

export const googleAccounts = pgTable(
  "google_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id").notNull(),
    label: text("label").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    grantedScopes: text("granted_scopes").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Case-insensitive unique label per user: functional index on (user_id, LOWER(label)).
    // This is the authoritative uniqueness guard for the rename path; created by migration 0008.
    uniqueIndex("google_accounts_user_label_ci_unique").using("btree", table.userId, sql`LOWER(${table.label})`),
    // Composite unique index on (user_id, id, label) required as the referenced key
    // for the google_write_approvals composite FK (approval must reference the same label value).
    uniqueIndex("google_accounts_owner_id_label_unique").on(table.userId, table.id, table.label),
    foreignKey({ columns: [table.userId, table.identityId], foreignColumns: [googleIdentities.userId, googleIdentities.id], name: "google_accounts_identity_owner_fk" }).onDelete("cascade"),
    check("google_accounts_status_check", sql`${table.status} in ('active', 'revoked')`),
    // Format and normalization CHECK mirroring validateAccountLabel() in src/lib/auth.ts:
    // 1-50 chars, trimmed, only lowercase alphanumeric, spaces, and hyphens, and cannot be 'both'.
    check(
      "google_accounts_label_check",
      sql`${table.label} <> 'both' and length(${table.label}) between 1 and 50 and ${table.label} = trim(${table.label}) and ${table.label} ~ '^[a-z0-9 \\-]{1,50}$'`,
    ),
  ],
);

export const oauthTransactions = pgTable(
  "oauth_transactions",
  {
    stateHash: text("state_hash").primaryKey(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    operation: text("operation").notNull().default("login"),
    initiatingUserId: uuid("initiating_user_id").references(() => users.id, { onDelete: "cascade" }),
    accountLabel: text("account_label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("oauth_transactions_expires_at_idx").on(table.expiresAt),
    check("oauth_transactions_operation_check", sql`${table.operation} in ('login', 'connect')`),
    check("oauth_transactions_account_label_check", sql`${table.accountLabel} is null or (length(${table.accountLabel}) between 1 and 50)`),
    check("oauth_transactions_connect_user_check", sql`(${table.operation} = 'login' and ${table.initiatingUserId} is null and ${table.accountLabel} is null) or (${table.operation} = 'connect' and ${table.initiatingUserId} is not null and ${table.accountLabel} is not null)`),
  ],
);

export const googleCapabilities = pgTable("google_capabilities", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (table) => [index("google_capabilities_expires_at_idx").on(table.expiresAt)]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    title: text("title").notNull(),
    account: text("account").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversations_user_session_id_unique").on(table.userId, table.sessionId),
    uniqueIndex("conversations_user_id_id_unique").on(table.userId, table.id),
    index("conversations_user_updated_at_idx").on(table.userId, table.updatedAt),
    index("conversations_updated_at_idx").on(table.updatedAt),
    // Format-only CHECK mirroring isAccount() in src/lib/conversations.ts.
    // Accepts 'both' (sentinel) and labels matching ^[a-z0-9 \-]{1,50}$.
    // Does NOT prove the label belongs to the conversation owner — that is an
    // application-layer concern. No normalized account-reference redesign here.
    check(
      "conversations_account_check",
      sql`${table.account} = 'both' OR (length(${table.account}) BETWEEN 1 AND 50 AND ${table.account} ~ '^[a-z0-9 \\-]{1,50}$')`,
    ),
  ],
);

export const googleWriteApprovals = pgTable("google_write_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  accountLabel: text("account_label").notNull(),
  googleAccountId: uuid("google_account_id").notNull(),
  operation: text("operation").notNull(),
  payload: text("payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("google_write_approvals_user_conversation_idx").on(table.userId, table.conversationId), foreignKey({ columns: [table.userId, table.conversationId], foreignColumns: [conversations.userId, conversations.id], name: "google_write_approvals_conversation_owner_fk" }).onDelete("cascade"), foreignKey({ columns: [table.userId, table.googleAccountId, table.accountLabel], foreignColumns: [googleAccounts.userId, googleAccounts.id, googleAccounts.label], name: "google_write_approvals_account_owner_label_fk" }).onDelete("cascade").onUpdate("cascade"), check("google_write_approvals_label_check", sql`length(${table.accountLabel}) between 1 and 50`)]);

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

export const userRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  sessions: many(sessions),
}));

export const conversationRelations = relations(conversations, ({ many, one }) => ({
  messages: many(messages),
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
