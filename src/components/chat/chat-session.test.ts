import { describe, expect, it, vi } from "vitest";

import { createSessionId } from "./chat-session";

describe("chat sessions", () => {
  it("creates a session ID through crypto.randomUUID", () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce("conversation-one")
      .mockReturnValueOnce("conversation-two");
    vi.stubGlobal("crypto", { randomUUID });

    const firstSessionId = createSessionId();
    const reusedSessionId = firstSessionId;
    const newSessionId = createSessionId();

    expect(firstSessionId).toBe("conversation-one");
    expect(reusedSessionId).toBe(firstSessionId);
    expect(newSessionId).toBe("conversation-two");
    expect(randomUUID).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
