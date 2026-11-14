import "server-only";

import { FunctionTool } from "@google/adk";
import { Type, type Schema } from "@google/genai";
import {
  googleBroker,
  issueGoogleCapability,
  verifyGoogleCapability,
  type GoogleReadOperation,
} from "../google-api";

const MAX_SEARCH_RESULTS = 20;
const MAX_TEXT_CHARS = 4_000;
const MAX_DOC_CHARS = 8_000;

export interface ReadToolContext {
  userId: string;
  selectedLabels: string[];
}

function sanitizeToolName(label: string, operation: string): string {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const safeOp = operation.replace(/\./g, "_");
  return `${safeLabel}_${safeOp}`;
}

async function executeWithReadCapability<T>(
  userId: string,
  label: string,
  operation: GoogleReadOperation,
  fn: () => Promise<T>,
): Promise<T> {
  const token = await issueGoogleCapability(userId, label, [operation]);
  await verifyGoogleCapability(token, userId, label, operation);
  return fn();
}

function sanitizeGmailMessage(msg: unknown): Record<string, unknown> {
  if (!msg || typeof msg !== "object") return {};
  const record = msg as Record<string, unknown>;
  const payload = record.payload as Record<string, unknown> | undefined;
  const headers = Array.isArray(payload?.headers)
    ? (payload.headers as Array<{ name?: string; value?: string }>)
    : [];

  const findHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const snippet = typeof record.snippet === "string" ? record.snippet.slice(0, MAX_TEXT_CHARS) : "";

  return {
    id: record.id,
    threadId: record.threadId,
    subject: findHeader("subject"),
    from: findHeader("from"),
    to: findHeader("to"),
    date: findHeader("date"),
    snippet,
  };
}

