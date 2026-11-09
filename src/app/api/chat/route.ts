import { NextResponse } from "next/server";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_MESSAGE_LENGTH = 4_000;
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
    request.sessionId.trim().length > 0 &&
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

  return NextResponse.json(responseBody, { status: upstreamResponse.status });
}
