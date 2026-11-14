"use client";

import { useState } from "react";
import type { ApprovalPreviewData } from "./chat-state";

interface ApprovalCardProps {
  approval: ApprovalPreviewData;
  onConfirm?: (approvalId: string) => void;
  disabled?: boolean;
}

export function ApprovalCard({ approval, onConfirm, disabled = false }: ApprovalCardProps) {
  const [hasConfirmed, setHasConfirmed] = useState(false);

  const { operation, account, details } = approval;

  let title = "Action Requires Approval";
  let badgeColor = "bg-amber-100 text-amber-800 border-amber-200";

  switch (operation) {
    case "gmail.send":
      title = "Proposed Email";
      badgeColor = "bg-blue-100 text-blue-800 border-blue-200";
      break;
    case "calendar.create":
      title = "Proposed Calendar Event";
      badgeColor = "bg-purple-100 text-purple-800 border-purple-200";
      break;
    case "docs.create":
      title = "Proposed Google Document";
      badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-200";
      break;
    case "docs.insert":
      title = "Proposed Document Edit";
      badgeColor = "bg-indigo-100 text-indigo-800 border-indigo-200";
      break;
  }

  const handleConfirm = () => {
    if (disabled || hasConfirmed) return;
    setHasConfirmed(true);
    onConfirm?.(approval.approvalId);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeColor}`}>
            {title}
          </span>
          <span className="text-[11px] text-slate-500">Account: <strong className="text-slate-700 capitalize">{account}</strong></span>
        </div>
        <span className="text-[10px] text-slate-400">Approval ID: {approval.approvalId.slice(0, 8)}...</span>
      </div>

      <div className="space-y-2 p-3.5 text-xs text-slate-700">
        {operation === "gmail.send" && (
          <>
            <div>
              <span className="font-medium text-slate-500">To:</span> <span className="text-slate-900">{details.to}</span>
            </div>
            <div>
              <span className="font-medium text-slate-500">Subject:</span> <span className="font-medium text-slate-900">{details.subject}</span>
            </div>
            {details.bodyPreview && (
              <div className="mt-1 rounded-lg bg-slate-50 p-2 text-slate-600 border border-slate-100 whitespace-pre-wrap">
                {details.bodyPreview}
              </div>
            )}
          </>
        )}

        {operation === "calendar.create" && (
          <>
            <div>
              <span className="font-medium text-slate-500">Event Title:</span> <span className="font-medium text-slate-900">{details.summary}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="font-medium text-slate-500">Starts:</span> <span className="text-slate-800">{details.start}</span>
              </div>
              <div>
                <span className="font-medium text-slate-500">Ends:</span> <span className="text-slate-800">{details.end}</span>
              </div>
            </div>
          </>
        )}

        {operation === "docs.create" && (
          <div>
            <span className="font-medium text-slate-500">Document Title:</span> <span className="font-medium text-slate-900">{details.title}</span>
          </div>
        )}

        {operation === "docs.insert" && (
          <>
            <div>
              <span className="font-medium text-slate-500">Document ID:</span> <span className="font-mono text-[11px] text-slate-800">{details.documentId}</span>
            </div>
            {details.textPreview && (
              <div className="mt-1 rounded-lg bg-slate-50 p-2 text-slate-600 border border-slate-100 whitespace-pre-wrap font-mono text-[11px]">
                {details.textPreview}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-3.5 py-2.5">
        <p className="text-[11px] text-slate-400">
          Deterministic execution · Requires explicit confirmation
        </p>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={disabled || hasConfirmed}
          onClick={handleConfirm}
          type="button"
        >
          {hasConfirmed ? (
            <span>Confirmed</span>
          ) : (
            <>
              <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
              </svg>
              <span>Confirm & Execute</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
