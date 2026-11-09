import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDatabase } from "./db";
import { conversations, oauthTransactions, sessions, users, type User } from "./db/schema";

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
}): Promise<void> {
  const db = getDatabase();
  await db.delete(oauthTransactions).where(lt(oauthTransactions.expiresAt, new Date()));
  await db.insert(oauthTransactions).values({
    stateHash: hashToken(input.state),
    nonce: input.nonce,
    codeVerifier: input.codeVerifier,
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

  await db.update(conversations).set({ userId: user.id }).where(isNull(conversations.userId));
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
