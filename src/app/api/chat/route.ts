import { NextResponse } from "next/server";

import { databaseErrorResponse } from "../../../lib/api-errors";
import {
  appendMessage,
  createConversation,
  createConversationTitle,
  findConversationBySessionId,
  isUuid,
  updateConversation,
} from "../../../lib/conversations";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_MESSAGE_LENGTH = 4_000;
const ACTIVE_CONVERSATION_COOKIE = "active_conversation_id";
const ACCOUNT_INSTRUCTIONS = {
  personal: "Use only the Personal Gmail account.",
  official: "Use only the Official Gmail account.",
  both: "Use both Personal and Official Gmail accounts when the request involves email.",
} as const;

type Account = keyof typeof ACCOUNT_INSTRUCTIONS;

type ChatRequest = {
  message: string;
  sessionId: string;
  account: Account;
};

function getTimeoutMs(): number {
  const configuredTimeout = Number.parseInt(
    process.env.N8N_WEBHOOK_TIMEOUT_MS ?? "",
    10,
  );

  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_TIMEOUT_MS;
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const request = value as Record<string, unknown>;

  return (
    typeof request.message === "string" &&
    request.message.trim().length > 0 &&
    request.message.length <= MAX_MESSAGE_LENGTH &&
    typeof request.sessionId === "string" &&
    isUuid(request.sessionId.trim()) &&
    typeof request.account === "string" &&
    request.account in ACCOUNT_INSTRUCTIONS
  );
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isChatRequest(body)) {
    return errorResponse("Invalid chat request.", 400);
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return errorResponse("The n8n webhook is not configured.", 503);
  }

  let conversation;
  try {
    conversation = await findConversationBySessionId(body.sessionId);
    if (!conversation) {
      conversation = await createConversation({
        sessionId: body.sessionId,
        title: createConversationTitle(body.message),
        account: body.account,
      });
    } else {
      conversation = await updateConversation(conversation.id, {
        account: body.account,
        ...(conversation.title === "New conversation"
          ? { title: createConversationTitle(body.message) }
          : {}),
      });
      if (!conversation) {
        return errorResponse("The conversation could not be found.", 404);
      }
    }

    await appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: body.message.trim(),
    });
  } catch (error) {
    return databaseErrorResponse(error);
  }

  const user = `${ACCOUNT_INSTRUCTIONS[body.account]}\n\n${body.message}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: body.sessionId,
        user,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return errorResponse("The n8n webhook request timed out.", 504);
    }

    return errorResponse("The n8n webhook could not be reached.", 502);
  } finally {
    clearTimeout(timeout);
  }

  let responseBody: unknown;
  try {
    responseBody = await upstreamResponse.json();
  } catch {
    return errorResponse("The n8n webhook returned invalid JSON.", 502);
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json(responseBody, { status: 502 });
  }

  let assistantContent: string | null = null;
  if (typeof responseBody === "string" && responseBody.trim()) {
    assistantContent = responseBody.trim();
  } else if (Array.isArray(responseBody)) {
    const response = responseBody.find(
      (item): item is { output: string } =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).output === "string" &&
        Boolean((item as Record<string, string>).output.trim()),
    );
    assistantContent = response?.output.trim() ?? null;
  } else if (typeof responseBody === "object" && responseBody !== null && !Array.isArray(responseBody)) {
    const output = (responseBody as Record<string, unknown>).output;
    assistantContent = typeof output === "string" && output.trim() ? output.trim() : null;
  }

  if (assistantContent) {
    try {
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: assistantContent,
      });
    } catch (error) {
      return databaseErrorResponse(error);
    }
  }

  const response = NextResponse.json(responseBody, { status: upstreamResponse.status });
  response.cookies.set(ACTIVE_CONVERSATION_COOKIE, conversation.id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}
