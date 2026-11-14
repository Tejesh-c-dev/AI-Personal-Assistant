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
  let badgeColor = "bg-[#B7791F]/10 text-[#B7791F] border-[#B7791F]/25";

  switch (operation) {
    case "gmail.send":
      title = "Proposed Email";
      badgeColor = "bg-[#315F85]/10 text-[#315F85] border-[#315F85]/25";
      break;
    case "calendar.create":
      title = "Proposed Calendar Event";
      badgeColor = "bg-[#315F85]/10 text-[#315F85] border-[#315F85]/25";
      break;
    case "docs.create":
      title = "Proposed Google Document";
      badgeColor = "bg-[#315F85]/10 text-[#315F85] border-[#315F85]/25";
      break;
    case "docs.insert":
      title = "Proposed Document Edit";
      badgeColor = "bg-[#315F85]/10 text-[#315F85] border-[#315F85]/25";
      break;
  }

  const handleConfirm = () => {
    if (disabled || hasConfirmed) return;
    setHasConfirmed(true);
    onConfirm?.(approval.approvalId);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[#DCE4ED] bg-[#FFFFFF] shadow-xs">
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-[#DCE4ED] bg-[#F1F5F9] px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeColor}`}>
            {title}
          </span>
          <span className="text-[11px] text-[#64748B]">
            Account: <strong className="text-[#172B4D] capitalize">{account}</strong>
          </span>
        </div>
        <span className="text-[10px] text-[#64748B]">Approval ID: {approval.approvalId.slice(0, 8)}...</span>
      </div>

      {/* Details Body */}
      <div className="space-y-2 p-3.5 text-xs text-[#172B4D]">
        {operation === "gmail.send" && (
          <>
            <div>
              <span className="font-medium text-[#64748B]">To:</span> <span className="text-[#172B4D]">{details.to}</span>
            </div>
            <div>
              <span className="font-medium text-[#64748B]">Subject:</span> <span className="font-medium text-[#172B4D]">{details.subject}</span>
            </div>
            {details.bodyPreview && (
              <div className="mt-1 rounded-lg bg-[#F1F5F9] p-2.5 text-[#172B4D] border border-[#DCE4ED] whitespace-pre-wrap">
                {details.bodyPreview}
              </div>
            )}
          </>
        )}

        {operation === "calendar.create" && (
          <>
            <div>
              <span className="font-medium text-[#64748B]">Event Title:</span> <span className="font-medium text-[#172B4D]">{details.summary}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="font-medium text-[#64748B]">Starts:</span> <span className="text-[#172B4D]">{details.start}</span>
              </div>
              <div>
                <span className="font-medium text-[#64748B]">Ends:</span> <span className="text-[#172B4D]">{details.end}</span>
              </div>
            </div>
          </>
        )}

        {operation === "docs.create" && (
          <div>
            <span className="font-medium text-[#64748B]">Document Title:</span> <span className="font-medium text-[#172B4D]">{details.title}</span>
          </div>
        )}

        {operation === "docs.insert" && (
          <>
            <div>
              <span className="font-medium text-[#64748B]">Document ID:</span> <span className="font-mono text-[11px] text-[#172B4D]">{details.documentId}</span>
            </div>
            {details.textPreview && (
              <div className="mt-1 rounded-lg bg-[#F1F5F9] p-2.5 text-[#172B4D] border border-[#DCE4ED] whitespace-pre-wrap font-mono text-[11px]">
                {details.textPreview}
              </div>
            )}
          </>
        )}
      </div>

      {/* Execution Footer */}
      <div className="flex items-center justify-between border-t border-[#DCE4ED] bg-[#F1F5F9]/60 px-3.5 py-2.5">
        <p className="text-[11px] text-[#64748B]">
          Deterministic execution · Requires explicit confirmation
        </p>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#15945B] px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#127b4b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#15945B]/40 disabled:cursor-not-allowed disabled:bg-[#DCE4ED] disabled:text-[#64748B]"
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
