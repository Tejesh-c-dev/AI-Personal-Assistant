import "server-only";

export type ActivityStatus = "running" | "completed" | "failed" | "cancelled";

export interface MappedActivity {
  label: string;
  category: "gmail" | "calendar" | "docs" | "general";
}

export interface PendingApprovalPreview {
  approvalId: string;
  account: string;
  operation: "gmail.send" | "calendar.create" | "docs.create" | "docs.insert";
  expiresAt: string;
  details: Record<string, string>;
}

export function mapToolToActivityLabel(toolName: string): MappedActivity {
  const normalized = toolName.toLowerCase();

  if (normalized.endsWith("_gmail_search")) {
    return { label: "Searching Gmail", category: "gmail" };
  }
  if (normalized.endsWith("_gmail_get")) {
    return { label: "Retrieving email", category: "gmail" };
  }
  if (normalized.endsWith("_calendar_list")) {
    return { label: "Listing Calendar events", category: "calendar" };
  }
  if (normalized.endsWith("_calendar_get")) {
    return { label: "Retrieving Calendar event", category: "calendar" };
  }
  if (normalized.endsWith("_docs_get")) {
    return { label: "Reading Google Doc", category: "docs" };
  }
  if (normalized.endsWith("_docs_export")) {
    return { label: "Exporting Google Doc", category: "docs" };
  }
  if (normalized.endsWith("_propose_send_email") || normalized.endsWith("_send_email")) {
    return { label: "Preparing email approval", category: "gmail" };
  }
  if (normalized.endsWith("_propose_create_calendar_event") || normalized.endsWith("_create_calendar_event")) {
    return { label: "Preparing Calendar approval", category: "calendar" };
  }
  if (normalized.endsWith("_propose_create_document") || normalized.endsWith("_create_document")) {
    return { label: "Preparing document approval", category: "docs" };
  }
  if (normalized.endsWith("_propose_insert_document_text") || normalized.endsWith("_insert_document_text")) {
    return { label: "Preparing document edit approval", category: "docs" };
  }

  return { label: "Executing action", category: "general" };
}

export function extractPendingApproval(response: unknown): PendingApprovalPreview | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }

  const rec = response as Record<string, unknown>;
  const approvalId = typeof rec.approvalId === "string" ? rec.approvalId.trim() : "";
  const status = typeof rec.status === "string" ? rec.status : "";
  const expiresAt = typeof rec.expiresAt === "string" ? rec.expiresAt : "";

  if (!approvalId || status !== "pending_confirmation" || !expiresAt) {
    return null;
  }

  // 1. Email Proposal
  if (rec.proposedEmail && typeof rec.proposedEmail === "object") {
    const email = rec.proposedEmail as Record<string, unknown>;
    const account = typeof email.account === "string" ? email.account : "personal";
    const to = typeof email.to === "string" ? email.to : "";
    const subject = typeof email.subject === "string" ? email.subject : "";
    const bodyPreview = typeof email.bodyPreview === "string" ? email.bodyPreview : "";

    return {
      approvalId,
      account,
      operation: "gmail.send",
      expiresAt,
      details: { to, subject, bodyPreview },
    };
  }

  // 2. Calendar Proposal
  if (rec.proposedEvent && typeof rec.proposedEvent === "object") {
    const ev = rec.proposedEvent as Record<string, unknown>;
    const account = typeof ev.account === "string" ? ev.account : "personal";
    const summary = typeof ev.summary === "string" ? ev.summary : "";
    const start = typeof ev.start === "string" ? ev.start : "";
    const end = typeof ev.end === "string" ? ev.end : "";
    const calendarId = typeof ev.calendarId === "string" ? ev.calendarId : "primary";

    return {
      approvalId,
      account,
      operation: "calendar.create",
      expiresAt,
      details: { summary, date: typeof ev.date === "string" ? ev.date : start.slice(0, 10), start, end, timezone: String(ev.timezone ?? ""), durationMinutes: String(ev.durationMinutes ?? ""), durationSource: String(ev.durationSource ?? ""), calendarId },
    };
  }

  // 3. Create Document Proposal
  if (rec.proposedDocument && typeof rec.proposedDocument === "object") {
    const doc = rec.proposedDocument as Record<string, unknown>;
    const account = typeof doc.account === "string" ? doc.account : "personal";
    const title = typeof doc.title === "string" ? doc.title : "";

    return {
      approvalId,
      account,
      operation: "docs.create",
      expiresAt,
      details: { title },
    };
  }

  // 4. Insert Text Proposal
  if (rec.proposedInsertion && typeof rec.proposedInsertion === "object") {
    const ins = rec.proposedInsertion as Record<string, unknown>;
    const account = typeof ins.account === "string" ? ins.account : "personal";
    const documentName = typeof ins.documentName === "string" ? ins.documentName : "Google document";
    const textPreview = typeof ins.textPreview === "string" ? ins.textPreview : "";

    return {
      approvalId,
      account,
      operation: "docs.insert",
      expiresAt,
      details: { documentName, textPreview },
    };
  }

  return null;
}
