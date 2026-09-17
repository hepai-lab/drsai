export type RemoteFailureKind = "ssh" | "runtime";

export interface RuntimeEventEnvelope {
  event_id: string;
  sequence: number;
  [key: string]: unknown;
}

export interface ReconnectPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxWindowMs?: number;
  jitterRatio?: number;
  random?: () => number;
}

export class ReconnectBackoff {
  private attempt = 0;
  private startedAt: number | undefined;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxWindowMs: number;
  readonly jitterRatio: number;
  readonly random: () => number;

  constructor(options: ReconnectPolicyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.maxWindowMs = options.maxWindowMs ?? 180_000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.random = options.random ?? Math.random;
  }

  next(now = Date.now()): { attempt: number; delayMs: number; exhausted: boolean; elapsedMs: number } {
    this.startedAt ??= now;
    const elapsedMs = Math.max(0, now - this.startedAt);
    if (elapsedMs >= this.maxWindowMs) return { attempt: this.attempt, delayMs: 0, exhausted: true, elapsedMs };
    const raw = Math.min(this.baseDelayMs * 2 ** this.attempt, this.maxDelayMs);
    const jitter = raw * this.jitterRatio * (this.random() * 2 - 1);
    const delayMs = Math.max(0, Math.round(raw + jitter));
    if (elapsedMs + delayMs > this.maxWindowMs) return { attempt: this.attempt, delayMs: 0, exhausted: true, elapsedMs };
    this.attempt += 1;
    return { attempt: this.attempt, delayMs, exhausted: false, elapsedMs };
  }

  reset(): void {
    this.attempt = 0;
    this.startedAt = undefined;
  }
}

export function classifyRemoteFailure(runtimeReachable: boolean, sshReachable: boolean): RemoteFailureKind | undefined {
  if (runtimeReachable) return undefined;
  return sshReachable ? "runtime" : "ssh";
}

export class RuntimeInstanceTracker {
  runtimeId: string | undefined;
  instanceId: string | undefined;
  generation = 0;

  observe(runtimeId: string | undefined, instanceId: string | undefined): "unknown" | "initial" | "unchanged" | "restarted" {
    if (!runtimeId || !instanceId) return "unknown";
    if (!this.runtimeId) {
      this.runtimeId = runtimeId;
      this.instanceId = instanceId;
      this.generation = 1;
      return "initial";
    }
    if (this.runtimeId !== runtimeId) throw new Error("Remote Runtime identity changed; automatic Workspace reassociation is unsafe.");
    if (this.instanceId === instanceId) return "unchanged";
    this.instanceId = instanceId;
    this.generation += 1;
    return "restarted";
  }
}

export class RuntimeEventAccumulator<T extends RuntimeEventEnvelope = RuntimeEventEnvelope> {
  private readonly ids = new Set<string>();
  private readonly pending = new Map<number, T>();
  private sequence = 0;

  get afterSequence(): number { return this.sequence; }

  accept(events: readonly T[]): T[] {
    const accepted: T[] = [];
    for (const event of events) {
      if (!event.event_id || !Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error("Runtime Event identity is invalid.");
      if (this.ids.has(event.event_id)) continue;
      if (event.sequence <= this.sequence) throw new Error(`Runtime Event sequence ${event.sequence} was reused by ${event.event_id}.`);
      const existing = this.pending.get(event.sequence);
      if (existing && existing.event_id !== event.event_id) throw new Error(`Runtime Event sequence ${event.sequence} has conflicting identities.`);
      this.pending.set(event.sequence, event);
      this.ids.add(event.event_id);
    }
    for (;;) {
      const event = this.pending.get(this.sequence + 1);
      if (!event) break;
      this.pending.delete(event.sequence);
      this.sequence = event.sequence;
      accepted.push(event);
    }
    return accepted;
  }
}
