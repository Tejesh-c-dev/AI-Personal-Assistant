import "server-only";

import { createEvent, isFinalResponse, type Event, type InMemorySessionService, type Session } from "@google/adk";
import type { Message } from "../db/schema";

export const APP_NAME = "ai-personal-assistant";
export const MAX_HISTORY_MESSAGES = 20; // up to 10 back-and-forth pairs

/**
 * Hydrates an in-memory ADK session with existing conversation history from PostgreSQL.
 *
 * NOTE: The current turn's user message MUST NOT be included in `priorMessages`.
 * It will be supplied separately to `runner.runAsync({ newMessage: ... })`, ensuring
 * it is processed and persisted into the session exactly once.
 */
export async function hydrateSession(
  sessionService: InMemorySessionService,
  userId: string,
  conversationId: string,
  priorMessages: Message[],
): Promise<Session> {
  const session = await sessionService.createSession({
    appName: APP_NAME,
    userId,
    sessionId: conversationId,
  });

  const bounded = priorMessages.slice(-MAX_HISTORY_MESSAGES);

  for (let i = 0; i < bounded.length; i++) {
    const msg = bounded[i];
    const isUser = msg.role === "user";
    const author = isUser ? "user" : "personal_assistant";
    const role = isUser ? "user" : "model";

    const event = createEvent({
      invocationId: `hist_${conversationId}_${i}`,
      author,
      content: {
        role,
        parts: [{ text: msg.content }],
      },
    });

    await sessionService.appendEvent({ session, event });
  }

  return session;
}

/**
 * Extracts the user-facing text from the ADK events generated during `runner.runAsync`.
 * Prefers events tagged with `isFinalResponse(event)`. If none match, falls back to
 * collecting text from non-user response events.
 */
export function extractFinalResponse(events: Event[]): string | null {
  const finalEvents = events.filter((event) => {
    if (!event) return false;
    try {
      return isFinalResponse(event);
    } catch {
      return false;
    }
  });

  if (finalEvents.length > 0) {
    const parts: string[] = [];
    for (const event of finalEvents) {
      if (event.content?.parts) {
        for (const part of event.content.parts) {
          if (typeof part.text === "string" && part.text.trim()) {
            parts.push(part.text.trim());
          }
        }
      }
    }
    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
  }

  // Fallback for events that contain content from the assistant/model
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.author !== "user" && ev.content?.parts) {
      const textParts = ev.content.parts
        .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
        .filter(Boolean);
      if (textParts.length > 0) {
        return textParts.join("\n").trim();
      }
    }
  }

  return null;
}
