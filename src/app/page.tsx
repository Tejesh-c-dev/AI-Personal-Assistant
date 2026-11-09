"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { sendChatMessage } from "@/components/chat/chat-api";
import { type Account as AccountType } from "@/components/chat/account-selector";
import { ChatComposer } from "@/components/chat/chat-composer";
import { chatReducer, initialChatState } from "@/components/chat/chat-state";
import { createSessionId } from "@/components/chat/chat-session";
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
  const requestVersion = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatState.messages, chatState.isLoading, chatState.error]);

  const handleNewChat = () => {
    requestVersion.current += 1;
    setSessionId(createSessionId());
    dispatch({ type: "new-chat" });
    setIsSidebarOpen(false);
  };

  const handleSubmit = () => {
    if (chatState.isLoading || !chatState.composerValue.trim()) {
      return;
    }

    const message = chatState.composerValue;
    const activeSessionId = sessionId ?? createSessionId();
    if (sessionId === null) {
      setSessionId(activeSessionId);
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

  return (
    <div className="flex min-h-screen bg-[var(--background)] lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <Sidebar account={account} isCollapsed={isSidebarCollapsed} isOpen={isSidebarOpen} onAccountChange={setAccount} onClose={() => setIsSidebarOpen(false)} onNewChat={handleNewChat} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} />
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
          <div className="pb-5 sm:pb-7">
            <ChatComposer account={account} isLoading={chatState.isLoading} onAccountChange={setAccount} onChange={(value) => dispatch({ type: "composer-changed", value })} onSubmit={handleSubmit} value={chatState.composerValue} />
          </div>
        </div>
      </main>
    </div>
  );
}
