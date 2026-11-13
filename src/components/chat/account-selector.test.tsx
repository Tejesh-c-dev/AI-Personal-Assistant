import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { AccountSelector } from "./account-selector";

describe("AccountSelector component", () => {
  it("renders dynamic accounts with labels and emails", () => {
    const accounts = [
      { label: "personal", detail: "alice@gmail.com" },
      { label: "work", detail: "work@company.com" },
    ];

    const html = renderToString(
      <AccountSelector accounts={accounts} onChange={() => {}} value="personal" />,
    );

    expect(html).toContain("Personal · alice@gmail.com");
    expect(html).toContain("Work · work@company.com");
    expect(html).toContain("Both · All inboxes");
  });

  it("does not render 'Both' option if only one account exists", () => {
    const accounts = [{ label: "solo", detail: "solo@example.com" }];

    const html = renderToString(
      <AccountSelector accounts={accounts} onChange={() => {}} value="solo" />,
    );

    expect(html).toContain("Solo · solo@example.com");
    expect(html).not.toContain("Both · All inboxes");
  });

  it("renders empty state option when no accounts are connected", () => {
    const html = renderToString(
      <AccountSelector accounts={[]} isLoading={false} onChange={() => {}} value="" />,
    );

    expect(html).toContain("No accounts connected");
  });

  it("renders loading state option when accounts are loading", () => {
    const html = renderToString(
      <AccountSelector accounts={[]} isLoading={true} onChange={() => {}} value="" />,
    );

    expect(html).toContain("Loading accounts...");
  });

  it("preserves initial value option if value is not yet in options", () => {
    const accounts = [{ label: "work", detail: "work@example.com" }];

    const html = renderToString(
      <AccountSelector accounts={accounts} onChange={() => {}} value="personal" />,
    );

    expect(html).toContain("Personal");
    expect(html).toContain("Work · work@example.com");
  });
});

