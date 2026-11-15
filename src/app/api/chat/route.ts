import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  getFunctionCalls,
  getFunctionResponses,
  StreamingMode,
  type Event,
} from "@google/adk";
import {
  databaseErrorResponse,
  logRequestFailure,
  unauthorizedResponse,
} from "../../../lib/api-errors";
import {
  getCurrentUser,
  listGoogleAccounts,
  validateAccountLabel,
} from "../../../lib/auth";
import {
  GoogleAuthorizationError,
  issueGoogleCapability,
  issueGoogleProposalCapability,
  GOOGLE_OPERATIONS,
  type GoogleOperation,
} from "../../../lib/google-api";
import { consumeGoogleWriteApproval } from "../../../lib/google-write-approvals";
import {
  appendMessage,
  createConversation,
  createConversationTitle,
  findConversationBySessionId,
  getConversationMessages,
  isAccount,
  isUuid,
  updateConversation,
} from "../../../lib/conversations";
import { createRequestScopedRunner } from "../../../lib/adk/agent-runner";
import { OpenRouterError } from "../../../lib/adk/openrouter-llm";
import {
  handleConfirmation,
  parseConfirmationCommand,
} from "../../../lib/adk/confirmation-handler";
import {
  extractFinalResponse,
  hydrateSession,
  MAX_HISTORY_MESSAGES,
} from "../../../lib/adk/session-hydration";
import {
  extractPendingApproval,
  mapToolToActivityLabel,
} from "../../../lib/adk/activity-mapper";
import { createTrustedTimeContext, isValidIanaTimezone } from "../../../lib/trusted-time";

const DEFAULT_TIMEOUT_MS = 150_000;
export const maxDuration = 180;
const MAX_MESSAGE_LENGTH = 4_000;
const ACTIVE_CONVERSATION_COOKIE = "active_conversation_id";

function accountInstruction(account: string, connectedLabels?: string[]): string {
  if (connectedLabels && connectedLabels.length === 0) {
    return "No Google accounts are connected for this user. Explain that they need to connect a Google account before Google data can be accessed.";
  }
  if (account === "both") {
    if (!connectedLabels) {
      return "For read operations, use both connected accounts and label their results. For writes, use only an explicitly selected account.";
    }
    return `For read operations, use only these connected accounts: ${connectedLabels.join(", ")}. Label their results. For writes, use only an explicitly selected account.`;
  }
  if (connectedLabels && !connectedLabels.includes(account)) {
    return `The selected account '${account}' is not connected. Explain that the user must connect or select one of these accounts: ${connectedLabels.join(", ")}. Do not claim Google access.`;
  }
  const label = account.charAt(0).toUpperCase() + account.slice(1);
  return `Use only the ${label} account for Google operations.`;
}

