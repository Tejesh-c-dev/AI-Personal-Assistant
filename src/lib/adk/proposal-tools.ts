import "server-only";

import { FunctionTool } from "@google/adk";
import { Type, type Schema } from "@google/genai";
import {
  issueGoogleProposalCapability,
  verifyGoogleProposalCapability,
  type GoogleOperation,
} from "../google-api";
import { createGoogleWriteApproval } from "../google-write-approvals";
import { createTrustedTimeContext, resolveCalendarTime, type TrustedTimeContext } from "../trusted-time";

export interface ProposalToolContext {
  userId: string;
  conversationId: string;
  selectedLabels: string[];
  trustedTime?: TrustedTimeContext;
}

function sanitizeToolName(label: string, action: string): string {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const safeAction = action.replace(/\./g, "_");
  return `${safeLabel}_propose_${safeAction}`;
}

async function createApprovalForOperation(
  userId: string,
  label: string,
  conversationId: string,
  operation: GoogleOperation,
  payload: unknown,
  displayDetails: Record<string, string>,
) {
  const token = await issueGoogleProposalCapability(userId, label, operation, conversationId);
  const verified = await verifyGoogleProposalCapability(token, operation);
  const stored = await createGoogleWriteApproval({
    userId: verified.userId,
    conversationId: verified.conversationId,
    label: verified.label,
    googleAccountId: verified.accountId,
    operation,
    payload,
    displayDetails,
  });

  return {
    approvalId: stored.approvalId,
    expiresAt: stored.expiresAt,
    confirmationInstruction: `To execute this write, the user must explicitly send: CONFIRM ${stored.approvalId}`,
    status: "pending_confirmation",
  };
}

