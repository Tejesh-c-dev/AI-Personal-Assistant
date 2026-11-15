export type ToolActivity = {
  id: string;
  label: string;
  status: "running" | "completed" | "failed" | "cancelled";
};

export type ApprovalStatus = "pending" | "confirming" | "approved" | "rejected" | "expired" | "failed" | "uncertain" | "unavailable";

export type ApprovalPreviewData = {
  approvalId: string;
  account: string;
  operation: "gmail.send" | "calendar.create" | "docs.create" | "docs.insert";
  expiresAt: string;
  details: Record<string, string>;
  status?: ApprovalStatus;
  result?: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  activities?: ToolActivity[];
  pendingApproval?: ApprovalPreviewData;
  isStreaming?: boolean;
};

export type ChatState = {
  messages: ChatMessage[];
  composerValue: string;
  isLoading: boolean;
  error: string | null;
};

export type ChatAction =
  | { type: "composer-changed"; value: string }
  | { type: "submit"; message: string; messageId: string }
  | { type: "assistant-response"; message: ChatMessage }
  | { type: "request-failed"; message: string }
  | { type: "load-messages"; messages: ChatMessage[] }
  | { type: "new-chat" }
  | { type: "stream-start"; messageId: string }
  | { type: "stream-activity"; activity: ToolActivity }
  | { type: "stream-approval"; approval: ApprovalPreviewData }
  | { type: "approval-updated"; approvalId: string; status: ApprovalStatus; result?: string | null }
  | { type: "stream-delta"; text: string }
  | { type: "stream-final"; messageId?: string }
  | { type: "stream-abort" }
  | { type: "stream-error"; message: string };

export const initialChatState: ChatState = {
  messages: [],
  composerValue: "",
  isLoading: false,
  error: null,
};

export function isMessageValid(message: string): boolean {
  return message.trim().length > 0;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "composer-changed":
      return { ...state, composerValue: action.value };

    case "submit":
      if (!isMessageValid(action.message) || state.isLoading) {
        return state;
      }
      return {
        ...state,
        composerValue: "",
        error: null,
        isLoading: true,
        messages: [
          ...state.messages,
          { content: action.message.trim(), id: action.messageId, role: "user" },
        ],
      };

    case "assistant-response":
      return {
        ...state,
        error: null,
        isLoading: false,
        messages: [...state.messages, action.message],
      };

    case "request-failed":
      return { ...state, error: action.message, isLoading: false };

    case "load-messages":
      return {
        ...state,
        error: null,
        isLoading: false,
        messages: action.messages,
        composerValue: "",
      };

    case "new-chat":
      return initialChatState;

    case "stream-start": {
      const activeMsg: ChatMessage = {
        id: action.messageId,
        role: "assistant",
        content: "",
        activities: [],
        isStreaming: true,
      };
      return {
        ...state,
        messages: [...state.messages, activeMsg],
      };
    }

    case "stream-activity": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") return state;

      const existingActivities = last.activities ?? [];
      const index = existingActivities.findIndex((a) => a.id === action.activity.id);

      let updatedActivities: ToolActivity[];
      if (index >= 0) {
        updatedActivities = existingActivities.map((a, i) =>
          i === index ? action.activity : a,
        );
      } else {
        updatedActivities = [...existingActivities, action.activity];
      }

      const updatedLast: ChatMessage = {
        ...last,
        activities: updatedActivities,
      };

      return {
        ...state,
        messages: [...state.messages.slice(0, -1), updatedLast],
      };
    }

    case "stream-approval": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") return state;

      const updatedLast: ChatMessage = {
        ...last,
        pendingApproval: action.approval,
      };

      return {
        ...state,
        messages: [...state.messages.slice(0, -1), updatedLast],
      };
    }

    case "approval-updated":
      return {
        ...state,
        messages: state.messages.map((message) => message.pendingApproval?.approvalId === action.approvalId
          ? { ...message, pendingApproval: { ...message.pendingApproval, status: action.status, result: action.result } }
          : message),
      };

    case "stream-delta": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") return state;

      const updatedLast: ChatMessage = {
        ...last,
        content: last.content + action.text,
      };

      return {
        ...state,
        messages: [...state.messages.slice(0, -1), updatedLast],
      };
    }

    case "stream-final": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") {
        return { ...state, isLoading: false };
      }

      const updatedLast: ChatMessage = {
        ...last,
        id: action.messageId || last.id,
        isStreaming: false,
      };

      return {
        ...state,
        isLoading: false,
        messages: [...state.messages.slice(0, -1), updatedLast],
      };
    }

    case "stream-abort": {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") {
        return { ...state, isLoading: false };
      }

      const cancelledActivities = (last.activities ?? []).map((a) =>
        a.status === "running" ? { ...a, status: "cancelled" as const } : a,
      );

      const updatedLast: ChatMessage = {
        ...last,
        activities: cancelledActivities,
        isStreaming: false,
      };

      return {
        ...state,
        isLoading: false,
        messages: [...state.messages.slice(0, -1), updatedLast],
      };
    }

    case "stream-error": {
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === "assistant" && last.isStreaming) {
        const updatedLast: ChatMessage = {
          ...last,
          isStreaming: false,
        };
        return {
          ...state,
          isLoading: false,
          error: action.message,
          messages: [...state.messages.slice(0, -1), updatedLast],
        };
      }

      return {
        ...state,
        isLoading: false,
        error: action.message,
      };
    }
  }
}
