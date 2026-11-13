import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse, unauthorizedResponse } from "../../../../lib/api-errors";
import { deleteGoogleAccount, getCurrentUser, updateGoogleAccountLabel, validateAccountLabel } from "../../../../lib/auth";
import { decryptGoogleRefreshToken } from "../../../../lib/google-token-crypto";
import { revokeGoogleToken } from "../../../../lib/google-oauth";

export async function PATCH(request: Request, { params }: { params: Promise<{ label: string }> }) {
  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    return databaseErrorResponse(error);
  }
  if (!user) return unauthorizedResponse();

  const { label } = await params;
  let normalizedOldLabel: string;
  try {
    normalizedOldLabel = validateAccountLabel(label);
  } catch {
    return invalidRequestResponse("Account label must be 1–50 lowercase alphanumeric characters, hyphens, or spaces, and cannot be 'both'.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequestResponse("Invalid JSON body.");
  }

  const rawNewLabel =
    typeof body === "object" && body !== null && "newLabel" in body
      ? (body as { newLabel: unknown }).newLabel
      : typeof body === "object" && body !== null && "label" in body
      ? (body as { label: unknown }).label
      : undefined;

  if (typeof rawNewLabel !== "string") {
    return invalidRequestResponse("New label must be a string.");
  }

  let normalizedNewLabel: string;
  try {
    normalizedNewLabel = validateAccountLabel(rawNewLabel);
  } catch {
    return invalidRequestResponse("Account label must be 1–50 lowercase alphanumeric characters, hyphens, or spaces, and cannot be 'both'.");
  }

  try {
    await updateGoogleAccountLabel(user.id, normalizedOldLabel, normalizedNewLabel);
    return NextResponse.json({ success: true, label: normalizedNewLabel });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "ACCOUNT_NOT_FOUND") {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }
      if (error.message === "ACCOUNT_LABEL_EXISTS") {
        return NextResponse.json({ error: "An account with this label already exists." }, { status: 409 });
      }
    }
    return databaseErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ label: string }> }) {
  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    return databaseErrorResponse(error);
  }
  if (!user) return unauthorizedResponse();

  const { label } = await params;
  let normalizedLabel: string;
  try {
    normalizedLabel = validateAccountLabel(label);
  } catch {
    return invalidRequestResponse("Account label must be 1–50 lowercase alphanumeric characters, hyphens, or spaces, and cannot be 'both'.");
  }

  try {
    const ciphertext = await deleteGoogleAccount(user.id, normalizedLabel);
    if (ciphertext) {
      try {
        await revokeGoogleToken(decryptGoogleRefreshToken(ciphertext));
      } catch {
        console.error("Google account was disconnected but token revocation failed.");
      }
    }
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}
