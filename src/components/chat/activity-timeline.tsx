"use client";

import { useState } from "react";
import type { ToolActivity } from "./chat-state";
import { Icon, type IconName } from "../ui/icons";

interface ActivityTimelineProps {
  activities: ToolActivity[];
  isStreaming?: boolean;
}

function getActionIcon(label: string): IconName {
  const normalized = label.toLowerCase();
  if (normalized.includes("gmail") || normalized.includes("email")) {
    return "mail";
  }
  if (normalized.includes("calendar") || normalized.includes("event")) {
    return "calendar";
  }
  if (normalized.includes("doc") || normalized.includes("document")) {
    return "doc";
  }
  if (normalized.includes("approval")) {
    return "shield";
  }
  return "spark";
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!activities || activities.length === 0) return null;

  const runningCount = activities.filter((a) => a.status === "running").length;
  const completedCount = activities.filter((a) => a.status === "completed").length;
  const failedCount = activities.filter((a) => a.status === "failed").length;
  const cancelledCount = activities.filter((a) => a.status === "cancelled").length;

  let summaryText = "";
  if (runningCount > 0) {
    const runningItem = activities.find((a) => a.status === "running");
    summaryText = runningItem ? `${runningItem.label}...` : "Working on your request...";
  } else if (failedCount > 0) {
    summaryText = `${completedCount} completed, ${failedCount} failed`;
  } else if (cancelledCount > 0) {
    summaryText = `${completedCount} completed, cancelled`;
  } else {
    summaryText = `${completedCount} ${completedCount === 1 ? "action" : "actions"} completed`;
  }

  return (
    <div className="mb-3 rounded-xl border border-[#DCE4ED] bg-[#F1F5F9] p-3 text-xs text-[#172B4D] transition">
      {/* Activity Header */}
      <button
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-2 text-left font-medium text-[#172B4D] hover:text-[#172B4D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#315F85]/40 rounded-lg"
        onClick={() => setIsExpanded((prev) => !prev)}
        type="button"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {runningCount > 0 ? (
            <span className="flex size-4 shrink-0 items-center justify-center">
              <svg
                className="size-3.5 animate-spin text-[#315F85]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  fill="currentColor"
                />
              </svg>
            </span>
          ) : failedCount > 0 ? (
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#C2413B]/10 text-[#C2413B]">
              <Icon className="size-3" name="alert" />
            </span>
          ) : (
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#15945B]/10 text-[#15945B]">
              <Icon className="size-3" name="check" />
            </span>
          )}
          <span className="truncate font-medium">{summaryText}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-[#64748B]">
          <span className="text-[11px] font-medium">
            {isExpanded ? "Hide details" : "View steps"}
          </span>
          <svg
            className={`size-3.5 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M19 9l-7 7-7-7"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        </div>
      </button>

      {/* Expandable Step-by-Step Breakdown */}
      {isExpanded && (
        <ul className="mt-3 space-y-1.5 border-t border-[#DCE4ED] pt-2.5">
          {activities.map((activity) => {
            const iconName = getActionIcon(activity.label);

            return (
              <li
                className="flex items-center justify-between gap-2 rounded-lg bg-[#FFFFFF] px-2.5 py-1.5 border border-[#DCE4ED]/60 text-[11px]"
                key={activity.id}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[#64748B]">
                    <Icon className="size-3.5" name={iconName} />
                  </span>
                  <span
                    className={`truncate ${
                      activity.status === "running"
                        ? "font-medium text-[#315F85]"
                        : activity.status === "failed"
                        ? "text-[#C2413B]"
                        : activity.status === "cancelled"
                        ? "text-[#64748B]"
                        : "text-[#172B4D]"
                    }`}
                  >
                    {activity.label}
                  </span>
                </div>

                <div className="shrink-0">
                  {activity.status === "running" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#315F85]">
                      <span className="size-1.5 animate-pulse rounded-full bg-[#315F85]" />
                      Running
                    </span>
                  )}
                  {activity.status === "completed" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#15945B]">
                      <Icon className="size-3" name="check" />
                      Completed
                    </span>
                  )}
                  {activity.status === "failed" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#C2413B]">
                      <Icon className="size-3" name="close" />
                      Failed
                    </span>
                  )}
                  {activity.status === "cancelled" && (
                    <span className="text-[10px] text-[#64748B]">Cancelled</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
