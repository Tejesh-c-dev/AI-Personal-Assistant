"use client";

import { useState } from "react";

import {
  type GoogleAccount,
  disconnectAccount,
  renameAccount,
  validateAccountLabelClient,
} from "./account-api";
import { Icon } from "../ui/icons";

type AccountManagerProps = {
  isOpen: boolean;
  onClose: () => void;
  accounts: GoogleAccount[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<unknown>;
  onAccountRenamed?: (oldLabel: string, newLabel: string) => void;
  onAccountDisconnected?: (label: string) => void;
};

function formatScopeName(scope: string): string {
  if (scope.includes("gmail.modify")) return "Gmail (Read & Modify)";
  if (scope.includes("gmail.send")) return "Gmail (Send)";
  if (scope.includes("calendar.events")) return "Calendar Events";
  if (scope.includes("documents")) return "Google Docs";
  if (scope.includes("drive.readonly")) return "Google Drive (Read)";
  const parts = scope.split("/");
  return parts[parts.length - 1] || scope;
}

export function AccountManager({
  isOpen,
  onClose,
  accounts,
  isLoading,
  error: globalError,
  onRefresh,
  onAccountRenamed,
  onAccountDisconnected,
}: AccountManagerProps) {
  const [newLabel, setNewLabel] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isSubmittingConnect, setIsSubmittingConnect] = useState(false);

  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const [confirmDisconnectLabel, setConfirmDisconnectLabel] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartRename = (account: GoogleAccount) => {
    setEditingLabel(account.label);
    setRenameValue(account.label);
    setRenameError(null);
    setActionSuccess(null);
    setActionError(null);
  };

  const handleCancelRename = () => {
    setEditingLabel(null);
    setRenameValue("");
    setRenameError(null);
  };

  const handleSaveRename = async (oldLabel: string) => {
    const validation = validateAccountLabelClient(renameValue);
    if (!validation.valid) {
      setRenameError(validation.error ?? "Invalid label.");
      return;
    }

    if (validation.normalized === oldLabel.toLowerCase()) {
      handleCancelRename();
      return;
    }

    const alreadyExists = accounts.some(
      (acc) => acc.label.toLowerCase() === validation.normalized && acc.label.toLowerCase() !== oldLabel.toLowerCase(),
    );
    if (alreadyExists) {
      setRenameError(`An account with the label "${validation.normalized}" already exists.`);
      return;
    }

    setIsRenaming(true);
    setRenameError(null);
    try {
      await renameAccount(oldLabel, validation.normalized);
      setActionSuccess(`Account "${oldLabel}" renamed to "${validation.normalized}".`);
      setEditingLabel(null);
      await onRefresh();
      onAccountRenamed?.(oldLabel, validation.normalized);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Failed to rename account.");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleConfirmDisconnect = async (label: string) => {
    setIsDisconnecting(true);
    setActionError(null);
    try {
      await disconnectAccount(label);
      setActionSuccess(`Account "${label}" disconnected successfully.`);
      setConfirmDisconnectLabel(null);
      await onRefresh();
      onAccountDisconnected?.(label);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to disconnect account.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateAccountLabelClient(newLabel);
    if (!validation.valid) {
      setConnectError(validation.error ?? "Invalid label.");
      return;
    }

    const alreadyExists = accounts.some(
      (acc) => acc.label.toLowerCase() === validation.normalized,
    );
    if (alreadyExists) {
      setConnectError(`An account with the label "${validation.normalized}" is already connected.`);
      return;
    }

    setIsSubmittingConnect(true);
    setConnectError(null);

    // Trigger OAuth redirect via standard POST form submission
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/accounts/${encodeURIComponent(validation.normalized)}/connect`;
    document.body.appendChild(form);
    form.submit();
  };

  return (
    <div
      aria-labelledby="account-manager-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xl sm:p-8">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-5">
          <div>
            <h2
              className="text-xl font-bold tracking-tight text-slate-900"
              id="account-manager-title"
            >
              Google Account Management
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Manage connected Google accounts, grant permissions, and link additional inboxes.
            </p>
          </div>
          <button
            aria-label="Close dialog"
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            type="button"
          >
            <Icon className="size-5" name="close" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-6 overflow-y-auto py-5">
          {/* Notifications */}
          {globalError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {globalError}
            </div>
          )}
          {actionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              {actionSuccess}
            </div>
          )}

          {/* Connected Accounts Section */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Connected Accounts ({accounts.length})
              </h3>
              <button
                className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                disabled={isLoading}
                onClick={() => void onRefresh()}
                type="button"
              >
                <Icon className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} name="refresh" />
                Refresh
              </button>
            </div>

            {/* Loading State */}
            {isLoading && (
              <div className="mt-3 space-y-3">
                <div className="animate-pulse rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="h-4 w-1/3 rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-slate-200" />
                  <div className="mt-3 h-5 w-2/3 rounded bg-slate-200" />
                </div>
              </div>
            )}

            {/* Empty State */}
            {!isLoading && accounts.length === 0 && (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                  <Icon className="size-5" name="inbox" />
                </div>
                <h4 className="mt-3 text-sm font-semibold text-slate-800">No Google accounts linked</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Connect your first Google account below to give your assistant access to emails, calendar, and documents.
                </p>
              </div>
            )}

            {/* Account List */}
            {!isLoading && accounts.length > 0 && (
              <div className="mt-3 space-y-3">
                {accounts.map((acc) => {
                  const isEditing = editingLabel === acc.label;
                  const isConfirmingDisconnect = confirmDisconnectLabel === acc.label;

                  return (
                    <div
                      className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition hover:border-slate-300"
                      key={acc.id}
                    >
                      {/* Header row: Label & Status & Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {isEditing ? (
                          <div className="flex flex-1 items-center gap-2">
                            <input
                              aria-label="New account label"
                              className="h-8 rounded-lg border border-blue-400 px-2.5 text-xs font-semibold text-slate-800 outline-none ring-2 ring-blue-100"
                              disabled={isRenaming}
                              onChange={(e) => setRenameValue(e.target.value)}
                              placeholder="new-label"
                              value={renameValue}
                            />
                            <button
                              aria-label="Save label"
                              className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                              disabled={isRenaming}
                              onClick={() => void handleSaveRename(acc.label)}
                              type="button"
                            >
                              <Icon className="size-4" name="check" />
                            </button>
                            <button
                              aria-label="Cancel rename"
                              className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                              disabled={isRenaming}
                              onClick={handleCancelRename}
                              type="button"
                            >
                              <Icon className="size-4" name="close" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <span className="font-semibold text-slate-900 capitalize">
                              {acc.label}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                acc.status === "active"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                              }`}
                            >
                              <span
                                className={`size-1.5 rounded-full ${
                                  acc.status === "active" ? "bg-emerald-500" : "bg-amber-500"
                                }`}
                              />
                              {acc.status === "active" ? "Connected" : "Revoked"}
                            </span>
                          </div>
                        )}

                        {!isEditing && !isConfirmingDisconnect && (
                          <div className="flex items-center gap-1">
                            <button
                              aria-label={`Rename ${acc.label}`}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              onClick={() => handleStartRename(acc)}
                              type="button"
                            >
                              <Icon className="size-3.5" name="edit" />
                              Rename
                            </button>
                            <button
                              aria-label={`Disconnect ${acc.label}`}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 hover:text-red-700"
                              onClick={() => setConfirmDisconnectLabel(acc.label)}
                              type="button"
                            >
                              <Icon className="size-3.5" name="trash" />
                              Disconnect
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Rename error if present */}
                      {isEditing && renameError && (
                        <p className="mt-1.5 text-[11px] text-red-600">{renameError}</p>
                      )}

                      {/* Email row */}
                      <p className="mt-1 text-xs text-slate-500 font-mono">{acc.email}</p>

                      {/* Granted Scopes */}
                      <div className="mt-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Granted Scopes:
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {acc.grantedScopes && acc.grantedScopes.length > 0 ? (
                            acc.grantedScopes.map((scope) => (
                              <span
                                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                                key={scope}
                                title={scope}
                              >
                                {formatScopeName(scope)}
                              </span>
                            ))
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">
                              No additional scopes granted
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Disconnect confirmation dialog */}
                      {isConfirmingDisconnect && (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50/70 p-3">
                          <p className="text-xs font-medium text-red-900">
                            Disconnect &quot;{acc.label}&quot;?
                          </p>
                          <p className="mt-0.5 text-[11px] text-red-700">
                            This will revoke the assistant&apos;s access to this Google inbox. You can reconnect anytime.
                          </p>
                          <div className="mt-2.5 flex items-center gap-2">
                            <button
                              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
                              disabled={isDisconnecting}
                              onClick={() => void handleConfirmDisconnect(acc.label)}
                              type="button"
                            >
                              {isDisconnecting ? "Disconnecting..." : "Confirm Disconnect"}
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              disabled={isDisconnecting}
                              onClick={() => setConfirmDisconnectLabel(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add Account Section */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
            <h3 className="text-sm font-semibold text-slate-900">Connect Another Google Account</h3>
            <p className="mt-1 text-xs text-slate-500">
              Provide a label (e.g. <code className="text-slate-700">work</code>,{" "}
              <code className="text-slate-700">client-a</code>,{" "}
              <code className="text-slate-700">personal</code>) to organize your inboxes.
            </p>

            <form className="mt-4" onSubmit={handleConnectSubmit}>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="sr-only" htmlFor="custom-account-label">
                    Account Label
                  </label>
                  <input
                    aria-label="Account Label"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    disabled={isSubmittingConnect}
                    id="custom-account-label"
                    onChange={(e) => {
                      setNewLabel(e.target.value);
                      if (connectError) setConnectError(null);
                    }}
                    placeholder="e.g. work, side-project, personal"
                    value={newLabel}
                  />
                </div>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1d5bd7] disabled:opacity-50 disabled:pointer-events-none"
                  disabled={isSubmittingConnect || !newLabel.trim()}
                  type="submit"
                >
                  <Icon className="size-4" name="plus" />
                  {isSubmittingConnect ? "Redirecting..." : "Connect with Google"}
                </button>
              </div>

              {connectError && (
                <p className="mt-2 text-[11px] font-medium text-red-600">{connectError}</p>
              )}

              <p className="mt-3 text-[11px] text-slate-400">
                You will be redirected to Google to authenticate and authorize Gmail, Calendar, and Docs scopes.
              </p>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 pt-4 flex justify-end">
          <button
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
