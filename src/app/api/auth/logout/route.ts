import { NextResponse } from "next/server";

import { clearSessionCookie, invalidateCurrentSession } from "../../../../lib/auth";

export async function POST() {
  try {
    await invalidateCurrentSession();
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    response.cookies.set("active_conversation_id", "", {
      httpOnly: true,
      maxAge: 0,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Session invalidation failed.", error);
    return NextResponse.json({ error: "Logout could not be completed." }, { status: 500 });
  }
}
