import { createHash, randomUUID } from "crypto";
import { appendFile, mkdir, readFile, unlink, writeFile } from "fs/promises";
import { hostname } from "os";
import { monitorEventLoopDelay } from "perf_hooks";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";
import { DiagnosticRootCauseEngine } from "./rootCauseAnalysis";
import {
  DIAGNOSTIC_SCHEMA_VERSION,
  isTerminalDiagnosticStatus,
  type DiagnosticComponentHealth,
  type DiagnosticEvent,
  type DiagnosticEventInput,
  type DiagnosticFinding,
  type DiagnosticIssueUpdateRequest,
  type DiagnosticIssueUpdateResult,
  type DiagnosticPerformanceSummary,
  type DiagnosticQuery,
  type DiagnosticResourceSample,
  type DiagnosticSnapshot,
  type DiagnosticStackFrame,
  type DiagnosticStatus,
  type DiagnosticTrace,
} from "../shared/diagnostics";

const MAX_EVENTS = 5_000;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_STORAGE_BYTES = 10 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const DIAGNOSTIC_DIR = join(DRSAI_HOME, "desktop", "diagnostics");
const EVENT_FILE = join(DIAGNOSTIC_DIR, "events.jsonl");
const ISSUE_STATE_FILE = join(DIAGNOSTIC_DIR, "issue-overrides.json");

type DiagnosticPublisher = (event: DiagnosticEvent) => void;

export interface DiagnosticOperationHandle {
  traceId: string;
  spanId: string;
  complete(message?: string, attributes?: Record<string, unknown>): Promise<DiagnosticEvent>;
  wait(message: string, attributes?: Record<string, unknown>): Promise<DiagnosticEvent>;
  fail(error: unknown, errorCode?: string): Promise<DiagnosticEvent>;
  cancel(message?: string): Promise<DiagnosticEvent>;
}

export class DesktopDiagnostics {
  private readonly historicalEventIds = new Set<string>();
  private events: DiagnosticEvent[] = [];
  private readonly ids = new Set<string>();
  private readonly health = new Map<string, DiagnosticComponentHealth>();
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private publisher: DiagnosticPublisher | null = null;
  private droppedEvents = 0;
  private persistedBytes = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private sequence = 0;
  private readonly machineId = createHash("sha256").update(hostname() || "local").digest("hex").slice(0, 16);
  private readonly resourceSamples: DiagnosticResourceSample[] = [];
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  private readonly rootCauseEngine = new DiagnosticRootCauseEngine(ISSUE_STATE_FILE);

  constructor() {
    this.eventLoopDelay.enable();
  }

  setPublisher(publisher: DiagnosticPublisher | null): void {
    this.publisher = publisher;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.load();
    await this.initializing;
  }

