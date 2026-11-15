import "server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "./db";
import { googleWriteApprovals } from "./db/schema";
import type { GoogleAccountLabel, GoogleOperation } from "./google-api";

export async function createGoogleWriteApproval(input: { userId: string; conversationId: string; label: GoogleAccountLabel; googleAccountId: string; operation: GoogleOperation; payload: unknown; displayDetails?: Record<string, string> }) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const [approval] = await getDatabase().insert(googleWriteApprovals).values({ userId: input.userId, conversationId: input.conversationId, accountLabel: input.label, googleAccountId: input.googleAccountId, operation: input.operation, payload: JSON.stringify(input.payload), displayDetails: JSON.stringify(input.displayDetails ?? {}), expiresAt }).returning();
  return { approvalId: approval.id, expiresAt: expiresAt.toISOString() };
}

export async function consumeGoogleWriteApproval(input: { id: string; userId: string; conversationId: string }) {
  const now = new Date();
  const [approval] = await getDatabase().update(googleWriteApprovals).set({ consumedAt: now, status: "confirming" }).where(and(eq(googleWriteApprovals.id, input.id), eq(googleWriteApprovals.userId, input.userId), eq(googleWriteApprovals.conversationId, input.conversationId), eq(googleWriteApprovals.status, "pending"), isNull(googleWriteApprovals.consumedAt), gt(googleWriteApprovals.expiresAt, now))).returning();
  if (!approval || !approval.accountLabel) return null;
  let payload: unknown;
  try { payload = JSON.parse(approval.payload); } catch {
    await updateGoogleWriteApprovalStatus({ ...input, status: "failed" });
    return null;
  }
  if (typeof approval.googleAccountId !== "string" || !approval.googleAccountId) {
    await updateGoogleWriteApprovalStatus({ ...input, status: "failed" });
    return null;
  }
  return { label: approval.accountLabel, accountId: approval.googleAccountId, operation: approval.operation as GoogleOperation, payload };
}

export async function rejectGoogleWriteApproval(input: { id: string; userId: string; conversationId: string }) {
  const now = new Date();
  const [approval] = await getDatabase().update(googleWriteApprovals)
    .set({ status: "rejected", consumedAt: now })
    .where(and(eq(googleWriteApprovals.id, input.id), eq(googleWriteApprovals.userId, input.userId), eq(googleWriteApprovals.conversationId, input.conversationId), eq(googleWriteApprovals.status, "pending"), isNull(googleWriteApprovals.consumedAt), gt(googleWriteApprovals.expiresAt, now)))
    .returning();
  return approval ?? null;
}

export async function updateGoogleWriteApprovalStatus(input: { id: string; userId: string; conversationId: string; status: "approved" | "failed" | "uncertain"; result?: string }) {
  const [approval] = await getDatabase().update(googleWriteApprovals)
    .set({ status: input.status, ...(input.result ? { result: input.result } : {}) })
    .where(and(eq(googleWriteApprovals.id, input.id), eq(googleWriteApprovals.userId, input.userId), eq(googleWriteApprovals.conversationId, input.conversationId), eq(googleWriteApprovals.status, "confirming")))
    .returning();
  return approval ?? null;
}

export async function listGoogleWriteApprovals(input: { userId: string; conversationId: string }) {
  const rows = await getDatabase().select({ id: googleWriteApprovals.id, account: googleWriteApprovals.accountLabel, operation: googleWriteApprovals.operation, displayDetails: googleWriteApprovals.displayDetails, expiresAt: googleWriteApprovals.expiresAt, status: googleWriteApprovals.status, result: googleWriteApprovals.result })
    .from(googleWriteApprovals)
    .where(and(eq(googleWriteApprovals.userId, input.userId), eq(googleWriteApprovals.conversationId, input.conversationId)))
    .orderBy(desc(googleWriteApprovals.createdAt));
  return rows.map((row) => {
    let details: Record<string, string> = {};
    try {
      const decoded: unknown = JSON.parse(row.displayDetails);
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) details = decoded as Record<string, string>;
    } catch { /* Malformed optional presentation metadata is omitted. */ }
    const expired = row.status === "pending" && row.expiresAt <= new Date();
    return { approvalId: row.id, account: row.account, operation: row.operation, details, expiresAt: row.expiresAt.toISOString(), status: expired ? "expired" : row.status, result: row.result };
  });
}
