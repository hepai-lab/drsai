import { AsyncLocalStorage } from "async_hooks";
import { createHash } from "crypto";

export interface ActiveDiagnosticContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sessionId?: string;
  runId?: string;
  workspaceId?: string;
}

const storage = new AsyncLocalStorage<ActiveDiagnosticContext>();

export function runWithDiagnosticContext<T>(context: ActiveDiagnosticContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getDiagnosticContext(): ActiveDiagnosticContext | undefined {
  return storage.getStore();
}

export function getDiagnosticPropagationHeaders(): Record<string, string> {
  const context = storage.getStore();
  if (!context) return {};
  const traceHex = createHash("sha256").update(context.traceId).digest("hex").slice(0, 32);
  const spanHex = createHash("sha256").update(context.spanId).digest("hex").slice(0, 16);
  return {
    traceparent: `00-${traceHex}-${spanHex}-01`,
    "X-OpenDrSai-Trace-ID": sanitize(context.traceId),
    "X-OpenDrSai-Span-ID": sanitize(context.spanId),
    "X-OpenDrSai-Sent-At": String(Date.now()),
    ...(context.parentSpanId ? { "X-OpenDrSai-Parent-Span-ID": sanitize(context.parentSpanId) } : {}),
    ...(context.sessionId ? { "X-OpenDrSai-Session-ID": sanitize(context.sessionId) } : {}),
    ...(context.runId ? { "X-OpenDrSai-Run-ID": sanitize(context.runId) } : {}),
    ...(context.workspaceId ? { "X-OpenDrSai-Workspace-ID": sanitize(context.workspaceId) } : {}),
  };
}

export function extractDiagnosticContext(value: unknown): Partial<ActiveDiagnosticContext> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const nested = input.diagnosticContext && typeof input.diagnosticContext === "object"
    ? input.diagnosticContext as Record<string, unknown>
    : input;
  return compact({
    traceId: firstId(nested.traceId, nested.diagnosticTraceId, input.requestId),
    spanId: firstId(nested.spanId, nested.diagnosticSpanId),
    parentSpanId: firstId(nested.parentSpanId),
    sessionId: firstId(nested.sessionId, input.sessionId),
    runId: firstId(nested.runId, input.runId),
    workspaceId: firstId(nested.workspaceId, input.workspaceId),
  });
}

function firstId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value)) return value;
  }
  return undefined;
}

function compact(value: Partial<ActiveDiagnosticContext>): Partial<ActiveDiagnosticContext> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<ActiveDiagnosticContext>;
}

function sanitize(value: string): string {
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value) ? value : createHash("sha256").update(value).digest("hex");
}
