import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { ApprovalCard } from "./approval-card";
import type { ApprovalPreviewData } from "./chat-state";

const base: ApprovalPreviewData = {
  approvalId: "11111111-2222-4333-8444-555555555555",
  account: "work",
  operation: "gmail.send",
  expiresAt: "2026-11-15T00:00:00Z",
  details: { to: "recipient@example.com", subject: "Meeting follow-up", bodyPreview: "Thanks for meeting today." },
};
const actions = { onConfirm: vi.fn(async () => ({ status: "approved" as const })), onReject: vi.fn(async () => ({ status: "rejected" as const })) };

describe("ApprovalCard", () => {
  it("renders operation specific details and keeps the ID in technical details", () => {
    const html = renderToString(<ApprovalCard approval={base} {...actions} />);
    expect(html).toContain("Send email");
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("recipient@example.com");
    expect(html).toContain("Meeting follow-up");
    expect(html).toContain("Thanks for meeting today.");
    expect(html).toContain("Send email</button>");
    expect(html).toContain("Reject</button>");
    expect(html.slice(0, html.indexOf("<details"))).not.toContain(base.approvalId);
    expect(html.slice(html.indexOf("<details"))).toContain(base.approvalId);
    expect(html).toContain("Approval details");
    expect(html).toContain("Copy ID");
  });

  it.each([
    ["calendar.create", { summary: "Sprint Planning", date: "2026-11-15", start: "10:00", end: "11:00", timezone: "Asia/Calcutta", durationMinutes: "60" }, "Create calendar event", "Sprint Planning"],
    ["docs.create", { title: "Q4 Roadmap" }, "Create document", "Q4 Roadmap"],
    ["docs.insert", { documentName: "Project notes", textPreview: "Add this paragraph" }, "Insert document text", "Project notes"],
  ] as const)("renders %s without exposing internal document identifiers", (operation, details, title, expected) => {
    const approval = { ...base, operation, details } as ApprovalPreviewData;
    const html = renderToString(<ApprovalCard approval={approval} {...actions} />);
    expect(html).toContain(title);
    expect(html).toContain(expected);
    expect(html).not.toContain("documentId");
  });

  it.each([
    ["approved", "Approved"], ["rejected", "Rejected"], ["expired", "Expired"],
    ["failed", "Failed"], ["uncertain", "Execution uncertain"], ["confirming", "Confirming"],
  ] as const)("shows the backend %s state without actions", (status, label) => {
    const html = renderToString(<ApprovalCard approval={{ ...base, status }} {...actions} />);
    expect(html).toContain(label);
    expect(html).not.toContain("type=\"button\" disabled");
    expect(html).not.toContain("Reject</button>");
    expect(html).not.toContain("Send email</button>");
  });
});
