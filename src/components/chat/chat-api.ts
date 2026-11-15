import type { Account } from "@/components/chat/account-selector";

export type ApiAccount = string;

export type ChatRequest = {
  message: string;
  sessionId: string;
  account: ApiAccount;
  timezone: string;
  stream?: boolean;
};

export class ChatApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatApiError";
  }
}

export function toApiAccount(account: Account): ApiAccount {
  return account.toLowerCase() as ApiAccount;
}

export function createChatRequest(message: string, sessionId: string, account: Account, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): ChatRequest {
  return {
    message: message.trim(),
    sessionId,
    account: toApiAccount(account),
    timezone,
  };
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const response = payload as Record<string, unknown>;
    if (typeof response.error === "string" && response.error.trim()) {
      return response.error;
    }
    if (typeof response.message === "string" && response.message.trim()) {
      return response.message;
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  return fallback;
}

export function parseAssistantResponse(payload: unknown): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const response = item as Record<string, unknown>;
        if (typeof response.output === "string" && response.output.trim()) {
          return response.output.trim();
        }
      }
    }
  }

  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const response = payload as Record<string, unknown>;
    if (typeof response.output === "string" && response.output.trim()) {
      return response.output.trim();
    }
    if (typeof response.error === "string" && response.error.trim()) {
      throw new ChatApiError(response.error);
    }
  }

  throw new ChatApiError("The assistant returned an unsupported response.");
}

export async function sendChatMessage(
  message: string,
  sessionId: string,
  account: Account,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createChatRequest(message, sessionId, account)),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ChatApiError("The assistant returned an invalid response.");
  }

  if (!response.ok) {
    throw new ChatApiError(getErrorMessage(payload, "The assistant request failed."));
  }

  return parseAssistantResponse(payload);
}

export type StreamActivityPayload = {
  id: string;
  label: string;
  status: "running" | "completed" | "failed" | "cancelled";
};

export type StreamApprovalPayload = {
  approvalId: string;
  account: string;
  operation: "gmail.send" | "calendar.create" | "docs.create" | "docs.insert";
  expiresAt: string;
  details: Record<string, string>;
};

export type ApprovalActionResult = { status: import("./chat-state").ApprovalStatus; result?: string | null; error?: string };

export async function actOnApproval(approvalId: string, conversationId: string, action: "confirm" | "reject"): Promise<ApprovalActionResult> {
  const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, action }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.status !== "string") throw new ChatApiError("The approval status could not be verified.");
  if (response.status >= 500 && payload.status !== "failed" && payload.status !== "uncertain") {
    throw new ChatApiError("The approval status could not be verified.");
  }
  return {
    status: payload.status as ApprovalActionResult["status"],
    result: typeof payload.result === "string" ? payload.result : null,
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}

export type StreamChatOptions = {
  message: string;
  sessionId: string;
  account: Account;
  signal?: AbortSignal;
  onStart?: (requestId: string) => void;
  onActivity?: (activity: StreamActivityPayload) => void;
  onApprovalRequired?: (approval: StreamApprovalPayload) => void;
  onTextDelta?: (text: string) => void;
  onFinal?: (messageId: string) => void;
  onError?: (error: string) => void;
  fetcher?: typeof fetch;
};

export async function streamChatMessage(options: StreamChatOptions): Promise<void> {
  const {
    message,
    sessionId,
    account,
    signal,
    onStart,
    onActivity,
    onApprovalRequired,
    onTextDelta,
    onFinal,
    onError,
    fetcher = fetch,
  } = options;

  let response: Response;
  try {
    response = await fetcher("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        ...createChatRequest(message, sessionId, account),
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : "The assistant request failed.";
    onError?.(msg);
    throw new ChatApiError(msg);
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {}
    const msg = getErrorMessage(payload, "The assistant request failed.");
    onError?.(msg);
    throw new ChatApiError(msg);
  }

  if (!response.body) {
    const msg = "The assistant returned an empty response.";
    onError?.(msg);
    throw new ChatApiError(msg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(dataStr);
        } catch {
          continue;
        }

        switch (event.type) {
          case "start":
            onStart?.(String(event.requestId ?? ""));
            break;
          case "activity":
            onActivity?.({
              id: String(event.id ?? ""),
              label: String(event.label ?? ""),
              status: event.status as StreamActivityPayload["status"],
            });
            break;
          case "approval_required":
            onApprovalRequired?.({
              approvalId: String(event.approvalId ?? ""),
              account: String(event.account ?? ""),
              operation: event.operation as StreamApprovalPayload["operation"],
              expiresAt: String(event.expiresAt ?? ""),
              details: (event.details as Record<string, string>) ?? {},
            });
            break;
          case "text_delta":
            if (typeof event.text === "string") {
              onTextDelta?.(event.text);
            }
            break;
          case "final":
            onFinal?.(String(event.messageId ?? ""));
            break;
          case "error":
            onError?.(String(event.error ?? "The assistant request failed."));
            break;
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : "The stream was interrupted.";
    onError?.(msg);
    throw new ChatApiError(msg);
  } finally {
    reader.releaseLock();
  }
}
