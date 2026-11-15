import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { findGoogleAccount } from "../auth";
import { getDatabase } from "../db";
import { googleWriteApprovals, type Conversation, type User } from "../db/schema";
import {
  googleBroker,
  GoogleAuthorizationError,
  issueGoogleCapability,
  verifyGoogleCapability,
  type GoogleOperation,
} from "../google-api";
import { consumeGoogleWriteApproval, updateGoogleWriteApprovalStatus } from "../google-write-approvals";

export interface ConfirmationHandlerResult {
  output: string;
}

export function parseConfirmationCommand(message: string): string | null {
  const match = /^\s*confirm\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*$/i.exec(message);
  return match ? match[1] : null;
}

function formatExecutionResult(operation: GoogleOperation, label: string, result: unknown): string {
  switch (operation) {
    case "gmail.send":
      return `✓ Email sent successfully via your '${label}' account.`;
    case "calendar.create": {
      const rec = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
      const summary = typeof rec.summary === "string" ? ` "${rec.summary}"` : "";
      return `✓ Calendar event${summary} created successfully in your '${label}' account.`;
    }
    case "docs.create": {
      const rec = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
      const title = typeof rec.title === "string" ? ` "${rec.title}"` : "";
      const docId = typeof rec.documentId === "string" ? ` (ID: ${rec.documentId})` : "";
      return `✓ Google Document${title}${docId} created successfully in your '${label}' account.`;
    }
    case "docs.insert":
      return `✓ Text successfully inserted into the document in your '${label}' account.`;
    default:
      return `✓ Action (${operation}) completed successfully in your '${label}' account.`;
  }
}

/**
 * Deterministically validates and executes a pending Google write approval.
 *
 * Sequence:
 * 1. Authenticated user and conversation verified (provided in arguments).
 * 2. Look up pending approval in database without consuming it.
 * 3. Validate approval owner, conversation, expiry, and active status.
 * 4. Require selectedAccount to match the approval's exact account label. Reject "both".
 * 5. Atomically consume the approval (single-use).
 * 6. Issue and verify a capability token bound to the exact stored payload and account.
 * 7. Execute the exact payload stored in the database via the broker.
 * 8. Return formatted deterministic result.
 */
export async function handleConfirmation(params: {
  approvalId: string;
  user: User;
  conversation: Conversation;
  selectedAccount?: string;
}): Promise<ConfirmationHandlerResult> {
  const { approvalId, user, conversation, selectedAccount } = params;

  // 1. Look up the pending approval without consuming it
  const db = getDatabase();
  const now = new Date();
  const [pending] = await db
    .select()
    .from(googleWriteApprovals)
    .where(
      and(
        eq(googleWriteApprovals.id, approvalId),
        eq(googleWriteApprovals.userId, user.id),
        eq(googleWriteApprovals.conversationId, conversation.id),
        isNull(googleWriteApprovals.consumedAt),
        gt(googleWriteApprovals.expiresAt, now),
      ),
    )
    .limit(1);

  if (!pending) {
    throw new Error("This approval has expired, already been used, or does not exist for this conversation.");
  }

  // 2. Reject "both" for write confirmations (HLD §5.3, §7.2)
  if (selectedAccount === "both") {
    throw new Error(`Write confirmations cannot be executed with 'both' selected. Please switch to the '${pending.accountLabel}' account.`);
  }

  // 3. Require selected account to match approval's exact account label
  if (selectedAccount && selectedAccount.trim().toLowerCase() !== pending.accountLabel.trim().toLowerCase()) {
    throw new Error(
      `Account mismatch: This operation was approved for the '${pending.accountLabel}' account, but '${selectedAccount}' is currently selected. Please switch accounts to confirm.`,
    );
  }

  // 4. Validate account status and identity
  const account = await findGoogleAccount(user.id, pending.accountLabel);
  if (!account || account.status !== "active" || account.id !== pending.googleAccountId) {
    throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
  }

  // 5. Atomically consume the approval
  const consumed = await consumeGoogleWriteApproval({
    id: pending.id,
    userId: user.id,
    conversationId: conversation.id,
  });

  if (!consumed) {
    throw new Error("The approval could not be consumed (it may have been consumed concurrently or expired).");
  }

  const operation = consumed.operation;
  let executionStarted = false;
  try {
    // The capability is bound to the exact payload consumed from storage.
    const capability = await issueGoogleCapability(
      user.id,
      consumed.label,
      [operation],
      300,
      { [operation]: JSON.stringify(consumed.payload) },
      consumed.accountId,
    );
    await verifyGoogleCapability(capability, user.id, consumed.label, operation, consumed.payload);

    // Invoke the broker with the exact stored payload. Once invoked, failures may be ambiguous.
    executionStarted = true;
    let rawResult: unknown;
    switch (operation) {
      case "gmail.send": {
        const input = consumed.payload as { to?: string; subject?: string; body?: string };
        rawResult = await googleBroker.sendGmail(
          user.id,
          consumed.label,
          {
            to: String(input.to ?? ""),
            subject: String(input.subject ?? ""),
            body: String(input.body ?? ""),
          },
          consumed.accountId,
        );
        break;
      }

      case "calendar.create": {
        const input = consumed.payload as { event?: Record<string, unknown>; calendarId?: string };
        rawResult = await googleBroker.createCalendarEvent(
          user.id,
          consumed.label,
          (input.event ?? {}) as Record<string, unknown>,
          input.calendarId ? String(input.calendarId) : "primary",
          consumed.accountId,
        );
        break;
      }

      case "docs.create": {
        const input = consumed.payload as { title?: string };
        rawResult = await googleBroker.createDocument(
          user.id,
          consumed.label,
          String(input.title ?? "Untitled Document"),
          consumed.accountId,
        );
        break;
      }

      case "docs.insert": {
        const input = consumed.payload as { documentId?: string; text?: string };
        rawResult = await googleBroker.insertDocumentText(
          user.id,
          consumed.label,
          String(input.documentId ?? ""),
          String(input.text ?? ""),
          consumed.accountId,
        );
        break;
      }

      default:
        throw new Error(`Unsupported write operation: ${operation}`);
    }
    const output = formatExecutionResult(operation, consumed.label, rawResult);
    await updateGoogleWriteApprovalStatus({ id: approvalId, userId: user.id, conversationId: conversation.id, status: "approved", result: output });
    return { output };
  } catch (error) {
    const status = executionStarted && !(error instanceof GoogleAuthorizationError) ? "uncertain" : "failed";
    await updateGoogleWriteApprovalStatus({ id: approvalId, userId: user.id, conversationId: conversation.id, status });
    if (error instanceof GoogleAuthorizationError) throw error;
    throw new Error("CONFIRMATION_EXECUTION_FAILED");
  }
}
