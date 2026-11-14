"use client";

import { AccountSelector, type Account, type AccountItem } from "@/components/chat/account-selector";
import { Icon } from "@/components/ui/icons";

type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  account: Account;
  onAccountChange: (account: Account) => void;
  isLoading?: boolean;
  accounts?: AccountItem[];
  isAccountsLoading?: boolean;
};

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  account,
  onAccountChange,
  isLoading = false,
  accounts,
  isAccountsLoading = false,
}: ChatComposerProps) {
  const canSubmit = value.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <form
        className="rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_10px_35px_rgb(15_23_42_/_0.07)] transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !isLoading) onSubmit();
        }}
      >
        <label className="sr-only" htmlFor="message">Message your assistant</label>
        <textarea
          className="min-h-20 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
          id="message"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit && !isLoading) onSubmit();
            }
          }}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask anything, or choose a suggestion above..."
          rows={2}
          disabled={isLoading}
          value={value}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
          <div className="flex items-center gap-3">
            <p className="hidden text-[11px] text-slate-400 sm:block">Enter to send · Shift + Enter for a new line</p>
            <div className="w-[150px] [&_label]:sr-only [&_select]:h-8 [&_select]:rounded-lg [&_select]:bg-slate-50 [&_select]:py-1.5 [&_select]:text-[11px]">
              <AccountSelector
                accounts={accounts}
                disabled={isLoading || isAccountsLoading}
                isLoading={isAccountsLoading}
                onChange={onAccountChange}
                value={account}
              />
            </div>
          </div>
          {isLoading ? (
            <button
              aria-label="Stop generating response"
              className="flex size-9 items-center justify-center rounded-xl bg-slate-800 text-white transition hover:bg-slate-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              onClick={(e) => {
                e.preventDefault();
                onStop?.();
              }}
              type="button"
            >
              <span className="size-3 rounded-sm bg-white" />
            </button>
          ) : (
            <button
              aria-label="Send message"
              className="flex size-9 items-center justify-center rounded-xl bg-[#1d5bd7] text-white transition hover:bg-[#1749af] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              disabled={!canSubmit}
              type="submit"
            >
              <Icon className="size-4" name="arrow-up" />
            </button>
          )}
        </div>
      </form>
      <p className="mt-3 text-center text-[11px] text-slate-400">AI Personal Assistant can make mistakes. Check important information.</p>
    </div>
  );
}