  async record(input: DiagnosticEventInput): Promise<DiagnosticEvent> {
    await this.initialize();
    const event = normalizeEvent({ ...input, machineId: input.machineId ?? this.machineId, sequence: input.sequence ?? ++this.sequence });
    if (this.ids.has(event.id)) return this.events.find((item) => item.id === event.id) ?? event;
    this.ids.add(event.id);
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      const removed = this.events.splice(0, this.events.length - MAX_EVENTS);
      for (const item of removed) this.ids.delete(item.id);
      this.droppedEvents += removed.length;
    }
    this.updateHealthFromEvent(event);
    this.publisher?.(event);
    this.enqueuePersist(event);
    return event;
  }

  async start(input: DiagnosticEventInput): Promise<DiagnosticOperationHandle> {
    const startedAt = Date.now();
    const started = await this.record({
      ...input,
      kind: input.kind ?? "operation",
      status: "started",
      level: input.level ?? "info",
    });
    const followup = async (
      status: DiagnosticStatus,
      message: string,
      extra: Partial<DiagnosticEventInput> = {},
    ): Promise<DiagnosticEvent> => this.record({
      ...input,
      ...extra,
      id: undefined,
      traceId: started.traceId,
      spanId: started.spanId,
      parentSpanId: started.parentSpanId,
      status,
      message,
      endedAt: isTerminalDiagnosticStatus(status) ? new Date().toISOString() : undefined,
      durationMs: Date.now() - startedAt,
      level: status === "failed" ? "error" : status === "waiting" ? "warn" : (extra.level ?? input.level ?? "info"),
    });
    return {
      traceId: started.traceId,
      spanId: started.spanId,
      complete: (message = `${input.operation} completed`, attributes) =>
        followup("completed", message, { attributes: sanitizeAttributes(attributes) }),
      wait: (message, attributes) =>
        followup("waiting", message, { attributes: sanitizeAttributes(attributes) }),
      fail: (error, errorCode) => {
        const normalized = normalizeError(error);
        return followup("failed", normalized.message, {
          kind: "error",
          errorCode: errorCode ?? normalized.code,
          stack: normalized.stack,
          source: normalized.stack.find((frame) => frame.file) ?? normalized.stack[0],
        });
      },
      cancel: (message = `${input.operation} cancelled`) => followup("cancelled", message),
    };
  }

  async snapshot(query: DiagnosticQuery = {}): Promise<DiagnosticSnapshot> {
    await this.initialize();
    const events = filterEvents(this.events, query);
    const health = [...this.health.values()].sort((left, right) => left.id.localeCompare(right.id));
    const traces = buildTraces(events);
    this.sampleResources();
    const rootCause = await this.rootCauseEngine.analyze(events, traces, health);
    return {
      generatedAt: new Date().toISOString(),
      events,
      traces,
      health,
      findings: deriveFindings(events.filter((event) => !this.historicalEventIds.has(event.id)), health),
      deepTracing: buildDeepTracingSnapshot(events, traces, this.resourceSamples),
      rootCause,
      droppedEvents: this.droppedEvents,
      storage: { eventCount: this.events.length, maxEvents: MAX_EVENTS, persisted: true },
    };
  }

  async clear(): Promise<number> {
    await this.initialize();
    const removed = this.events.length;
    this.events = [];
    this.ids.clear();
    this.droppedEvents = 0;
    this.persistedBytes = 0;
    this.writeQueue = this.writeQueue.then(async () => {
      try { await unlink(EVENT_FILE); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }).catch(() => undefined);
    await this.writeQueue;
    return removed;
  }

  async serializeExport(): Promise<string> {
    const snapshot = await this.snapshot({ limit: MAX_EVENTS });
    return JSON.stringify({
      product: "OpenDrSai Desktop",
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      snapshot,
    }, null, 2);
  }

  registerHealth(input: Omit<DiagnosticComponentHealth, "lastHeartbeatAt"> & { lastHeartbeatAt?: string }): void {
    const safe: DiagnosticComponentHealth = {
      ...input,
      message: redactText(input.message).slice(0, 2_000),
      lastHeartbeatAt: input.lastHeartbeatAt ?? new Date().toISOString(),
    };
    this.health.set(safe.id, safe);
  }

  updateIssue(request: DiagnosticIssueUpdateRequest): Promise<DiagnosticIssueUpdateResult> {
    return this.rootCauseEngine.update(request);
  }

  private async load(): Promise<void> {
    await mkdir(DIAGNOSTIC_DIR, { recursive: true });
    try {
      const raw = await readFile(EVENT_FILE, "utf8");
      this.persistedBytes = Buffer.byteLength(raw, "utf8");
      const cutoff = Date.now() - RETENTION_MS;
      let needsCompaction = false;
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as DiagnosticEvent;
          if (Date.parse(parsed.timestamp) < cutoff || parsed.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION) {
            needsCompaction = true;
            continue;
          }
          const event = normalizeEvent(parsed);
          if (this.ids.has(event.id)) continue;
          this.ids.add(event.id);
          this.historicalEventIds.add(event.id);
          this.events.push(event);
          this.sequence = Math.max(this.sequence, event.sequence ?? 0);
        } catch {
          this.droppedEvents += 1;
          needsCompaction = true;
        }
      }
      if (this.events.length > MAX_EVENTS) {
        const removed = this.events.splice(0, this.events.length - MAX_EVENTS);
        for (const event of removed) this.ids.delete(event.id);
        this.droppedEvents += removed.length;
        needsCompaction = true;
      }
      const unfinished = buildTraces(this.events).filter((trace) => !isTerminalDiagnosticStatus(trace.status)).slice(0, 50);
      for (const trace of unfinished) {
        const recovery = normalizeEvent({
          traceId: trace.traceId,
          parentSpanId: trace.activeEvent?.spanId,
          module: "desktop",
          component: "diagnostic-recovery",
          operation: "diagnostic.trace.recovered",
          message: "Active trace recovered after desktop restart",
          kind: "snapshot",
          status: "waiting",
          level: "warn",
          machineId: this.machineId,
          sequence: ++this.sequence,
          attributes: { recovered: true, previousEventCount: trace.events.length },
        });
        this.ids.add(recovery.id);
        this.events.push(recovery);
        this.updateHealthFromEvent(recovery);
        needsCompaction = true;
      }
      await this.compactIfNeeded(needsCompaction);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.droppedEvents += 1;
    }
    this.registerHealth({
      id: "electron-main",
      module: "desktop",
      component: "electron-main",
      state: "running",
      message: "Electron main process is running",
      pid: process.pid,
      restartCount: 0,
      retryCount: 0,
    });
    this.initialized = true;
  }

  private enqueuePersist(event: DiagnosticEvent): void {
    this.writeQueue = this.writeQueue.then(async () => {
      const line = `${JSON.stringify(event)}\n`;
      await mkdir(dirname(EVENT_FILE), { recursive: true });
      await appendFile(EVENT_FILE, line, "utf8");
      this.persistedBytes += Buffer.byteLength(line, "utf8");
      await this.compactIfNeeded(false);
    }).catch(() => { this.droppedEvents += 1; });
  }

  private async compactIfNeeded(force: boolean): Promise<void> {
    if (!force && this.persistedBytes <= MAX_STORAGE_BYTES) return;
    const content = this.events.map((event) => JSON.stringify(event)).join("\n") + (this.events.length ? "\n" : "");
    await writeFile(EVENT_FILE, content, "utf8");
    this.persistedBytes = Buffer.byteLength(content, "utf8");
  }

  private updateHealthFromEvent(event: DiagnosticEvent): void {
    const id = `${event.module}:${event.component}`;
    const previous = this.health.get(id);
    const recoveryEvidence = previous
      && ["failed", "waiting", "stopped", "disconnected"].includes(previous.state)
      && ["started", "running", "completed"].includes(event.status);
    if (previous && event.kind !== "health" && event.status !== "failed" && event.status !== "waiting" && event.status !== "cancelled" && !recoveryEvidence) {
      return;
    }
    const state = event.status === "failed" ? "failed"
      : event.status === "waiting" ? "waiting"
      : event.status === "cancelled" ? "stopped"
      : "running";
    const recovered = previous && ["failed", "stopped", "disconnected"].includes(previous.state) && state === "running";
    const retried = /retry|reconnect/i.test(`${event.operation} ${event.message}`);
    this.health.set(id, {
      id,
      module: event.module,
      component: event.component,
      state,
      message: event.message,
      lastHeartbeatAt: event.timestamp,
      restartCount: (previous?.restartCount ?? 0) + (recovered ? 1 : 0),
      retryCount: (previous?.retryCount ?? 0) + (retried ? 1 : 0),
      ...(event.errorCode ? { lastErrorCode: event.errorCode } : {}),
      lastTraceId: event.traceId,
    });
  }

  private sampleResources(): void {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    this.resourceSamples.push({
      timestamp: new Date().toISOString(),
      machineId: this.machineId,
      processId: process.pid,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      eventLoopDelayMs: Number.isFinite(this.eventLoopDelay.mean) ? Math.round(this.eventLoopDelay.mean / 1_000_000 * 100) / 100 : 0,
    });
    this.eventLoopDelay.reset();
    if (this.resourceSamples.length > 120) this.resourceSamples.splice(0, this.resourceSamples.length - 120);
  }
}

