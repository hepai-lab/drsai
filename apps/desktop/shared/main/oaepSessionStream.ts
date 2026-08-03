import type { OaepEvent, OaepItem, OaepRun, OaepSnapshot, RuntimeClient } from "./runtimeClient";

export interface OaepSessionState {
  sessionId: string;
  cursor: number;
  items: ReadonlyMap<string, OaepItem>;
  runs: ReadonlyMap<string, OaepRun>;
}

export interface OaepSessionMetrics {
  snapshots: number;
  resnapshots: number;
  replayEvents: number;
  streamEvents: number;
  reconnects: number;
  protocolViolations: number;
}

export interface OaepSessionListener {
  onSnapshot?(state: OaepSessionState, source: "snapshot" | "resnapshot"): void | Promise<void>;
  onEvent?(event: OaepEvent, state: OaepSessionState, source: "replay" | "stream"): void | Promise<void>;
  onConnection?(state: "connected" | "retrying", attempt: number, error?: unknown): void | Promise<void>;
}

export interface OaepSessionSubscription {
  readonly cursor: number;
  readonly state: OaepSessionState;
  readonly metrics: Readonly<OaepSessionMetrics>;
  readonly done: Promise<void>;
  stop(): void;
}

class OaepEventGap extends Error {
  constructor() {
    super("Runtime OAEP Event sequence has a gap.");
  }
}

function isCursorExpired(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "cursor_expired");
}

function textFromDelta(event: OaepEvent): string {
  const delta = event.data.delta;
  return delta && typeof delta === "object" && typeof delta.text === "string" ? delta.text : "";
}

function deltaType(event: OaepEvent): OaepItem["type"] {
  const delta = event.data.delta;
  const kind = delta && typeof delta === "object" ? String(delta.kind ?? "") : "";
  if (kind.startsWith("reasoning.")) return "reasoning";
  if (kind.startsWith("plan.")) return "plan";
  if (kind.startsWith("command.")) return "command_execution";
  if (kind.startsWith("tool.")) return "tool_call";
  if (kind.startsWith("subtask.")) return "subtask";
  return "message";
}

function appendDelta(items: Map<string, OaepItem>, event: OaepEvent): void {
  if (!event.item_id) return;
  const id = event.item_id;
  const text = textFromDelta(event);
  const existing = items.get(id);
  if (existing) {
    if (["completed", "failed", "cancelled"].includes(existing.status)) {
      throw new Error("oaep_item_event_after_terminal");
    }
    const content = { ...existing.content } as Record<string, unknown>;
    if (existing.type === "reasoning") {
      const segments = Array.isArray(content.segments) ? [...content.segments] as Array<Record<string, unknown>> : [];
      const tail = segments.at(-1) ?? { id: `${id}:text`, text: "" };
      const next = { ...tail, text: `${typeof tail.text === "string" ? tail.text : ""}${text}` };
      if (segments.length) segments[segments.length - 1] = next; else segments.push(next);
      content.segments = segments;
    } else if (existing.type === "command_execution") {
      content.output = `${typeof content.output === "string" ? content.output : ""}${text}`;
    } else if (existing.type === "tool_call") {
      content.result = `${typeof content.result === "string" ? content.result : ""}${text}`;
    } else if (existing.type === "subtask") {
      content.summary = `${typeof content.summary === "string" ? content.summary : ""}${text}`;
    } else {
      content.text = `${typeof content.text === "string" ? content.text : ""}${text}`;
    }
    items.set(id, { ...existing, status: "running", sequence: event.sequence,
      updated_at: event.timestamp, content } as unknown as OaepItem);
    return;
  }
  const type = deltaType(event);
  const common = { id, session_id: event.session_id, run_id: event.run_id ?? "", status: "running" as const,
    sequence: event.sequence, created_at: event.timestamp, updated_at: event.timestamp, source: event.source };
  if (type === "reasoning") {
    items.set(id, { ...common, type, content: { segments: [{ id: `${id}:text`, text }] } });
  } else if (type === "plan") {
    items.set(id, { ...common, type, content: { text, steps: [] } });
  } else if (type === "command_execution") {
    items.set(id, { ...common, type, content: { command: [], display_command: "", cwd: ".", output: text,
      exit_code: null, duration_ms: null } });
  } else if (type === "tool_call") {
    items.set(id, { ...common, type, content: { tool_kind: "tool", tool_name: "tool", call_id: id,
      arguments: {}, result: text } });
  } else if (type === "subtask") {
    items.set(id, { ...common, type, content: { title: "Subtask", summary: text } });
  } else {
    items.set(id, { ...common, type: "message", content: { role: "assistant", phase: "final", text,
      parts: [], citations: [] } });
  }
}

export function reduceOaepEvent(
  items: Map<string, OaepItem>,
  runs: Map<string, OaepRun>,
  event: OaepEvent,
): void {
  const run = event.data.run;
  if (run && typeof run === "object" && "id" in run) runs.set(String(run.id), run as OaepRun);
  if (event.type === "event.item.delta") {
    appendDelta(items, event);
    return;
  }
  const item = event.data.item;
  if (item && typeof item === "object" && "id" in item) {
    const value = item as OaepItem;
    const existing = items.get(value.id);
    if (existing && existing.type !== value.type) throw new Error("oaep_item_type_changed");
    items.set(value.id, value);
  }
}

async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: OaepEvent) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (data) await onEvent(JSON.parse(data) as OaepEvent);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

