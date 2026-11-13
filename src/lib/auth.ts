import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt, sql } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Account label validation
// ---------------------------------------------------------------------------

/** Reserved values that cannot be used as account labels. */
export const RESERVED_LABELS = ["both"] as const;

const LABEL_RE = /^[a-z0-9 \-]{1,50}$/;

/**
 * Normalize and validate a user-supplied account label.
 * Returns the trimmed, lowercased label on success.
 * Throws "INVALID_LABEL" or "RESERVED_LABEL" on failure.
 */
export function validateAccountLabel(raw: string): string {
  const label = raw.trim().toLowerCase();
  if (!LABEL_RE.test(label)) throw new Error("INVALID_LABEL");
  if ((RESERVED_LABELS as readonly string[]).includes(label)) throw new Error("RESERVED_LABEL");
  return label;
}

// ---------------------------------------------------------------------------
// OAuth transactions
// ---------------------------------------------------------------------------

export async function createOAuthTransaction(input: {
  state: string;
  nonce: string;
  codeVerifier: string;
  operation?: "login" | "connect";
  initiatingUserId?: string;
  accountLabel?: string;
}): Promise<void> {
  const operation = input.operation ?? "login";
  if (operation === "connect" && (!input.initiatingUserId || !input.accountLabel)) {
    throw new Error("Connect OAuth transactions require an initiating user and account label.");
  }
  if (operation === "login" && (input.initiatingUserId || input.accountLabel)) {
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
    accountLabel: input.accountLabel,
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

// ---------------------------------------------------------------------------
// User upsert
// ---------------------------------------------------------------------------

export async function upsertGoogleUser(input: {
  googleSubject: string;
  email: string;
  name: string;
  picture?: string;
}): Promise<User> {
  const db = getDatabase();

  const [existingIdentity] = await db
    .select()
    .from(googleIdentities)
    .where(eq(googleIdentities.googleSubject, input.googleSubject))
    .limit(1);

  if (existingIdentity) {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingIdentity.userId))
      .limit(1);

    if (!existingUser || existingUser.googleSubject !== input.googleSubject) {
      throw new Error("GOOGLE_IDENTITY_ALREADY_LINKED");
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        email: input.email,
        name: input.name,
        picture: input.picture ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingUser.id))
      .returning();

    await db
      .update(googleIdentities)
      .set({ email: input.email, updatedAt: new Date() })
      .where(eq(googleIdentities.id, existingIdentity.id));

    return updatedUser ?? existingUser;
  }

  const [existingPrimaryUser] = await db
    .select()
    .from(users)
    .where(eq(users.googleSubject, input.googleSubject))
    .limit(1);

  let user = existingPrimaryUser;
  if (!user) {
    const [createdUser] = await db.insert(users).values(input).returning();
    if (!createdUser) {
      throw new Error("Google user could not be created.");
    }
    user = createdUser;
  }

  const [identity] = await db
    .insert(googleIdentities)
    .values({ userId: user.id, googleSubject: input.googleSubject, email: input.email })
    .onConflictDoNothing()
    .returning();

  if (!identity) {
    const [conflictIdentity] = await db
      .select()
      .from(googleIdentities)
      .where(eq(googleIdentities.googleSubject, input.googleSubject))
      .limit(1);
    if (!conflictIdentity || conflictIdentity.userId !== user.id) {
      throw new Error("GOOGLE_IDENTITY_ALREADY_LINKED");
    }
  }

  return user;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Google accounts
// ---------------------------------------------------------------------------

export async function listGoogleAccounts(userId: string) {
  return getDatabase().select({ id: googleAccounts.id, label: googleAccounts.label, email: googleIdentities.email, grantedScopes: googleAccounts.grantedScopes, status: googleAccounts.status, createdAt: googleAccounts.createdAt, updatedAt: googleAccounts.updatedAt })
    .from(googleAccounts).innerJoin(googleIdentities, eq(googleIdentities.id, googleAccounts.identityId))
    .where(eq(googleAccounts.userId, userId));
}

export async function saveGoogleAccount(input: { userId: string; label: string; googleSubject: string; email: string; refreshTokenCiphertext: string; grantedScopes: string[] }) {
  const db = getDatabase();
  // Resolve or create the google identity
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

  const normalizedLabel = input.label.trim().toLowerCase();

  // Find existing account for this user+label (case-insensitive)
  const [existing] = await db
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.userId, input.userId), sql`LOWER(${googleAccounts.label}) = LOWER(${normalizedLabel})`))
    .limit(1);

  if (existing) {
    await db
      .update(googleAccounts)
      .set({ identityId: identity.id, refreshTokenCiphertext: input.refreshTokenCiphertext, grantedScopes: input.grantedScopes, status: "active", updatedAt: new Date() })
      .where(and(eq(googleAccounts.id, existing.id), eq(googleAccounts.userId, input.userId)));
  } else {
    await db.insert(googleAccounts).values({
      userId: input.userId,
      identityId: identity.id,
      label: normalizedLabel,
      refreshTokenCiphertext: input.refreshTokenCiphertext,
      grantedScopes: input.grantedScopes,
      status: "active",
    });
  }
}

