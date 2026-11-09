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

export default function Home() {
  const [account, setAccount] = useState<AccountType>("Personal");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [chatState, dispatch] = useReducer(chatReducer, initialChatState);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const requestVersion = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex min-h-screen bg-[var(--background)] lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <Sidebar account={account} activeConversationId={activeConversationId} conversations={conversations} isCollapsed={isSidebarCollapsed} isOpen={isSidebarOpen} onAccountChange={handleAccountChange} onClose={() => setIsSidebarOpen(false)} onDeleteConversation={handleDeleteConversation} onNewChat={handleNewChat} onRenameConversation={handleRenameConversation} onSelectConversation={handleSelectConversation} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} />
      <main className="flex min-h-screen min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">
        <ChatHeader isSidebarCollapsed={isSidebarCollapsed} onMenuClick={() => {
          if (window.innerWidth >= 1024) setIsSidebarCollapsed((collapsed) => !collapsed);
          else setIsSidebarOpen(true);
        }} />
        <div className="flex min-h-0 flex-1 flex-col px-5 sm:px-8">
          {chatState.messages.length === 0 ? (
            <EmptyState onPromptSelect={(prompt) => dispatch({ type: "composer-changed", value: prompt })} />
          ) : (
            <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto py-8 sm:py-10">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                {chatState.messages.map((message) => <Message content={message.content} key={message.id} role={message.role} />)}
                {chatState.isLoading && <LoadingState />}
                {chatState.error && <ErrorState message={chatState.error} />}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
          {isHistoryLoading && <p className="pb-2 text-center text-xs text-slate-400">Loading conversation history...</p>}
          {historyError && <ErrorState message={historyError} />}
          <div className="pb-5 sm:pb-7">
            <ChatComposer account={account} isLoading={chatState.isLoading} onAccountChange={setAccount} onChange={(value) => dispatch({ type: "composer-changed", value })} onSubmit={handleSubmit} value={chatState.composerValue} />
          </div>
        </div>
      </main>
    </div>
  );
}

function toUiAccount(account: "personal" | "official" | "both"): AccountType {
  return account[0].toUpperCase() + account.slice(1) as AccountType;
}