class SharedOaepSessionController {
  readonly items = new Map<string, OaepItem>();
  readonly runs = new Map<string, OaepRun>();
  readonly listeners = new Set<OaepSessionListener>();
  readonly abort = new AbortController();
  cursor = 0;
  retryAttempt = 0;
  readonly metrics: OaepSessionMetrics = {
    snapshots: 0,
    resnapshots: 0,
    replayEvents: 0,
    streamEvents: 0,
    reconnects: 0,
    protocolViolations: 0,
  };
  private readyResolve!: () => void;
  readonly ready = new Promise<void>((resolve) => { this.readyResolve = resolve; });
  readonly done: Promise<void>;

  constructor(readonly client: RuntimeClient, readonly sessionId: string, readonly onEmpty: () => void) {
    this.done = this.run();
  }

  get state(): OaepSessionState {
    return { sessionId: this.sessionId, cursor: this.cursor, items: this.items, runs: this.runs };
  }

  add(listener: OaepSessionListener): () => void {
    this.listeners.add(listener);
    if (this.cursor > 0) void listener.onSnapshot?.(this.state, "snapshot");
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.abort.abort("oaep_session_unused");
        this.onEmpty();
      }
    };
  }

  private async notifySnapshot(source: "snapshot" | "resnapshot"): Promise<void> {
    if (source === "snapshot") this.metrics.snapshots += 1;
    else this.metrics.resnapshots += 1;
    await Promise.all([...this.listeners].map((listener) => listener.onSnapshot?.(this.state, source)));
  }

  private async notifyEvent(event: OaepEvent, source: "replay" | "stream"): Promise<void> {
    await Promise.all([...this.listeners].map((listener) => listener.onEvent?.(event, this.state, source)));
  }

  private async notifyConnection(state: "connected" | "retrying", error?: unknown): Promise<void> {
    await Promise.all([...this.listeners].map((listener) => listener.onConnection?.(state, this.retryAttempt, error)));
  }

  private replaceSnapshot(snapshot: OaepSnapshot): void {
    if (snapshot.session.id !== this.sessionId || snapshot.snapshot_sequence < 0) {
      throw new Error("Runtime OAEP snapshot is invalid.");
    }
    this.items.clear();
    this.runs.clear();
    snapshot.items.forEach((item) => this.items.set(item.id, item));
    snapshot.runs.forEach((run) => this.runs.set(run.id, run));
    this.cursor = snapshot.snapshot_sequence;
  }

  private async accept(event: OaepEvent, source: "replay" | "stream"): Promise<void> {
    if (event.session_id !== this.sessionId) throw new Error("Cross-Session OAEP Event rejected.");
    if (event.sequence <= this.cursor) return;
    if (event.sequence !== this.cursor + 1) throw new OaepEventGap();
    reduceOaepEvent(this.items, this.runs, event);
    this.cursor = event.sequence;
    if (source === "replay") this.metrics.replayEvents += 1;
    else this.metrics.streamEvents += 1;
    await this.notifyEvent(event, source);
  }

  private async run(): Promise<void> {
    let needsSnapshot = true;
    let firstReady = false;
    while (!this.abort.signal.aborted) {
      try {
        if (needsSnapshot) {
          this.replaceSnapshot(await this.client.getOaepSnapshot(this.sessionId));
          await this.notifySnapshot(firstReady ? "resnapshot" : "snapshot");
          needsSnapshot = false;
        }
        while (true) {
          const page = await this.client.listOaepEvents(this.sessionId, this.cursor);
          for (const event of page.data) await this.accept(event, "replay");
          if (!page.has_more) break;
        }
        const opened = await this.client.openOaepEventStream(this.sessionId, this.cursor, this.abort.signal);
        if (!firstReady) { firstReady = true; this.readyResolve(); }
        if (this.retryAttempt) await this.notifyConnection("connected");
        this.retryAttempt = 0;
        await consumeSse(opened.events, this.abort.signal, (event) => this.accept(event, "stream"));
        if (!this.abort.signal.aborted) throw new Error("Runtime OAEP stream ended before cancellation.");
      } catch (error) {
        if (this.abort.signal.aborted) break;
        this.metrics.reconnects += 1;
        if (error instanceof OaepEventGap || (
          error instanceof Error && /^(?:oaep_|Cross-Session OAEP)/.test(error.message)
        )) this.metrics.protocolViolations += 1;
        needsSnapshot ||= isCursorExpired(error) || error instanceof OaepEventGap;
        this.retryAttempt += 1;
        await this.notifyConnection("retrying", error);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.min(2000, 100 * 2 ** Math.min(4, this.retryAttempt - 1)));
          this.abort.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    }
    if (!firstReady) this.readyResolve();
  }
}

const controllers = new WeakMap<RuntimeClient, Map<string, SharedOaepSessionController>>();

export async function subscribeOaepSession(
  client: RuntimeClient,
  sessionId: string,
  listener: OaepSessionListener,
): Promise<OaepSessionSubscription> {
  let sessions = controllers.get(client);
  if (!sessions) { sessions = new Map(); controllers.set(client, sessions); }
  let controller = sessions.get(sessionId);
  if (!controller) {
    controller = new SharedOaepSessionController(client, sessionId, () => sessions?.delete(sessionId));
    sessions.set(sessionId, controller);
  }
  const remove = controller.add(listener);
  await controller.ready;
  return {
    get cursor() { return controller!.cursor; },
    get state() { return controller!.state; },
    get metrics() { return { ...controller!.metrics }; },
    done: controller.done,
    stop: remove,
  };
}
