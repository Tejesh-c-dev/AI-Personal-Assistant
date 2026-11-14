"use client";

import { useState } from "react";
import type { ToolActivity } from "./chat-state";

interface ActivityTimelineProps {
  activities: ToolActivity[];
  isStreaming?: boolean;
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
    summaryText = runningItem ? `${runningItem.label}...` : "Working...";
  } else if (failedCount > 0) {
    summaryText = `${completedCount} completed, ${failedCount} failed`;
  } else if (cancelledCount > 0) {
    summaryText = `${completedCount} completed, cancelled`;
  } else {
    summaryText = `${completedCount} ${completedCount === 1 ? "action" : "actions"} completed`;
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 text-xs text-slate-600 transition">
      <button
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-2 text-left font-medium text-slate-700 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        onClick={() => setIsExpanded((prev) => !prev)}
        type="button"
      >
        <div className="flex items-center gap-2 min-w-0">
          {runningCount > 0 ? (
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none" />
          ) : failedCount > 0 ? (
            <span className="size-2 shrink-0 rounded-full bg-red-500" />
          ) : (
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
          )}
          <span className="truncate">{summaryText}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 text-slate-400">
          <span>{isExpanded ? "Hide details" : "View steps"}</span>
          <svg
            className={`size-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <ul className="mt-2.5 space-y-1.5 border-t border-slate-200/60 pt-2">
          {activities.map((activity) => (
            <li className="flex items-center gap-2 text-[11px]" key={activity.id}>
              {activity.status === "running" && (
                <svg
                  className="size-3.5 shrink-0 animate-spin text-blue-500 motion-reduce:animate-none"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    fill="currentColor"
                  />
                </svg>
              )}
              {activity.status === "completed" && (
                <svg className="size-3.5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
                </svg>
              )}
              {activity.status === "failed" && (
                <svg className="size-3.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
                </svg>
              )}
              {activity.status === "cancelled" && (
                <svg className="size-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M20 12H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
              )}
              <span
                className={`truncate ${
                  activity.status === "running"
                    ? "font-medium text-blue-700"
                    : activity.status === "failed"
                    ? "text-red-700"
                    : activity.status === "cancelled"
                    ? "text-slate-400"
                    : "text-slate-700"
                }`}
              >
                {activity.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