function normalizeEvent(input: DiagnosticEventInput | DiagnosticEvent): DiagnosticEvent {
  const now = new Date().toISOString();
  const traceId = safeId(input.traceId, "trace");
  const spanId = safeId(input.spanId, "span");
  const message = redactText(input.message).slice(0, 8_000) || input.operation;
  const event: DiagnosticEvent = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    id: safeId(input.id, "event"),
    traceId,
    spanId,
    timestamp: validDate(input.timestamp) ?? now,
    kind: input.kind ?? "operation",
    level: input.level ?? "info",
    status: input.status ?? "running",
    module: safeLabel(input.module, "unknown"),
    component: safeLabel(input.component, "unknown"),
    operation: safeLabel(input.operation, "operation"),
    message,
  };
  if (input.parentSpanId) event.parentSpanId = safeId(input.parentSpanId, "span");
  if (input.endedAt) event.endedAt = validDate(input.endedAt);
  if (typeof input.durationMs === "number" && input.durationMs >= 0) event.durationMs = Math.round(input.durationMs);
  if (input.errorCode) event.errorCode = safeLabel(input.errorCode, "error");
  if (input.machineId) event.machineId = safeId(input.machineId, "machine");
  if (typeof input.sequence === "number" && Number.isFinite(input.sequence) && input.sequence >= 0) event.sequence = Math.round(input.sequence);
  for (const key of ["sessionId", "turnId", "runId", "workspaceId", "backendId", "remoteHostId"] as const) {
    if (input[key]) event[key] = redactText(String(input[key])).slice(0, 256);
  }
  if (input.attributes) event.attributes = sanitizeAttributes(input.attributes);
  if (input.stack?.length) event.stack = input.stack.slice(0, 100).map(sanitizeFrame);
  if (input.source) event.source = sanitizeFrame({ ...input.source, raw: "" });
  const serialized = JSON.stringify(event);
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_BYTES) {
    event.message = `${event.message.slice(0, 2_000)} [truncated]`;
    event.stack = event.stack?.slice(0, 20);
    event.attributes = { truncated: true };
  }
  return event;
}