type ChatRequest = {
  message: string;
  sessionId: string;
  account: string;
  timezone: string;
  stream?: boolean;
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
    isAccount(request.account) &&
    isValidIanaTimezone(request.timezone) &&
    (request.stream === undefined || typeof request.stream === "boolean")
  );
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function ssePayload(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function createSseResponse(
  stream: ReadableStream,
  requestId: string,
  conversationId: string,
): Response {
  const headers = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Request-ID": requestId,
  });
  headers.set(
    "Set-Cookie",
    `${ACTIVE_CONVERSATION_COOKIE}=${conversationId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return new Response(stream, { headers });
}

async function handlePost(request: Request, requestId: string) {
  let authenticatedUser;
  try {
    authenticatedUser = await getCurrentUser();
  } catch (error) {
    logRequestFailure(requestId, "database");
    return databaseErrorResponse(error, requestId);
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
    return errorResponse("Invalid chat request. A valid IANA timezone is required.", 400);
  }
  if (body.account !== "both") {
    try {
      body.account = validateAccountLabel(body.account);
    } catch {
      return errorResponse("Invalid chat request.", 400);
    }
  }

  const isStreamingRequested =
    request.headers.get("accept")?.includes("text/event-stream") ||
    body.stream === true;
  const trustedTime = createTrustedTimeContext(body.timezone);

  let conversation;
  try {
    conversation = await findConversationBySessionId(
      authenticatedUser.id,
      body.sessionId,
    );
    if (!conversation) {
      conversation = await createConversation({
        userId: authenticatedUser.id,
        sessionId: body.sessionId,
        title: createConversationTitle(body.message),
        account: body.account,
      });
    } else {
      conversation = await updateConversation(
        conversation.id,
        authenticatedUser.id,
        {
          account: body.account,
          ...(conversation.title === "New conversation"
            ? { title: createConversationTitle(body.message) }
            : {}),
        },
      );
      if (!conversation) {
        return errorResponse("The conversation could not be found.", 404);
      }
    }
  } catch (error) {
    logRequestFailure(requestId, "database");
    return databaseErrorResponse(error, requestId);
  }

  // --- Google ADK Path ---
  if (process.env.USE_ADK === "true" || parseConfirmationCommand(body.message)) {
    // 1. Check for explicit confirmation command before invoking LLM
    const confirmationId = parseConfirmationCommand(body.message);
    if (confirmationId) {
      if (isStreamingRequested) {
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (data: Record<string, unknown>) => {
              try {
                controller.enqueue(encoder.encode(ssePayload(data)));
              } catch {}
            };

            send({ type: "start", requestId });

            try {
              await appendMessage({
                conversationId: conversation.id,
                role: "user",
                content: body.message.trim(),
              });

              const result = await handleConfirmation({
                approvalId: confirmationId,
                user: authenticatedUser,
                conversation,
                selectedAccount: body.account,
              });

              const saved = await appendMessage({
                conversationId: conversation.id,
                role: "assistant",
                content: result.output,
              });

              send({ type: "text_delta", text: result.output });
              send({
                type: "final",
                messageId: saved && typeof saved === "object" && "id" in saved ? saved.id : randomUUID(),
              });
            } catch (error) {
              logRequestFailure(requestId, "confirmation");
              let errMsg = "The confirmation could not be completed.";
              if (
                error instanceof GoogleAuthorizationError &&
                (error.code === "RECONNECT_REQUIRED" ||
                  error.code === "SCOPE_REQUIRED")
              ) {
                errMsg =
                  "Google authorization is required. Please reconnect or grant the required access.";
              } else if (error instanceof GoogleAuthorizationError) {
                errMsg = "The Google operation could not be completed.";
              } else if (
                error instanceof Error &&
                (error.message.startsWith("This approval") ||
                  error.message.startsWith("Write confirmations") ||
                  error.message.startsWith("Account mismatch"))
              ) {
                errMsg = error.message.startsWith("This approval")
                  ? "This approval is no longer available."
                  : "The selected account does not match this approval.";
              }
              send({ type: "error", error: errMsg });
            } finally {
              controller.close();
            }
          },
        });
        return createSseResponse(stream, requestId, conversation.id);
      }

      // Non-streaming confirmation
      try {
        await appendMessage({
          conversationId: conversation.id,
          role: "user",
          content: body.message.trim(),
        });

        const result = await handleConfirmation({
          approvalId: confirmationId,
          user: authenticatedUser,
          conversation,
          selectedAccount: body.account,
        });

        await appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: result.output,
        });

        const response = NextResponse.json({ output: result.output });
        response.cookies.set(ACTIVE_CONVERSATION_COOKIE, conversation.id, {
          httpOnly: true,
          maxAge: 60 * 60 * 24 * 365,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        });
        return response;
      } catch (error) {
        logRequestFailure(requestId, "confirmation");
        if (
          error instanceof GoogleAuthorizationError &&
          (error.code === "RECONNECT_REQUIRED" ||
            error.code === "SCOPE_REQUIRED")
        ) {
          return errorResponse(
            "Google authorization is required. Please reconnect or grant the required access.",
            403,
          );
        }
        if (error instanceof GoogleAuthorizationError) {
          return errorResponse(
            "The Google operation could not be completed.",
            502,
          );
        }
        if (
          error instanceof Error &&
          (error.message.startsWith("This approval") ||
            error.message.startsWith("Write confirmations") ||
            error.message.startsWith("Account mismatch"))
        ) {
          return errorResponse(
            error.message.startsWith("This approval")
              ? "This approval is no longer available."
              : "The selected account does not match this approval.",
            400,
          );
        }
        return errorResponse("The confirmation could not be completed.", 500);
      }
    }

    // 2. Normal ADK Agent Path
    let priorMessages;
    try {
      priorMessages = await getConversationMessages(
        conversation.id,
        MAX_HISTORY_MESSAGES,
      );
      await appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: body.message.trim(),
      });
    } catch (error) {
      logRequestFailure(requestId, "database");
      return databaseErrorResponse(error, requestId);
    }

    let connectedAccounts;
    try {
      connectedAccounts = await listGoogleAccounts(authenticatedUser.id);
    } catch (error) {
      if (error instanceof GoogleAuthorizationError) {
        logRequestFailure(requestId, "google_authorization");
        return errorResponse(
          "Google authorization is required. Please reconnect or grant the required access.",
          403,
        );
      }
      logRequestFailure(requestId, "database");
      return databaseErrorResponse(error, requestId);
    }
    const connectedLabels = connectedAccounts
      .filter((account) => account.status === "active")
      .map((a) => {
        try {
          return validateAccountLabel(a.label);
        } catch {
          return null;
        }
      })
      .filter((label): label is string => label !== null);

    if (connectedLabels.length === 0) {
      const output =
        "No Google account is connected. Connect a Google account before I can access Gmail, Calendar, or Docs.";
      let savedMessage;
      try {
        savedMessage = await appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: output,
        });
      } catch (error) {
        logRequestFailure(requestId, "database");
        return databaseErrorResponse(error, requestId);
      }

      if (isStreamingRequested) {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(ssePayload({ type: "start", requestId })),
            );
            controller.enqueue(
              encoder.encode(ssePayload({ type: "text_delta", text: output })),
            );
            controller.enqueue(
              encoder.encode(
                ssePayload({
                  type: "final",
                  messageId:
                    savedMessage &&
                    typeof savedMessage === "object" &&
                    "id" in savedMessage
                      ? savedMessage.id
                      : randomUUID(),
                }),
              ),
            );
            controller.close();
          },
        });
        return createSseResponse(stream, requestId, conversation.id);
      }

      const response = NextResponse.json({ output });
      response.cookies.set(ACTIVE_CONVERSATION_COOKIE, conversation.id, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      return response;
    }

    let runner: ReturnType<typeof createRequestScopedRunner>["runner"];
    let sessionService: ReturnType<
      typeof createRequestScopedRunner
    >["sessionService"];
    try {
      ({ runner, sessionService } = createRequestScopedRunner({
        user: authenticatedUser,
        conversation,
        selectedAccount: body.account,
        connectedLabels,
        trustedTime,
      }));
    } catch {
      logRequestFailure(requestId, "runner_initialization");
      return errorResponse("The assistant is temporarily unavailable.", 502);
    }

    try {
      await hydrateSession(
        sessionService,
        authenticatedUser.id,
        conversation.id,
        priorMessages,
      );
    } catch {
      logRequestFailure(requestId, "session_hydration");
      return errorResponse("Conversation history could not be prepared.", 502);
    }

    if (isStreamingRequested) {
      const stream = new ReadableStream({
        async start(streamController) {
          const encoder = new TextEncoder();
          const send = (data: Record<string, unknown>) => {
            try {
              streamController.enqueue(encoder.encode(ssePayload(data)));
            } catch {}
          };

          send({ type: "start", requestId });

          const controller = new AbortController();
          const onClientAbort = () => controller.abort();
          request.signal.addEventListener("abort", onClientAbort);
          const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

          const events: Event[] = [];
          let accumulatedText = "";
          let completedNormally = false;

          try {
            for await (const event of runner.runAsync({
              userId: authenticatedUser.id,
              sessionId: conversation.id,
              newMessage: {
                role: "user",
                parts: [
                  {
                    text: `${accountInstruction(body.account, connectedLabels)}\n\n${body.message.trim()}`,
                  },
                ],
              },
              runConfig: { streamingMode: StreamingMode.SSE },
              abortSignal: controller.signal,
            })) {
              events.push(event);

              // 1. Tool execution running
              const functionCalls = getFunctionCalls(event);
              if (functionCalls.length > 0) {
                for (const call of functionCalls) {
                  const { label } = mapToolToActivityLabel(call.name ?? "");
                  send({
                    type: "activity",
                    id: call.id ?? randomUUID(),
                    label,
                    status: "running",
                  });
                }
              }

              // 2. Tool response returned
              const functionResponses = getFunctionResponses(event);
              if (functionResponses.length > 0) {
                for (const resp of functionResponses) {
                  const isError =
                    resp.response &&
                    typeof resp.response === "object" &&
                    "error" in (resp.response as Record<string, unknown>);
                  const { label } = mapToolToActivityLabel(resp.name ?? "");
                  send({
                    type: "activity",
                    id: resp.id ?? randomUUID(),
                    label,
                    status: isError ? "failed" : "completed",
                  });

                  const approval = extractPendingApproval(resp.response);
                  if (approval) {
                    send({
                      type: "approval_required",
                      approvalId: approval.approvalId,
                      operation: approval.operation,
                      account: approval.account,
                      expiresAt: approval.expiresAt,
                      details: approval.details,
                    });
                  }
                }
              }

              // 3. Streaming text delta
              if (event.partial && event.content?.parts) {
                for (const part of event.content.parts) {
                  if (typeof part.text === "string" && part.text) {
                    accumulatedText += part.text;
                    send({ type: "text_delta", text: part.text });
                  }
                }
              }
            }

            completedNormally = true;
          } catch (error) {
            if (
              controller.signal.aborted ||
              (error instanceof DOMException && error.name === "AbortError")
            ) {
              if (request.signal.aborted) {
                send({
                  type: "activity",
                  id: "cancel",
                  label: "Cancelled by user",
                  status: "cancelled",
                });
              } else {
                logRequestFailure(requestId, "agent_timeout");
                send({ type: "error", error: "The agent request timed out." });
              }
            } else if (error instanceof GoogleAuthorizationError) {
              logRequestFailure(requestId, "google_authorization");
              send({
                type: "error",
                error:
                  "Google authorization is required. Please reconnect or grant the required access.",
              });
            } else if (
              error instanceof OpenRouterError &&
              error.code === "TIMEOUT"
            ) {
              logRequestFailure(requestId, "openrouter_timeout");
              send({ type: "error", error: "The agent request timed out." });
            } else {
              logRequestFailure(requestId, "agent_provider");
              send({
                type: "error",
                error: "The assistant could not complete your request.",
              });
            }
          } finally {
            clearTimeout(timeout);
            request.signal.removeEventListener("abort", onClientAbort);
          }

          if (completedNormally) {
            const assistantText =
              extractFinalResponse(events) ||
              accumulatedText ||
              "I was unable to complete your request.";
            try {
              const saved = await appendMessage({
                conversationId: conversation.id,
                role: "assistant",
                content: assistantText,
              });
              send({
                type: "final",
                messageId:
                  saved && typeof saved === "object" && "id" in saved
                    ? saved.id
                    : randomUUID(),
              });
            } catch {
              logRequestFailure(requestId, "database");
              send({
                type: "error",
                error: "The assistant response could not be saved.",
              });
            }
          }

          streamController.close();
        },
      });

      return createSseResponse(stream, requestId, conversation.id);
    }

    // Non-streaming normal agent path
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
    const events: Event[] = [];

    try {
      for await (const event of runner.runAsync({
        userId: authenticatedUser.id,
        sessionId: conversation.id,
        newMessage: {
          role: "user",
          parts: [
            {
              text: `${accountInstruction(body.account, connectedLabels)}\n\n${body.message.trim()}`,
            },
          ],
        },
        abortSignal: controller.signal,
      })) {
        events.push(event);
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        logRequestFailure(requestId, "agent_timeout");
        return errorResponse("The agent request timed out.", 504);
      }
      if (error instanceof GoogleAuthorizationError) {
        logRequestFailure(requestId, "google_authorization");
        return errorResponse(
          "Google authorization is required. Please reconnect or grant the required access.",
          403,
        );
      }
      if (error instanceof OpenRouterError && error.code === "TIMEOUT") {
        logRequestFailure(requestId, "openrouter_timeout");
        return errorResponse("The agent request timed out.", 504);
      }
      logRequestFailure(requestId, "agent_provider");
      return errorResponse(
        "The assistant could not complete your request.",
        502,
      );
    } finally {
      clearTimeout(timeout);
    }

    const assistantText =
      extractFinalResponse(events) || "I was unable to complete your request.";
    try {
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: assistantText,
      });
    } catch (error) {
      logRequestFailure(requestId, "database");
      return databaseErrorResponse(error, requestId);
    }

    const response = NextResponse.json({ output: assistantText });
    response.cookies.set(ACTIVE_CONVERSATION_COOKIE, conversation.id, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return response;
  }

  // --- Legacy n8n path (kept for rollback) ---
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return errorResponse("The n8n webhook is not configured.", 503);
  }
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return errorResponse("The n8n webhook secret is not configured.", 503);
  }

  try {
    await appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: body.message.trim(),
    });
  } catch (error) {
    return databaseErrorResponse(error, requestId);
  }

  const userPrompt = `${accountInstruction(body.account)}\n\n${body.message}`;

  // Resolve which account labels to issue capabilities for
  let selectedLabels: string[];
  if (body.account === "both") {
    try {
      const connectedAccounts = await listGoogleAccounts(authenticatedUser.id);
      selectedLabels = connectedAccounts.map((a) => a.label);
    } catch {
      selectedLabels = [];
    }
  } else {
    selectedLabels = [body.account];
  }

  const googleCapabilities: Record<
    string,
    Partial<Record<GoogleOperation, string>>
  > = {};
  const googleProposalCapabilities: Record<
    string,
    Partial<Record<GoogleOperation, string>>
  > = {};
  await Promise.all(
    selectedLabels.flatMap((label) =>
      GOOGLE_OPERATIONS.map(async (operation) => {
        if (
          [
            "gmail.send",
            "calendar.create",
            "docs.create",
            "docs.insert",
          ].includes(operation)
        )
          return;
        try {
          const capability = await issueGoogleCapability(
            authenticatedUser.id,
            label,
            [operation],
          );
          googleCapabilities[label] ??= {};
          googleCapabilities[label][operation] = capability;
        } catch {
          /* Disconnected accounts and missing scopes stay unavailable to the workflow. */
        }
      }),
    ),
  );
  const confirmation =
    /^\s*confirm\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*$/i.exec(
      body.message,
    );
  let approvedWrite: {
    label: string;
    accountId: string;
    operation: GoogleOperation;
    payload: unknown;
  } | null = null;
  if (confirmation) {
    try {
      const approved = await consumeGoogleWriteApproval({
        id: confirmation[1],
        userId: authenticatedUser.id,
        conversationId: conversation.id,
      });
      if (
        approved &&
        (body.account === "both" || body.account === approved.label)
      ) {
        const capability = await issueGoogleCapability(
          authenticatedUser.id,
          approved.label,
          [approved.operation],
          300,
          { [approved.operation]: JSON.stringify(approved.payload) },
          approved.accountId,
        );
        googleCapabilities[approved.label] ??= {};
        googleCapabilities[approved.label][approved.operation] = capability;
        approvedWrite = approved;
      }
    } catch (error) {
      if (
        error instanceof GoogleAuthorizationError &&
        error.code === "RECONNECT_REQUIRED"
      ) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 403 },
        );
      }
      /* Failed or expired confirmations are treated as ordinary chat input. */
    }
  }
  if (!approvedWrite && body.account !== "both") {
    const label = body.account;
    await Promise.all(
      GOOGLE_OPERATIONS.filter((operation) =>
        [
          "gmail.send",
          "calendar.create",
          "docs.create",
          "docs.insert",
        ].includes(operation),
      ).map(async (operation) => {
        try {
          const capability = await issueGoogleProposalCapability(
            authenticatedUser.id,
            label,
            operation,
            conversation.id,
          );
          googleProposalCapabilities[label] ??= {};
          googleProposalCapabilities[label][operation] = capability;
        } catch {
          /* Missing connection or scope means the operation is not available. */
        }
      }),
    );
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
    if (
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
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
    logRequestFailure(requestId, "provider_http_error");
    return errorResponse(
      "The chat provider could not complete your request.",
      502,
    );
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
  } else if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    !Array.isArray(responseBody)
  ) {
    const output = (responseBody as Record<string, unknown>).output;
    assistantContent =
      typeof output === "string" && output.trim() ? output.trim() : null;
  }

  if (assistantContent) {
    try {
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: assistantContent,
      });
    } catch (error) {
      return databaseErrorResponse(error, requestId);
    }
  }

  const response = NextResponse.json(responseBody, {
    status: upstreamResponse.status,
  });
  response.cookies.set(ACTIVE_CONVERSATION_COOKIE, conversation.id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const response = await handlePost(request, requestId);
    response.headers.set("X-Request-ID", requestId);
    return response;
  } catch {
    logRequestFailure(requestId, "unexpected");
    const response = errorResponse("The request could not be completed.", 500);
    response.headers.set("X-Request-ID", requestId);
    return response;
  }
}
