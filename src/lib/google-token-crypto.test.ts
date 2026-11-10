import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decryptGoogleRefreshToken, encryptGoogleRefreshToken } from "./google-token-crypto";

describe("Google refresh token encryption", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("encrypts and decrypts tokens with AES-GCM", () => {
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const encrypted = encryptGoogleRefreshToken("refresh-secret");
    expect(encrypted).not.toContain("refresh-secret");
    expect(decryptGoogleRefreshToken(encrypted)).toBe("refresh-secret");
  });

  it("rejects missing or malformed keys", () => {
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "");
    expect(() => encryptGoogleRefreshToken("token")).toThrow("must be configured");
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "not-a-key");
    expect(() => encryptGoogleRefreshToken("token")).toThrow("valid base64");
  });

  it("rejects tampered ciphertext", () => {
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    const encrypted = encryptGoogleRefreshToken("refresh-secret");
    const segments = encrypted.split(".");
    segments[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptGoogleRefreshToken(segments.join("."))).toThrow("could not be decrypted");
  });
});
