"use client";

import { AccountSelector, type Account } from "@/components/chat/account-selector";
import { Icon } from "@/components/ui/icons";

type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  account: Account;
  onAccountChange: (account: Account) => void;
};

export function ChatComposer({ value, onChange, onSubmit, account, onAccountChange }: ChatComposerProps) {
  const canSubmit = value.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <form className="rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_10px_35px_rgb(15_23_42_/_0.07)] transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50" onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(); }}>
        <label className="sr-only" htmlFor="message">Message your assistant</label>
        <textarea
          className="min-h-20 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
          id="message"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask anything, or choose a suggestion above..."
          rows={2}
          value={value}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
          <div className="flex items-center gap-3">
            <p className="hidden text-[11px] text-slate-400 sm:block">Enter to send · Shift + Enter for a new line</p>
            <div className="w-[150px] [&_label]:sr-only [&_select]:h-8 [&_select]:rounded-lg [&_select]:bg-slate-50 [&_select]:py-1.5 [&_select]:text-[11px]"><AccountSelector onChange={onAccountChange} value={account} /></div>
          </div>
          <button aria-label="Send message" className="flex size-9 items-center justify-center rounded-xl bg-[#1d5bd7] text-white transition hover:bg-[#1749af] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" disabled={!canSubmit} type="submit"><Icon className="size-4" name="arrow-up" /></button>
        </div>
      </form>
      <p className="mt-3 text-center text-[11px] text-slate-400">AI Personal Assistant can make mistakes. Check important information.</p>
    </div>
  );
}
