import "server-only";

import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, gt, isNull } from "drizzle-orm";
import { decryptGoogleRefreshToken } from "./google-token-crypto";
import { findGoogleAccount, getGoogleConfig, markGoogleAccountRevoked } from "./auth";
import { getDatabase } from "./db";
import { googleCapabilities } from "./db/schema";

export type GoogleAccountLabel = string;
export const GOOGLE_OPERATIONS = ["gmail.search", "gmail.get", "gmail.send", "calendar.list", "calendar.get", "calendar.create", "docs.get", "docs.create", "docs.insert", "docs.export"] as const;
export type GoogleOperation = typeof GOOGLE_OPERATIONS[number];
export type GoogleReadOperation = Extract<GoogleOperation, "gmail.search" | "gmail.get" | "calendar.list" | "calendar.get" | "docs.get" | "docs.export">;
export class GoogleAuthorizationError extends Error {
  constructor(public readonly code: "RECONNECT_REQUIRED" | "SCOPE_REQUIRED" | "GOOGLE_API_FAILED" | "INVALID_REQUEST" | "CONFIRMATION_REQUIRED") {
    super(code === "RECONNECT_REQUIRED" ? "Reconnect this Google account to continue." : code === "SCOPE_REQUIRED" ? "Reconnect this Google account and grant the required permission." : code === "CONFIRMATION_REQUIRED" ? "Confirm this exact action in a separate user turn before it can run." : code === "INVALID_REQUEST" ? "The Google API request is invalid." : "The Google service could not complete the request.");
    this.name = "GoogleAuthorizationError";
  }
}

const tokenCache = new Map<string, { token: string; expiresAt: number; accountVersion: number }>();
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const scopes: Record<GoogleOperation, string> = {
  "gmail.search": "https://www.googleapis.com/auth/gmail.modify", "gmail.get": "https://www.googleapis.com/auth/gmail.modify", "gmail.send": "https://www.googleapis.com/auth/gmail.send",
  "calendar.list": "https://www.googleapis.com/auth/calendar.events", "calendar.get": "https://www.googleapis.com/auth/calendar.events", "calendar.create": "https://www.googleapis.com/auth/calendar.events",
  "docs.get": "https://www.googleapis.com/auth/documents", "docs.create": "https://www.googleapis.com/auth/documents", "docs.insert": "https://www.googleapis.com/auth/documents", "docs.export": "https://www.googleapis.com/auth/drive.readonly",
};
const writes = new Set<GoogleOperation>(["gmail.send", "calendar.create", "docs.create", "docs.insert"]);
function googleAccountVersion(account: { updatedAt?: Date }): number {
  return account.updatedAt instanceof Date ? account.updatedAt.getTime() : 0;
}

async function accessToken(userId: string, label: GoogleAccountLabel, expectedAccountId?: string): Promise<string> {
  const account = await findGoogleAccount(userId, label);
  if (!account || account.status !== "active" || (expectedAccountId && account.id !== expectedAccountId)) throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
  const accountVersion = googleAccountVersion(account);
  const cached = tokenCache.get(account.id);
  if (cached && cached.accountVersion === accountVersion && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const refreshToken = decryptGoogleRefreshToken(account.refreshTokenCiphertext);
  const { clientId, clientSecret } = getGoogleConfig();
  let response: Response;
  try { response = await fetch(GOOGLE_TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) }); }
  catch { throw new GoogleAuthorizationError("GOOGLE_API_FAILED"); }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  if (!response.ok || typeof record.access_token !== "string") {
    if (record.error === "invalid_grant") { tokenCache.delete(account.id); await markGoogleAccountRevoked(userId, label, account.id); throw new GoogleAuthorizationError("RECONNECT_REQUIRED"); }
    throw new GoogleAuthorizationError("GOOGLE_API_FAILED");
  }
  tokenCache.set(account.id, { token: record.access_token, expiresAt: Date.now() + (typeof record.expires_in === "number" ? record.expires_in : 3600) * 1000, accountVersion });
  return record.access_token;
}