export function buildProposalTools(ctx: ProposalToolContext): FunctionTool[] {
  // Never expose write proposal tools for "both" or multiple accounts
  if (ctx.selectedLabels.length !== 1) {
    return [];
  }

  const label = ctx.selectedLabels[0];
  const { userId, conversationId } = ctx;
  const trustedTime = ctx.trustedTime ?? createTrustedTimeContext("UTC");

  const tools: FunctionTool[] = [];

  // 1. Propose Gmail Send
  tools.push(
    new FunctionTool({
      name: sanitizeToolName(label, "send_email"),
      description: `Create a proposal to send an email from the '${label}' account. This only creates a pending approval; it never sends email. Use only when the user explicitly asks to send. For a draft/compose request, write the draft in chat and do not create a proposal.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          to: {
            type: Type.STRING,
            description: "Recipient email address, supplied or confirmed by the user.",
          },
          subject: {
            type: Type.STRING,
            description: "Email subject line. Preserve the user's requested meaning and do not invent details.",
          },
          body: {
            type: Type.STRING,
            description: "Full proposed plain-text body. The user must explicitly confirm the returned approval ID before any sending occurs.",
          },
        },
        required: ["to", "subject", "body"],
      } as Schema,
      execute: async (rawInput: unknown) => {
        const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
        const to = String(input.to ?? "").trim();
        const subject = String(input.subject ?? "").trim();
        const body = String(input.body ?? "").trim();

        if (!to || !subject || !body) {
          return { error: "'to', 'subject', and 'body' are all required to propose sending an email." };
        }

        const payload = { to, subject, body };
        const approval = await createApprovalForOperation(userId, label, conversationId, "gmail.send", payload, { to, subject, bodyPreview: body.slice(0, 300) });

        return {
          ...approval,
          proposedEmail: {
            account: label,
            to,
            subject,
            bodyPreview: body.slice(0, 300),
          },
        };
      },
    }),
  );

  // 2. Propose Calendar Event
  tools.push(
    new FunctionTool({
      name: sanitizeToolName(label, "create_calendar_event"),
      description: `Create a proposal to create a new calendar event in the '${label}' account. This only creates a pending approval; it never creates the event. Use only when the user explicitly asks to schedule/create it. For a request to check or find events, use Calendar list instead.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: "Title or summary of the event.",
          },
          date: {
            type: Type.STRING,
            description: `Local event date in YYYY-MM-DD, resolved using trusted today ${trustedTime.localDate} (${trustedTime.weekday}) in ${trustedTime.timezone}.`,
          },
          time: {
            type: Type.STRING,
            description: "Local start time in 24-hour HH:mm format. Interpret clear 12 AM/PM correctly; clarify genuinely ambiguous AM/PM.",
          },
          timezone: { type: Type.STRING, description: "Optional explicitly named IANA timezone for this event." },
          durationMinutes: { type: Type.INTEGER, description: "Optional explicit event duration in minutes." },
          kind: { type: Type.STRING, description: "Use alarm or reminder for short reminder requests; otherwise event." },
          description: {
            type: Type.STRING,
            description: "Optional event description.",
          },
          calendarId: {
            type: Type.STRING,
            description: "Calendar ID, defaults to 'primary'.",
          },
        },
        required: ["summary", "date", "time"],
      } as Schema,
      execute: async (rawInput: unknown) => {
        const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
        const summary = String(input.summary ?? "").trim();
        const date = String(input.date ?? "").trim();
        const time = String(input.time ?? "").trim();
        const timezone = typeof input.timezone === "string" ? input.timezone.trim() : undefined;
        const durationMinutes = input.durationMinutes === undefined ? undefined : Number(input.durationMinutes);
        const kind = input.kind === "alarm" || input.kind === "reminder" ? input.kind : "event";
        const description = typeof input.description === "string" ? input.description.trim() : undefined;
        const calendarId = String(input.calendarId ?? "primary");

        if (!summary || !date || !time) {
          return { error: "'summary', 'date', and 'time' are all required to propose a calendar event." };
        }

        const resolved = resolveCalendarTime({ reference: trustedTime, date, time, timezone, durationMinutes, kind });
        if (!resolved.ok) return { error: resolved.message };
        const timing = resolved.value;

        const eventPayload: Record<string, unknown> = {
          summary,
          start: { dateTime: timing.startDateTime, timeZone: timing.timezone },
          end: { dateTime: timing.endDateTime, timeZone: timing.timezone },
          ...(description ? { description } : {}),
        };

        const payload = { event: eventPayload, calendarId, referenceInstant: timing.referenceInstant, localStart: timing.localStart, localEnd: timing.localEnd, timezone: timing.timezone, durationMinutes: timing.durationMinutes, durationSource: timing.durationSource };
        const displayDetails = { summary, date: timing.localStart.slice(0, 10), start: timing.localStart, end: timing.localEnd, timezone: timing.timezone, durationMinutes: String(timing.durationMinutes), durationSource: timing.durationSource };
        const approval = await createApprovalForOperation(userId, label, conversationId, "calendar.create", payload, displayDetails);

        return {
          ...approval,
          proposedEvent: {
            account: label,
            calendarId,
            summary,
            date: timing.localStart.slice(0, 10),
            start: timing.localStart,
            end: timing.localEnd,
            timezone: timing.timezone,
            durationMinutes: String(timing.durationMinutes),
            durationSource: timing.durationSource,
          },
        };
      },
    }),
  );

  // 3. Propose Create Document
  tools.push(
    new FunctionTool({
      name: sanitizeToolName(label, "create_document"),
      description: `Propose creating a new Google Doc in the '${label}' account. Creates a pending approval; does NOT create the document.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: "Title of the document to create.",
          },
        },
        required: ["title"],
      } as Schema,
      execute: async (rawInput: unknown) => {
        const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
        const title = String(input.title ?? "").trim();

        if (!title) {
          return { error: "'title' is required to propose creating a document." };
        }

        const payload = { title };
        const approval = await createApprovalForOperation(userId, label, conversationId, "docs.create", payload, { title });

        return {
          ...approval,
          proposedDocument: {
            account: label,
            title,
          },
        };
      },
    }),
  );

  // 4. Propose Insert Text
  tools.push(
    new FunctionTool({
      name: sanitizeToolName(label, "insert_document_text"),
      description: `Create an approval proposal to insert text into an identified Google Doc in the '${label}' account. Locate the document with Docs search first when its ID is unknown, and pass both its documentId and displayed name as documentName. This only creates a pending approval; deterministic confirmation is the only path that executes the write.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          documentId: {
            type: Type.STRING,
            description: "Exact Google Docs document ID from a unique Docs search result or user supplied ID.",
          },
          documentName: {
            type: Type.STRING,
            description: "Document title shown by the Docs search result, if known. Presentation only; this is not used to execute the write.",
          },
          text: {
            type: Type.STRING,
            description: "The text content to insert.",
          },
        },
        required: ["documentId", "text"],
      } as Schema,
      execute: async (rawInput: unknown) => {
        const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
        const documentId = String(input.documentId ?? "").trim();
        const documentName = String(input.documentName ?? "").trim();
        const text = String(input.text ?? "");

        if (!documentId || !text) {
          return { error: "'documentId' and 'text' are required to propose inserting text." };
        }

        const payload = { documentId, text };
        const displayDetails = { documentName: documentName || "Google document", textPreview: text.slice(0, 200) };
        const approval = await createApprovalForOperation(userId, label, conversationId, "docs.insert", payload, displayDetails);

        return {
          ...approval,
          proposedInsertion: {
            account: label,
            documentName: displayDetails.documentName,
            textPreview: text.slice(0, 200),
          },
        };
      },
    }),
  );

  return tools;
}
