import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  return user
    ? NextResponse.json({ user: { email: user.email, name: user.name, picture: user.picture } })
    : NextResponse.json({ error: "Authentication is required." }, { status: 401 });
}
