import { NextResponse } from "next/server";
import { googleBroker, GoogleAuthorizationError, GOOGLE_OPERATIONS, verifyAnyGoogleCapability, verifyGoogleProposalCapability, type GoogleOperation } from "../../../../lib/google-api";
import { createGoogleWriteApproval } from "../../../../lib/google-write-approvals";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid broker request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid broker request." }, { status: 400 });
  const record = body as Record<string, unknown>;
  const operation = record.operation;
  const input = record.input;
  const action = record.action ?? "execute";
  const authorization = request.headers.get("authorization") ?? "";
  const capability = authorization.startsWith("Bearer ") ? authorization.slice(7) : record.capability;
  if (typeof capability !== "string" || !capability) return NextResponse.json({ error: "A broker capability is required." }, { status: 401 });
  if (typeof operation !== "string" || !GOOGLE_OPERATIONS.includes(operation as GoogleOperation)) return NextResponse.json({ error: "Invalid broker request." }, { status: 400 });
  try {
    if (action === "propose") {
      if (!["gmail.send", "calendar.create", "docs.create", "docs.insert"].includes(operation)) throw new GoogleAuthorizationError("INVALID_REQUEST");
      if (typeof input !== "object" || input === null || Array.isArray(input)) throw new GoogleAuthorizationError("INVALID_REQUEST");
      const proposal = await verifyGoogleProposalCapability(capability, operation as GoogleOperation);
      const stored = await createGoogleWriteApproval({ userId: proposal.userId, conversationId: proposal.conversationId, label: proposal.label, operation: operation as GoogleOperation, payload: input });
      return NextResponse.json({ result: { ...stored, confirmation: `Reply CONFIRM ${stored.approvalId} in a separate message to approve these exact details.` } }, { status: 201 });
    }
    if (action !== "execute") throw new GoogleAuthorizationError("INVALID_REQUEST");
    const { userId, label } = await verifyAnyGoogleCapability(capability, operation as GoogleOperation, input);
    let result: unknown;
    const data = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    switch (operation as GoogleOperation) {
      case "gmail.search": result = await googleBroker.searchGmail(userId, label, String(data.query ?? ""), Number(data.maxResults ?? 20)); break;
      case "gmail.get": result = await googleBroker.getGmailMessage(userId, label, String(data.messageId ?? "")); break;
      case "gmail.send": result = await googleBroker.sendGmail(userId, label, { to: String(data.to ?? ""), subject: String(data.subject ?? ""), body: String(data.body ?? "") }); break;
      case "calendar.list": result = await googleBroker.listCalendarEvents(userId, label, String(data.calendarId ?? "primary"), typeof data.timeMin === "string" ? data.timeMin : undefined, typeof data.timeMax === "string" ? data.timeMax : undefined); break;
      case "calendar.get": result = await googleBroker.getCalendarEvent(userId, label, String(data.eventId ?? ""), String(data.calendarId ?? "primary")); break;
      case "calendar.create": result = await googleBroker.createCalendarEvent(userId, label, data.event as Record<string, unknown>, String(data.calendarId ?? "primary")); break;
      case "docs.get": result = await googleBroker.getDocument(userId, label, String(data.documentId ?? "")); break;
      case "docs.create": result = await googleBroker.createDocument(userId, label, String(data.title ?? "")); break;
      case "docs.insert": result = await googleBroker.insertDocumentText(userId, label, String(data.documentId ?? ""), String(data.text ?? "")); break;
      case "docs.export": result = await googleBroker.exportDocument(userId, label, String(data.documentId ?? ""), String(data.mimeType ?? "text/plain")); break;
    }
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof GoogleAuthorizationError) {
      const status = error.code === "RECONNECT_REQUIRED" || error.code === "SCOPE_REQUIRED" ? 403 : error.code === "CONFIRMATION_REQUIRED" ? 409 : 401;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: "The Google service could not complete the request.", code: "GOOGLE_API_FAILED" }, { status: 502 });
  }
}
