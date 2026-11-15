import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse, notFoundResponse, unauthorizedResponse } from "../../../../../lib/api-errors";
import { getCurrentUser } from "../../../../../lib/auth";
import { getConversation, isUuid } from "../../../../../lib/conversations";
import { listGoogleWriteApprovals } from "../../../../../lib/google-write-approvals";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  let user;
  try { user = await getCurrentUser(); } catch (error) { return databaseErrorResponse(error); }
  if (!user) return unauthorizedResponse();
  const { id } = await context.params;
  if (!isUuid(id)) return invalidRequestResponse("Invalid conversation ID.");
  try {
    const conversation = await getConversation(id, user.id);
    if (!conversation) return notFoundResponse();
    return NextResponse.json({ approvals: await listGoogleWriteApprovals({ userId: user.id, conversationId: id }) });
  } catch (error) { return databaseErrorResponse(error); }
}
