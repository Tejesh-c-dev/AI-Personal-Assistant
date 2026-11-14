import { FunctionTool, InMemorySessionService, isFinalResponse, LlmAgent, Runner } from "@google/adk";
import type { Event, LlmRequest } from "@google/adk";
import { loadEnvConfig } from "@next/env";
import { OpenRouterError, OpenRouterLlm } from "../src/lib/adk/openrouter-llm.js";
import { formatSmokeFailure, type SmokeFailureStage, type SmokeTestName } from "../src/lib/adk/openrouter-smoke-diagnostics.js";

loadEnvConfig(process.cwd());

type JsonRecord = Record<string, unknown>;

const syntheticToolResult = "synthetic-smoke-result-7f31";
const appName = "openrouter-live-smoke";
const userId = "synthetic-smoke-user";
const sessionId = "synthetic-smoke-session";
let activeTest: SmokeTestName = "configuration";
let activeStage: SmokeFailureStage = "configuration";
let missingVariable: "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | undefined;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredEnvironment(name: "OPENROUTER_API_KEY" | "OPENROUTER_MODEL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    missingVariable = name;
    throw new Error("Required OpenRouter configuration is missing.");
  }
  return value;
}

function assertPrivacyRequirements(body: JsonRecord): void {
  const provider = body.provider;
  if (!isRecord(provider)
    || provider.zdr !== true
    || provider.data_collection !== "deny"
    || provider.allow_fallbacks !== false) {
    throw new Error("A request did not include the required OpenRouter privacy settings.");
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function getRequestMessages(body: JsonRecord): JsonRecord[] {
  return Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
}

async function main(): Promise<void> {
  // Validate both before making a request. The adapter itself is explicitly selected,
  // so no Gemini configuration or fallback is consulted.
  requiredEnvironment("OPENROUTER_API_KEY");
  requiredEnvironment("OPENROUTER_MODEL");

  const realFetch = globalThis.fetch.bind(globalThis);
  const sentBodies: JsonRecord[] = [];
  globalThis.fetch = async (input, init) => {
    activeStage = "http request";
    if (typeof init?.body !== "string") throw new Error("OpenRouter request body was unavailable for privacy validation.");
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      throw new Error("OpenRouter request body was not valid JSON.");
    }
    if (!isRecord(body)) throw new Error("OpenRouter request body was not an object.");
    assertPrivacyRequirements(body);
    sentBodies.push(body);
    const response = await realFetch(input, init);
    activeStage = activeTest === "Test A" ? "response validation" : "ADK execution";
    return response;
  };

  try {
    activeTest = "Test A";
    activeStage = "http request";
    const textStart = sentBodies.length;
    const textRequest: LlmRequest = {
      contents: [{ role: "user", parts: [{ text: "Reply with a short greeting." }] }],
      config: {},
      liveConnectConfig: {},
      toolsDict: {},
    };
    let textResponse = "";
    for await (const response of new OpenRouterLlm().generateContentAsync(textRequest)) {
      for (const part of response.content?.parts ?? []) {
        if (typeof part.text === "string") textResponse += part.text;
      }
    }
    activeStage = "response validation";
    assert(textResponse.trim().length > 0, "Text inference returned no assistant response.");
    assert(sentBodies.length === textStart + 1, "Text inference did not make exactly one OpenRouter request.");
    console.log("PASS Test A: OpenRouter returned a nonempty assistant response with required privacy settings.");

    activeTest = "Test B";
    activeStage = "ADK execution";
    const toolStart = sentBodies.length;
    let toolExecutionCount = 0;
    let toolInvocationFailed = false;
    const tool = new FunctionTool({
      name: "synthetic_lookup",
      description: "Return a fixed synthetic smoke-test value. This tool does not access external services or data.",
      execute: () => {
        activeStage = "tool invocation";
        try {
          toolExecutionCount += 1;
          return syntheticToolResult;
        } catch {
          toolInvocationFailed = true;
          throw new Error("Synthetic tool invocation failed.");
        } finally {
          if (!toolInvocationFailed) activeStage = "ADK execution";
        }
      },
    });
    const agent = new LlmAgent({
      name: "openrouter_smoke_agent",
      model: new OpenRouterLlm(),
      instruction: `For the user's request, call synthetic_lookup exactly once, then include its returned value verbatim in your final answer. Do not invent or omit the returned value.`,
      tools: [tool],
    });
    const sessionService = new InMemorySessionService();
    const runner = new Runner({ appName, agent, sessionService });
    const events: Event[] = [];

    try {
      await sessionService.createSession({ appName, userId, sessionId });
      for await (const event of runner.runAsync({
        userId,
        sessionId,
        newMessage: { role: "user", parts: [{ text: "Use the synthetic lookup tool and report its result." }] },
      })) {
        events.push(event);
      }
    } catch (error: unknown) {
      if (error instanceof OpenRouterError) throw error;
      if (toolInvocationFailed) activeStage = "tool invocation";
      throw new Error("ADK execution failed.");
    } finally {
      await runner.close();
    }

    if (toolInvocationFailed) {
      activeStage = "tool invocation";
      throw new Error("Synthetic tool invocation failed.");
    }
    activeStage = "ADK execution";
    assert(sentBodies.length > toolStart, "The ADK Runner made no OpenRouter request.");
    const toolRoundMessages = sentBodies.slice(toolStart).flatMap(getRequestMessages);
    assert(toolRoundMessages.some((message) => message.role === "assistant"
      && Array.isArray(message.tool_calls)
      && message.tool_calls.some((call) => isRecord(call)
        && isRecord(call.function)
        && call.function.name === "synthetic_lookup")), "The model did not request the synthetic tool.");
    assert(toolExecutionCount === 1, "ADK did not execute the synthetic tool exactly once.");
    assert(toolRoundMessages.some((message) => message.role === "tool"
      && typeof message.content === "string"
      && message.content.includes(syntheticToolResult)), "The tool result was not returned to the model.");

    const finalText = events
      .filter((event) => isFinalResponse(event))
      .flatMap((event) => event.content?.parts ?? [])
      .flatMap((part) => typeof part.text === "string" ? [part.text] : [])
      .join("\n");
    activeStage = "response validation";
    assert(finalText.includes(syntheticToolResult), "The final assistant response did not contain the synthetic tool result.");
    console.log("PASS Test B: OpenRouter requested the tool, ADK executed it, returned its result, and produced a matching final answer.");
  } finally {
    // Do not retain captured prompts, tool results, or request bodies beyond the test.
    sentBodies.length = 0;
    globalThis.fetch = realFetch;
  }
}

main().catch((error: unknown) => {
  console.error(formatSmokeFailure({ test: activeTest, stage: activeStage, error, missingVariable }));
  process.exitCode = 1;
});
