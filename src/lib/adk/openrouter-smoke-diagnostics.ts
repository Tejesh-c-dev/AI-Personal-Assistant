import { OpenRouterError, type OpenRouterFailureStage } from "./openrouter-llm";

export type SmokeTestName = "configuration" | "Test A" | "Test B";
export type SmokeFailureStage = OpenRouterFailureStage | "ADK execution" | "tool invocation";

export function formatSmokeFailure(input: {
  test: SmokeTestName;
  stage: SmokeFailureStage;
  error?: unknown;
  missingVariable?: "OPENROUTER_API_KEY" | "OPENROUTER_MODEL";
}): string {
  const fields: Array<[string, string | number | boolean | undefined]> = [
    ["test", input.test],
  ];

  if (input.missingVariable) {
    fields.push(["stage", "configuration"], ["category", "configuration failure"], ["missing", input.missingVariable]);
  } else if (input.error instanceof OpenRouterError) {
    const details = input.error.diagnostics;
    fields.push(
      ["stage", details.stage],
      ["http_status", details.httpStatus],
      ["error_code", details.openRouterErrorCode],
      ["error_type", details.errorType],
      ["provider_code", details.providerCode],
      ["request_id", details.requestId],
      ["http_error", details.httpError],
      ["category", details.category],
    );
  } else {
    const category = input.stage === "configuration" ? "configuration failure"
      : input.stage === "tool invocation" ? "tool invocation failure"
        : input.stage === "ADK execution" ? "ADK execution failure"
          : input.stage === "http request" ? "network failure"
            : input.stage === "OpenRouter response" ? "OpenRouter response failure"
              : input.stage === "response validation" ? "invalid response"
                : "unknown failure";
    fields.push(["stage", input.stage], ["category", category]);
  }

  return `FAIL OpenRouter smoke test: ${fields
    .filter((field): field is [string, string | number | boolean] => field[1] !== undefined)
    .map(([name, value]) => `${name}=${String(value).replace(/[^A-Za-z0-9_.:/ -]/g, "_")}`)
    .join(" ")}.`;
}