function filterEvents(events: DiagnosticEvent[], query: DiagnosticQuery): DiagnosticEvent[] {
  const since = query.since ? Date.parse(query.since) : Number.NEGATIVE_INFINITY;
  const filtered = events.filter((event) =>
    (!query.traceId || event.traceId === query.traceId)
    && (!query.module || event.module === query.module)
    && (!query.component || event.component === query.component)
    && (!query.status || event.status === query.status)
    && (!query.level || event.level === query.level)
    && Date.parse(event.timestamp) >= since
  );
  return filtered.slice(-Math.max(1, Math.min(query.limit ?? 1_000, MAX_EVENTS)));
}

export function buildTraces(events: DiagnosticEvent[]): DiagnosticTrace[] {
  const grouped = new Map<string, DiagnosticEvent[]>();
  for (const event of events) grouped.set(event.traceId, [...(grouped.get(event.traceId) ?? []), event]);
  return [...grouped.entries()].map(([traceId, traceEvents]) => {
    const ordered = [...traceEvents].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    const root = ordered.find((event) => !event.parentSpanId) ?? ordered[0];
    const latestBySpan = new Map<string, DiagnosticEvent>();
    for (const event of ordered) latestBySpan.set(event.spanId, event);
    const currentSpanEvents = [...latestBySpan.values()];
    const firstFailure = ordered.find((event) => event.status === "failed" && latestBySpan.get(event.spanId)?.status === "failed");
    const activeEvent = [...currentSpanEvents].reverse().find((event) => !isTerminalDiagnosticStatus(event.status));
    const last = ordered[ordered.length - 1];
    const status: DiagnosticStatus = firstFailure ? "failed"
      : activeEvent ? activeEvent.status
      : last?.status ?? "completed";
    const started = Date.parse(root.timestamp);
    const ended = last?.endedAt ? Date.parse(last.endedAt) : isTerminalDiagnosticStatus(status) ? Date.parse(last.timestamp) : undefined;
    return {
      traceId,
      startedAt: root.timestamp,
      ...(ended ? { endedAt: new Date(ended).toISOString(), durationMs: Math.max(0, ended - started) } : {}),
      status,
      rootOperation: root.operation,
      events: ordered,
      ...(activeEvent ? { activeEvent } : {}),
      ...(firstFailure ? { firstFailure } : {}),
      criticalPathMs: calculateCriticalPath(ordered),
      recovered: ordered.some((event) => event.attributes?.recovered === true),
      machineIds: [...new Set(ordered.map((event) => event.machineId).filter((value): value is string => Boolean(value)))],
    };
  }).sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

function calculateCriticalPath(events: DiagnosticEvent[]): number {
  const durations = new Map<string, number>();
  const parents = new Map<string, string | undefined>();
  for (const event of events) {
    durations.set(event.spanId, Math.max(durations.get(event.spanId) ?? 0, event.durationMs ?? 0));
    if (!parents.has(event.spanId)) parents.set(event.spanId, event.parentSpanId);
  }
  const totals = new Map<string, number>();
  const totalFor = (spanId: string, seen = new Set<string>()): number => {
    if (totals.has(spanId)) return totals.get(spanId)!;
    if (seen.has(spanId)) return durations.get(spanId) ?? 0;
    seen.add(spanId);
    const parent = parents.get(spanId);
    const total = (durations.get(spanId) ?? 0) + (parent && durations.has(parent) ? totalFor(parent, seen) : 0);
    totals.set(spanId, total);
    return total;
  };
  return Math.max(0, ...durations.keys().map((spanId) => totalFor(spanId)));
}

function buildDeepTracingSnapshot(events: DiagnosticEvent[], traces: DiagnosticTrace[], resources: DiagnosticResourceSample[]): DiagnosticSnapshot["deepTracing"] {
  const groups = new Map<string, { module: string; component: string; operation: string; durations: number[]; failures: number }>();
  for (const event of events) {
    if (!isTerminalDiagnosticStatus(event.status) || event.durationMs === undefined) continue;
    const key = `${event.module}:${event.component}:${event.operation}`;
    const group = groups.get(key) ?? { module: event.module, component: event.component, operation: event.operation, durations: [], failures: 0 };
    group.durations.push(event.durationMs);
    if (event.status === "failed") group.failures += 1;
    groups.set(key, group);
  }
  const performance: DiagnosticPerformanceSummary[] = [...groups.entries()].map(([key, group]) => {
    const sorted = [...group.durations].sort((left, right) => left - right);
    const totalDurationMs = sorted.reduce((sum, value) => sum + value, 0);
    return {
      key,
      module: group.module,
      component: group.component,
      operation: group.operation,
      count: sorted.length,
      failureCount: group.failures,
      totalDurationMs,
      averageDurationMs: Math.round(totalDurationMs / Math.max(1, sorted.length)),
      p95DurationMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
      maxDurationMs: sorted.at(-1) ?? 0,
    };
  }).sort((left, right) => right.p95DurationMs - left.p95DurationMs).slice(0, 100);
  const activeCheckpoints = traces.filter((trace) => !isTerminalDiagnosticStatus(trace.status)).map((trace) => ({
    traceId: trace.traceId,
    rootOperation: trace.rootOperation,
    status: trace.status,
    lastEventAt: trace.events.at(-1)?.timestamp ?? trace.startedAt,
    eventCount: trace.events.length,
    machineIds: trace.machineIds ?? [],
    recovered: trace.recovered === true,
  }));
  const clockOffsets = new Map<string, { machineId: string; offsetMs: number; sampledAt: string }>();
  for (const event of events) {
    const offset = event.attributes?.clockOffsetMs;
    if (event.machineId && typeof offset === "number") clockOffsets.set(event.machineId, { machineId: event.machineId, offsetMs: offset, sampledAt: event.timestamp });
  }
  return { performance, resources: resources.slice(-120), activeCheckpoints, clockOffsets: [...clockOffsets.values()] };
}

export function deriveFindings(events: DiagnosticEvent[], health: DiagnosticComponentHealth[]): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const failedByComponent = new Map<string, DiagnosticEvent>();
  for (const event of events) {
    if (event.status === "failed") failedByComponent.set(`${event.module}:${event.component}`, event);
  }
  for (const event of [...failedByComponent.values()].reverse().slice(0, 20)) {
    findings.push({
      id: `failure:${event.id}`,
      severity: "error",
      title: `Failure in ${event.component}`,
      message: event.message,
      module: event.module,
      component: event.component,
      traceId: event.traceId,
      eventId: event.id,
      suggestedAction: event.source?.file ? "Inspect the reported source location and preceding trace events." : "Inspect the preceding trace events and component logs.",
    });
  }
  const now = Date.now();
  const waiting = events.filter((event) => event.status === "waiting" && now - Date.parse(event.timestamp) >= 10_000).slice(-10);
  for (const event of waiting) findings.push({
    id: `waiting:${event.id}`,
    severity: "warning",
    title: `${event.component} is waiting`,
    message: event.message,
    module: event.module,
    component: event.component,
    traceId: event.traceId,
    eventId: event.id,
    suggestedAction: "Check the active trace for network, process, approval, or user-input dependencies.",
  });
  for (const item of health.filter((entry) => entry.state === "failed" || entry.state === "disconnected").slice(0, 20)) {
    if (failedByComponent.has(`${item.module}:${item.component}`)) continue;
    findings.push({
      id: `health:${item.id}`,
      severity: item.state === "failed" ? "error" : "warning",
      title: `${item.component} is ${item.state}`,
      message: item.message,
      module: item.module,
      component: item.component,
      traceId: item.lastTraceId,
      suggestedAction: "Check component availability and retry or restart the affected connection.",
    });
  }
  const spanIds = new Set(events.map((event) => event.spanId));
  for (const event of events.filter((item) => item.parentSpanId && !spanIds.has(item.parentSpanId)).slice(-10)) {
    findings.push({
      id: `orphan:${event.id}`,
      severity: "warning",
      title: `Orphan span in ${event.component}`,
      message: "The parent span is missing, possibly because of a dropped event, restart, or remote disconnection.",
      module: event.module,
      component: event.component,
      traceId: event.traceId,
      eventId: event.id,
      suggestedAction: "Inspect restart and remote transport events, then retry if the chain cannot converge.",
    });
  }
  for (const event of events.filter((item) => isTerminalDiagnosticStatus(item.status) && (item.durationMs ?? 0) >= 10_000).slice(-10)) {
    findings.push({
      id: `slow:${event.id}`,
      severity: "warning",
      title: `Slow operation in ${event.component}`,
      message: `${event.operation} took ${event.durationMs} ms.`,
      module: event.module,
      component: event.component,
      traceId: event.traceId,
      eventId: event.id,
      suggestedAction: "Inspect the performance waterfall for queueing, network, resource, or dependency delays.",
    });
  }
  const retries = new Map<string, DiagnosticEvent[]>();
  for (const event of events.filter((item) => /retry|reconnect/i.test(`${item.operation} ${item.message}`))) {
    const key = `${event.traceId}:${event.component}`;
    retries.set(key, [...(retries.get(key) ?? []), event]);
  }
  for (const retryEvents of [...retries.values()].filter((items) => items.length >= 3).slice(-10)) {
    const event = retryEvents.at(-1)!;
    findings.push({
      id: `retries:${event.traceId}:${event.component}`,
      severity: "warning",
      title: `Repeated retries in ${event.component}`,
      message: `${retryEvents.length} retry or reconnect events occurred in this trace.`,
      module: event.module,
      component: event.component,
      traceId: event.traceId,
      eventId: event.id,
      suggestedAction: "Inspect the first retry and the upstream dependency before repeating the operation.",
    });
  }
  for (const event of events.filter((item) => (typeof item.attributes?.costUsd === "number" && item.attributes.costUsd >= 1) || (typeof item.attributes?.tokenCount === "number" && item.attributes.tokenCount >= 100_000)).slice(-10)) {
    findings.push({
      id: `cost:${event.id}`,
      severity: "warning",
      title: `High-cost operation in ${event.component}`,
      message: "This operation exceeded the configured diagnostic cost threshold.",
      module: event.module,
      component: event.component,
      traceId: event.traceId,
      eventId: event.id,
      suggestedAction: "Review input size, repeated tool calls, model usage, and cancellation behavior.",
    });
  }
  return findings.slice(0, 50);
}

