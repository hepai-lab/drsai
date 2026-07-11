export interface ChatSseChoice {
  delta?: {
    content?: string;
    tool_call?: unknown;
    tool_calls?: unknown;
    content_block?: unknown;
  };
  message?: {
    content?: string;
    role?: string;
    name?: string;
    tool_call_id?: string;
    tool_call?: unknown;
    tool_calls?: unknown;
  };
}

export interface ChatSsePayload {
  error?: string | { message?: string };
  type?: string;
  role?: string;
  content?: unknown;
  output?: unknown;
  item?: unknown;
  delta?: unknown;
  content_block?: unknown;
  choices?: ChatSseChoice[];
  file_event?: unknown;
  file_events?: unknown;
  tool_call?: unknown;
  tool_calls?: unknown;
  tool_event?: unknown;
  tool_events?: unknown;
  metadata?: {
    file_event?: unknown;
    file_events?: unknown;
    tool_call?: unknown;
    tool_calls?: unknown;
    tool_event?: unknown;
    tool_events?: unknown;
  };
}

export interface AgentLogSsePayload {
  title?: string;
  content?: string;
  level?: string;
  content_type?: string;
}

export interface ChatToolTimelineEvent {
  id: string;
  kind: "tool_call" | "tool_result" | "log" | "diff" | "artifact";
  title: string;
  status?: "started" | "running" | "completed" | "failed";
  content?: string;
  toolName?: string;
  path?: string;
  timestamp?: string;
  level?: string;
}

export function parseCompletionSseFrame(frame: string): string[] {
  const payload = getSseData(frame);

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

export function parseAgentLogSseFrame(frame: string): AgentLogSsePayload | null {
  if (getSseEventName(frame) !== "agent.log") return null;

  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as AgentLogSsePayload;
  const content = typeof value.content === "string" ? value.content.trim() : "";
  if (!content) return null;

  return {
    title: typeof value.title === "string" ? value.title : undefined,
    content,
    level: typeof value.level === "string" ? value.level : undefined,
    content_type: typeof value.content_type === "string" ? value.content_type : undefined,
  };
}

export function parseChatToolTimelineSseFrame(frame: string): ChatToolTimelineEvent[] {
  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const value = parsed as ChatSsePayload;
  const eventName = getSseEventName(frame);
  const candidates = [
    ...normalizeUnknownItems(value.tool_call),
    ...normalizeUnknownItems(value.tool_calls),
    ...normalizeUnknownItems(value.tool_event),
    ...normalizeUnknownItems(value.tool_events),
    ...normalizeUnknownItems(value.metadata?.tool_call),
    ...normalizeUnknownItems(value.metadata?.tool_calls),
    ...normalizeUnknownItems(value.metadata?.tool_event),
    ...normalizeUnknownItems(value.metadata?.tool_events),
    ...extractChoiceToolCandidates(value.choices),
    ...extractProviderToolCandidates(parsed),
  ];
  if (/^(?:tool\.progress|tool\.call|tool\.result|agent\.tool|tool)$/i.test(eventName)) {
    candidates.push(parsed);
  }

  return candidates.flatMap((item, index) =>
    normalizeToolTimelineEvent(item, eventName, index),
  );
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

function normalizeUnknownItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function extractChoiceToolCandidates(choices: ChatSseChoice[] | undefined): unknown[] {
  if (!choices?.length) return [];
  return choices.flatMap((choice) => {
    const items = [
      ...normalizeUnknownItems(choice.delta?.tool_call),
      ...normalizeUnknownItems(choice.delta?.tool_calls),
      ...normalizeUnknownItems(choice.delta?.content_block),
      ...normalizeUnknownItems(choice.message?.tool_call),
      ...normalizeUnknownItems(choice.message?.tool_calls),
    ];
    if (isToolLikeRecord(choice.message)) items.push(choice.message);
    return items;
  });
}

function extractProviderToolCandidates(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const items = [
    ...normalizeUnknownItems(record.content_block),
    ...normalizeUnknownItems(record.item),
    ...normalizeUnknownItems(record.output),
  ];
  const delta = record.delta;
  if (isToolLikeRecord(delta)) items.push(delta);
  for (const contentItem of normalizeUnknownItems(record.content)) {
    if (isToolLikeRecord(contentItem)) items.push(contentItem);
  }
  return items;
}

function isToolLikeRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const type = readString(record.type).toLowerCase();
  const role = readString(record.role).toLowerCase();
  return Boolean(
    readString(record.tool_call_id) ||
    readString(record.toolName) ||
    readString(record.tool_name) ||
    readString(record.tool) ||
    readString(record.function_name) ||
    readString(readObject(record.function)?.name) ||
    type === "tool_use" ||
    type === "tool_result" ||
    type === "function_call" ||
    type === "function_result" ||
    type === "server_tool_call" ||
    role === "tool",
  );
}

function normalizeToolTimelineEvent(
  value: unknown,
  eventName: string,
  index: number,
): ChatToolTimelineEvent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const functionRecord = readObject(record.function);
  const structuredInput =
    record.arguments ??
    functionRecord?.arguments ??
    record.input ??
    record.parameters ??
    record.params;
  const toolName =
    readString(record.toolName) ||
    readString(record.tool_name) ||
    readString(record.tool) ||
    readString(functionRecord?.name) ||
    readString(record.function_name) ||
    readString(record.name);
  const path =
    readString(record.path) ||
    readString(record.file) ||
    readString(record.targetPath) ||
    readPathFromStructuredPayload(structuredInput);
  const kind = normalizeToolEventKind(record.kind, eventName, record);
  const title =
    readString(record.title) ||
    (toolName ? `Tool: ${toolName}` : "") ||
    (kind === "tool_result" && readString(record.tool_call_id) ? `Tool result: ${readString(record.tool_call_id)}` : "") ||
    (path ? `File: ${path}` : "") ||
    eventName ||
    "Tool event";
  const content =
    readString(record.content) ||
    readString(record.message) ||
    readString(record.output) ||
    readString(record.diff) ||
    readString(record.summary) ||
    readStructuredText(structuredInput) ||
    readStructuredText(record.result) ||
    readStructuredText(record.observation) ||
    readStructuredText(record.error);
  if (!title && !content) return [];
  return [{
    id: readString(record.id) || readString(record.tool_call_id) || `${eventName || "tool"}-${index}-${stableToolEventHash(`${title}:${content ?? ""}`)}`,
    kind,
    title: clampToolText(title, 180),
    status: normalizeToolEventStatus(record.status || record.state),
    content: content ? clampToolText(content, 2000) : undefined,
    toolName: toolName ? clampToolText(toolName, 140) : undefined,
    path: path ? clampToolText(path, 260) : undefined,
    timestamp: readString(record.timestamp) || readString(record.createdAt),
    level: readString(record.level),
  }];
}

