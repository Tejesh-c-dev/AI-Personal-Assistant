import type { Account } from "./account-selector";

export type ApiAccount = "personal" | "official" | "both";

export type ConversationSummary = {
  id: string;
  sessionId: string;
  title: string;
  account: ApiAccount;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
};

export function toConversationAccount(account: Account): ApiAccount {
  return account.toLowerCase() as ApiAccount;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Conversation history request failed.");
  }
  return payload as T;
}

export async function listConversations() {
  return requestJson<{ conversations: ConversationSummary[]; activeConversationId: string | null }>("/api/conversations");
}

export async function getConversation(id: string) {
  return requestJson<ConversationDetail>(`/api/conversations/${id}`);
}

export async function createConversation(input: {
  sessionId: string;
  title: string;
  account: Account;
}) {
  return requestJson<{ conversation: ConversationSummary }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ ...input, account: toConversationAccount(input.account) }),
  });
}

export async function updateConversation(id: string, input: { title?: string; account?: Account }) {
  return requestJson<{ conversation: ConversationSummary }>(`/api/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      ...(input.account ? { account: toConversationAccount(input.account) } : {}),
    }),
  });
}

export async function removeConversation(id: string) {
  return requestJson<{ success: true }>(`/api/conversations/${id}`, { method: "DELETE" });
}
