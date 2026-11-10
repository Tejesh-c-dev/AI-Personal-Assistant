import { NextResponse } from "next/server";

import { databaseErrorResponse, invalidRequestResponse, unauthorizedResponse } from "../../../../../lib/api-errors";
import { getCurrentUser } from "../../../../../lib/auth";
import { GOOGLE_ACCOUNT_SCOPES, beginGoogleAuthorization } from "../../../../../lib/google-oauth";

export async function POST(_request: Request, { params }: { params: Promise<{ label: string }> }) {
  let user;
  try { user = await getCurrentUser(); } catch (error) { return databaseErrorResponse(error); }
  if (!user) return unauthorizedResponse();
  const { label } = await params;
  if (label !== "personal" && label !== "official") return invalidRequestResponse("Account label must be personal or official.");
  try {
    const authorization = await beginGoogleAuthorization(GOOGLE_ACCOUNT_SCOPES, { operation: "connect", initiatingUserId: user.id, accountType: label });
    const response = NextResponse.redirect(authorization.url, 303);
    response.cookies.set("google_oauth_state", authorization.state, { httpOnly: true, maxAge: 600, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return response;
  } catch (error) {
    return databaseErrorResponse(error);
  }
}
