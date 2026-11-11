import { NextResponse } from "next/server";

import { databaseErrorResponse, unauthorizedResponse } from "../../../lib/api-errors";
import { getCurrentUser } from "../../../lib/auth";
import { GoogleAuthorizationError, issueGoogleCapability, issueGoogleProposalCapability, GOOGLE_OPERATIONS, type GoogleOperation } from "../../../lib/google-api";
import { consumeGoogleWriteApproval } from "../../../lib/google-write-approvals";
import {
  appendMessage,
  createConversation,
  createConversationTitle,
  findConversationBySessionId,
  isUuid,
  updateConversation,
} from "../../../lib/conversations";

const DEFAULT_TIMEOUT_MS = 150_000;
export const maxDuration = 180;
const MAX_MESSAGE_LENGTH = 4_000;
const ACTIVE_CONVERSATION_COOKIE = "active_conversation_id";
const ACCOUNT_INSTRUCTIONS = {
  personal: "Use only the Personal account for Google operations.",
  official: "Use only the Official account for Google operations.",
  both: "For read operations, use both connected accounts and label their results. For writes, use only an explicitly selected account.",
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
  let authenticatedUser;
  try {
    authenticatedUser = await getCurrentUser();
  } catch (error) {
    return databaseErrorResponse(error);
  }
  if (!authenticatedUser) {
    return unauthorizedResponse();
  }

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
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return errorResponse("The n8n webhook secret is not configured.", 503);
  }

  let conversation;
  try {
    conversation = await findConversationBySessionId(authenticatedUser.id, body.sessionId);
    if (!conversation) {
      conversation = await createConversation({
        userId: authenticatedUser.id,
        sessionId: body.sessionId,
        title: createConversationTitle(body.message),
        account: body.account,
      });
    } else {
      conversation = await updateConversation(conversation.id, authenticatedUser.id, {
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

  const userPrompt = `${ACCOUNT_INSTRUCTIONS[body.account]}\n\n${body.message}`;
  const selectedLabels = body.account === "both" ? ["personal", "official"] as const : [body.account] as const;
  const googleCapabilities: Record<string, Partial<Record<GoogleOperation, string>>> = {};
  const googleProposalCapabilities: Record<string, Partial<Record<GoogleOperation, string>>> = {};
  await Promise.all(selectedLabels.flatMap((label) => GOOGLE_OPERATIONS.map(async (operation) => {
    if (["gmail.send", "calendar.create", "docs.create", "docs.insert"].includes(operation)) return;
    try {
      const capability = await issueGoogleCapability(authenticatedUser.id, label, [operation]);
      googleCapabilities[label] ??= {};
      googleCapabilities[label][operation] = capability;
    } catch { /* Disconnected accounts and missing scopes stay unavailable to the workflow. */ }
  })));
  const confirmation = /^\s*confirm\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*$/i.exec(body.message);
  let approvedWrite: { label: "personal" | "official"; accountId: string; operation: GoogleOperation; payload: unknown } | null = null;
  if (confirmation) {
    try {
      const approved = await consumeGoogleWriteApproval({ id: confirmation[1], userId: authenticatedUser.id, conversationId: conversation.id });
      if (approved && body.account === approved.label) {
        const capability = await issueGoogleCapability(authenticatedUser.id, approved.label, [approved.operation], 300, { [approved.operation]: JSON.stringify(approved.payload) }, approved.accountId);
        googleCapabilities[approved.label] ??= {};
        googleCapabilities[approved.label][approved.operation] = capability;
        approvedWrite = approved;
      }
    } catch (error) {
      if (error instanceof GoogleAuthorizationError && error.code === "RECONNECT_REQUIRED") {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
      }
      /* Failed or expired confirmations are treated as ordinary chat input. */
    }
  }
  if (!approvedWrite && body.account !== "both") {
    const label = body.account;
    await Promise.all(GOOGLE_OPERATIONS.filter((operation) => ["gmail.send", "calendar.create", "docs.create", "docs.insert"].includes(operation)).map(async (operation) => {
      try {
        const capability = await issueGoogleProposalCapability(authenticatedUser.id, label, operation, conversation.id);
        googleProposalCapabilities[label] ??= {};
        googleProposalCapabilities[label][operation] = capability;
      } catch { /* Missing connection or scope means the operation is not available. */ }
    }));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-Webhook-Secret": webhookSecret,
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        sessionId: conversation.id,
        userId: authenticatedUser.id,
        googleBrokerUrl: new URL("/api/google/broker", request.url).toString(),
        googleCapabilities,
        googleProposalCapabilities,
        approvedWrite,
        user: userPrompt,
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
