"use client";

import { Icon } from "@/components/ui/icons";

type Account = "Personal" | "Official" | "Both";

type AccountSelectorProps = {
  value: Account;
  onChange: (account: Account) => void;
  disabled?: boolean;
};

const accounts: { label: Account; detail: string }[] = [
  { label: "Personal", detail: "personal@gmail.com" },
  { label: "Official", detail: "work@gmail.com" },
  { label: "Both", detail: "All inboxes" },
];

export type { Account };

export function AccountSelector({ value, onChange, disabled = false }: AccountSelectorProps) {
  return (
    <div className="relative">
      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400" htmlFor="account">
        Gmail account
      </label>
      <div className="relative">
        <select
          aria-label="Choose Gmail account"
          className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm font-medium text-slate-700 outline-none transition disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          disabled={disabled}
          id="account"
          onChange={(event) => onChange(event.target.value as Account)}
          value={value}
        >
          {accounts.map((account) => (
            <option key={account.label} value={account.label}>
              {account.label} · {account.detail}
            </option>
          ))}
        </select>
        <Icon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" name="chevron-down" />
      </div>
    </div>
  );
}
