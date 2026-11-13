"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { sendChatMessage } from "@/components/chat/chat-api";
import { type Account as AccountType } from "@/components/chat/account-selector";
import { ChatComposer } from "@/components/chat/chat-composer";
import { chatReducer, initialChatState } from "@/components/chat/chat-state";
import { createSessionId } from "@/components/chat/chat-session";
import {
  createConversation,
  getConversation,
  listConversations,
  removeConversation,
  updateConversation,
  type ConversationSummary,
} from "@/components/chat/conversation-api";
import { EmptyState } from "@/components/chat/empty-state";
import { ErrorState, LoadingState, Message } from "@/components/chat/message";
import { ChatHeader } from "@/components/layout/chat-header";
import { Sidebar } from "@/components/layout/sidebar";
import { AccountManager } from "@/components/accounts/account-manager";
import { fetchAccounts, type GoogleAccount } from "@/components/accounts/account-api";
import type { User } from "@/lib/db/schema";

export default function ChatWorkspace({ user }: { user: Pick<User, "name" | "email" | "picture"> }) {
  const [account, setAccount] = useState<AccountType>("personal");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [chatState, dispatch] = useReducer(chatReducer, initialChatState);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  // Accounts state
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [isAccountsLoading, setIsAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [isAccountManagerOpen, setIsAccountManagerOpen] = useState(false);
  const [oauthNotice, setOauthNotice] = useState<{ type: "success" | "error"; message: string } | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const errorParam = params.get("error");
      if (errorParam) {
        return {
          type: "error",
          message: `Google authorization failed: ${errorParam}`,
        };
      }
    }
    return null;
  });

  const requestVersion = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleRefreshAccounts = async () => {
    setIsAccountsLoading(true);
    setAccountsError(null);
    try {
      const loaded = await fetchAccounts();
      setAccounts(loaded);
      return loaded;
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : "Failed to load Google accounts.");
      return [];
    } finally {
      setIsAccountsLoading(false);
    }
  };

  // Check URL parameters for OAuth errors and load accounts on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("error")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    }

    let cancelled = false;
    void fetchAccounts()
      .then((loaded) => {
        if (cancelled) return;
        setAccounts(loaded);
        if (loaded.length > 0) {
          setAccount((current) => {
            const hasCurrent = loaded.some(
              (a) => a.label.toLowerCase() === current.toLowerCase() || current.toLowerCase() === "both",
            );
            return hasCurrent ? current : loaded[0].label;
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAccountsError(err instanceof Error ? err.message : "Failed to load Google accounts.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsAccountsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatState.messages, chatState.isLoading, chatState.error]);

  useEffect(() => {
    let cancelled = false;
    void listConversations()
      .then(async ({ conversations: loadedConversations, activeConversationId: loadedActiveId }) => {
        if (cancelled) return;
        setConversations(loadedConversations);
        if (!loadedActiveId) return;

        const detail = await getConversation(loadedActiveId);
        if (cancelled) return;
        setActiveConversationId(detail.conversation.id);
        setSessionId(detail.conversation.sessionId);
        setAccount(toUiAccount(detail.conversation.account));
        dispatch({
          type: "load-messages",
          messages: detail.messages.map(({ id, role, content }) => ({ id, role, content })),
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Conversation history is unavailable.");
      })
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleNewChat = () => {
    requestVersion.current += 1;
    setActiveConversationId(null);
    setSessionId(createSessionId());
    dispatch({ type: "new-chat" });
    setIsSidebarOpen(false);
  };

  const handleSubmit = async () => {
    if (chatState.isLoading || !chatState.composerValue.trim()) {
      return;
    }

    const message = chatState.composerValue;
    const activeSessionId = sessionId ?? createSessionId();
    if (sessionId === null) {
      setSessionId(activeSessionId);
    }
    try {
      if (!activeConversationId) {
        const { conversation } = await createConversation({
          sessionId: activeSessionId,
          title: message.trim().slice(0, 80),
          account,
        });
        setActiveConversationId(conversation.id);
        setConversations((current) => [conversation, ...current]);
      }
    } catch (error: unknown) {
      dispatch({
        type: "request-failed",
        message: error instanceof Error ? error.message : "Conversation history is unavailable.",
      });
      return;
    }

    const currentRequestVersion = requestVersion.current;
    dispatch({ type: "submit", message, messageId: crypto.randomUUID() });

    void sendChatMessage(message, activeSessionId, account)
      .then((content) => {
        if (requestVersion.current === currentRequestVersion) {
          dispatch({
            type: "assistant-response",
            message: { content, id: crypto.randomUUID(), role: "assistant" },
          });
          void listConversations().then(({ conversations: loadedConversations }) => setConversations(loadedConversations));
        }
      })
      .catch((error: unknown) => {
        if (requestVersion.current !== currentRequestVersion) {
          return;
        }
        dispatch({
          type: "request-failed",
          message: error instanceof Error ? error.message : "The assistant request failed.",
        });
      });
  };

  const handleAccountChange = (nextAccount: AccountType) => {
    setAccount(nextAccount);
    if (activeConversationId) {
      void updateConversation(activeConversationId, { account: nextAccount })
        .then(({ conversation }) => {
          setConversations((current) => current.map((item) => item.id === conversation.id ? conversation : item));
        })
        .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "Conversation could not be updated."));
    }
  };

  const handleSelectConversation = (conversation: ConversationSummary) => {
    requestVersion.current += 1;
    setActiveConversationId(conversation.id);
    setSessionId(conversation.sessionId);
    setAccount(toUiAccount(conversation.account));
    setIsSidebarOpen(false);
    void getConversation(conversation.id)
      .then((detail) => dispatch({
        type: "load-messages",
        messages: detail.messages.map(({ id, role, content }) => ({ id, role, content })),
      }))
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "Conversation could not be loaded."));
  };

  const handleRenameConversation = (conversation: ConversationSummary) => {
    const title = window.prompt("Rename conversation", conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    void updateConversation(conversation.id, { title })
      .then(({ conversation: updated }) => setConversations((current) => current.map((item) => item.id === updated.id ? updated : item)))
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "Conversation could not be renamed."));
  };

  const handleDeleteConversation = (conversation: ConversationSummary) => {
    if (!window.confirm(`Delete "${conversation.title}"?`)) return;
    void removeConversation(conversation.id)
      .then(() => {
        setConversations((current) => current.filter((item) => item.id !== conversation.id));
        if (activeConversationId === conversation.id) handleNewChat();
      })
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "Conversation could not be deleted."));
  };

  const handleAccountRenamed = (oldLabel: string, newLabel: string) => {
    if (account.toLowerCase() === oldLabel.toLowerCase()) {
      setAccount(newLabel);
    }
  };

  const handleAccountDisconnected = (label: string) => {
    if (account.toLowerCase() === label.toLowerCase()) {
      setAccount(() => {
        const remaining = accounts.filter((a) => a.label.toLowerCase() !== label.toLowerCase());
        return remaining.length > 0 ? remaining[0].label : "personal";
      });
    }
  };

  return (
    <div className="flex min-h-screen bg-[var(--background)] lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <Sidebar
        account={account}
        accounts={accounts}
        activeConversationId={activeConversationId}
        conversations={conversations}
        isAccountsLoading={isAccountsLoading}
        isCollapsed={isSidebarCollapsed}
        isOpen={isSidebarOpen}
        onAccountChange={handleAccountChange}
        onClose={() => setIsSidebarOpen(false)}
        onDeleteConversation={handleDeleteConversation}
        onNewChat={handleNewChat}
        onOpenSettings={() => setIsAccountManagerOpen(true)}
        onRenameConversation={handleRenameConversation}
        onSelectConversation={handleSelectConversation}
        onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
        user={user}
      />
      <main className="flex min-h-screen min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">
        <ChatHeader
          isSidebarCollapsed={isSidebarCollapsed}
          onMenuClick={() => {
            if (window.innerWidth >= 1024) setIsSidebarCollapsed((collapsed) => !collapsed);
            else setIsSidebarOpen(true);
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col px-5 sm:px-8">
          {oauthNotice && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <span>{oauthNotice.message}</span>
              <button
                className="font-medium text-red-700 hover:text-red-900"
                onClick={() => setOauthNotice(null)}
                type="button"
              >
                Dismiss
              </button>
            </div>
          )}
          {chatState.messages.length === 0 ? (
            <EmptyState onPromptSelect={(prompt) => dispatch({ type: "composer-changed", value: prompt })} />
          ) : (
            <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto py-8 sm:py-10">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                {chatState.messages.map((message) => (
                  <Message content={message.content} key={message.id} role={message.role} />
                ))}
                {chatState.isLoading && <LoadingState />}
                {chatState.error && <ErrorState message={chatState.error} />}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
          {isHistoryLoading && <p className="pb-2 text-center text-xs text-slate-400">Loading conversation history...</p>}
          {historyError && <ErrorState message={historyError} />}
          <div className="pb-5 sm:pb-7">
            <ChatComposer
              account={account}
              accounts={accounts}
              isAccountsLoading={isAccountsLoading}
              isLoading={chatState.isLoading}
              onAccountChange={setAccount}
              onChange={(value) => dispatch({ type: "composer-changed", value })}
              onSubmit={handleSubmit}
              value={chatState.composerValue}
            />
          </div>
        </div>
      </main>

      {/* Account Management Modal */}
      <AccountManager
        accounts={accounts}
        error={accountsError}
        isLoading={isAccountsLoading}
        isOpen={isAccountManagerOpen}
        onAccountDisconnected={handleAccountDisconnected}
        onAccountRenamed={handleAccountRenamed}
        onClose={() => setIsAccountManagerOpen(false)}
        onRefresh={handleRefreshAccounts}
      />
    </div>
  );
}

function toUiAccount(account: string): AccountType {
  if (!account) return "personal";
  return account.toLowerCase();
}
