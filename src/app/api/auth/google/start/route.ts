import { NextResponse } from "next/server";

import { beginGoogleAuthorization } from "../../../../../lib/google-oauth";

export async function GET() {
  try {
    const authorization = await beginGoogleAuthorization();
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set("google_oauth_state", authorization.state, {
      httpOnly: true,
      maxAge: 10 * 60,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Google authorization could not start.", error);
    return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 503 });
  }
}
