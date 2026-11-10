import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDatabase } from "./db";
import { googleAccounts, googleIdentities, oauthTransactions, sessions, users, type User } from "./db/schema";

export const AUTH_COOKIE = "assistant_session";
export const OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function randomToken(byteLength = 32): string {
  return base64Url(randomBytes(byteLength));
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be configured.");
  }
  return { clientId, clientSecret, redirectUri };
}

export async function createOAuthTransaction(input: {
  state: string;
  nonce: string;
  codeVerifier: string;
  operation?: "login" | "connect";
  initiatingUserId?: string;
  accountType?: "personal" | "official";
}): Promise<void> {
  const operation = input.operation ?? "login";
  if (operation === "connect" && (!input.initiatingUserId || !input.accountType)) {
    throw new Error("Connect OAuth transactions require an initiating user and account type.");
  }
  if (operation === "login" && (input.initiatingUserId || input.accountType)) {
    throw new Error("Login OAuth transactions cannot include connect account data.");
  }
  const db = getDatabase();
  await db.delete(oauthTransactions).where(lt(oauthTransactions.expiresAt, new Date()));
  await db.insert(oauthTransactions).values({
    stateHash: hashToken(input.state),
    nonce: input.nonce,
    codeVerifier: input.codeVerifier,
    operation,
    initiatingUserId: input.initiatingUserId,
    accountType: input.accountType,
    expiresAt: new Date(Date.now() + OAUTH_TRANSACTION_TTL_SECONDS * 1000),
  });
}

export async function consumeOAuthTransaction(state: string) {
  const db = getDatabase();
  const [transaction] = await db
    .delete(oauthTransactions)
    .where(and(eq(oauthTransactions.stateHash, hashToken(state)), gt(oauthTransactions.expiresAt, new Date())))
    .returning();
  return transaction ?? null;
}

export async function upsertGoogleUser(input: {
  googleSubject: string;
  email: string;
  name: string;
  picture?: string;
}): Promise<User> {
  const db = getDatabase();
  const [user] = await db
    .insert(users)
    .values(input)
    .onConflictDoUpdate({
      target: users.googleSubject,
      set: {
        email: input.email,
        name: input.name,
        picture: input.picture ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!user) {
    throw new Error("Google user could not be created.");
  }

  await db
    .insert(googleIdentities)
    .values({ userId: user.id, googleSubject: input.googleSubject, email: input.email })
    .onConflictDoUpdate({
      target: googleIdentities.googleSubject,
      set: { userId: user.id, email: input.email, updatedAt: new Date() },
    });
  return user;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const db = getDatabase();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
    lastUsedAt: now,
  });
  return token;
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const db = getDatabase();
  const [result] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!result) {
    return null;
  }

  await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, result.session.id));
  return result.user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationError();
  }
  return user;
}

export async function listGoogleAccounts(userId: string) {
  return getDatabase().select({ id: googleAccounts.id, label: googleAccounts.accountType, email: googleIdentities.email, createdAt: googleAccounts.createdAt, updatedAt: googleAccounts.updatedAt })
    .from(googleAccounts).innerJoin(googleIdentities, eq(googleIdentities.id, googleAccounts.identityId))
    .where(eq(googleAccounts.userId, userId));
}

export async function saveGoogleAccount(input: { userId: string; accountType: "personal" | "official"; googleSubject: string; email: string; refreshTokenCiphertext: string; grantedScopes: string[] }) {
  const db = getDatabase();
  let [identity] = await db.select().from(googleIdentities).where(eq(googleIdentities.googleSubject, input.googleSubject)).limit(1);
  if (identity && identity.userId !== input.userId) throw new Error("GOOGLE_IDENTITY_ALREADY_LINKED");
  if (!identity) {
    [identity] = await db.insert(googleIdentities).values({ userId: input.userId, googleSubject: input.googleSubject, email: input.email }).onConflictDoNothing().returning();
    if (!identity) {
      [identity] = await db.select().from(googleIdentities).where(eq(googleIdentities.googleSubject, input.googleSubject)).limit(1);
      if (!identity || identity.userId !== input.userId) throw new Error("GOOGLE_IDENTITY_ALREADY_LINKED");
    }
  } else {
    await db.update(googleIdentities).set({ email: input.email, updatedAt: new Date() }).where(eq(googleIdentities.id, identity.id));
  }
  await db.insert(googleAccounts).values({ userId: input.userId, identityId: identity.id, accountType: input.accountType, refreshTokenCiphertext: input.refreshTokenCiphertext, grantedScopes: input.grantedScopes, status: "active" })
    .onConflictDoUpdate({ target: [googleAccounts.userId, googleAccounts.accountType], set: { identityId: identity.id, refreshTokenCiphertext: input.refreshTokenCiphertext, grantedScopes: input.grantedScopes, status: "active", updatedAt: new Date() } });
}

export async function findGoogleAccount(userId: string, accountType: "personal" | "official") {
  const [account] = await getDatabase().select().from(googleAccounts)
    .where(and(eq(googleAccounts.userId, userId), eq(googleAccounts.accountType, accountType))).limit(1);
  return account ?? null;
}

export async function markGoogleAccountRevoked(userId: string, accountType: "personal" | "official") {
  await getDatabase().update(googleAccounts).set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(googleAccounts.userId, userId), eq(googleAccounts.accountType, accountType)));
}

export async function deleteGoogleAccount(userId: string, accountType: "personal" | "official") {
  const db = getDatabase();
  const [account] = await db.select().from(googleAccounts).where(and(eq(googleAccounts.userId, userId), eq(googleAccounts.accountType, accountType))).limit(1);
  if (!account) return null;
  await db.delete(googleAccounts).where(and(eq(googleAccounts.id, account.id), eq(googleAccounts.userId, userId)));
  return account.refreshTokenCiphertext;
}

export async function invalidateCurrentSession(): Promise<void> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) {
    return;
  }
  await getDatabase().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export function setSessionCookie(response: { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void } }, token: string) {
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function clearSessionCookie(response: { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void } }) {
  response.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
