/** Roles the desktop renderer understands for visual styling. */
export type MessageRole = "user" | "agent" | "tool" | "tool_request" | "thinking";

export interface ChatMessage {
  id: string;
  /** Simplified role used by the renderer to pick bubble/avatar style. */
  role: MessageRole;
  content: string;
  /** Original autogen message type (e.g. "TextMessage", "ToolCallExecutionEvent"). */
  msgType?: string;
  /** Tool name extracted from a ToolCallRequestEvent / ToolCallExecutionEvent. */
  toolName?: string;
  /** Raw arguments/result JSON for tool messages (preserved for future expansion). */
  toolPayload?: string;
}

export interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: {
    provider: string;
    model: string;
    label: string;
    baseUrl: string;
  }[];
}

export interface UsageState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}
