import { DatabaseUnavailableError } from "./db";

import { NextResponse } from "next/server";

export function databaseErrorResponse(error: unknown, requestId?: string) {
  if (error instanceof DatabaseUnavailableError) {
    return NextResponse.json({ error: error.message, code: "DATABASE_UNAVAILABLE" }, { status: 503 });
  }

  console.error("Conversation database request failed.", { ...(requestId ? { requestId } : {}), category: "database" });
  return NextResponse.json({ error: "Conversation history could not be loaded." }, { status: 500 });
}

/** Log only fixed diagnostic fields; never pass exception objects or user data here. */
export function logRequestFailure(requestId: string, category: string): void {
  console.error("Chat request failed.", { requestId, category });
}

export function invalidRequestResponse(message = "Invalid request.") {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFoundResponse() {
  return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
}
