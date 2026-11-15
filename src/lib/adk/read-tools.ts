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
  fn: (expectedAccountId: string) => Promise<T>,
): Promise<T> {
  const token = await issueGoogleCapability(userId, label, [operation]);
  const verified = await verifyGoogleCapability(token, userId, label, operation);
  return fn(verified.accountId);
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
        description: `Find Gmail messages in the '${label}' account using Gmail search criteria. Use this to discover matching messages (sender, recipient, words, dates, labels, or read status). This returns summaries and IDs. Do not use it to retrieve a known message by ID; use the Gmail get tool for that. Example: query "from:alex@example.com is:unread".`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: "Gmail search operators or terms used to find messages, e.g. 'from:alex@example.com after:2026/01/01'. Required; this is not a message ID.",
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
        description: `Retrieve details of one already-known Gmail message by its messageId from the '${label}' account. Use after a search result or when the user supplied the ID. This does not search by sender, subject, or other criteria; use Gmail search to find messages.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            messageId: {
              type: Type.STRING,
              description: "Exact Gmail message ID from a previous result or user input; do not put search criteria here.",
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
        description: `Find calendar events in a time range in the '${label}' account. Use for schedules, date ranges, or finding events by time. Returns event summaries and IDs. To retrieve details for a known event ID, use Calendar get.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            calendarId: {
              type: Type.STRING,
              description: "Calendar identifier, defaults to 'primary'.",
            },
            timeMin: {
              type: Type.STRING,
              description: "Inclusive start of the requested time range in RFC3339, including timezone (e.g. '2026-11-14T00:00:00-05:00'). Use with timeMax to bound a range.",
            },
            timeMax: {
              type: Type.STRING,
              description: "Exclusive end of the requested time range in RFC3339, including timezone. Use with timeMin to bound a range.",
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
        description: `Retrieve details of one already-known calendar event by exact eventId from the '${label}' account. Use an ID from Calendar list or the user. This does not find events by date, title, or attendee; use Calendar list for that.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            eventId: {
              type: Type.STRING,
              description: "Exact event ID from a prior Calendar list result or user input; not a title or search query.",
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

    // 5. Docs search
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "docs.search"),
        description: `Find Google Docs by name in the '${label}' account. Search exact title first; if no results, retry using partial matching. Use the unique result's documentId for Docs get, export, or an insert proposal. If multiple results remain, ask the user to choose using title, modified date, and account label.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Document name or distinctive title text, not a document ID." },
            matchMode: { type: Type.STRING, description: "Use 'exact' first, then 'partial' only if exact returns no files." },
            pageToken: { type: Type.STRING, description: "Optional Drive page token to continue this same match mode." },
          },
          required: ["name", "matchMode"],
        } as Schema,
        execute: async (rawInput: unknown) => {
          const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
          const name = typeof input.name === "string" ? input.name.trim() : "";
          const matchMode = input.matchMode === "partial" ? "partial" : input.matchMode === "exact" ? "exact" : null;
          const pageToken = typeof input.pageToken === "string" && input.pageToken.trim() ? input.pageToken.trim() : undefined;
          if (!name || !matchMode) return { error: "A name and matchMode ('exact' or 'partial') are required." };
          return executeWithReadCapability(userId, label, "docs.search", async (expectedAccountId) => {
            const raw = await googleBroker.searchDocuments(userId, label, name, matchMode, pageToken, expectedAccountId);
            const result = raw && typeof raw === "object" ? raw as { files?: unknown[]; nextPageToken?: unknown } : {};
            const files = Array.isArray(result.files) ? result.files.slice(0, 10).flatMap((file) => {
              if (!file || typeof file !== "object") return [];
              const record = file as Record<string, unknown>;
              if (typeof record.id !== "string" || typeof record.name !== "string" || record.mimeType !== "application/vnd.google-apps.document") return [];
              return [{ documentId: record.id, name: record.name, mimeType: record.mimeType, modifiedTime: typeof record.modifiedTime === "string" ? record.modifiedTime : undefined, webViewLink: typeof record.webViewLink === "string" ? record.webViewLink : undefined, account: label }];
            }) : [];
            return { files, ...(typeof result.nextPageToken === "string" ? { nextPageToken: result.nextPageToken } : {}) };
          });
        },
      }),
    );

    // 6. Docs get
    tools.push(
      new FunctionTool({
        name: sanitizeToolName(label, "docs.get"),
        description: `Retrieve metadata and structure for an identified Google Doc by known documentId in the '${label}' account. This returns metadata, not document text. Use Docs export to read/export text content; use Docs search to discover a document by name.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            documentId: {
              type: Type.STRING,
              description: "Exact Google Docs document ID already known from the user or another result; not a title or search query.",
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
        description: `Export text from an identified Google Doc in the '${label}' account by known documentId. Use this when the user asks to read, quote, or summarize document contents. Locate by name with Docs search first when needed.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            documentId: {
              type: Type.STRING,
              description: "Exact Google Docs document ID already known from the user or another result; not a title or search query.",
            },
            mimeType: {
              type: Type.STRING,
              description: "Requested export MIME type; defaults to 'text/plain' for readable text. Examples: 'text/plain' or 'text/html'.",
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
