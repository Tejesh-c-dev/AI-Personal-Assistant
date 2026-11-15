import { Icon } from "../ui/icons";
import { ActivityTimeline } from "./activity-timeline";
import { ApprovalCard } from "./approval-card";
import type { ApprovalActionResult } from "./chat-api";
import type { ApprovalPreviewData, ToolActivity } from "./chat-state";

type MessageProps = {
  role: "user" | "assistant";
  content: string;
  activities?: ToolActivity[];
  pendingApproval?: ApprovalPreviewData;
  isStreaming?: boolean;
  onConfirmApproval?: (approvalId: string) => Promise<ApprovalActionResult>;
  onRejectApproval?: (approvalId: string) => Promise<ApprovalActionResult>;
};

export function Message({
  role,
  content,
  activities,
  pendingApproval,
  isStreaming = false,
  onConfirmApproval,
  onRejectApproval,
}: MessageProps) {
  const isUser = role === "user";

  return (
    <article className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg border border-[#DCE4ED] bg-[#F1F5F9] text-[#315F85]">
          <Icon className="size-3.5" name="spark" />
        </div>
      )}
      <div
        className={`max-w-[min(85%,680px)] px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "rounded-2xl rounded-br-xs bg-[#315F85] text-white shadow-xs"
            : "rounded-2xl rounded-tl-xs border border-[#DCE4ED] bg-[#FFFFFF] text-[#172B4D] shadow-xs"
        }`}
      >
        {!isUser && activities && activities.length > 0 && (
          <ActivityTimeline activities={activities} isStreaming={isStreaming} />
        )}
        {(content || isStreaming) && (
          <div className="whitespace-pre-wrap break-words">
            {content}
            {isStreaming && (
              <span
                aria-label="streaming"
                className="inline-block ml-0.5 animate-pulse font-mono text-[#315F85] motion-reduce:animate-none"
              >
                ▋
              </span>
            )}
          </div>
        )}
        {!isUser && pendingApproval && (
          <ApprovalCard
            approval={pendingApproval}
            onConfirm={onConfirmApproval}
            onReject={onRejectApproval}
          />
        )}
      </div>
    </article>
  );
}

export function LoadingState() {
  return (
    <div aria-label="Assistant is thinking" className="flex items-center gap-2 text-xs text-[#64748B]">
      <span className="size-2 animate-pulse rounded-full bg-[#315F85] motion-reduce:animate-none" />
      <span>Thinking through that...</span>
    </div>
  );
}

type ErrorStateProps = { message?: string };

export function ErrorState({ message = "Something went wrong. Please try again." }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-xl border border-[#C2413B]/20 bg-[#C2413B]/10 px-4 py-3 text-sm text-[#C2413B]">
      {message}
    </div>
  );
}