async function apiRequest<T>(userId: string, label: GoogleAccountLabel, operation: GoogleOperation, url: string, method = "GET", body?: unknown, expectedAccountId?: string): Promise<T> {
  const account = await findGoogleAccount(userId, label);
  if (!account || account.status !== "active" || (expectedAccountId && account.id !== expectedAccountId)) throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
  if (!account.grantedScopes.includes(scopes[operation])) throw new GoogleAuthorizationError("SCOPE_REQUIRED");
  const token = await accessToken(userId, label, expectedAccountId);
  const currentAccount = await findGoogleAccount(userId, label);
  if (!currentAccount || currentAccount.status !== "active" || currentAccount.id !== account.id || (expectedAccountId && currentAccount.id !== expectedAccountId)) throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
  let response: Response;
  try { response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new GoogleAuthorizationError("GOOGLE_API_FAILED"); }
  if (!response.ok) throw new GoogleAuthorizationError("GOOGLE_API_FAILED");
  if (operation === "docs.export") return await response.text() as T;
  try { return await response.json() as T; } catch { throw new GoogleAuthorizationError("GOOGLE_API_FAILED"); }
}
function googleUrl(path: string, params?: Record<string, string>): string { const url = new URL(`https://www.googleapis.com/${path}`); for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value); return url.toString(); }

