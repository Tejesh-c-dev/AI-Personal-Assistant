import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { ActivityTimeline } from "./activity-timeline";
import type { ToolActivity } from "./chat-state";

describe("ActivityTimeline", () => {
  it("renders empty string when activities array is empty", () => {
    const html = renderToString(<ActivityTimeline activities={[]} />);
    expect(html).toBe("");
  });

  it("renders summary text and action count", () => {
    const activities: ToolActivity[] = [
      { id: "1", label: "Searching Gmail", status: "completed" },
      { id: "2", label: "Retrieving email", status: "completed" },
    ];

    const html = renderToString(<ActivityTimeline activities={activities} />);
    expect(html).toContain("2 actions completed");
    expect(html).toContain("View steps");
  });

  it("renders running activity in progress", () => {
    const activities: ToolActivity[] = [
      { id: "1", label: "Searching Gmail", status: "running" },
    ];

    const html = renderToString(<ActivityTimeline activities={activities} isStreaming={true} />);
    expect(html).toContain("Searching Gmail...");
  });

  it("renders failure summary when an activity failed", () => {
    const activities: ToolActivity[] = [
      { id: "1", label: "Searching Gmail", status: "completed" },
      { id: "2", label: "Reading Doc", status: "failed" },
    ];

    const html = renderToString(<ActivityTimeline activities={activities} />);
    expect(html).toContain("1 completed, 1 failed");
  });
});
