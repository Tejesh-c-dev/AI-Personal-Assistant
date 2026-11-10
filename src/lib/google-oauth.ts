import "server-only";

import { createHash } from "node:crypto";

import { jwtVerify, createRemoteJWKSet } from "jose";
import type { NextResponse } from "next/server";

import {
  consumeOAuthTransaction,
  createOAuthTransaction,
  createSession,
  getGoogleConfig,
  randomToken,
  setSessionCookie,
  upsertGoogleUser,
  saveGoogleAccount,
} from "./auth";
import { encryptGoogleRefreshToken } from "./google-token-crypto";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export const GOOGLE_INITIAL_SCOPES = ["openid", "email", "profile"] as const;
export const GOOGLE_ACCOUNT_SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.readonly"] as const;

function codeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export async function beginGoogleAuthorization(
  additionalScopes: readonly string[] = [],
  transactionContext: { operation?: "login" | "connect"; initiatingUserId?: string; accountType?: "personal" | "official" } = {},
): Promise<{ url: string; state: string }> {
  const { clientId, redirectUri } = getGoogleConfig();
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(48);
  await createOAuthTransaction({ state, nonce, codeVerifier, ...transactionContext });

  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...GOOGLE_INITIAL_SCOPES, ...additionalScopes].join(" "));
  if (additionalScopes.length > 0) {
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function completeGoogleAuthorization(response: NextResponse, state: string, code: string) {
  const transaction = await consumeOAuthTransaction(state);
  if (!transaction) {
    throw new Error("The OAuth state is invalid or expired.");
  }
  if (transaction.operation !== "login" && transaction.operation !== "connect") throw new Error("The OAuth operation is invalid.");
  if (transaction.operation === "connect" && (!transaction.initiatingUserId || (transaction.accountType !== "personal" && transaction.accountType !== "official"))) throw new Error("The OAuth connection transaction is invalid.");

  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: transaction.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokenPayload: unknown = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !isRecord(tokenPayload) || typeof tokenPayload.id_token !== "string" || (transaction.operation === "connect" && typeof tokenPayload.refresh_token !== "string")) {
    throw new Error("Google authorization could not be completed.");
  }

  const { payload } = await jwtVerify(tokenPayload.id_token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUER,
    audience: clientId,
  });
  if (
    payload.nonce !== transaction.nonce ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new Error("Google identity validation failed.");
  }

  if (transaction.operation === "connect") {
    await saveGoogleAccount({
      userId: transaction.initiatingUserId!,
      accountType: transaction.accountType as "personal" | "official",
      googleSubject: payload.sub,
      email: payload.email,
      refreshTokenCiphertext: encryptGoogleRefreshToken(tokenPayload.refresh_token as string),
      grantedScopes: typeof tokenPayload.scope === "string" ? tokenPayload.scope.split(/\s+/).filter(Boolean) : [],
    });
    return;
  }

  const user = await upsertGoogleUser({
    googleSubject: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" && payload.name ? payload.name : payload.email,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  });
  const sessionToken = await createSession(user.id);
  setSessionCookie(response, sessionToken);
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const { clientId } = getGoogleConfig();
  const response = await fetch(GOOGLE_REVOCATION_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, client_id: clientId }) });
  if (!response.ok) throw new Error("Google token revocation failed.");
}
