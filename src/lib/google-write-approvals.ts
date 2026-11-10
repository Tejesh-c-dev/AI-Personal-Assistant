import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "./db";
import { googleWriteApprovals } from "./db/schema";
import type { GoogleAccountLabel, GoogleOperation } from "./google-api";

export async function createGoogleWriteApproval(input: { userId: string; conversationId: string; label: GoogleAccountLabel; googleAccountId: string; operation: GoogleOperation; payload: unknown }) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const [approval] = await getDatabase().insert(googleWriteApprovals).values({ userId: input.userId, conversationId: input.conversationId, accountLabel: input.label, googleAccountId: input.googleAccountId, operation: input.operation, payload: JSON.stringify(input.payload), expiresAt }).returning({ id: googleWriteApprovals.id });
  return { approvalId: approval.id, expiresAt: expiresAt.toISOString() };
}

export async function consumeGoogleWriteApproval(input: { id: string; userId: string; conversationId: string }) {
  const now = new Date();
  const [approval] = await getDatabase().update(googleWriteApprovals).set({ consumedAt: now }).where(and(eq(googleWriteApprovals.id, input.id), eq(googleWriteApprovals.userId, input.userId), eq(googleWriteApprovals.conversationId, input.conversationId), isNull(googleWriteApprovals.consumedAt), gt(googleWriteApprovals.expiresAt, now))).returning();
  if (!approval || (approval.accountLabel !== "personal" && approval.accountLabel !== "official")) return null;
  let payload: unknown;
  try { payload = JSON.parse(approval.payload); } catch { return null; }
  if (typeof approval.googleAccountId !== "string" || !approval.googleAccountId) return null;
  return { label: approval.accountLabel as GoogleAccountLabel, accountId: approval.googleAccountId, operation: approval.operation as GoogleOperation, payload };
}
