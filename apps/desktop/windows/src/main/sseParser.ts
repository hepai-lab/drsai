export interface ChatSseChoice {
  delta?: { content?: string };
  message?: { content?: string };
}

export interface ChatSsePayload {
  error?: string | { message?: string };
  choices?: ChatSseChoice[];
  file_event?: unknown;
  file_events?: unknown;
  metadata?: { file_event?: unknown; file_events?: unknown };
}

export function parseCompletionSseFrame(frame: string): string[] {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!payload || payload === "[DONE]") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }

  const value = parsed as ChatSsePayload;
  if (value.error) {
    const error = value.error;
    throw new Error(typeof error === "string" ? error : error.message || JSON.stringify(error));
  }

  const content = value.choices?.[0]?.delta?.content ?? value.choices?.[0]?.message?.content ?? "";
  return content ? [content] : [];
}

export function isCompletionDoneFrame(frame: string): boolean {
  return frame
    .split(/\r?\n/)
    .some((line) => line.startsWith("data:") && line.slice(5).trim() === "[DONE]");
}

export const parseChatSseFrame = parseCompletionSseFrame;
export const parseAgentRunSseFrame = parseCompletionSseFrame;

export interface AgentRunSseFileEvent {
  action: "read" | "create" | "modify" | "delete" | "rename" | "patch" | "artifact";
  path: string;
  name?: string;
  hash?: string;
  diff?: string;
  source?: string;
  targetPath?: string;
  timestamp?: string;
}

export function parseAgentRunSseFileEvents(frame: string): AgentRunSseFileEvent[] {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!payload || payload === "[DONE]") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const value = parsed as ChatSsePayload;
  return [
    ...normalizeFileEvents(value.file_event),
    ...normalizeFileEvents(value.file_events),
    ...normalizeFileEvents(value.metadata?.file_event),
    ...normalizeFileEvents(value.metadata?.file_events),
  ];
}

function normalizeFileEvents(value: unknown): AgentRunSseFileEvent[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const action = normalizeAction(record.action);
    const path = typeof record.path === "string" ? record.path : "";
    if (!action || !path.trim()) return [];
    return [{
      action,
      path: path.trim(),
      name: typeof record.name === "string" ? record.name : undefined,
      hash: typeof record.hash === "string" ? record.hash : undefined,
      diff: typeof record.diff === "string" ? record.diff : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
      targetPath: typeof record.targetPath === "string" ? record.targetPath : undefined,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
    }];
  });
}

function normalizeAction(value: unknown): AgentRunSseFileEvent["action"] | null {
  if (value === "read" || value === "create" || value === "modify" || value === "delete" ||
    value === "rename" || value === "patch" || value === "artifact") {
    return value;
  }
  return null;
}
