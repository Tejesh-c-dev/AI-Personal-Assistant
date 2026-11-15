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

  describe("streaming actions", () => {
    it("handles stream-start, stream-activity, stream-approval, stream-delta, and stream-final", () => {
      let state = chatReducer(initialChatState, {
        type: "submit",
        message: "Send email",
        messageId: "u-1",
      });

      state = chatReducer(state, {
        type: "stream-start",
        messageId: "a-temp",
      });

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toEqual({
        id: "a-temp",
        role: "assistant",
        content: "",
        activities: [],
        isStreaming: true,
      });

      // Activity: running
      state = chatReducer(state, {
        type: "stream-activity",
        activity: { id: "act-1", label: "Searching Gmail", status: "running" },
      });
      expect(state.messages[1].activities).toEqual([
        { id: "act-1", label: "Searching Gmail", status: "running" },
      ]);

      // Activity: completed update
      state = chatReducer(state, {
        type: "stream-activity",
        activity: { id: "act-1", label: "Searching Gmail", status: "completed" },
      });
      expect(state.messages[1].activities).toEqual([
        { id: "act-1", label: "Searching Gmail", status: "completed" },
      ]);

      // Approval required
      state = chatReducer(state, {
        type: "stream-approval",
        approval: {
          approvalId: "app-1",
          account: "personal",
          operation: "gmail.send",
          expiresAt: "2026-11-15T00:00:00Z",
          details: { to: "bob@example.com" },
        },
      });
      expect(state.messages[1].pendingApproval).toMatchObject({ approvalId: "app-1" });

      // Progressive text deltas
      state = chatReducer(state, { type: "stream-delta", text: "I have " });
      state = chatReducer(state, { type: "stream-delta", text: "prepared the draft." });
      expect(state.messages[1].content).toBe("I have prepared the draft.");
      expect(state.messages[1].isStreaming).toBe(true);

      // Final
      state = chatReducer(state, { type: "stream-final", messageId: "a-final" });
      expect(state.isLoading).toBe(false);
      expect(state.messages[1].id).toBe("a-final");
      expect(state.messages[1].isStreaming).toBe(false);
    });

    it("handles stream-abort by cancelling running activities and clearing loading", () => {
      let state = chatReducer(initialChatState, {
        type: "submit",
        message: "Long task",
        messageId: "u-1",
      });
      state = chatReducer(state, { type: "stream-start", messageId: "a-1" });
      state = chatReducer(state, {
        type: "stream-activity",
        activity: { id: "act-1", label: "Searching Gmail", status: "running" },
      });

      state = chatReducer(state, { type: "stream-abort" });
      expect(state.isLoading).toBe(false);
      expect(state.messages[1].isStreaming).toBe(false);
      expect(state.messages[1].activities).toEqual([
        { id: "act-1", label: "Searching Gmail", status: "cancelled" },
      ]);
    });
  });

  it("updates approval state from the backend response", () => {
    const state = {
      ...initialChatState,
      messages: [{ id: "m1", role: "assistant" as const, content: "", pendingApproval: { approvalId: "approval-1", account: "work", operation: "docs.create" as const, expiresAt: "later", details: { title: "Notes" }, status: "pending" as const } }],
    };
    const updated = chatReducer(state, { type: "approval-updated", approvalId: "approval-1", status: "approved", result: "Document created." });
    expect(updated.messages[0].pendingApproval).toMatchObject({ status: "approved", result: "Document created." });
  });
});
