export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
  | { type: "new-chat" };

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
      return { ...state, error: null, isLoading: false, messages: action.messages, composerValue: "" };
    case "new-chat":
      return initialChatState;
  }
}