export function buildReadTools(ctx: ReadToolContext): FunctionTool[] {
  const tools: FunctionTool[] = [];

  for (const label of ctx.selectedLabels) {
    const userId = ctx.userId;

    // 1. Gmail search
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "gmail.search"),
        description: `Search Gmail messages in the '${label}' account. Returns message summaries.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: "Gmail search query (e.g., 'from:colleague@example.com is:unread').",
            },
            maxResults: {
              type: Type.NUMBER,
              description: "Maximum results to return (between 1 and 20, default 10).",
            },
          },
          required: ["query"],
        } as Schema,
        execute: async (rawInput: unknown) => {
          const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
          const query = String(input.query ?? "").trim();
          if (!query) {
            return { error: "Query cannot be empty." };
          }
          const num = Number(input.maxResults ?? 10);
          const maxResults = Math.min(Math.max(Number.isFinite(num) ? num : 10, 1), MAX_SEARCH_RESULTS);

          return executeWithReadCapability(userId, label, "gmail.search", async () => {
            const raw = await googleBroker.searchGmail(userId, label, query, maxResults);
            if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).messages)) {
              const list = (raw as Record<string, unknown>).messages as Array<Record<string, unknown>>;
              return { messages: list.slice(0, maxResults) };
            }
            return raw;
          });
        },
      }),
    );

    // 2. Gmail get
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "gmail.get"),
        description: `Retrieve details of a single Gmail message by ID from the '${label}' account.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            messageId: {
              type: Type.STRING,
              description: "The Gmail message ID.",
            },
          },
          required: ["messageId"],
        } as Schema,
        execute: async (rawInput: unknown) => {
          const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
          const messageId = String(input.messageId ?? "").trim();
          if (!messageId) {
            return { error: "messageId cannot be empty." };
          }

          return executeWithReadCapability(userId, label, "gmail.get", async () => {
            const raw = await googleBroker.getGmailMessage(userId, label, messageId);
            return sanitizeGmailMessage(raw);
          });
        },
      }),
    );

    // 3. Calendar list
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "calendar.list"),
        description: `List upcoming calendar events from the '${label}' account.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            calendarId: {
              type: Type.STRING,
              description: "Calendar identifier, defaults to 'primary'.",
            },
            timeMin: {
              type: Type.STRING,
              description: "Start of time range in ISO/RFC3339 format (e.g., '2026-11-14T00:00:00Z').",
            },
            timeMax: {
              type: Type.STRING,
              description: "End of time range in ISO/RFC3339 format.",
            },
          },
        } as Schema,
        execute: async (rawInput: unknown) => {
          const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
          const calendarId = String(input.calendarId ?? "primary");
          const timeMin = typeof input.timeMin === "string" && input.timeMin.trim() ? input.timeMin.trim() : undefined;
          const timeMax = typeof input.timeMax === "string" && input.timeMax.trim() ? input.timeMax.trim() : undefined;

          return executeWithReadCapability(userId, label, "calendar.list", async () => {
            const raw = await googleBroker.listCalendarEvents(userId, label, calendarId, timeMin, timeMax);
            if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).items)) {
              const items = (raw as Record<string, unknown>).items as Array<Record<string, unknown>>;
              return {
                events: items.slice(0, MAX_SEARCH_RESULTS).map((ev) => ({
                  id: ev.id,
                  summary: ev.summary,
                  start: ev.start,
                  end: ev.end,
                  status: ev.status,
                })),
              };
            }
            return raw;
          });
        },
      }),
    );

    // 4. Calendar get
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "calendar.get"),
        description: `Get details of a specific calendar event by ID from the '${label}' account.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            eventId: {
              type: Type.STRING,
              description: "The calendar event ID.",
            },
            calendarId: {
              type: Type.STRING,
              description: "Calendar identifier, defaults to 'primary'.",
            },
          },
          required: ["eventId"],
        } as Schema,
        execute: async (rawInput: unknown) => {
          const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
          const eventId = String(input.eventId ?? "").trim();
          if (!eventId) {
            return { error: "eventId cannot be empty." };
          }
          const calendarId = String(input.calendarId ?? "primary");

          return executeWithReadCapability(userId, label, "calendar.get", async () => {
            const ev = (await googleBroker.getCalendarEvent(userId, label, eventId, calendarId)) as Record<string, unknown>;
            if (!ev || typeof ev !== "object") return {};
            return {
              id: ev.id,
              summary: ev.summary,
              description: typeof ev.description === "string" ? ev.description.slice(0, MAX_TEXT_CHARS) : undefined,
              start: ev.start,
              end: ev.end,
              location: ev.location,
              status: ev.status,
            };
          });
        },
      }),
    );

    // 5. Docs get
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "docs.get"),
        description: `Retrieve metadata and structure of a Google Doc by document ID from the '${label}' account.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            documentId: {
              type: Type.STRING,
              description: "The Google Docs document ID.",
            },
          },
          required: ["documentId"],
        } as Schema,
        execute: async (rawInput: unknown) => {
          const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
          const documentId = String(input.documentId ?? "").trim();
          if (!documentId) {
            return { error: "documentId cannot be empty." };
          }

          return executeWithReadCapability(userId, label, "docs.get", async () => {
            const doc = (await googleBroker.getDocument(userId, label, documentId)) as Record<string, unknown>;
            if (!doc || typeof doc !== "object") return {};
            return {
              documentId: doc.documentId,
              title: doc.title,
              revisionId: doc.revisionId,
            };
          });
        },
      }),
    );

    // 6. Docs export
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "docs.export"),
        description: `Export the text content of a Google Doc from the '${label}' account.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            documentId: {
              type: Type.STRING,
              description: "The Google Docs document ID.",
            },
            mimeType: {
              type: Type.STRING,
              description: "Export format, defaults to 'text/plain'.",
            },
          },
          required: ["documentId"],
        } as Schema,
        execute: async (rawInput: unknown) => {
          const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
          const documentId = String(input.documentId ?? "").trim();
          if (!documentId) {
            return { error: "documentId cannot be empty." };
          }
          const mimeType = String(input.mimeType ?? "text/plain");

          return executeWithReadCapability(userId, label, "docs.export", async () => {
            const text = await googleBroker.exportDocument(userId, label, documentId, mimeType);
            const str = typeof text === "string" ? text : "";
            return {
              documentId,
              content: str.slice(0, MAX_DOC_CHARS),
              truncated: str.length > MAX_DOC_CHARS,
            };
          });
        },
      }),
    );
  }

  return tools;
}