export async function findGoogleAccount(userId: string, label: string) {
  const normalizedLabel = label.trim().toLowerCase();
  const [account] = await getDatabase().select().from(googleAccounts)
    .where(and(eq(googleAccounts.userId, userId), sql`LOWER(${googleAccounts.label}) = LOWER(${normalizedLabel})`)).limit(1);
  return account ?? null;
}

export async function markGoogleAccountRevoked(userId: string, label: string, expectedAccountId?: string) {
  const normalizedLabel = label.trim().toLowerCase();
  await getDatabase().update(googleAccounts).set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(googleAccounts.userId, userId), sql`LOWER(${googleAccounts.label}) = LOWER(${normalizedLabel})`, ...(expectedAccountId ? [eq(googleAccounts.id, expectedAccountId)] : [])));
}

export async function deleteGoogleAccount(userId: string, label: string) {
  const normalizedLabel = label.trim().toLowerCase();
  const db = getDatabase();
  const [account] = await db.select().from(googleAccounts)
    .where(and(eq(googleAccounts.userId, userId), sql`LOWER(${googleAccounts.label}) = LOWER(${normalizedLabel})`)).limit(1);
  if (!account) return null;
  await db.delete(googleAccounts).where(and(eq(googleAccounts.id, account.id), eq(googleAccounts.userId, userId)));
  return account.refreshTokenCiphertext;
}

export async function updateGoogleAccountLabel(userId: string, oldLabel: string, newLabel: string) {
  const normalizedOldLabel = oldLabel.trim().toLowerCase();
  const normalizedNewLabel = validateAccountLabel(newLabel);

  if (normalizedOldLabel === normalizedNewLabel) {
    return true;
  }

  const db = getDatabase();

  const [existingOld] = await db
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.userId, userId), sql`LOWER(${googleAccounts.label}) = LOWER(${normalizedOldLabel})`))
    .limit(1);

  if (!existingOld) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  // App-level pre-check (best-effort; the DB functional index is the authoritative
  // guard against concurrent renames landing on the same label).
  const [existingNew] = await db
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.userId, userId), sql`LOWER(${googleAccounts.label}) = LOWER(${normalizedNewLabel})`))
    .limit(1);

  if (existingNew && existingNew.id !== existingOld.id) {
    throw new Error("ACCOUNT_LABEL_EXISTS");
  }

  // The composite FK on google_write_approvals (user_id, google_account_id, account_label)
  // references (user_id, id, label) with ON UPDATE CASCADE. Updating the label here
  // automatically propagates the new label to all associated approval rows without
  // any manual UPDATE — pending approvals are preserved with their IDs and payloads.
  try {
    await db
      .update(googleAccounts)
      .set({ label: normalizedNewLabel, updatedAt: new Date() })
      .where(and(eq(googleAccounts.id, existingOld.id), eq(googleAccounts.userId, userId)));
  } catch (err) {
    // Handle a concurrent rename that races past the app-level pre-check and collides
    // with the DB unique index google_accounts_user_label_ci_unique (SQLSTATE 23505).
    if (isAccountLabelUniqueViolation(err)) throw new Error("ACCOUNT_LABEL_EXISTS");
    throw err;
  }

  return true;
}

/**
 * Returns true when the error is a PostgreSQL unique-constraint violation (SQLSTATE 23505)
 * specifically on the case-insensitive account label unique index:
 * `google_accounts_user_label_ci_unique`.
 *
 * Inspects both the direct error and any nested causes (e.g. DrizzleError / driver wrapper).
 * Prevents unrelated unique violations (e.g. composite owner FK index or identity subject)
 * from being misidentified as ACCOUNT_LABEL_EXISTS.
 */
export function isAccountLabelUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (typeof current === "object" && current !== null) {
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown };
    if (
      candidate.code === "23505" &&
      (candidate.constraint === "google_accounts_user_label_ci_unique" ||
        (typeof candidate.message === "string" &&
          candidate.message.includes("google_accounts_user_label_ci_unique")))
    ) {
      return true;
    }
    if ("cause" in current && current.cause) {
      current = current.cause;
    } else {
      break;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Session cookie helpers
// ---------------------------------------------------------------------------

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

