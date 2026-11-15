import { mkdir, writeFile } from "node:fs/promises";
import { FunctionTool, InMemorySessionService, LlmAgent, Runner } from "@google/adk";
import { Type, type Schema } from "@google/genai";
import { OpenRouterLlm } from "../src/lib/adk/openrouter-llm";

type ToolId = "gmail_search" | "gmail_get" | "calendar_list" | "calendar_get" | "docs_search" | "docs_get" | "docs_export" | "propose_send_email" | "propose_calendar_event" | "propose_create_document" | "propose_insert_text";
type Case = { id: string; request: string; expected: ToolId[]; forbidden: ToolId[]; args?: Record<string, unknown> };
const cases: Case[] = [
  { id: "gmail_search_sender", request: "Find unread email from alex@example.com", expected: ["gmail_search"], forbidden: ["gmail_get"], args: { query: "from:alex@example.com is:unread" } },
  { id: "gmail_search_subject", request: "Find messages about the Q4 invoice", expected: ["gmail_search"], forbidden: ["gmail_get"], args: { query: "Q4 invoice" } },
  { id: "gmail_search_date", request: "Search Gmail for mail after 2026-01-01", expected: ["gmail_search"], forbidden: ["gmail_get"], args: { query: "after:2026/01/01" } },
  { id: "gmail_search_recipient", request: "Find emails sent to finance@example.com", expected: ["gmail_search"], forbidden: ["gmail_get"], args: { query: "to:finance@example.com" } },
  { id: "gmail_search_keyword", request: "Look for messages mentioning the launch plan", expected: ["gmail_search"], forbidden: ["gmail_get"], args: { query: "launch plan" } },
  { id: "gmail_search_limit", request: "Show at most 3 emails from sam@example.com", expected: ["gmail_search"], forbidden: ["gmail_get"], args: { query: "from:sam@example.com", maxResults: 3 } },
  { id: "gmail_get_known", request: "Get Gmail message ID msg-123", expected: ["gmail_get"], forbidden: ["gmail_search"], args: { messageId: "msg-123" } },
  { id: "gmail_get_body", request: "Retrieve the details for message id m_789", expected: ["gmail_get"], forbidden: ["gmail_search"], args: { messageId: "m_789" } },
  { id: "gmail_find_then_get", request: "Find the latest email from jo@example.com and retrieve its details", expected: ["gmail_search", "gmail_get"], forbidden: [], args: { query: "from:jo@example.com" } },
  { id: "calendar_range", request: "What meetings do I have between 2026-12-01 and 2026-12-03?", expected: ["calendar_list"], forbidden: ["calendar_get"], args: { timeMin: "2026-12-01", timeMax: "2026-12-03" } },
  { id: "calendar_today", request: "List my calendar for today", expected: ["calendar_list"], forbidden: ["calendar_get"] },
  { id: "calendar_next_week", request: "Show events next week", expected: ["calendar_list"], forbidden: ["calendar_get"] },
  { id: "calendar_range_timezone", request: "List events from 9 AM to noon on 2026-11-20 in New York", expected: ["calendar_list"], forbidden: ["calendar_get"], args: { timeMin: "2026-11-20T09:00:00-05:00", timeMax: "2026-11-20T12:00:00-05:00" } },
  { id: "calendar_specific_range", request: "What is on my calendar from 2026-11-15T00:00:00Z through 2026-11-16T00:00:00Z?", expected: ["calendar_list"], forbidden: ["calendar_get"], args: { timeMin: "2026-11-15T00:00:00Z", timeMax: "2026-11-16T00:00:00Z" } },
  { id: "calendar_get_known", request: "Get calendar event evt-555", expected: ["calendar_get"], forbidden: ["calendar_list"], args: { eventId: "evt-555" } },
  { id: "calendar_get_details", request: "Retrieve details for event ID meeting_42", expected: ["calendar_get"], forbidden: ["calendar_list"], args: { eventId: "meeting_42" } },
  { id: "calendar_find_then_get", request: "Find my first meeting tomorrow and then retrieve that event's details", expected: ["calendar_list", "calendar_get"], forbidden: [] },
  { id: "docs_find_then_get", request: "Find the Google Doc named Quarterly Plan and get its metadata", expected: ["docs_search", "docs_get"], forbidden: ["docs_export"], args: { name: "Quarterly Plan", matchMode: "exact" } },
  { id: "docs_find_then_insert", request: "Find my document called Trip Notes and propose adding 'Packing list'", expected: ["docs_search", "propose_insert_text"], forbidden: ["docs_get", "docs_export"], args: { name: "Trip Notes", matchMode: "exact" } },
  { id: "docs_ambiguous_results", request: "Find my document about expenses", expected: ["docs_search"], forbidden: ["docs_get", "docs_export", "propose_insert_text"] },
  { id: "docs_no_matches", request: "Find a Google Doc named No Such Synthetic Document", expected: ["docs_search"], forbidden: ["docs_get", "docs_export", "propose_insert_text"], args: { name: "No Such Synthetic Document", matchMode: "exact" } },
  { id: "docs_metadata", request: "Get metadata for Google Doc document ID doc-abc", expected: ["docs_get"], forbidden: ["docs_export"], args: { documentId: "doc-abc" } },
  { id: "docs_revision", request: "Check the title and revision ID of document ID d_22", expected: ["docs_get"], forbidden: ["docs_export"], args: { documentId: "d_22" } },
  { id: "docs_read_text", request: "Read the contents of Google Doc ID doc-abc", expected: ["docs_export"], forbidden: ["docs_get"], args: { documentId: "doc-abc", mimeType: "text/plain" } },
  { id: "docs_summarize", request: "Summarize document ID project-notes-1", expected: ["docs_export"], forbidden: ["docs_get"], args: { documentId: "project-notes-1" } },
  { id: "docs_export_html", request: "Export document ID d-html as HTML", expected: ["docs_export"], forbidden: ["docs_get"], args: { documentId: "d-html", mimeType: "text/html" } },
  { id: "docs_meta_then_text", request: "Check metadata and then read text from document ID file-1", expected: ["docs_get", "docs_export"], forbidden: [], args: { documentId: "file-1" } },
  { id: "proposal_email", request: "Send an email to lee@example.com with subject Hello and body See you soon", expected: ["propose_send_email"], forbidden: ["gmail_search", "gmail_get"], args: { to: "lee@example.com", subject: "Hello", body: "See you soon" } },
  { id: "draft_email_only", request: "Draft an email to lee@example.com saying I will be late, but do not send it", expected: [], forbidden: ["propose_send_email"] },
  { id: "proposal_event", request: "Schedule an event called Planning on 2026-12-10 from 10:00 to 11:00 UTC", expected: ["propose_calendar_event"], forbidden: ["calendar_list", "calendar_get"], args: { summary: "Planning", start: "2026-12-10T10:00:00Z", end: "2026-12-10T11:00:00Z" } },
  { id: "check_before_create", request: "Before scheduling Planning for tomorrow at 10, check my calendar for conflicts and then propose the event", expected: ["calendar_list", "propose_calendar_event"], forbidden: ["calendar_get"] },
  { id: "proposal_doc", request: "Create a new Google Doc titled Trip plan", expected: ["propose_create_document"], forbidden: ["docs_get", "docs_export"], args: { title: "Trip plan" } },
  { id: "proposal_insert", request: "Insert the text 'Approved' into document ID doc-99", expected: ["propose_insert_text"], forbidden: ["docs_get", "docs_export"], args: { documentId: "doc-99", text: "Approved" } },
  { id: "proposal_then_read", request: "Propose adding 'Agenda' to doc-99, then read the current contents of doc-99", expected: ["propose_insert_text", "docs_export"], forbidden: ["docs_get"], args: { documentId: "doc-99" } },
  { id: "proposal_not_execution", request: "Please prepare a proposal to send Pat the subject Update and body Ready", expected: ["propose_send_email"], forbidden: ["gmail_search", "gmail_get"], args: { to: "Pat", subject: "Update", body: "Ready" } },
  { id: "ambiguous_email", request: "Open that email for me", expected: [], forbidden: ["gmail_search", "gmail_get"] },
  { id: "ambiguous_doc", request: "Read my document", expected: [], forbidden: ["docs_get", "docs_export"] },
  { id: "ambiguous_event", request: "Tell me about my appointment", expected: [], forbidden: ["calendar_list", "calendar_get"] },
  { id: "both_services_reads", request: "Find unread email from alex@example.com and list events tomorrow", expected: ["gmail_search", "calendar_list"], forbidden: ["gmail_get", "calendar_get"] },
  { id: "general_no_tool", request: "Explain what an inbox is", expected: [], forbidden: ["gmail_search", "gmail_get", "calendar_list", "calendar_get", "docs_get", "docs_export"] },
];

