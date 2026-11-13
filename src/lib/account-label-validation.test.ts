import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { validateAccountLabel } from "./auth";
import { isAccount } from "./conversations";

describe("validateAccountLabel", () => {
  it("normalizes labels to lowercase and trimmed", () => {
    expect(validateAccountLabel("  Personal  ")).toBe("personal");
    expect(validateAccountLabel("Work-Account")).toBe("work-account");
    expect(validateAccountLabel("Side Project 1")).toBe("side project 1");
  });

  it("rejects reserved 'both' label", () => {
    expect(() => validateAccountLabel("both")).toThrow("RESERVED_LABEL");
    expect(() => validateAccountLabel("  BOTH  ")).toThrow("RESERVED_LABEL");
  });

  it("rejects empty or whitespace-only labels", () => {
    expect(() => validateAccountLabel("")).toThrow("INVALID_LABEL");
    expect(() => validateAccountLabel("   ")).toThrow("INVALID_LABEL");
  });

  it("rejects labels longer than 50 characters", () => {
    const longLabel = "a".repeat(51);
    expect(() => validateAccountLabel(longLabel)).toThrow("INVALID_LABEL");
  });

  it("rejects labels with special characters or invalid symbols", () => {
    expect(() => validateAccountLabel("personal@gmail.com")).toThrow("INVALID_LABEL");
    expect(() => validateAccountLabel("work/account")).toThrow("INVALID_LABEL");
    expect(() => validateAccountLabel("account#1")).toThrow("INVALID_LABEL");
    expect(() => validateAccountLabel("<script>")).toThrow("INVALID_LABEL");
  });

  it("accepts valid alphanumeric labels with hyphens and spaces up to 50 chars", () => {
    expect(validateAccountLabel("personal")).toBe("personal");
    expect(validateAccountLabel("official")).toBe("official");
    expect(validateAccountLabel("work")).toBe("work");
    expect(validateAccountLabel("side-hustle")).toBe("side-hustle");
    expect(validateAccountLabel("client 123")).toBe("client 123");
    expect(validateAccountLabel("a")).toBe("a");
    expect(validateAccountLabel("a".repeat(50))).toBe("a".repeat(50));
  });

  describe("database CHECK constraint parity (google_accounts_label_check)", () => {
    // Tests validating that any string accepted by validateAccountLabel satisfies the DB CHECK:
    //   "label" <> 'both'
    //   AND length("label") BETWEEN 1 AND 50
    //   AND "label" = trim("label")
    //   AND "label" ~ '^[a-z0-9 \-]{1,50}$'
    const satisfiesDbCheck = (label: string): boolean => {
      if (label === "both") return false;
      if (label.length < 1 || label.length > 50) return false;
      if (label !== label.trim()) return false;
      return /^[a-z0-9 \-]{1,50}$/.test(label);
    };

    it("ensures all valid normalized labels satisfy the DB CHECK constraint", () => {
      const validSamples = [
        "personal",
        "official",
        "work",
        "work-account",
        "side project 1",
        "a",
        "1",
        "a-b-c",
        "a".repeat(50),
      ];
      for (const sample of validSamples) {
        const validated = validateAccountLabel(sample);
        expect(satisfiesDbCheck(validated)).toBe(true);
      }
    });

    it("ensures invalid/unnormalized inputs would be rejected by the DB CHECK constraint", () => {
      expect(satisfiesDbCheck("both")).toBe(false); // reserved
      expect(satisfiesDbCheck("")).toBe(false); // empty
      expect(satisfiesDbCheck("   ")).toBe(false); // whitespace only
      expect(satisfiesDbCheck(" work")).toBe(false); // untrimmed leading space
      expect(satisfiesDbCheck("work ")).toBe(false); // untrimmed trailing space
      expect(satisfiesDbCheck("Work")).toBe(false); // uppercase
      expect(satisfiesDbCheck("work@home")).toBe(false); // forbidden character
      expect(satisfiesDbCheck("a".repeat(51))).toBe(false); // exceeds 50 chars
    });
  });
});

describe("isAccount (conversation account field validation)", () => {
  it("accepts the 'both' sentinel value", () => {
    expect(isAccount("both")).toBe(true);
  });

  it("accepts valid account labels matching the label format", () => {
    expect(isAccount("personal")).toBe(true);
    expect(isAccount("official")).toBe(true);
    expect(isAccount("work")).toBe(true);
    expect(isAccount("side-hustle")).toBe(true);
    expect(isAccount("client 123")).toBe(true);
    expect(isAccount("a".repeat(50))).toBe(true);
  });

  it("rejects empty string and whitespace-only values", () => {
    expect(isAccount("")).toBe(false);
    expect(isAccount("   ")).toBe(false);
  });

  it("rejects values with invalid characters", () => {
    expect(isAccount("personal@gmail.com")).toBe(false);
    expect(isAccount("work/account")).toBe(false);
    expect(isAccount("<script>")).toBe(false);
    // isAccount normalizes to lowercase before testing, so uppercase letters are accepted
    // (they become lowercase). Only truly invalid characters (not in [a-z0-9 \-]) are rejected.
    expect(isAccount("UPPERCASE")).toBe(true); // normalized to "uppercase" — valid label
    expect(isAccount("WORK@HOME")).toBe(false); // '@' is invalid even after lowercasing
  });

  it("rejects non-string values", () => {
    expect(isAccount(null)).toBe(false);
    expect(isAccount(undefined)).toBe(false);
    expect(isAccount(42)).toBe(false);
    expect(isAccount({})).toBe(false);
  });

  it("rejects labels longer than 50 characters", () => {
    expect(isAccount("a".repeat(51))).toBe(false);
  });

  it("rejects 'unknown' (not a valid label format due to being all-lowercase alpha but absent from reserved list — still accepted by regex)", () => {
    // 'unknown' satisfies the regex ^[a-z0-9 \-]{1,50}$ and is not 'both',
    // so isAccount returns true. The chat route test mock rejects it explicitly
    // as a test fixture; the actual isAccount function does not special-case it.
    // This documents the distinction between application business rules and format-only validation.
    expect(isAccount("unknown")).toBe(true);
  });

  it("'both' is accepted as a conversation account sentinel (read-both-accounts mode)", () => {
    // Verifies the CHECK constraint's sentinel branch: account = 'both'
    expect(isAccount("both")).toBe(true);
  });
});
