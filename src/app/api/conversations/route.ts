import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse } from "../../../lib/api-errors";
import {
  createConversation,
  createConversationTitle,
  isAccount,
  isUuid,
  listConversations,
} from "../../../lib/conversations";

export const ACTIVE_CONVERSATION_COOKIE = "active_conversation_id";

function setActiveConversationCookie(response: NextResponse, id: string) {
  response.cookies.set(ACTIVE_CONVERSATION_COOKIE, id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function GET() {
  try {
    const conversationList = await listConversations();
    const activeConversationId = (await cookies()).get(ACTIVE_CONVERSATION_COOKIE)?.value ?? null;
    return NextResponse.json({ conversations: conversationList, activeConversationId });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequestResponse("Request body must be valid JSON.");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return invalidRequestResponse();
  }

  const input = body as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : crypto.randomUUID();
  const account = input.account;

  if (!isUuid(sessionId) || !isAccount(account) || title.length > 80) {
    return invalidRequestResponse("A valid sessionId, account, and title are required.");
  }

  try {
    const conversation = await createConversation({
      sessionId,
      title: title || "New conversation",
      account,
    });
    const response = NextResponse.json({ conversation }, { status: 201 });
    setActiveConversationCookie(response, conversation.id);
    return response;
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export { createConversationTitle };
