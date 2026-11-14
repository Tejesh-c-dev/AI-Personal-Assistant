import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractPendingApproval, mapToolToActivityLabel } from "./activity-mapper";

describe("activity-mapper", () => {
  it("maps known tool names to sanitized activity labels", () => {
    expect(mapToolToActivityLabel("personal_gmail_search")).toEqual({
      label: "Searching Gmail",
      category: "gmail",
    });
    expect(mapToolToActivityLabel("work_gmail_get")).toEqual({
      label: "Retrieving email",
      category: "gmail",
    });
    expect(mapToolToActivityLabel("personal_calendar_list")).toEqual({
      label: "Listing Calendar events",
      category: "calendar",
    });
    expect(mapToolToActivityLabel("work_calendar_get")).toEqual({
      label: "Retrieving Calendar event",
      category: "calendar",
    });
    expect(mapToolToActivityLabel("personal_docs_get")).toEqual({
      label: "Reading Google Doc",
      category: "docs",
    });
    expect(mapToolToActivityLabel("personal_docs_export")).toEqual({
      label: "Exporting Google Doc",
      category: "docs",
    });
    expect(mapToolToActivityLabel("personal_propose_send_email")).toEqual({
      label: "Preparing email approval",
      category: "gmail",
    });
    expect(mapToolToActivityLabel("personal_propose_create_calendar_event")).toEqual({
      label: "Preparing Calendar approval",
      category: "calendar",
    });
    expect(mapToolToActivityLabel("personal_propose_create_document")).toEqual({
      label: "Preparing document approval",
      category: "docs",
    });
    expect(mapToolToActivityLabel("personal_propose_insert_document_text")).toEqual({
      label: "Preparing document edit approval",
      category: "docs",
    });
    expect(mapToolToActivityLabel("unknown_custom_tool")).toEqual({
      label: "Executing action",
      category: "general",
    });
  });

  it("extracts pending email approval preview and redacts sensitive metadata", () => {
    const raw = {
      approvalId: "app-123",
      expiresAt: "2026-11-15T00:00:00Z",
      status: "pending_confirmation",
      confirmationInstruction: "CONFIRM app-123",
      internalToken: "secret-token",
      userId: "user-456",
      proposedEmail: {
        account: "personal",
        to: "alice@example.com",
        subject: "Budget update",
        bodyPreview: "Here is the budget...",
        googleAccountId: "internal-acc-id",
      },
    };

    const extracted = extractPendingApproval(raw);
    expect(extracted).toEqual({
      approvalId: "app-123",
      account: "personal",
      operation: "gmail.send",
      expiresAt: "2026-11-15T00:00:00Z",
      details: {
        to: "alice@example.com",
        subject: "Budget update",
        bodyPreview: "Here is the budget...",
      },
    });

    const serialized = JSON.stringify(extracted);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("user-456");
    expect(serialized).not.toContain("internal-acc-id");
  });

  it("extracts calendar, doc creation, and doc insertion proposals correctly", () => {
    const calendarRaw = {
      approvalId: "app-cal",
      expiresAt: "2026-11-15T00:00:00Z",
      status: "pending_confirmation",
      proposedEvent: {
        account: "work",
        calendarId: "primary",
        summary: "Sprint Sync",
        start: "2026-11-15T10:00:00Z",
        end: "2026-11-15T11:00:00Z",
      },
    };
    expect(extractPendingApproval(calendarRaw)).toEqual({
      approvalId: "app-cal",
      account: "work",
      operation: "calendar.create",
      expiresAt: "2026-11-15T00:00:00Z",
      details: {
        calendarId: "primary",
        summary: "Sprint Sync",
        start: "2026-11-15T10:00:00Z",
        end: "2026-11-15T11:00:00Z",
      },
    });

    const docRaw = {
      approvalId: "app-doc",
      expiresAt: "2026-11-15T00:00:00Z",
      status: "pending_confirmation",
      proposedDocument: { account: "work", title: "Q4 Roadmap" },
    };
    expect(extractPendingApproval(docRaw)).toEqual({
      approvalId: "app-doc",
      account: "work",
      operation: "docs.create",
      expiresAt: "2026-11-15T00:00:00Z",
      details: { title: "Q4 Roadmap" },
    });

    const insertRaw = {
      approvalId: "app-ins",
      expiresAt: "2026-11-15T00:00:00Z",
      status: "pending_confirmation",
      proposedInsertion: { account: "personal", documentId: "doc-99", textPreview: "Hello" },
    };
    expect(extractPendingApproval(insertRaw)).toEqual({
      approvalId: "app-ins",
      account: "personal",
      operation: "docs.insert",
      expiresAt: "2026-11-15T00:00:00Z",
      details: { documentId: "doc-99", textPreview: "Hello" },
    });
  });

  it("returns null for non-approval responses", () => {
    expect(extractPendingApproval(null)).toBeNull();
    expect(extractPendingApproval({})).toBeNull();
    expect(extractPendingApproval({ status: "done" })).toBeNull();
    expect(extractPendingApproval({ approvalId: "123", status: "rejected" })).toBeNull();
  });
});

