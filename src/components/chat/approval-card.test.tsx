import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { ApprovalCard } from "./approval-card";
import type { ApprovalPreviewData } from "./chat-state";

describe("ApprovalCard", () => {
  const approval: ApprovalPreviewData = {
    approvalId: "app-test-uuid-1234",
    account: "personal",
    operation: "gmail.send",
    expiresAt: "2026-11-15T00:00:00Z",
    details: {
      to: "recipient@example.com",
      subject: "Meeting Follow-up",
      bodyPreview: "Thanks for meeting today.",
    },
  };

  it("renders email proposal details cleanly", () => {
    const html = renderToString(<ApprovalCard approval={approval} />);

    expect(html).toContain("Proposed Email");
    expect(html).toContain("recipient@example.com");
    expect(html).toContain("Meeting Follow-up");
    expect(html).toContain("Thanks for meeting today.");
    expect(html).toContain("Confirm &amp; Execute");
    expect(html).toContain("app-test");
  });

  it("renders calendar proposal details cleanly", () => {
    const calApproval: ApprovalPreviewData = {
      approvalId: "app-cal-5678",
      account: "work",
      operation: "calendar.create",
      expiresAt: "2026-11-15T00:00:00Z",
      details: {
        summary: "Sprint Planning",
        start: "2026-11-15T10:00:00Z",
        end: "2026-11-15T11:00:00Z",
      },
    };

    const html = renderToString(<ApprovalCard approval={calApproval} />);
    expect(html).toContain("Proposed Calendar Event");
    expect(html).toContain("Sprint Planning");
    expect(html).toContain("2026-11-15T10:00:00Z");
  });

  it("renders disabled state when disabled prop is true", () => {
    const html = renderToString(<ApprovalCard approval={approval} disabled={true} />);
    expect(html).toContain("disabled");
  });
});