export function normalizeError(error: unknown): { message: string; code?: string; stack: DiagnosticStackFrame[] } {
  const value = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  const code = typeof (error as NodeJS.ErrnoException | undefined)?.code === "string"
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return {
    message: redactText(value.message || String(error)).slice(0, 8_000),
    ...(code ? { code } : {}),
    stack: parseStack(value.stack ?? value.message),
  };
}

export function parseStack(stack: string): DiagnosticStackFrame[] {
  return redactText(stack).split(/\r?\n/).slice(0, 100).map((raw) => {
    const jsWithFunction = raw.match(/^\s*at\s+(.*?)\s+\((.+):(\d+):(\d+)\)$/);
    if (jsWithFunction) return sanitizeFrame({ raw, function: jsWithFunction[1], file: jsWithFunction[2], line: Number(jsWithFunction[3]), column: Number(jsWithFunction[4]), language: languageForFile(jsWithFunction[2]) });
    const js = raw.match(/^\s*at\s+(.+):(\d+):(\d+)$/);
    if (js) return sanitizeFrame({ raw, file: js[1], line: Number(js[2]), column: Number(js[3]), language: languageForFile(js[1]) });
    const python = raw.match(/^\s*File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(.+)$/);
    if (python) return sanitizeFrame({ raw, file: python[1], line: Number(python[2]), function: python[3], language: "python" });
    return { raw: raw.slice(0, 2_000), language: "unknown" };
  });
}

