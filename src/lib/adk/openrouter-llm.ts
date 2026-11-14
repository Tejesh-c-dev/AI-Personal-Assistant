import "server-only";

import { isIP } from "node:net";
import { BaseLlm } from "@google/adk";
import type { BaseLlmConnection } from "@google/adk";
import type { LlmRequest, LlmResponse } from "@google/adk";
import type { FunctionDeclaration } from "@google/genai";

type OpenRouterMessage = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

export type OpenRouterFailureStage = "configuration" | "http request" | "OpenRouter response" | "response validation";
export type OpenRouterFailureCategory =
  | "invalid request"
  | "invalid API key"
  | "account/payment restriction"
  | "permission or privacy restriction"
  | "timeout"
  | "rate limit"
  | "upstream provider failure"
  | "no eligible provider"
  | "model or endpoint not found"
  | "network failure"
  | "configuration failure"
  | "invalid response"
  | "unsupported operation";

export type OpenRouterDiagnostics = {
  stage: OpenRouterFailureStage;
  category: OpenRouterFailureCategory;
  httpStatus?: number;
  openRouterErrorCode?: number | string;
  errorType?: string;
  providerCode?: number | string;
  requestId?: string;
  httpError?: boolean;
};

export class OpenRouterError extends Error {
  constructor(
    readonly code: "CONFIGURATION" | "REQUEST" | "UPSTREAM" | "TIMEOUT" | "UNSUPPORTED",
    readonly diagnostics: OpenRouterDiagnostics = {
      stage: code === "CONFIGURATION" ? "configuration" : "response validation",
      category: code === "CONFIGURATION" ? "configuration failure" : code === "TIMEOUT" ? "timeout" : code === "UNSUPPORTED" ? "unsupported operation" : "invalid response",
    },
  ) {
    super("OpenRouter inference request failed.");
    this.name = "OpenRouterError";
  }
}

function safeCode(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z0-9_.:-]+$/.test(value)) return undefined;
  if (/secret|private|prompt|credential|authorization|bearer|sk-or/i.test(value)) return undefined;
  return value;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(value)) return undefined;
  if (/secret|private|prompt|credential|authorization|bearer|sk-or/i.test(value)) return undefined;
  return value;
}

function errorDetails(payload: unknown): { code?: number | string; errorType?: string; providerCode?: number | string } {
  const root = record(payload);
  const error = record(root?.error);
  const metadata = record(error?.metadata);
  return {
    code: safeCode(error?.code),
    errorType: safeId(metadata?.error_type),
    providerCode: safeCode(metadata?.provider_code),
  };
}

function categoryForStatus(status: number, payload?: unknown): OpenRouterFailureCategory {
  switch (status) {
    case 400: return "invalid request";
    case 401: return "invalid API key";
    case 402: return "account/payment restriction";
    case 403: return "permission or privacy restriction";
    case 408: return "timeout";
    case 429: return "rate limit";
    case 502: return "upstream provider failure";
    case 503: return "no eligible provider";
    case 404: {
      const error = record(record(payload)?.error);
      const message = typeof error?.message === "string" ? error.message : "";
      return /no endpoints? found|no eligible providers?|no providers? (?:are )?available/i.test(message)
        ? "no eligible provider"
        : "model or endpoint not found";
    }
    default: return "upstream provider failure";
  }
}

async function responseFailure(response: Response, stage: "OpenRouter response" | "response validation", httpError: boolean, knownPayload?: unknown): Promise<OpenRouterError> {
  let payload = knownPayload;
  if (payload === undefined) {
    try { payload = await response.clone().json(); } catch { /* A body is never included in diagnostics. */ }
  }
  const details = errorDetails(payload);
  const root = record(payload);
  const category = httpError
    ? categoryForStatus(response.status, payload)
    : stage === "OpenRouter response" ? categoryForStatus(details.code && typeof details.code === "number" ? details.code : response.status, payload) : "invalid response";
  const requestId = safeId(response.headers.get("x-openrouter-generation-id"))
    ?? safeId(response.headers.get("x-request-id"))
    ?? safeId(root?.id);
  return new OpenRouterError("UPSTREAM", {
    stage,
    category,
    httpStatus: response.status,
    openRouterErrorCode: details.code,
    errorType: details.errorType,
    providerCode: details.providerCode,
    requestId,
    httpError,
  });
}

function record(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function schemaJson(schema: unknown): unknown {
  if (!record(schema)) return schema;
  const input = schema as JsonObject;
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "type" && typeof value === "string") output.type = value.toLowerCase();
    else if (key === "properties" && record(value)) output.properties = Object.fromEntries(Object.entries(value as JsonObject).map(([k, v]) => [k, schemaJson(v)]));
    else if (key === "items") output.items = schemaJson(value);
    else if (key === "required" || key === "enum" || key === "description" || key === "additionalProperties" || key === "format") output[key] = value;
  }
  return output;
}

function extractSystemInstruction(request: LlmRequest): string {
  const value = request.config?.systemInstruction;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => typeof part === "string" ? part : "").filter(Boolean).join("\n");
  const obj = record(value);
  return Array.isArray(obj?.parts) ? (obj.parts as JsonObject[]).map((part) => typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n") : "";
}

