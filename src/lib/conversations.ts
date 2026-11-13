import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { getDatabase } from "./db";
import { conversations, messages, type Conversation, type Message } from "./db/schema";

export const BOTH_SENTINEL = "both" as const;
export type Account = string;

export function isAccount(value: unknown): value is Account {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value === BOTH_SENTINEL) return true;
  // Any valid account label: 1-50 chars, lowercase letters/digits/hyphens/spaces
  return /^[a-z0-9 \-]{1,50}$/.test(value.trim().toLowerCase());
}

export const MESSAGE_ROLE_VALUES = ["user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLE_VALUES)[number];

export type ConversationSummary = Pick<Conversation, "id" | "sessionId" | "title" | "account" | "createdAt" | "updatedAt">;

export function isMessageRole(value: unknown): value is MessageRole {
  return typeof value === "string" && MESSAGE_ROLE_VALUES.includes(value as MessageRole);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createConversationTitle(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const db = getDatabase();
  return db
    .select({
      id: conversations.id,
      sessionId: conversations.sessionId,
      title: conversations.title,
      account: conversations.account,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
}

export async function getConversation(id: string, userId: string): Promise<{ conversation: Conversation; messages: Message[] } | null> {
  const db = getDatabase();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  if (!conversation) {
    return null;
  }

  const conversationMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return { conversation, messages: conversationMessages };
}

export async function createConversation(input: {
  userId: string;
  sessionId: string;
  title: string;
  account: Account;
}): Promise<Conversation> {
  const db = getDatabase();
  const [conversation] = await db.insert(conversations).values(input).returning();
  return conversation;
}

export async function updateConversation(
  id: string,
  userId: string,
  input: Partial<Pick<Conversation, "title" | "account">>,
): Promise<Conversation | null> {
  const db = getDatabase();
  const [conversation] = await db
    .update(conversations)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return conversation ?? null;
}

export async function deleteConversation(id: string, userId: string): Promise<boolean> {
  const db = getDatabase();
  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}

export async function appendMessage(input: {
  conversationId: string;
  role: MessageRole;
  content: string;
}): Promise<Message> {
  const db = getDatabase();
  const [message] = await db.insert(messages).values(input).returning();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
  return message;
}

export async function findConversationBySessionId(userId: string, sessionId: string): Promise<Conversation | null> {
  const db = getDatabase();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.sessionId, sessionId), eq(conversations.userId, userId)))
    .limit(1);
  return conversation ?? null;
}

export async function findConversationByIdAndSessionId(id: string, userId: string, sessionId: string): Promise<Conversation | null> {
  const db = getDatabase();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId), eq(conversations.sessionId, sessionId)))
    .limit(1);
  return conversation ?? null;
}
