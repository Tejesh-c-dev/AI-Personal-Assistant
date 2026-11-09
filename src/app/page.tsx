"use client";

import { useState } from "react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { EmptyState } from "@/components/chat/empty-state";
import { type Account } from "@/components/chat/account-selector";
import { ChatHeader } from "@/components/layout/chat-header";
import { Sidebar } from "@/components/layout/sidebar";

export default function Home() {
  const [account, setAccount] = useState<Account>("Personal");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [message, setMessage] = useState("");

  const handleNewChat = () => {
    setMessage("");
    setIsSidebarOpen(false);
  };

  const handleSubmit = () => {
    // Sending is intentionally not connected to an external service yet.
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
          <EmptyState onPromptSelect={setMessage} />
          <div className="pb-5 sm:pb-7">
            <ChatComposer account={account} onAccountChange={setAccount} onChange={setMessage} onSubmit={handleSubmit} value={message} />
          </div>
        </div>
      </main>
    </div>
  );
}