function toMessages(request: LlmRequest): OpenRouterMessage[] {
  const messages: OpenRouterMessage[] = [];
  const system = extractSystemInstruction(request);
  if (system) messages.push({ role: "system", content: system });
  for (const content of request.contents) {
    const role = content.role === "model" ? "assistant" : "user";
    let text = "";
    const calls: JsonObject[] = [];
    for (const rawPart of content.parts ?? []) {
      const part = record(rawPart);
      if (!part) continue;
      if (typeof part.text === "string") text += (text ? "\n" : "") + part.text;
      const call = record(part.functionCall);
      if (call && typeof call.name === "string") calls.push({ id: typeof call.id === "string" ? call.id : `adk_${calls.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } });
      const result = record(part.functionResponse);
      if (result && typeof result.name === "string") messages.push({ role: "tool", tool_call_id: typeof result.id === "string" ? result.id : result.name, content: JSON.stringify(result.response ?? {}) });
    }
    if (calls.length) messages.push({ role, ...(text ? { content: text } : { content: null }), tool_calls: calls });
    else if (text) messages.push({ role, content: text });
  }
  return messages;
}

function toTools(request: LlmRequest): JsonObject[] | undefined {
  const configuredTools = request.config?.tools ?? [];
  const declarationLists = configuredTools.map((tool) => record(tool)?.functionDeclarations);
  if (declarationLists.some((list) => !Array.isArray(list))) throw new OpenRouterError("UNSUPPORTED");
  const declarations = declarationLists.flatMap((list) => list as FunctionDeclaration[]);
  const allowed = request.allowedTools ? new Set(request.allowedTools) : null;
  const tools = declarations.filter((decl) => decl.name && (!allowed || allowed.has(decl.name))).map((decl) => ({
    type: "function",
    function: {
      name: decl.name,
      ...(decl.description ? { description: decl.description } : {}),
      parameters: schemaJson(decl.parametersJsonSchema ?? decl.parameters ?? { type: "OBJECT", properties: {} }),
    },
  }));
  return tools.length ? tools : undefined;
}

export class OpenRouterLlm extends BaseLlm {
  constructor(model = process.env.OPENROUTER_MODEL?.trim() || "") {
    if (!model) throw new OpenRouterError("CONFIGURATION");
    super({ model });
  }

  async *generateContentAsync(request: LlmRequest, stream = false, abortSignal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    if (stream) throw new OpenRouterError("UNSUPPORTED");
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey || !this.model) throw new OpenRouterError("CONFIGURATION");
    let endpoint = "https://openrouter.ai/api/v1/chat/completions";
    const configuredEndpoint = process.env.OPENROUTER_BASE_URL?.trim();
    if (configuredEndpoint) {
      try {
        if (process.env.NODE_ENV === "production") throw new Error("The local endpoint override is unavailable in production.");
        const url = new URL(configuredEndpoint);
        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        const loopback = hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && hostname.startsWith("127."));
        if (url.protocol !== "http:" || !loopback || url.username || url.password || url.search || url.hash) {
          throw new Error("OPENROUTER_BASE_URL must be a loopback HTTP URL without credentials, query, or fragment.");
        }
        endpoint = url.toString();
      } catch {
        throw new OpenRouterError("CONFIGURATION");
      }
    }
    const timeout = new AbortController();
    const timeoutId = setTimeout(() => timeout.abort(), Number(process.env.OPENROUTER_TIMEOUT_MS) || 120_000);
    const signal = abortSignal ? AbortSignal.any([abortSignal, timeout.signal]) : timeout.signal;
    try {
      const messages = toMessages(request);
      const tools = toTools(request);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            messages,
            ...(tools ? { tools, tool_choice: "auto" } : {}),
            stream: false,
            provider: { zdr: true, data_collection: "deny", require_parameters: true, allow_fallbacks: false },
          }),
          signal,
        });
      } catch {
        const cancelled = signal.aborted && abortSignal?.aborted;
        const timedOut = signal.aborted && !cancelled;
        throw new OpenRouterError(cancelled ? "REQUEST" : timedOut ? "TIMEOUT" : "UPSTREAM", {
          stage: "http request",
          category: timedOut ? "timeout" : "network failure",
          httpError: false,
        });
      }
      if (!response.ok) throw await responseFailure(response, "OpenRouter response", true);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw await responseFailure(response, "response validation", false); }
      if (record(payload)?.error != null) throw await responseFailure(response, "OpenRouter response", false, payload);
      const root = record(payload), choices = root?.choices;
      const first = Array.isArray(choices) ? record(choices[0]) : null;
      const message = record(first?.message);
      if (!message || (message.content != null && typeof message.content !== "string") || (message.tool_calls != null && !Array.isArray(message.tool_calls))) throw await responseFailure(response, "response validation", false, payload);
      const parts: JsonObject[] = [];
      if (typeof message.content === "string" && message.content) parts.push({ text: message.content });
      for (const rawCall of (message.tool_calls as unknown[] | undefined) ?? []) {
        const call = record(rawCall), fn = record(call?.function);
        if (!call || !fn || typeof call.id !== "string" || typeof fn.name !== "string" || typeof fn.arguments !== "string") throw await responseFailure(response, "response validation", false, payload);
        let args: unknown;
        try { args = JSON.parse(fn.arguments); } catch { throw await responseFailure(response, "response validation", false, payload); }
        if (!record(args)) throw await responseFailure(response, "response validation", false, payload);
        parts.push({ functionCall: { id: call.id, name: fn.name, args } });
      }
      if (!parts.length) throw await responseFailure(response, "response validation", false, payload);
      yield { content: { role: "model", parts } as LlmResponse["content"], turnComplete: true };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new OpenRouterError("UNSUPPORTED");
  }
}
