import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse, unauthorizedResponse } from "../../../../../lib/api-errors";
import { getCurrentUser, validateAccountLabel } from "../../../../../lib/auth";
import { GOOGLE_ACCOUNT_SCOPES, beginGoogleAuthorization } from "../../../../../lib/google-oauth";

export async function POST(_request: Request, { params }: { params: Promise<{ label: string }> }) {
  let user;
  try { user = await getCurrentUser(); } catch (error) { return databaseErrorResponse(error); }
  if (!user) return unauthorizedResponse();
  const { label } = await params;
  let normalizedLabel: string;
  try {
    normalizedLabel = validateAccountLabel(label);
  } catch {
    return invalidRequestResponse("Account label must be 1–50 lowercase alphanumeric characters, hyphens, or spaces, and cannot be 'both'.");
  }
  try {
    const authorization = await beginGoogleAuthorization(GOOGLE_ACCOUNT_SCOPES, { operation: "connect", initiatingUserId: user.id, accountLabel: normalizedLabel });
    const response = NextResponse.redirect(authorization.url, 303);
    response.cookies.set("google_oauth_state", authorization.state, { httpOnly: true, maxAge: 600, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return response;
  } catch (error) {
    return databaseErrorResponse(error);
  }
}