export const googleBroker = {
  searchGmail(userId: string, label: GoogleAccountLabel, query: string, maxResults = 20, expectedAccountId?: string) { return apiRequest(userId, label, "gmail.search", googleUrl("gmail/v1/users/me/messages", { q: query, maxResults: String(Math.min(Math.max(maxResults, 1), 100)) }), "GET", undefined, expectedAccountId); },
  getGmailMessage(userId: string, label: GoogleAccountLabel, messageId: string, expectedAccountId?: string) { return apiRequest(userId, label, "gmail.get", googleUrl(`gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`, { format: "full" }), "GET", undefined, expectedAccountId); },
  sendGmail(userId: string, label: GoogleAccountLabel, input: { to: string; subject: string; body: string }, expectedAccountId?: string) { const raw = Buffer.from(`To: ${input.to}\r\nSubject: ${input.subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${input.body}`).toString("base64url"); return apiRequest(userId, label, "gmail.send", googleUrl("gmail/v1/users/me/messages/send"), "POST", { raw }, expectedAccountId); },
  listCalendarEvents(userId: string, label: GoogleAccountLabel, calendarId = "primary", timeMin?: string, timeMax?: string, expectedAccountId?: string) { return apiRequest(userId, label, "calendar.list", googleUrl(`calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { ...(timeMin ? { timeMin } : {}), ...(timeMax ? { timeMax } : {}), singleEvents: "true", orderBy: "startTime" }), "GET", undefined, expectedAccountId); },
  getCalendarEvent(userId: string, label: GoogleAccountLabel, eventId: string, calendarId = "primary", expectedAccountId?: string) { return apiRequest(userId, label, "calendar.get", googleUrl(`calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`), "GET", undefined, expectedAccountId); },
  createCalendarEvent(userId: string, label: GoogleAccountLabel, event: Record<string, unknown>, calendarId = "primary", expectedAccountId?: string) { return apiRequest(userId, label, "calendar.create", googleUrl(`calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`), "POST", event, expectedAccountId); },
  getDocument(userId: string, label: GoogleAccountLabel, documentId: string, expectedAccountId?: string) { return apiRequest(userId, label, "docs.get", googleUrl(`v1/documents/${encodeURIComponent(documentId)}`), "GET", undefined, expectedAccountId); },
  createDocument(userId: string, label: GoogleAccountLabel, title: string, expectedAccountId?: string) { return apiRequest(userId, label, "docs.create", googleUrl("v1/documents"), "POST", { title }, expectedAccountId); },
  insertDocumentText(userId: string, label: GoogleAccountLabel, documentId: string, text: string, expectedAccountId?: string) { return apiRequest(userId, label, "docs.insert", googleUrl(`v1/documents/${encodeURIComponent(documentId)}:batchUpdate`), "POST", { requests: [{ insertText: { location: { index: 1 }, text } }] }, expectedAccountId); },
  exportDocument(userId: string, label: GoogleAccountLabel, documentId: string, mimeType = "text/plain", expectedAccountId?: string) { return apiRequest(userId, label, "docs.export", googleUrl(`drive/v3/files/${encodeURIComponent(documentId)}/export`, { mimeType }), "GET", undefined, expectedAccountId); },
};
export const googleReadBroker = googleBroker;

const CAPABILITY_ISSUER = "ai-personal-assistant";
function capabilityKey(): Uint8Array { const secret = process.env.GOOGLE_CAPABILITY_SECRET; if (!secret || secret.length < 32) throw new Error("GOOGLE_CAPABILITY_SECRET must be configured with at least 32 characters."); return new TextEncoder().encode(secret); }
// Capabilities are operation and account scoped, short lived, and bound to the exact write payload.
// The chat route supplies write grants only after matching a separately confirmed pending action.
export async function issueGoogleCapability(userId: string, label: GoogleAccountLabel, operations: readonly GoogleOperation[], ttlSeconds = 300, approvedPayloads: Record<string, string> = {}, expectedAccountId?: string): Promise<string> {
  if (!operations.length || operations.some((operation) => !GOOGLE_OPERATIONS.includes(operation))) throw new GoogleAuthorizationError("INVALID_REQUEST");
  const account = await findGoogleAccount(userId, label);
  if (!account || account.status !== "active") throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
  if (expectedAccountId && account.id !== expectedAccountId) throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
  if (operations.some((operation) => !account.grantedScopes.includes(scopes[operation]))) throw new GoogleAuthorizationError("SCOPE_REQUIRED");
  const permitted = operations.filter((operation) => !writes.has(operation) || Boolean(approvedPayloads[operation]));
  if (!permitted.length) throw new GoogleAuthorizationError("CONFIRMATION_REQUIRED");
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + Math.min(Math.max(ttlSeconds, 1), 600) * 1000);
  await getDatabase().insert(googleCapabilities).values({ nonce, expiresAt });
  return new SignJWT({ label, operations: permitted, approvedPayloads, accountId: account.id, accountIdentityId: account.identityId, accountVersion: googleAccountVersion(account), nonce }).setProtectedHeader({ alg: "HS256" }).setIssuer(CAPABILITY_ISSUER).setSubject(userId).setIssuedAt().setExpirationTime(expiresAt).sign(capabilityKey());
}
export async function issueGoogleProposalCapability(userId: string, label: GoogleAccountLabel, operation: GoogleOperation, conversationId: string, ttlSeconds = 300): Promise<string> {
  if (!writes.has(operation)) throw new GoogleAuthorizationError("INVALID_REQUEST");
  const account = await findGoogleAccount(userId, label);
  if (!account || account.status !== "active") throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
  if (!account.grantedScopes.includes(scopes[operation])) throw new GoogleAuthorizationError("SCOPE_REQUIRED");
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + Math.min(Math.max(ttlSeconds, 1), 600) * 1000);
  await getDatabase().insert(googleCapabilities).values({ nonce, expiresAt });
  return new SignJWT({ label, operation, conversationId, accountId: account.id, accountIdentityId: account.identityId, accountVersion: googleAccountVersion(account), purpose: "propose", nonce }).setProtectedHeader({ alg: "HS256" }).setIssuer(CAPABILITY_ISSUER).setSubject(userId).setIssuedAt().setExpirationTime(expiresAt).sign(capabilityKey());
}
async function consumeCapabilityNonce(nonce: string) {
  const consumedAt = new Date();
  const consumed = await getDatabase().update(googleCapabilities).set({ consumedAt }).where(and(eq(googleCapabilities.nonce, nonce), isNull(googleCapabilities.consumedAt), gt(googleCapabilities.expiresAt, consumedAt))).returning({ nonce: googleCapabilities.nonce });
  if (!consumed.length) throw new Error();
}
export async function verifyGoogleProposalCapability(token: string, operation: GoogleOperation): Promise<{ userId: string; label: GoogleAccountLabel; conversationId: string; accountId: string }> {
  try {
    const { payload } = await jwtVerify(token, capabilityKey(), { issuer: CAPABILITY_ISSUER });
    if (payload.purpose !== "propose" || payload.operation !== operation || typeof payload.sub !== "string" || typeof payload.conversationId !== "string" || typeof payload.nonce !== "string" || typeof payload.accountId !== "string" || typeof payload.accountIdentityId !== "string" || typeof payload.accountVersion !== "number" || typeof payload.label !== "string" || !payload.label || !writes.has(operation)) throw new Error();
    const activeAccount = await findGoogleAccount(payload.sub, payload.label);
    if (!activeAccount || activeAccount.status !== "active" || activeAccount.id !== payload.accountId || activeAccount.identityId !== payload.accountIdentityId || googleAccountVersion(activeAccount) !== payload.accountVersion) throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
    await consumeCapabilityNonce(payload.nonce);
    return { userId: payload.sub, label: payload.label, conversationId: payload.conversationId, accountId: payload.accountId };
  } catch (error) { if (error instanceof GoogleAuthorizationError) throw error; throw new GoogleAuthorizationError("INVALID_REQUEST"); }
}
export async function verifyGoogleCapability(token: string, userId: string, label: GoogleAccountLabel, operation: GoogleOperation, input?: unknown): Promise<void> {
  try {
    const { payload } = await jwtVerify(token, capabilityKey(), { issuer: CAPABILITY_ISSUER, subject: userId });
    if (payload.label !== label || !Array.isArray(payload.operations) || !payload.operations.includes(operation)) throw new Error();
    if (writes.has(operation)) {
      if (typeof input !== "object" || input === null || typeof payload.approvedPayloads !== "object" || payload.approvedPayloads === null || (payload.approvedPayloads as Record<string, unknown>)[operation] !== JSON.stringify(input)) throw new Error();
    }
    if (typeof payload.accountId !== "string" || typeof payload.accountIdentityId !== "string" || typeof payload.accountVersion !== "number") throw new Error();
    const activeAccount = await findGoogleAccount(userId, label);
    if (!activeAccount || activeAccount.status !== "active" || activeAccount.id !== payload.accountId || activeAccount.identityId !== payload.accountIdentityId || googleAccountVersion(activeAccount) !== payload.accountVersion) throw new GoogleAuthorizationError("RECONNECT_REQUIRED");
    if (typeof payload.nonce !== "string") throw new Error();
    await consumeCapabilityNonce(payload.nonce);
  } catch (error) {
    if (error instanceof GoogleAuthorizationError) throw error;
    throw new GoogleAuthorizationError(writes.has(operation) ? "CONFIRMATION_REQUIRED" : "INVALID_REQUEST");
  }
}
export async function verifyAnyGoogleCapability(token: string, operation: GoogleOperation, input?: unknown): Promise<{ userId: string; label: GoogleAccountLabel; accountId: string }> {
  try {
    const { payload } = await jwtVerify(token, capabilityKey(), { issuer: CAPABILITY_ISSUER });
    const label = payload.label;
    if (typeof payload.sub !== "string" || typeof label !== "string" || !label || !Array.isArray(payload.operations) || !payload.operations.includes(operation)) throw new Error();
    if (writes.has(operation) && (typeof input !== "object" || input === null)) throw new Error();
    await verifyGoogleCapability(token, payload.sub, label, operation, input);
    if (typeof payload.accountId !== "string") throw new Error();
    return { userId: payload.sub, label, accountId: payload.accountId };
  } catch (error) { if (error instanceof GoogleAuthorizationError) throw error; throw new GoogleAuthorizationError("INVALID_REQUEST"); }
}
