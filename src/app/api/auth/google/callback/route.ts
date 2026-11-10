import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { completeGoogleAuthorization } from "../../../../../lib/google-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (error || !state || !code) {
    return NextResponse.json({ error: "Invalid Google authorization response." }, { status: 400 });
  }

  const response = NextResponse.redirect(new URL("/", url));
  try {
    const stateCookie = (await cookies()).get("google_oauth_state")?.value;
    if (!stateCookie || stateCookie !== state) {
      return NextResponse.json({ error: "Invalid Google authorization state." }, { status: 400 });
    }
    await completeGoogleAuthorization(response, state, code);
    response.cookies.delete("google_oauth_state");
    return response;
  } catch {
    console.error("Google authorization callback was rejected.");
    return NextResponse.json({ error: "Google sign-in could not be completed." }, { status: 400 });
  }
}