function normalizeToolEventKind(
  rawKind: unknown,
  eventName: string,
  record: Record<string, unknown>,
): ChatToolTimelineEvent["kind"] {
  const kind = readString(rawKind).toLowerCase();
  const type = readString(record.type).toLowerCase();
  const role = readString(record.role).toLowerCase();
  if (kind === "tool_result" || kind === "result") return "tool_result";
  if (type === "tool_result" || type === "function_result" || role === "tool") return "tool_result";
  if (type === "tool_use" || type === "function_call" || type === "server_tool_call") return "tool_call";
  if (readString(record.tool_call_id) && readString(record.content)) return "tool_result";
  if (kind === "diff" || readString(record.diff)) return "diff";
  if (kind === "artifact") return "artifact";
  if (kind === "log") return "log";
  if (/result$/i.test(eventName)) return "tool_result";
  if (/progress|log/i.test(eventName)) return "log";
  return "tool_call";
}

function normalizeToolEventStatus(rawStatus: unknown): ChatToolTimelineEvent["status"] | undefined {
  const status = readString(rawStatus).toLowerCase();
  if (status === "started" || status === "running" || status === "completed" || status === "failed") return status;
  if (status === "error") return "failed";
  if (status === "done" || status === "complete" || status === "success" || status === "succeeded") return "completed";
  if (status === "pending" || status === "in_progress") return "running";
  return undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStructuredText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return readString(value);
  if (!value || typeof value !== "object") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function readPathFromStructuredPayload(value: unknown): string {
  const record = typeof value === "string" ? parseJsonObject(value) : readObject(value);
  if (!record) return "";
  return readString(record.path) || readString(record.file) || readString(record.targetPath);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function clampToolText(value: string, maxLength: number): string {
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function stableToolEventHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeAction(value: unknown): AgentRunSseFileEvent["action"] | null {
  if (value === "read" || value === "create" || value === "modify" || value === "delete" ||
    value === "rename" || value === "patch" || value === "artifact") {
    return value;
  }
  return null;
}

function getSseEventName(frame: string): string {
  return frame
    .split(/\r?\n/)
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim() ?? "";
}

function getSseData(frame: string): string {
  return frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}
