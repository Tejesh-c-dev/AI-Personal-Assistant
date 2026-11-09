"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AccountSelector, type Account } from "@/components/chat/account-selector";
import type { ConversationSummary } from "@/components/chat/conversation-api";
import { Icon } from "@/components/ui/icons";
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
};

export function Sidebar({
  account,
  isOpen,
  isCollapsed,
  onAccountChange,
  onClose,
  onNewChat,
  conversations,
  activeConversationId,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onToggleCollapse,
  user,
}: SidebarProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <button aria-label="Close navigation" className={`fixed inset-0 z-30 bg-slate-950/20 backdrop-blur-[2px] transition-opacity lg:hidden ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} type="button" />
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[286px] flex-col border-r border-slate-200/80 bg-[#fbfbfc] px-3 py-5 shadow-xl shadow-slate-900/5 transition-[width,transform] duration-300 lg:static lg:h-full lg:flex-none lg:z-auto lg:translate-x-0 lg:shadow-none ${isCollapsed ? "lg:w-[76px]" : "lg:w-[286px]"} ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between px-2"}`}>
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[#1d5bd7] text-sm font-bold text-white shadow-lg shadow-blue-200/60">A</div>
            {!isCollapsed && <div><p className="text-sm font-bold tracking-tight text-slate-900">AI Personal</p><p className="text-[11px] text-slate-400">Assistant workspace</p></div>}
          </div>
          <button aria-label="Close sidebar" className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600 lg:hidden" onClick={onClose} type="button"><Icon className="size-5" name="close" /></button>
        </div>

        <button aria-label="New chat" className={`mt-8 flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d5bd7] focus:outline-none focus:ring-4 focus:ring-blue-100 ${isCollapsed ? "mx-auto size-11" : "w-full"}`} onClick={onNewChat} type="button">
          <Icon className="size-4" name="plus" />{!isCollapsed && "New chat"}
        </button>

        {!isCollapsed && <div className="relative mt-4">
          <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" name="search" />
          <input aria-label="Search conversations" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" value={search} />
        </div>}

        <section className={`flex-1 ${isCollapsed ? "mt-7" : "mt-8"}`} aria-labelledby="history-heading">
          <div className={`flex items-center ${isCollapsed ? "justify-center" : "px-2"}`}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400" id="history-heading">{isCollapsed ? "..." : "Recent chats"}</h2>
          </div>
          {!isCollapsed && (filteredConversations.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center">
            <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-white text-slate-300 shadow-sm"><Icon className="size-4" name="message" /></div>
            <p className="mt-3 text-xs font-medium text-slate-500">{search ? "No matching conversations" : "No conversations yet"}</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">{search ? "Try a different search." : "Your recent chats will appear here."}</p>
          </div> : <div className="mt-4 space-y-1">
            {filteredConversations.map((conversation) => <div className={`group flex items-center gap-1 rounded-xl px-2 py-2 transition ${conversation.id === activeConversationId ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-100"}`} key={conversation.id}>
              <button className="min-w-0 flex-1 truncate text-left text-xs font-medium" onClick={() => onSelectConversation(conversation)} type="button">{conversation.title}</button>
              <button aria-label={`Rename ${conversation.title}`} className="hidden rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 group-hover:block" onClick={() => onRenameConversation(conversation)} type="button">Rename</button>
              <button aria-label={`Delete ${conversation.title}`} className="hidden rounded-md p-1 text-slate-400 hover:bg-white hover:text-red-600 group-hover:block" onClick={() => onDeleteConversation(conversation)} type="button">Delete</button>
            </div>)}
          </div>)}
        </section>

        <div className={`${isCollapsed ? "space-y-3" : "border-t border-slate-100 pt-4"}`}>
          <button aria-label="Open settings" className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 ${isCollapsed ? "justify-center" : ""}`} type="button"><Icon name="settings" />{!isCollapsed && "Settings"}</button>
          {!isCollapsed && <AccountSelector onChange={onAccountChange} value={account} />}
          {!isCollapsed && <div className="mt-3 rounded-xl border border-slate-200/80 bg-white p-2">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">{user.name.slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{user.name}</p><p className="truncate text-[10px] text-slate-400">{user.email}</p></div>
            </div>
            <button className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800" onClick={() => { void fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/sign-in")); }} type="button">Sign out</button>
          </div>}
        </div>
        <button aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="mt-3 hidden size-8 items-center justify-center self-end rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:flex" onClick={onToggleCollapse} type="button"><Icon name="panel" /></button>
      </aside>
    </>
  );
}
