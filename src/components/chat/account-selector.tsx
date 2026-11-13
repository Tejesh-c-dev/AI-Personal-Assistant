"use client";

import { useEffect, useState } from "react";
import { Icon } from "../ui/icons";

export type Account = string;

export type AccountItem = {
  label: string;
  detail?: string;
  email?: string;
};

type AccountSelectorProps = {
  value: Account;
  onChange: (account: Account) => void;
  disabled?: boolean;
  accounts?: AccountItem[];
  isLoading?: boolean;
};

function formatAccountLabel(label: string): string {
  if (label.toLowerCase() === "both") return "Both";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function AccountSelector({
  value,
  onChange,
  disabled = false,
  accounts: externalAccounts,
  isLoading: externalIsLoading,
}: AccountSelectorProps) {
  const [internalAccounts, setInternalAccounts] = useState<AccountItem[] | null>(null);
  const [internalLoading, setInternalLoading] = useState(() => externalAccounts === undefined);

  // If externalAccounts not provided, fetch from /api/accounts
  useEffect(() => {
    if (externalAccounts !== undefined) return;
    let cancelled = false;

    fetch("/api/accounts", { headers: { "Content-Type": "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { accounts?: Array<{ label: string; email: string }> } | null) => {
        if (!cancelled && data?.accounts) {
          setInternalAccounts(
            data.accounts.map((a) => ({
              label: a.label,
              detail: a.email,
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setInternalAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setInternalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [externalAccounts]);

  const accounts = externalAccounts ?? internalAccounts ?? [];
  const isLoading = externalIsLoading ?? internalLoading;

  // Build the option list
  const options: { value: string; display: string }[] = accounts.map((acc) => {
    const detail = acc.detail || acc.email;
    const name = formatAccountLabel(acc.label);
    return {
      value: acc.label,
      display: detail ? `${name} · ${detail}` : name,
    };
  });

  // Add "Both" option if there are 2 or more accounts
  if (accounts.length >= 2) {
    options.push({
      value: "both",
      display: "Both · All inboxes",
    });
  }

  // Ensure current value is represented if accounts are loaded but value isn't matched
  const normalizedValue = value.toLowerCase();
  const valueMatched = options.some((opt) => opt.value.toLowerCase() === normalizedValue);
  const effectiveValue = valueMatched
    ? options.find((opt) => opt.value.toLowerCase() === normalizedValue)!.value
    : value;

  return (
    <div className="relative">
      <label
        className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"
        htmlFor="account"
      >
        Gmail account
      </label>
      <div className="relative">
        <select
          aria-label="Choose Gmail account"
          className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm font-medium text-slate-700 outline-none transition disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          disabled={disabled || isLoading}
          id="account"
          onChange={(event) => onChange(event.target.value)}
          value={effectiveValue}
        >
          {isLoading && accounts.length === 0 && (
            <option disabled value="">
              Loading accounts...
            </option>
          )}
          {!isLoading && accounts.length === 0 && (
            <option disabled value="">
              No accounts connected
            </option>
          )}
          {!valueMatched && value && (
            <option key={value} value={value}>
              {formatAccountLabel(value)}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.display}
            </option>
          ))}
        </select>
        <Icon
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          name="chevron-down"
        />
      </div>
    </div>
  );
}
