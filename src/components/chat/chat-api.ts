import type { Account } from "@/components/chat/account-selector";

export type ApiAccount = "personal" | "official" | "both";

export type ChatRequest = {
  message: string;
  sessionId: string;
  account: ApiAccount;
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

export function createChatRequest(message: string, sessionId: string, account: Account): ChatRequest {
  return {
    message: message.trim(),
    sessionId,
    account: toApiAccount(account),
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
