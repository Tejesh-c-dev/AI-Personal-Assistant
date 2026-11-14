"use client";

import { useEffect, useState } from "react";

import type { Account, AccountItem } from "@/components/chat/account-selector";
import type { ConversationSummary } from "@/components/chat/conversation-api";
import { Icon } from "../ui/icons";
import type { User } from "@/lib/db/schema";

type SidebarProps = {
  account: Account;
  isOpen: boolean;
  isCollapsed: boolean;
  onAccountChange: (account: Account) => void;
  onClose: () => void;
  onNewChat: () => void;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onSelectConversation: (conversation: ConversationSummary) => void;
  onRenameConversation: (conversation: ConversationSummary) => void;
  onDeleteConversation: (conversation: ConversationSummary) => void;
  onToggleCollapse: () => void;
  user: Pick<User, "name" | "email" | "picture">;
  onOpenSettings?: () => void;
  onOpenAccounts?: () => void;
  onOpenAbout?: () => void;
  accounts?: AccountItem[];
  isAccountsLoading?: boolean;
};

export function Sidebar({
  isOpen,
  isCollapsed,
  onClose,
  onNewChat,
  conversations,
  activeConversationId,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onToggleCollapse,
  onOpenSettings,
  onOpenAccounts,
  onOpenAbout,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(search.trim().toLowerCase()),
  );

  // Close mobile drawer on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Mobile Backdrop */}
      <button
        aria-label="Close navigation overlay"
        className={`fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-[2px] transition-opacity lg:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        type="button"
      />

      {/* Navy Sidebar */}
      <aside
        id="left-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-[#243B53] bg-[#172B4D] px-3.5 py-4 text-white shadow-xl transition-[width,transform] duration-300 lg:static lg:h-full lg:flex-none lg:z-auto lg:translate-x-0 lg:shadow-none ${
          isCollapsed ? "lg:w-[72px]" : "lg:w-[280px]"
        } ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* App Logo & Brand Header */}
        <div
          className={`flex items-center ${
            isCollapsed ? "justify-center" : "justify-between px-1"
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#315F85] text-sm font-bold text-white shadow-sm">
              A
            </div>
            {!isCollapsed && (
              <div className="min-w-0 truncate">
                <p className="text-sm font-bold tracking-tight text-white truncate">
                  AI Assistant
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  Enterprise Workspace
                </p>
              </div>
            )}
          </div>
          <button
            aria-label="Close sidebar"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-[#243B53] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#315F85]/40 lg:hidden"
            onClick={onClose}
            title="Close sidebar"
            type="button"
          >
            <Icon className="size-4" name="close" />
          </button>
          {!isCollapsed && (
            <button
              aria-controls="left-sidebar"
              aria-expanded={true}
              aria-label="Collapse sidebar"
              className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-[#243B53] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#315F85]/40 lg:flex items-center justify-center"
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              type="button"
            >
              <Icon className="size-4" name="panel" />
            </button>
          )}
        </div>

        {/* Primary Navigation Rail (Chat, Accounts, Settings, About) */}
        <nav aria-label="Main Navigation" className="mt-4 space-y-1">
          {/* Chat (Active by default) */}
          <button
            aria-current="page"
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
              isCollapsed ? "justify-center" : ""
            } bg-[#243B53] text-white shadow-sm`}
            onClick={() => {
              onNewChat();
            }}
            type="button"
          >
            <Icon className="size-4 text-[#FFFFFF]" name="message" />
            {!isCollapsed && <span>Chat</span>}
          </button>

          {/* Accounts */}
          <button
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#243B53] hover:text-white ${
              isCollapsed ? "justify-center" : ""
            }`}
            onClick={onOpenAccounts ?? onOpenSettings}
            type="button"
          >
            <Icon className="size-4 text-slate-400" name="google" />
            {!isCollapsed && <span>Accounts</span>}
          </button>

          {/* Settings */}
          <button
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#243B53] hover:text-white ${
              isCollapsed ? "justify-center" : ""
            }`}
            onClick={onOpenSettings}
            type="button"
          >
            <Icon className="size-4 text-slate-400" name="settings" />
            {!isCollapsed && <span>Settings</span>}
          </button>

          {/* About */}
          <button
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#243B53] hover:text-white ${
              isCollapsed ? "justify-center" : ""
            }`}
            onClick={onOpenAbout}
            type="button"
          >
            <Icon className="size-4 text-slate-400" name="info" />
            {!isCollapsed && <span>About</span>}
          </button>
        </nav>

        {/* New Chat Primary Action Button */}
        <button
          aria-label="New chat"
          className={`mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#315F85] px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#264D70] focus:outline-none focus:ring-2 focus:ring-[#315F85]/40 ${
            isCollapsed ? "mx-auto size-10" : "w-full"
          }`}
          onClick={onNewChat}
          type="button"
        >
          <Icon className="size-3.5" name="plus" />
          {!isCollapsed && <span>New chat</span>}
        </button>

        {/* Search Conversations Input */}
        {!isCollapsed && (
          <div className="relative mt-3">
            <Icon
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
              name="search"
            />
            <input
              aria-label="Search conversations"
              className="h-9 w-full rounded-lg border border-[#243B53] bg-[#243B53]/60 pl-8 pr-3 text-xs text-white outline-none placeholder:text-slate-400 focus:border-[#315F85] focus:bg-[#243B53]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              value={search}
            />
          </div>
        )}

        {/* Recent Chats Section */}
        <section
          aria-labelledby="history-heading"
          className={`flex-1 min-h-0 overflow-y-auto ${
            isCollapsed ? "mt-4" : "mt-5"
          }`}
        >
          <div
            className={`flex items-center ${
              isCollapsed ? "justify-center" : "px-1"
            }`}
          >
            <h2
              className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"
              id="history-heading"
            >
              {isCollapsed ? "..." : "Recent chats"}
            </h2>
          </div>

          {!isCollapsed &&
            (filteredConversations.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[#243B53] bg-[#243B53]/30 px-3 py-4 text-center">
                <div className="mx-auto flex size-8 items-center justify-center rounded-full bg-[#243B53] text-slate-300">
                  <Icon className="size-3.5" name="message" />
                </div>
                <p className="mt-2 text-xs font-medium text-slate-300">
                  {search ? "No matching conversations" : "No conversations yet"}
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-slate-400">
                  {search
                    ? "Try a different search."
                    : "Your recent chats will appear here."}
                </p>
              </div>
            ) : (
              <div className="mt-2 space-y-0.5">
                {filteredConversations.map((conversation) => (
                  <div
                    className={`group flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition ${
                      conversation.id === activeConversationId
                        ? "bg-[#243B53] text-white font-medium"
                        : "text-slate-300 hover:bg-[#243B53]/60 hover:text-white"
                    }`}
                    key={conversation.id}
                  >
                    <button
                      className="min-w-0 flex-1 truncate text-left text-xs"
                      onClick={() => onSelectConversation(conversation)}
                      type="button"
                    >
                      {conversation.title}
                    </button>
                    <button
                      aria-label={`Rename ${conversation.title}`}
                      className="hidden rounded px-1 text-[10px] text-slate-300 hover:bg-[#172B4D] hover:text-white group-hover:block"
                      onClick={() => onRenameConversation(conversation)}
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete ${conversation.title}`}
                      className="hidden rounded px-1 text-[10px] text-red-300 hover:bg-[#172B4D] hover:text-red-200 group-hover:block"
                      onClick={() => onDeleteConversation(conversation)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ))}
        </section>

        {/* Compact Product Information Section Near Bottom */}
        {!isCollapsed ? (
          <div className="border-t border-[#243B53] pt-3 text-[11px] text-slate-400">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">AI Assistant</span>
              <span className="rounded bg-[#243B53] px-1.5 py-0.5 text-[10px] text-slate-300">
                v0.1.0
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 truncate">
              Google Workspace Connected
            </p>
          </div>
        ) : null}

        {/* Collapse Sidebar Button (Desktop) */}
        <button
          aria-controls="left-sidebar"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mt-3 hidden size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#243B53] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#315F85]/40 lg:flex ${
            isCollapsed ? "mx-auto" : "self-end"
          }`}
          onClick={onToggleCollapse}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          <Icon name="panel" />
        </button>
      </aside>
    </>
  );
}
