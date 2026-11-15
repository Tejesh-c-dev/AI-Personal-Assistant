import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse, notFoundResponse, unauthorizedResponse } from "../../../../lib/api-errors";
import { getCurrentUser } from "../../../../lib/auth";
import { getConversation, isUuid } from "../../../../lib/conversations";
import { handleConfirmation } from "../../../../lib/adk/confirmation-handler";
import { listGoogleWriteApprovals, rejectGoogleWriteApproval } from "../../../../lib/google-write-approvals";

type RouteContext = { params: Promise<{ id: string }> };

async function getApprovalId(context: RouteContext) {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

export async function GET(request: Request, context: RouteContext) {
  let user;
  try { user = await getCurrentUser(); } catch (error) { return databaseErrorResponse(error); }
  if (!user) return unauthorizedResponse();
  const approvalId = await getApprovalId(context);
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!approvalId || !conversationId || !isUuid(conversationId)) return invalidRequestResponse("A valid conversationId is required.");

  try {
    const detail = await getConversation(conversationId, user.id);
    if (!detail) return notFoundResponse();
    const approval = (await listGoogleWriteApprovals({ userId: user.id, conversationId })).find((item) => item.approvalId === approvalId);
    return approval ? NextResponse.json({ approval }) : notFoundResponse();
  } catch (error) { return databaseErrorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  let user;
  try { user = await getCurrentUser(); } catch (error) { return databaseErrorResponse(error); }
  if (!user) return unauthorizedResponse();
  const approvalId = await getApprovalId(context);
  if (!approvalId) return invalidRequestResponse("Invalid approval ID.");

  let body: unknown;
  try { body = await request.json(); } catch { return invalidRequestResponse("Request body must be valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidRequestResponse();
  const input = body as Record<string, unknown>;
  const conversationId = input.conversationId;
  const action = input.action;
  if (typeof conversationId !== "string" || !isUuid(conversationId) || (action !== "confirm" && action !== "reject")) {
    return invalidRequestResponse("A valid conversationId and action are required.");
  }

  try {
    const detail = await getConversation(conversationId, user.id);
    if (!detail) return notFoundResponse();
    const conversation = detail.conversation;
    if (action === "reject") {
      const rejected = await rejectGoogleWriteApproval({ id: approvalId, userId: user.id, conversationId });
      if (!rejected) {
        const current = (await listGoogleWriteApprovals({ userId: user.id, conversationId })).find((item) => item.approvalId === approvalId);
        return NextResponse.json({ status: current?.status ?? "unavailable", error: "This approval is no longer available." }, { status: 409 });
      }
      return NextResponse.json({ status: "rejected" });
    }

    const result = await handleConfirmation({ approvalId, user, conversation });
    const approval = (await listGoogleWriteApprovals({ userId: user.id, conversationId })).find((item) => item.approvalId === approvalId);
    return NextResponse.json({ status: approval?.status ?? "approved", result: result.output });
  } catch (error) {
    if (error instanceof Error && error.message === "CONFIRMATION_EXECUTION_FAILED") {
      const approval = (await listGoogleWriteApprovals({ userId: user.id, conversationId })).find((item) => item.approvalId === approvalId);
      return NextResponse.json({ status: approval?.status ?? "uncertain", error: "The operation could not be verified. Check the Google account before trying again." }, { status: 502 });
    }
    if (error instanceof Error && (error.message.startsWith("This approval") || error.message.startsWith("Account mismatch") || error.message.startsWith("Write confirmations"))) {
      const approval = (await listGoogleWriteApprovals({ userId: user.id, conversationId })).find((item) => item.approvalId === approvalId);
      return NextResponse.json({ status: approval?.status ?? "unavailable", error: "This approval is no longer available." }, { status: 409 });
    }
    try {
      const approval = (await listGoogleWriteApprovals({ userId: user.id, conversationId })).find((item) => item.approvalId === approvalId);
      if (approval) {
        return NextResponse.json({
          status: approval.status,
          error: approval.status === "pending"
            ? "The approval could not be completed. Check the account and try again."
            : "The approval status has changed. Do not retry this operation.",
        }, { status: approval.status === "pending" ? 502 : 409 });
      }
    } catch { /* Preserve the safe generic response if status lookup is unavailable. */ }
    return databaseErrorResponse(error);
  }
}