const specs: Record<ToolId, { description: string; properties: Record<string, unknown>; required: string[] }> = {
  gmail_search: { description: "Search Gmail messages. Returns message summaries.", properties: { query: { type: Type.STRING, description: "Gmail query" }, maxResults: { type: Type.NUMBER } }, required: ["query"] },
  gmail_get: { description: "Retrieve a Gmail message by ID.", properties: { messageId: { type: Type.STRING } }, required: ["messageId"] },
  calendar_list: { description: "List calendar events.", properties: { calendarId: { type: Type.STRING }, timeMin: { type: Type.STRING }, timeMax: { type: Type.STRING } }, required: [] },
  calendar_get: { description: "Get a calendar event by ID.", properties: { eventId: { type: Type.STRING }, calendarId: { type: Type.STRING } }, required: ["eventId"] },
  docs_get: { description: "Get Google Doc metadata.", properties: { documentId: { type: Type.STRING } }, required: ["documentId"] },
  docs_search: { description: "Find Google Docs by name. Exact first, partial only when exact has no results.", properties: { name: { type: Type.STRING }, matchMode: { type: Type.STRING }, pageToken: { type: Type.STRING } }, required: ["name", "matchMode"] },
  docs_export: { description: "Export a Google Doc.", properties: { documentId: { type: Type.STRING }, mimeType: { type: Type.STRING } }, required: ["documentId"] },
  propose_send_email: { description: "Propose sending an email; creates a pending approval.", properties: { to: { type: Type.STRING }, subject: { type: Type.STRING }, body: { type: Type.STRING } }, required: ["to", "subject", "body"] },
  propose_calendar_event: { description: "Propose creating a calendar event; creates a pending approval.", properties: { summary: { type: Type.STRING }, start: { type: Type.STRING }, end: { type: Type.STRING } }, required: ["summary", "start", "end"] },
  propose_create_document: { description: "Propose creating a document; creates a pending approval.", properties: { title: { type: Type.STRING } }, required: ["title"] },
  propose_insert_text: { description: "Propose inserting text; creates a pending approval.", properties: { documentId: { type: Type.STRING }, text: { type: Type.STRING } }, required: ["documentId", "text"] },
};

