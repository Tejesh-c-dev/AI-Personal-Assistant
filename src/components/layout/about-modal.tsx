"use client";

import { Icon } from "../ui/icons";

type AboutModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  if (!isOpen) return null;

  return (
    <div
      aria-labelledby="about-modal-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-[#DCE4ED] bg-[#FFFFFF] p-6 shadow-xl sm:p-7">
        <div className="flex items-start justify-between border-b border-[#DCE4ED] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[#172B4D] text-sm font-bold text-white">
              A
            </div>
            <div>
              <h2
                className="text-base font-bold tracking-tight text-[#172B4D]"
                id="about-modal-title"
              >
                AI Personal Assistant
              </h2>
              <p className="text-xs text-[#64748B]">Enterprise Productivity Assistant</p>
            </div>
          </div>
          <button
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-[#64748B] transition hover:bg-[#F1F5F9] hover:text-[#172B4D]"
            onClick={onClose}
            type="button"
          >
            <Icon className="size-5" name="close" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto py-4 text-xs leading-relaxed text-[#172B4D]">
          <p>
            AI Personal Assistant is an enterprise-grade intelligent assistant designed for seamless,
            secure Google Workspace orchestration across Gmail, Google Calendar, and Google Docs.
          </p>

          <div className="rounded-xl border border-[#DCE4ED] bg-[#F1F5F9] p-3 space-y-2">
            <div className="font-semibold text-[#172B4D]">Core Principles</div>
            <ul className="space-y-1.5 text-[#64748B]">
              <li className="flex items-start gap-2">
                <span className="text-[#15945B] font-bold">✓</span>
                <span>
                  <strong className="text-[#172B4D]">Deterministic Confirmation:</strong> Write operations
                  (sending emails, scheduling events, creating documents) strictly require your explicit confirmation.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#15945B] font-bold">✓</span>
                <span>
                  <strong className="text-[#172B4D]">Privacy Preserving:</strong> Read tools retrieve only relevant summaries without exposing internal prompts, private tokens, or hidden reasoning.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#15945B] font-bold">✓</span>
                <span>
                  <strong className="text-[#172B4D]">Dynamic Multi-Account:</strong> Flexible routing between personal, corporate, or combined Google Workspace inboxes.
                </span>
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-between pt-2 text-[11px] text-[#64748B]">
            <span>Version 0.1.0 (Enterprise)</span>
            <span>Next.js 16 • Google ADK</span>
          </div>
        </div>

        <div className="border-t border-[#DCE4ED] pt-3 text-right">
          <button
            className="rounded-lg bg-[#315F85] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#264D70]"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
