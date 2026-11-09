import { describe, expect, it } from "vitest";

import { chatReducer, initialChatState } from "./chat-state";

describe("chat state", () => {
  it("rejects empty messages and tracks loading after a valid submit", () => {
    expect(chatReducer(initialChatState, {
      type: "submit",
      message: "   ",
      messageId: "empty",
    })).toBe(initialChatState);

    const state = chatReducer(initialChatState, {
      type: "submit",
      message: " Check my emails ",
      messageId: "user-1",
    });

    expect(state).toMatchObject({
      composerValue: "",
      error: null,
      isLoading: true,
    });
    expect(state.messages).toEqual([
      { content: "Check my emails", id: "user-1", role: "user" },
    ]);
  });

  it("adds assistant responses and clears loading", () => {
    const loadingState = chatReducer(initialChatState, {
      type: "submit",
      message: "Hello",
      messageId: "user-1",
    });

    expect(chatReducer(loadingState, {
      type: "assistant-response",
      message: { content: "Hi!", id: "assistant-1", role: "assistant" },
    })).toEqual({
      composerValue: "",
      error: null,
      isLoading: false,
      messages: [
        { content: "Hello", id: "user-1", role: "user" },
        { content: "Hi!", id: "assistant-1", role: "assistant" },
      ],
    });
  });

  it("clears loading and stores request failures", () => {
    const state = chatReducer(
      { ...initialChatState, isLoading: true },
      { type: "request-failed", message: "The assistant request failed." },
    );

    expect(state).toEqual({
      ...initialChatState,
      error: "The assistant request failed.",
    });
  });

  it("resets the visible conversation state for New Chat", () => {
    const state = chatReducer(
      {
        composerValue: "draft",
        error: "old error",
        isLoading: true,
        messages: [{ content: "Old", id: "old", role: "user" }],
      },
      { type: "new-chat" },
    );

    expect(state).toEqual(initialChatState);
  });
});
