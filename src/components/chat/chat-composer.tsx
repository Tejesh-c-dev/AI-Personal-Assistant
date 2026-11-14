"use client";

import { AccountSelector, type Account, type AccountItem } from "./account-selector";
import { Icon } from "../ui/icons";

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
        className="rounded-2xl border border-[#DCE4ED] bg-[#FFFFFF] p-2.5 shadow-sm transition focus-within:border-[#315F85] focus-within:ring-2 focus-within:ring-[#315F85]/20"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !isLoading) onSubmit();
        }}
      >
        <label className="sr-only" htmlFor="message">Message your assistant</label>
        <textarea
          className="min-h-20 w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-[#172B4D] outline-none placeholder:text-[#64748B]"
          disabled={isLoading}
          id="message"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit && !isLoading) onSubmit();
            }
          }}
          placeholder="Message your assistant..."
          rows={2}
          value={value}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1 pt-1 border-t border-[#DCE4ED]/40">
          <div className="flex items-center gap-3">
            <p className="hidden text-[11px] text-[#64748B] sm:block">
              Enter to send · Shift + Enter for a new line
            </p>
            <div className="w-[160px] [&_label]:sr-only [&_select]:h-8 [&_select]:rounded-lg [&_select]:bg-[#F1F5F9] [&_select]:border-[#DCE4ED] [&_select]:py-1.5 [&_select]:text-[11px] [&_select]:text-[#172B4D]">
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
              className="flex size-9 items-center justify-center rounded-xl bg-[#172B4D] text-white transition hover:bg-[#243B53] shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[#172B4D]"
              onClick={(e) => {
                e.preventDefault();
                onStop?.();
              }}
              type="button"
            >
              <span className="size-3 rounded-xs bg-white" />
            </button>
          ) : (
            <button
              aria-label="Send message"
              className="flex size-9 items-center justify-center rounded-xl bg-[#315F85] text-white transition hover:bg-[#264D70] disabled:cursor-not-allowed disabled:bg-[#DCE4ED] disabled:text-[#64748B] shadow-xs"
              disabled={!canSubmit}
              type="submit"
            >
              <Icon className="size-4" name="arrow-up" />
            </button>
          )}
        </div>
      </form>
      <p className="mt-2.5 text-center text-[11px] text-[#64748B]">
        AI Personal Assistant can make mistakes. Verify important information.
      </p>
    </div>
  );
}
