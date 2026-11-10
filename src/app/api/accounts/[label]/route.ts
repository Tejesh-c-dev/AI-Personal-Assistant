import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse, unauthorizedResponse } from "../../../../lib/api-errors";
import { deleteGoogleAccount, getCurrentUser } from "../../../../lib/auth";
import { decryptGoogleRefreshToken } from "../../../../lib/google-token-crypto";
import { revokeGoogleToken } from "../../../../lib/google-oauth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ label: string }> }) {
  let user;
  try { user = await getCurrentUser(); } catch (error) { return databaseErrorResponse(error); }
  if (!user) return unauthorizedResponse();
  const { label } = await params;
  if (label !== "personal" && label !== "official") return invalidRequestResponse("Account label must be personal or official.");
  try {
    const ciphertext = await deleteGoogleAccount(user.id, label);
    if (ciphertext) {
      try { await revokeGoogleToken(decryptGoogleRefreshToken(ciphertext)); }
      catch { console.error("Google account was disconnected but token revocation failed."); }
    }
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}
