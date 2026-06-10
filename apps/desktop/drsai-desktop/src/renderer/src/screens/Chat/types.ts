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

export interface ModelItem {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit: number;
  max_tokens: number;
  reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
}

export interface ModelGroup {
  client_type: string;
  providerLabel: string;
  models: ModelItem[];
}

export interface UsageState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}