import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse, notFoundResponse } from "../../../../lib/api-errors";
import { deleteConversation, getConversation, isAccount, isUuid, updateConversation } from "../../../../lib/conversations";
import { ACTIVE_CONVERSATION_COOKIE } from "../route";

type RouteContext = { params: Promise<{ id: string }> };

async function getId(context: RouteContext) {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const id = await getId(context);
  if (!id) {
    return invalidRequestResponse("Invalid conversation ID.");
  }

  try {
    const conversation = await getConversation(id);
    return conversation ? NextResponse.json(conversation) : notFoundResponse();
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const id = await getId(context);
  if (!id) {
    return invalidRequestResponse("Invalid conversation ID.");
  }

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
  const title = typeof input.title === "string" ? input.title.trim() : undefined;
  const account = input.account;
  if ((title === undefined && !isAccount(account)) || (title !== undefined && (title.length === 0 || title.length > 80))) {
    return invalidRequestResponse("Provide a valid title or account.");
  }
  if (title !== undefined && account !== undefined && !isAccount(account)) {
    return invalidRequestResponse("Invalid account.");
  }

  try {
    const conversation = await updateConversation(id, {
      ...(title === undefined ? {} : { title }),
      ...(account === undefined ? {} : { account: account as "personal" | "official" | "both" }),
    });
    return conversation ? NextResponse.json({ conversation }) : notFoundResponse();
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const id = await getId(context);
  if (!id) {
    return invalidRequestResponse("Invalid conversation ID.");
  }

  try {
    const deleted = await deleteConversation(id);
    if (!deleted) {
      return notFoundResponse();
    }

    const response = NextResponse.json({ success: true });
    const cookieStore = await cookies();
    if (cookieStore.get(ACTIVE_CONVERSATION_COOKIE)?.value === id) {
      response.cookies.delete(ACTIVE_CONVERSATION_COOKIE);
    }
    return response;
  } catch (error) {
    return databaseErrorResponse(error);
  }
}
