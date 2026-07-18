import type {
  StructuredActivityEvent,
  StructuredConversationEvent,
} from "@shared/structuredConversation";

export type DebugLogLevel = "log" | "info" | "warn" | "error";
export type DebugLogSource = "console" | "window" | "promise" | "chat" | "activity" | "protocol";

export interface DebugLogEntry {
  id: number;
  level: DebugLogLevel;
  message: string;
  timestamp: number;
  source: DebugLogSource;
  turnId?: string;
  partId?: string;
  activityId?: string;
  activityKind?: StructuredActivityEvent["kind"];
  activityStatus?: StructuredActivityEvent["status"];
  durationMs?: number;
  raw?: string;
}

const MAX_ENTRIES = 1000;
const MAX_RAW_LENGTH = 256 * 1024;
const listeners = new Set<() => void>();
let entries: DebugLogEntry[] = [];
let nextId = 1;
let installed = false;

export const getDebugLogs = (): DebugLogEntry[] => entries;

export function subscribeDebugLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDebugLogs(): void {
  entries = [];
  notify();
}

export function appendDebugLog(
  level: DebugLogLevel,
  message: string,
  source: DebugLogSource = "console",
): void {
  append({ level, message, source, timestamp: Date.now() });
}

export function appendStructuredActivityLog(activity: StructuredActivityEvent): void {
  const existing = entries.find((entry) => entry.source === "activity" && entry.activityId === activity.id);
  const next: DebugLogEntry = {
    id: existing?.id ?? nextId++,
    level: activity.status === "error" ? "error" : activity.kind === "retry" ? "warn" : "info",
    message: activity.title,
    timestamp: parseTimestamp(activity.timestamp),
    source: "activity",
    turnId: activity.turnId,
    activityId: activity.id,
    activityKind: activity.kind,
    activityStatus: activity.status,
    ...(activity.kind === "tool" && activity.durationMs !== undefined ? { durationMs: activity.durationMs } : {}),
    raw: serializeBounded(activity),
  };
  entries = existing
    ? entries.map((entry) => entry.id === existing.id ? next : entry)
    : [...entries, next].slice(-MAX_ENTRIES);
  notify();
}

export function appendStructuredProtocolLog(event: StructuredConversationEvent): void {
  append({
    level: event.type === "turn.error" ? "error" : "info",
    message: summarizeProtocolEvent(event),
    timestamp: parseTimestamp(event.timestamp),
    source: "protocol",
    turnId: event.turnId,
    ...(event.type === "part.delta" ? { partId: event.partId } : {}),
    ...(event.type === "part.started" || event.type === "part.completed" ? { partId: event.part.id } : {}),
    raw: serializeBounded(event),
  });
}

export function installDebugLogCapture(): void {
  if (installed) return;
  installed = true;
  (["log", "info", "warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      append({ level, message: args.map(format).join(" "), source: "console", timestamp: Date.now() });
    };
  });
  window.addEventListener("error", (event) => append({
    level: "error",
    message: event.error?.stack || event.message,
    source: "window",
    timestamp: Date.now(),
  }));
  window.addEventListener("unhandledrejection", (event) => append({
    level: "error",
    message: format(event.reason),
    source: "promise",
    timestamp: Date.now(),
  }));
  append({ level: "info", message: "Debug output capture started", source: "console", timestamp: Date.now() });
}

function append(entry: Omit<DebugLogEntry, "id">): void {
  entries = [...entries, { ...entry, id: nextId++ }].slice(-MAX_ENTRIES);
  notify();
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function summarizeProtocolEvent(event: StructuredConversationEvent): string {
  if (event.type === "part.started" || event.type === "part.completed") {
    return `${event.type}: ${event.part.kind}`;
  }
  if (event.type === "part.delta") return `${event.type}: ${event.delta.kind}`;
  if (event.type === "activity.updated") return `${event.type}: ${event.activity.kind}`;
  return event.type;
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function serializeBounded(value: unknown): string {
  const serialized = format(value);
  if (serialized.length <= MAX_RAW_LENGTH) return serialized;
  return `${serialized.slice(0, MAX_RAW_LENGTH)}\n\n[truncated at ${MAX_RAW_LENGTH} characters]`;
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
