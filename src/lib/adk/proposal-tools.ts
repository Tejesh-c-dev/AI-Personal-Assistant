import "server-only";

import { FunctionTool } from "@google/adk";
import { Type, type Schema } from "@google/genai";
import {
  issueGoogleProposalCapability,
  verifyGoogleProposalCapability,
  type GoogleOperation,
} from "../google-api";
import { createGoogleWriteApproval } from "../google-write-approvals";

export interface ProposalToolContext {
  userId: string;
  conversationId: string;
  selectedLabels: string[];
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

  const tools: FunctionTool[] = [];

  // 1. Propose Gmail Send
  tools.push(
    new FunctionTool({
      name: sanitizeToolName(label, "send_email"),
      description: `Propose sending an email from the '${label}' account. Creates a pending approval; does NOT send the email.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          to: {
            type: Type.STRING,
            description: "Recipient email address.",
          },
          subject: {
            type: Type.STRING,
            description: "Email subject line.",
          },
          body: {
            type: Type.STRING,
            description: "Email body content in plain text.",
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
        const approval = await createApprovalForOperation(userId, label, conversationId, "gmail.send", payload);

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
      description: `Propose creating a new calendar event in the '${label}' account. Creates a pending approval; does NOT create the event.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: "Title or summary of the event.",
          },
          start: {
            type: Type.STRING,
            description: "Start time in ISO/RFC3339 format (e.g. '2026-11-15T10:00:00Z').",
          },
          end: {
            type: Type.STRING,
            description: "End time in ISO/RFC3339 format (e.g. '2026-11-15T11:00:00Z').",
          },
          description: {
            type: Type.STRING,
            description: "Optional event description.",
          },
          calendarId: {
            type: Type.STRING,
            description: "Calendar ID, defaults to 'primary'.",
          },
        },
        required: ["summary", "start", "end"],
      } as Schema,
      execute: async (rawInput: unknown) => {
        const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
        const summary = String(input.summary ?? "").trim();
        const start = String(input.start ?? "").trim();
        const end = String(input.end ?? "").trim();
        const description = typeof input.description === "string" ? input.description.trim() : undefined;
        const calendarId = String(input.calendarId ?? "primary");

        if (!summary || !start || !end) {
          return { error: "'summary', 'start', and 'end' are all required to propose a calendar event." };
        }

        const eventPayload: Record<string, unknown> = {
          summary,
          start: { dateTime: start },
          end: { dateTime: end },
          ...(description ? { description } : {}),
        };

        const payload = { event: eventPayload, calendarId };
        const approval = await createApprovalForOperation(userId, label, conversationId, "calendar.create", payload);

        return {
          ...approval,
          proposedEvent: {
            account: label,
            calendarId,
            summary,
            start,
            end,
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
        const approval = await createApprovalForOperation(userId, label, conversationId, "docs.create", payload);

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
      description: `Propose inserting text into an existing Google Doc in the '${label}' account. Creates a pending approval; does NOT insert text.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          documentId: {
            type: Type.STRING,
            description: "The Google Docs document ID.",
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
        const text = String(input.text ?? "");

        if (!documentId || !text) {
          return { error: "'documentId' and 'text' are required to propose inserting text." };
        }

        const payload = { documentId, text };
        const approval = await createApprovalForOperation(userId, label, conversationId, "docs.insert", payload);

        return {
          ...approval,
          proposedInsertion: {
            account: label,
            documentId,
            textPreview: text.slice(0, 200),
          },
        };
      },
    }),
  );

  return tools;
}
