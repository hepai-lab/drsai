import type {
  StructuredActivityEvent,
  StructuredConversationEvent,
} from "@shared/structuredConversation";
import type { DiagnosticEvent, DiagnosticEventInput, DiagnosticStackFrame, DiagnosticStatus } from "@shared/diagnostics";

export type DebugLogLevel = "log" | "info" | "warn" | "error";
export type DebugLogSource = "console" | "window" | "promise" | "chat" | "activity" | "protocol" | "diagnostic";

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
  diagnosticId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  module?: string;
  component?: string;
  operation?: string;
  diagnosticStatus?: DiagnosticStatus;
  stack?: DiagnosticStackFrame[];
}

const MAX_ENTRIES = 1000;
const MAX_RAW_LENGTH = 256 * 1024;
const listeners = new Set<() => void>();
let entries: DebugLogEntry[] = [];
let nextId = 1;
let installed = false;
let lastResizeObserverWarningAt = 0;

export function isBenignResizeObserverError(message: string): boolean {
  return /ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i.test(message);
}

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
  void recordDiagnosticSafe({
    traceId: activity.turnId,
    spanId: activity.id,
    module: "runtime",
    component: "structured-conversation",
    operation: `activity.${activity.kind}`,
    message: activity.title,
    status: mapActivityStatus(activity.status),
    level: activity.status === "error" ? "error" : activity.kind === "retry" ? "warn" : "info",
    turnId: activity.turnId,
    ...(activity.kind === "tool" && activity.durationMs !== undefined ? { durationMs: activity.durationMs } : {}),
    attributes: { kind: activity.kind },
  });
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
  void recordDiagnosticSafe({
    traceId: event.turnId,
    module: "runtime",
    component: "structured-conversation",
    operation: event.type,
    message: summarizeProtocolEvent(event),
    status: event.type === "turn.error" ? "failed"
      : event.type === "turn.completed" ? "completed"
      : event.type === "turn.cancelled" ? "cancelled"
      : "running",
    level: event.type === "turn.error" ? "error" : "info",
    turnId: event.turnId,
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
      if (level === "warn" || level === "error") {
        void recordDiagnosticSafe({
          module: "desktop",
          component: "renderer",
          operation: `console.${level}`,
          kind: level === "error" ? "error" : "log",
          status: level === "error" ? "failed" : "running",
          level,
          message: args.map(format).join(" "),
        });
      }
    };
  });
  window.addEventListener("error", (event) => {
    const message = event.error?.stack || event.message;
    if (isBenignResizeObserverError(message)) {
      event.preventDefault();
      const now = Date.now();
      if (now - lastResizeObserverWarningAt < 10_000) return;
      lastResizeObserverWarningAt = now;
      append({ level: "warn", message, source: "window", timestamp: now });
      void recordDiagnosticSafe({
        module: "desktop", component: "renderer-layout", operation: "resize-observer.warning",
        kind: "log", status: "completed", level: "warn", message,
      });
      return;
    }
    append({ level: "error", message, source: "window", timestamp: Date.now() });
    void recordDiagnosticSafe({
      module: "desktop", component: "renderer", operation: "window.error",
      kind: "error", status: "failed", level: "error", message,
      source: { file: event.filename, line: event.lineno, column: event.colno, language: "javascript" },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message = format(event.reason);
    append({ level: "error", message, source: "promise", timestamp: Date.now() });
    void recordDiagnosticSafe({
      module: "desktop", component: "renderer", operation: "promise.unhandled-rejection",
      kind: "error", status: "failed", level: "error", message,
    });
  });
  const api = window.openDrSai;
  if (api) {
    api.onDiagnosticEvent(appendDiagnosticEvent);
    void api.getDiagnosticSnapshot({ limit: MAX_ENTRIES }).then((snapshot) => {
      for (const event of snapshot.events) appendDiagnosticEvent(event, false);
      notify();
    }).catch(() => undefined);
    void recordDiagnosticSafe({
      module: "desktop", component: "renderer", operation: "renderer.started",
      kind: "health", status: "completed", level: "info", message: "Renderer diagnostic capture started",
      attributes: { userAgent: navigator.userAgent.slice(0, 200) },
    });
  }
  append({ level: "info", message: "Debug output capture started", source: "console", timestamp: Date.now() });
}

function appendDiagnosticEvent(event: DiagnosticEvent, shouldNotify = true): void {
  if (entries.some((entry) => entry.diagnosticId === event.id)) return;
  const entry: DebugLogEntry = {
    id: nextId++,
    level: event.level === "debug" ? "log" : event.level,
    message: event.message,
    timestamp: Date.parse(event.timestamp) || Date.now(),
    source: "diagnostic",
    diagnosticId: event.id,
    traceId: event.traceId,
    spanId: event.spanId,
    parentSpanId: event.parentSpanId,
    module: event.module,
    component: event.component,
    operation: event.operation,
    diagnosticStatus: event.status,
    turnId: event.turnId,
    durationMs: event.durationMs,
    stack: event.stack,
    raw: serializeBounded(event),
  };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  if (shouldNotify) notify();
}

async function recordDiagnosticSafe(input: DiagnosticEventInput): Promise<void> {
  try { await window.openDrSai?.recordDiagnostic(input); } catch { /* Diagnostics never break product flows. */ }
}

function mapActivityStatus(status: StructuredActivityEvent["status"]): DiagnosticStatus {
  if (status === "pending") return "waiting";
  if (status === "error") return "failed";
  return status;
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