const baselineInstruction = "You are a personal assistant. Use Google tools as needed. Write tools create pending approvals. Never claim writes are complete until confirmed.";
const improvedInstruction = `${baselineInstruction} Gmail search finds messages from criteria; Gmail get retrieves a message only by a known exact ID. Calendar list finds events in a time range; Calendar get retrieves one event only by a known exact ID. Docs search discovers Docs by name: try exact first, then partial only if exact has no results. Use a unique result ID for Docs get, export, or an insert proposal. Ask the user to choose among ambiguous results, including title, modified date, and account label. Docs get returns structure, not text; Docs export returns content from an identified document. Locate documents before proposing edits. Never invent IDs. Ask when an ID or intent is ambiguous. Do not use tools when no Google data is needed. Drafting is not sending. Write tools only create proposals; deterministic confirmation is the only write execution path. Use minimum necessary tools.`;

async function run() {
  if (process.argv[2] !== "--run-live") throw new Error("Opt-in only. Run npm run eval:google-routing -- --run-live");
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required.");
  const model = "inclusionai/ling-3.2-flash:free";
  const attempts = Number(process.env.ROUTING_EVAL_ATTEMPTS ?? 3);
  if (attempts !== 3) throw new Error("ROUTING_EVAL_ATTEMPTS must remain 3 for comparable reporting.");
  const outcomes: Record<string, unknown>[] = [];
  for (const config of ["baseline", "improved"] as const) {
    process.env.OPENROUTER_MODEL = model;
    for (const testCase of cases) for (let attempt = 1; attempt <= attempts; attempt++) {
      const selected: { tool: ToolId; args: Record<string, unknown> }[] = [];
      const tools = (Object.keys(specs) as ToolId[]).map((id) => {
        const spec = specs[id];
        const description = config === "baseline" ? spec.description : improvedDescription(id);
        return new FunctionTool({
          name: id,
          description,
          parameters: { type: Type.OBJECT, properties: spec.properties, required: spec.required } as Schema,
          execute: async (args: unknown) => { const safeArgs = (args && typeof args === "object" ? args : {}) as Record<string, unknown>; selected.push({ tool: id, args: safeArgs }); return { mocked: true }; },
        });
      });
      const service = new InMemorySessionService();
      const runner = new Runner({ appName: "google_tool_routing_eval", agent: new LlmAgent({ name: "routing_evaluator", model: new OpenRouterLlm(), instruction: config === "baseline" ? baselineInstruction : improvedInstruction, tools }), sessionService: service, autoCreateSession: true });
      const events = runner.runAsync({ userId: "synthetic-eval-user", sessionId: `${config}-${testCase.id}-${attempt}`, newMessage: { role: "user", parts: [{ text: testCase.request }] } });
      for await (const event of events) void event;
      const actual = selected.map((x) => x.tool);
      const argsCorrect = !testCase.args || Object.entries(testCase.args).every(([key, value]) => selected.some((x) => JSON.stringify(x.args[key]) === JSON.stringify(value)));
      const missing = testCase.expected.filter((id) => !actual.includes(id));
      const unexpected = actual.filter((id) => !testCase.expected.includes(id));
      const sequenceCorrect = JSON.stringify(actual) === JSON.stringify(testCase.expected);
      const forbiddenSelected = testCase.forbidden.filter((id) => actual.includes(id));
      outcomes.push({ config, caseId: testCase.id, attempt, request: testCase.request, expectedToolSequence: testCase.expected, forbiddenTools: testCase.forbidden, selectedTools: actual, selectedArguments: selected.map((x) => x.args), argumentCorrect: argsCorrect, sequenceCorrect, missingTools: missing, extraTools: unexpected, forbiddenSelected, passed: sequenceCorrect && forbiddenSelected.length === 0 && argsCorrect });
    }
  }
  const summary = ["baseline", "improved"].map((config) => {
    const rows = outcomes.filter((x) => x.config === config) as { passed: boolean; selectedTools: ToolId[]; expectedToolSequence: ToolId[]; argumentCorrect: boolean; forbiddenSelected: ToolId[]; extraTools: ToolId[] }[];
    return { config, attempts: rows.length, routingAccuracy: rows.filter((x) => x.passed).length / rows.length, wrongToolSelections: rows.filter((x) => x.selectedTools.some((tool) => !x.expectedToolSequence.includes(tool))).length, unnecessaryCalls: rows.filter((x) => x.extraTools.length || x.forbiddenSelected.length).length, argumentAccuracy: rows.filter((x) => x.argumentCorrect).length / rows.length };
  });
  const report = { model, attemptsPerCase: attempts, cases: cases.length, summary, outcomes };
  await mkdir("eval-results", { recursive: true });
  await writeFile(`eval-results/google-routing-${new Date().toISOString().replaceAll(":", "-")}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

function improvedDescription(id: ToolId): string {
  const descriptions: Record<ToolId, string> = {
    gmail_search: "Find Gmail messages from search criteria. Returns summaries and IDs. Use for sender/subject/date criteria, not to retrieve a known message ID.",
    gmail_get: "Retrieve one known Gmail message by exact messageId. Does not search; use Gmail search to discover matching messages.",
    calendar_list: "Find calendar events in a time range. Returns summaries and IDs. Use Calendar get for a known event ID.",
    calendar_get: "Retrieve one known calendar event by exact eventId. Does not find events by date or title; use Calendar list.",
    docs_get: "Retrieve supported Google Doc metadata and structure by known documentId; does not return text. Use Docs export for content.",
    docs_search: "Find Docs by name in this account. Try exact first and partial only if exact has no results. Use a unique result ID for retrieval or a proposal. Ask the user to choose among ambiguous results, showing title, modified date, and account label.",
    docs_export: "Export text content from an existing Google Doc by known documentId. Use to read or summarize document contents.",
    propose_send_email: "Create a pending email approval only; never sends. Use only when explicitly asked to send, not when asked to draft.",
    propose_calendar_event: "Create a pending event approval only; never creates the event. Use for explicit scheduling requests, not calendar lookup.",
    propose_create_document: "Create a pending document-creation approval only; never creates the document.",
    propose_insert_text: "Create a pending text-insertion approval only; never modifies the document.",
  };
  return descriptions[id];
}

run().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Evaluation failed."); process.exitCode = 1; });
