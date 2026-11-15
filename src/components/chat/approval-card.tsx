"use client";

import { useRef, useState } from "react";
import type { ApprovalActionResult } from "./chat-api";
import type { ApprovalPreviewData, ApprovalStatus } from "./chat-state";
import { copyApprovalId, createApprovalActionLock } from "./approval-action";

interface ApprovalCardProps {
  approval: ApprovalPreviewData;
  onConfirm?: (approvalId: string) => Promise<ApprovalActionResult>;
  onReject?: (approvalId: string) => Promise<ApprovalActionResult>;
}

const statusLabels: Record<ApprovalStatus, string> = {
  pending: "Awaiting approval",
  confirming: "Confirming",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  failed: "Failed",
  uncertain: "Execution uncertain",
  unavailable: "Unavailable",
};

const operationLabels = {
  "gmail.send": { title: "Send email", confirm: "Send email", icon: "✉" },
  "calendar.create": { title: "Create calendar event", confirm: "Create event", icon: "▦" },
  "docs.create": { title: "Create document", confirm: "Create document", icon: "▤" },
  "docs.insert": { title: "Insert document text", confirm: "Insert text", icon: "¶" },
} as const;

export function ApprovalCard({ approval, onConfirm, onReject }: ApprovalCardProps) {
  const [busyAction, setBusyAction] = useState<"confirm" | "reject" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<ApprovalStatus | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const actionLock = useRef(createApprovalActionLock());
  const status = localStatus ?? approval.status ?? "pending";
  const operation = operationLabels[approval.operation];
  const settled = status !== "pending";
  const canAct = status === "pending" && Boolean(onConfirm && onReject);
  const statusStyle = status === "approved" ? "text-emerald-700 bg-emerald-50" : status === "rejected" || status === "failed" || status === "uncertain" ? "text-rose-700 bg-rose-50" : status === "pending" ? "text-amber-800 bg-amber-50" : "text-slate-600 bg-slate-100";

  const runAction = async (action: "confirm" | "reject") => {
    if (!canAct || !actionLock.current.acquire()) return;
    setBusyAction(action);
    setActionError(null);
    try {
      const result = await (action === "confirm" ? onConfirm : onReject)!(approval.approvalId);
      setLocalStatus(result.status);
      if (result.error) setActionError(result.error);
    } catch (error) {
      setLocalStatus("uncertain");
      setActionError(error instanceof Error ? error.message : "The approval status could not be verified.");
    } finally {
      actionLock.current.release();
      setBusyAction(null);
    }
  };

  const copyId = async () => {
    try {
      await copyApprovalId(approval.approvalId, navigator.clipboard);
      setCopyMessage("Approval ID copied.");
    } catch {
      setCopyMessage("Copy is unavailable in this browser.");
    }
  };

  return (
    <section aria-label={`${operation.title} approval`} className="mt-3 overflow-hidden rounded-xl border border-[#CBD5E1] bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE4ED] bg-[#F1F5F9] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-white text-base text-[#315F85] shadow-xs">{operation.icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-[#172B4D]">{operation.title}</h3>
            <p className="text-[11px] text-[#64748B]">Google account: <span className="font-medium capitalize text-[#334155]">{approval.account}</span></p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle}`}>
          <span aria-hidden="true">{status === "approved" ? "✓" : status === "rejected" || status === "failed" ? "×" : status === "pending" ? "◷" : status === "confirming" ? "…" : "!"}</span>
          {statusLabels[status]}
        </span>
      </header>

      <div className="space-y-2.5 p-4 text-xs text-[#334155]">
        {approval.operation === "gmail.send" && <>
          <p><span className="font-medium text-[#64748B]">To</span><span className="ml-2 break-all">{approval.details.to || "—"}</span></p>
          <p><span className="font-medium text-[#64748B]">Subject</span><span className="ml-2 font-medium">{approval.details.subject || "(no subject)"}</span></p>
          {approval.details.bodyPreview && <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">{approval.details.bodyPreview}</p>}
        </>}
        {approval.operation === "calendar.create" && <>
          <p className="font-semibold text-[#172B4D]">{approval.details.summary || "Calendar event"}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <p><span className="text-[#64748B]">Date</span><br />{approval.details.date || approval.details.start?.slice(0, 10) || "—"}</p>
            <p><span className="text-[#64748B]">Timezone</span><br />{approval.details.timezone || "—"}</p>
            <p><span className="text-[#64748B]">Starts</span><br />{approval.details.start || "—"}</p>
            <p><span className="text-[#64748B]">Ends</span><br />{approval.details.end || "—"}</p>
          </div>
          {approval.details.durationMinutes && <p><span className="text-[#64748B]">Duration</span><span className="ml-2">{approval.details.durationMinutes} minutes</span></p>}
        </>}
        {approval.operation === "docs.create" && <p><span className="text-[#64748B]">Document</span><span className="ml-2 font-medium">{approval.details.title || "Untitled document"}</span></p>}
        {approval.operation === "docs.insert" && <>
          <p><span className="text-[#64748B]">Document</span><span className="ml-2 font-medium">{approval.details.documentName || "Google document"}</span></p>
          {approval.details.textPreview && <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">{approval.details.textPreview}</p>}
        </>}
      </div>

      {approval.result && <p className="border-t border-[#DCE4ED] bg-emerald-50/70 px-4 py-3 text-xs text-emerald-800">{approval.result}</p>}
      {status === "uncertain" && <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">The request may have reached Google. Check the account before taking further action.</p>}
      {actionError && <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">{actionError}</p>}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DCE4ED] bg-slate-50/70 px-4 py-3">
        {canAct ? <div className="flex items-center gap-2">
          <button type="button" disabled={busyAction !== null} onClick={() => void runAction("confirm")} className="rounded-lg bg-[#315F85] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#244966] disabled:cursor-wait disabled:opacity-60">
            {busyAction === "confirm" ? "Working…" : operation.confirm}
          </button>
          <button type="button" disabled={busyAction !== null} onClick={() => void runAction("reject")} className="rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#475569] transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60">
            {busyAction === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </div> : <span className="text-[11px] text-[#64748B]">{settled ? statusLabels[status] : "Approval action unavailable"}</span>}
        <details className="group text-xs">
          <summary className="cursor-pointer list-none font-medium text-[#315F85] hover:underline">Approval details</summary>
          <div className="absolute z-10 mt-2 w-64 rounded-lg border border-[#CBD5E1] bg-white p-3 shadow-lg">
            <p className="break-all font-mono text-[11px] text-[#475569]">{approval.approvalId}</p>
            <button className="mt-2 rounded-md border border-[#DCE4ED] px-2 py-1 text-[11px] font-medium text-[#315F85] hover:bg-slate-50" onClick={() => void copyId()} type="button">Copy ID</button>
            <span aria-live="polite" className="ml-2 text-[11px] text-[#64748B]">{copyMessage}</span>
          </div>
        </details>
      </footer>
    </section>
  );
}