function sanitizeFrame(frame: DiagnosticStackFrame): DiagnosticStackFrame {
  const file = frame.file ? redactPath(frame.file).slice(0, 1_000) : undefined;
  return {
    raw: redactText(frame.raw).slice(0, 2_000),
    ...(file ? { file } : {}),
    ...(frame.function ? { function: redactText(frame.function).slice(0, 500) } : {}),
    ...(typeof frame.line === "number" ? { line: Math.max(1, Math.round(frame.line)) } : {}),
    ...(typeof frame.column === "number" ? { column: Math.max(1, Math.round(frame.column)) } : {}),
    ...(frame.language ? { language: frame.language } : {}),
    ...(frame.inApp !== undefined ? { inApp: frame.inApp } : {}),
  };
}

function sanitizeAttributes(input?: Record<string, unknown>): Record<string, string | number | boolean | null> | undefined {
  if (!input) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, 50)) {
    const key = safeLabel(rawKey, "attribute");
    if (/token|secret|password|cookie|authorization|api.?key/i.test(key)) continue;
    if (rawValue === null || typeof rawValue === "number" || typeof rawValue === "boolean") result[key] = rawValue;
    else result[key] = redactText(String(rawValue)).slice(0, 1_000);
  }
  return result;
}

export function redactText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret|cookie|authorization)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, "%USERPROFILE%")
    .replace(/\/home\/[^/\s]+/g, "$HOME");
}

function redactPath(value: string): string {
  return redactText(value).replace(/\\/g, "/");
}

function safeId(value: string | undefined, prefix: string): string {
  const normalized = value?.trim();
  return normalized && /^[A-Za-z0-9._:-]{1,256}$/.test(normalized) ? normalized : `${prefix}-${randomUUID()}`;
}

function safeLabel(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "").trim().replace(/[^A-Za-z0-9._:/-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 200);
}

function validDate(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function languageForFile(file: string): DiagnosticStackFrame["language"] {
  if (/\.tsx?($|\?)/i.test(file)) return "typescript";
  if (/\.[cm]?jsx?($|\?)/i.test(file)) return "javascript";
  if (/\.py($|\?)/i.test(file)) return "python";
  return "unknown";
}

export const desktopDiagnostics = new DesktopDiagnostics();
