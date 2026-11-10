import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_ENV = "GOOGLE_TOKEN_ENCRYPTION_KEY";

function encryptionKey(): Buffer {
  const encoded = process.env[KEY_ENV];
  if (!encoded) throw new Error(`${KEY_ENV} must be configured with a base64-encoded 32-byte key.`);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new Error(`${KEY_ENV} must be a valid base64-encoded 32-byte key.`);
  }
  return key;
}

export function encryptGoogleRefreshToken(token: string): string {
  if (!token) throw new Error("A Google refresh token is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGoogleRefreshToken(encrypted: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || encodedCiphertext === undefined || extra !== undefined) {
    throw new Error("The encrypted Google refresh token is invalid.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The Google refresh token could not be decrypted.");
  }
}
