import { connection, NextResponse } from "next/server";

import { databaseErrorResponse, unauthorizedResponse } from "../../../lib/api-errors";
import { getCurrentUser, listGoogleAccounts } from "../../../lib/auth";

export async function GET() {
  await connection();
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();
    const accounts = await listGoogleAccounts(user.id);
    return NextResponse.json({ accounts });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}
