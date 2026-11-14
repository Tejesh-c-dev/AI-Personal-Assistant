"use client";

import { useEffect } from "react";

import type { GoogleAccount } from "@/components/accounts/account-api";
import { Icon } from "../ui/icons";

export function formatScopeDisplayName(scope: string): string {
  if (scope.includes("gmail.modify")) return "Gmail (Read & Modify)";
  if (scope.includes("gmail.send")) return "Gmail (Send)";
  if (scope.includes("calendar.events")) return "Calendar Events";
  if (scope.includes("documents")) return "Google Docs";
  if (scope.includes("drive.readonly")) return "Google Drive (Read)";
  const parts = scope.split("/");
  return parts[parts.length - 1] || scope;
}

type RightAccountPanelProps = {
  accounts: GoogleAccount[];
  activeAccountLabel: string;
  isLoading?: boolean;
  onOpenManageAccounts: () => void;
  isOpen: boolean;
  onClose: () => void;
};

export function RightAccountPanel({
  accounts,
  activeAccountLabel,
  isLoading = false,
  onOpenManageAccounts,
  isOpen,
  onClose,
}: RightAccountPanelProps) {
  // Find active account or fall back to first active
  const normalizedLabel = activeAccountLabel.toLowerCase();
  const activeAccount =
    accounts.find((a) => a.label.toLowerCase() === normalizedLabel) ??
    accounts[0] ??
    null;

  const isConnected = !!activeAccount && activeAccount.status === "active";
  const scopes = activeAccount?.grantedScopes ?? [];

  // Close on Escape key press
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

  const panelContent = (
    <div className="flex h-full flex-col p-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#DCE4ED] pb-4">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#F1F5F9] text-[#172B4D]">
            <Icon className="size-4" name="google" />
          </div>
          <h2 className="text-sm font-semibold tracking-tight text-[#172B4D]">
            Google Account
          </h2>
        </div>
        <button
          aria-label="Close Google Account panel"
          className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#172B4D] focus:outline-none focus:ring-2 focus:ring-[#315F85]/40"
          onClick={onClose}
          title="Close Google Account panel"
          type="button"
        >
          <Icon className="size-4" name="close" />
        </button>
      </div>

      {/* Account Info Card */}
      <div className="mt-4 flex-1 space-y-5 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-24 rounded bg-[#F1F5F9]" />
            <div className="h-8 rounded-xl bg-[#F1F5F9]" />
            <div className="h-20 rounded-xl bg-[#F1F5F9]" />
          </div>
        ) : activeAccount ? (
          <>
            {/* Status & Identity */}
            <div className="rounded-xl border border-[#DCE4ED] bg-[#F1F5F9] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                  Account Status
                </span>
                {isConnected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#15945B]/20 bg-[#15945B]/10 px-2 py-0.5 text-[11px] font-medium text-[#15945B]">
                    <span className="size-1.5 rounded-full bg-[#15945B]" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C2413B]/20 bg-[#C2413B]/10 px-2 py-0.5 text-[11px] font-medium text-[#C2413B]">
                    <span className="size-1.5 rounded-full bg-[#C2413B]" />
                    Revoked
                  </span>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold capitalize text-[#172B4D]">
                  {activeAccount.label}
                  {normalizedLabel === "both" && (
                    <span className="ml-1.5 text-[10px] font-normal text-[#64748B]">
                      (Multi-inbox mode)
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-[#64748B]">
                  {activeAccount.email}
                </p>
              </div>

              {accounts.length > 1 && (
                <div className="pt-1 text-[11px] text-[#64748B]">
                  {accounts.length} linked Google accounts
                </div>
              )}
            </div>

            {/* Granted OAuth Scopes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[#172B4D]">
                  Granted Permissions
                </h3>
                <span className="text-[10px] text-[#64748B]">OAuth Scopes</span>
              </div>

              {scopes.length > 0 ? (
                <ul className="space-y-1.5">
                  {scopes.map((scope) => (
                    <li
                      className="flex items-center gap-2 rounded-lg border border-[#DCE4ED] bg-[#FFFFFF] px-2.5 py-2 text-xs text-[#172B4D]"
                      key={scope}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#15945B]/10 text-[#15945B]">
                        <Icon className="size-3" name="check" />
                      </span>
                      <span className="truncate">{formatScopeDisplayName(scope)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-[#DCE4ED] p-3 text-center text-xs text-[#64748B]">
                  No scopes granted yet.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-[#DCE4ED] p-5 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B]">
              <Icon className="size-5" name="google" />
            </div>
            <p className="mt-3 text-xs font-semibold text-[#172B4D]">
              No Google Account Connected
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#64748B]">
              Link your Google Account to enable Gmail, Calendar, and Google Docs orchestration.
            </p>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="border-t border-[#DCE4ED] pt-4">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#DCE4ED] bg-[#FFFFFF] px-3 py-2.5 text-xs font-semibold text-[#172B4D] transition hover:bg-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#315F85]/20"
          onClick={onOpenManageAccounts}
          type="button"
        >
          <Icon className="size-3.5" name="settings" />
          <span>Manage Accounts</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Panel */}
      {isOpen && (
        <aside
          id="right-account-panel"
          className="hidden w-72 shrink-0 border-l border-[#DCE4ED] bg-[#FFFFFF] lg:block"
        >
          {panelContent}
        </aside>
      )}

      {/* Mobile / Tablet Collapsible Drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${
          isOpen ? "block" : "pointer-events-none hidden"
        }`}
      >
        <button
          aria-label="Close account panel overlay"
          className={`fixed inset-0 bg-slate-950/20 backdrop-blur-[2px] transition-opacity ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={onClose}
          type="button"
        />
        <div
          id="right-account-drawer"
          className={`fixed inset-y-0 right-0 w-80 max-w-[85vw] border-l border-[#DCE4ED] bg-[#FFFFFF] shadow-xl transition-transform duration-300 ${
            isOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {panelContent}
        </div>
      </div>
    </>
  );
}
