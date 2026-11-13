import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { AccountManager } from "./account-manager";
import type { GoogleAccount } from "./account-api";

describe("AccountManager component", () => {
  const dummyAccounts: GoogleAccount[] = [
    {
      id: "acc-1",
      label: "personal",
      email: "alice@gmail.com",
      status: "active",
      grantedScopes: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "acc-2",
      label: "work",
      email: "alice@work.corp",
      status: "revoked",
      grantedScopes: ["https://www.googleapis.com/auth/documents"],
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    },
  ];

  it("renders nothing when isOpen is false", () => {
    const html = renderToString(
      <AccountManager
        accounts={dummyAccounts}
        error={null}
        isLoading={false}
        isOpen={false}
        onClose={() => {}}
        onRefresh={async () => {}}
      />,
    );
    expect(html).toBe("");
  });

  it("renders account list with label, email, status, and scopes", () => {
    const html = renderToString(
      <AccountManager
        accounts={dummyAccounts}
        error={null}
        isLoading={false}
        isOpen={true}
        onClose={() => {}}
        onRefresh={async () => {}}
      />,
    );

    expect(html).toContain("Google Account Management");
    expect(html).toContain("personal");
    expect(html).toContain("alice@gmail.com");
    expect(html).toContain("Connected");
    expect(html).toContain("Gmail (Read &amp; Modify)");
    expect(html).toContain("Calendar Events");

    expect(html).toContain("work");
    expect(html).toContain("alice@work.corp");
    expect(html).toContain("Revoked");
    expect(html).toContain("Google Docs");
  });

  it("renders loading state when isLoading is true", () => {
    const html = renderToString(
      <AccountManager
        accounts={[]}
        error={null}
        isLoading={true}
        isOpen={true}
        onClose={() => {}}
        onRefresh={async () => {}}
      />,
    );

    expect(html).toContain("animate-pulse");
  });

  it("renders empty state when there are no accounts", () => {
    const html = renderToString(
      <AccountManager
        accounts={[]}
        error={null}
        isLoading={false}
        isOpen={true}
        onClose={() => {}}
        onRefresh={async () => {}}
      />,
    );

    expect(html).toContain("No Google accounts linked");
    expect(html).toContain("Connect your first Google account below");
  });

  it("renders error state when error is passed", () => {
    const html = renderToString(
      <AccountManager
        accounts={[]}
        error="Network connection failure"
        isLoading={false}
        isOpen={true}
        onClose={() => {}}
        onRefresh={async () => {}}
      />,
    );

    expect(html).toContain("Network connection failure");
  });

  it("renders connect form with input and action button", () => {
    const html = renderToString(
      <AccountManager
        accounts={dummyAccounts}
        error={null}
        isLoading={false}
        isOpen={true}
        onClose={() => {}}
        onRefresh={async () => {}}
      />,
    );

    expect(html).toContain("Connect Another Google Account");
    expect(html).toContain("Connect with Google");
    expect(html).toContain("custom-account-label");
  });
});

