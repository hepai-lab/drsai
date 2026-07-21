export type StreamingTransportTimeout = "connect" | "idle" | "total";
export type StreamingReconnectResult = "reconnected" | "exhausted" | "unsupported" | "expired" | "not_disconnected";

export interface StreamingTransportSnapshot {
  state: "connecting" | "connected" | "backpressured" | "reconnecting" | "terminal";
  startedAt: number;
  connectedAt: number | null;
  lastActivityAt: number;
  lastHeartbeatAt: number;
  disconnectedAt: number | null;
  reconnectAttempts: number;
  timeout: StreamingTransportTimeout | null;
}

export interface StreamingTransportPolicy {
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  heartbeatIntervalMs: number;
  reconnectWindowMs: number;
  maxReconnectAttempts: number;
  supportsResume: boolean;
}

const DEFAULT_POLICY: StreamingTransportPolicy = {
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 15_000,
  totalTimeoutMs: 120_000,
  heartbeatIntervalMs: 5_000,
  reconnectWindowMs: 8_000,
  maxReconnectAttempts: 2,
  supportsResume: false,
};

export class StreamingTransportReliability {
  readonly policy: StreamingTransportPolicy;
  #snapshot: StreamingTransportSnapshot;

  constructor(now = Date.now(), policy: Partial<StreamingTransportPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    validatePolicy(this.policy);
    this.#snapshot = {
      state: "connecting",
      startedAt: now,
      connectedAt: null,
      lastActivityAt: now,
      lastHeartbeatAt: now,
      disconnectedAt: null,
      reconnectAttempts: 0,
      timeout: null,
    };
  }

  get snapshot(): Readonly<StreamingTransportSnapshot> { return { ...this.#snapshot }; }

  connected(now = Date.now()): boolean {
    if (this.#snapshot.state === "terminal") return false;
    this.#snapshot.state = "connected";
    this.#snapshot.connectedAt ??= now;
    this.#snapshot.lastActivityAt = now;
    this.#snapshot.disconnectedAt = null;
    return true;
  }

  activity(now = Date.now()): boolean {
    if (this.#snapshot.state === "terminal") return false;
    this.#snapshot.lastActivityAt = now;
    return true;
  }

  setBackpressured(active: boolean, now = Date.now()): boolean {
    if (this.#snapshot.state === "terminal" || this.#snapshot.state === "reconnecting") return false;
    const next = active ? "backpressured" : "connected";
    if (this.#snapshot.state === next) return false;
    this.#snapshot.state = next;
    this.#snapshot.lastActivityAt = now;
    return true;
  }

  disconnect(now = Date.now()): boolean {
    if (this.#snapshot.state === "terminal" || this.#snapshot.state === "reconnecting") return false;
    this.#snapshot.state = "reconnecting";
    this.#snapshot.disconnectedAt = now;
    return true;
  }

  async reconnect(attempt: () => boolean | Promise<boolean>, now = Date.now()): Promise<StreamingReconnectResult> {
    if (this.#snapshot.state !== "reconnecting" || this.#snapshot.disconnectedAt === null) return "not_disconnected";
    if (!this.policy.supportsResume) return "unsupported";
    if (now - this.#snapshot.disconnectedAt > this.policy.reconnectWindowMs) return "expired";
    if (this.#snapshot.reconnectAttempts >= this.policy.maxReconnectAttempts) return "exhausted";
    this.#snapshot.reconnectAttempts += 1;
    if (!await attempt()) return this.#snapshot.reconnectAttempts >= this.policy.maxReconnectAttempts ? "exhausted" : "not_disconnected";
    this.connected(now);
    return "reconnected";
  }

  poll(now = Date.now()): { heartbeatDue: boolean; timeout: StreamingTransportTimeout | null } {
    if (this.#snapshot.state === "terminal") return { heartbeatDue: false, timeout: this.#snapshot.timeout };
    let timeout: StreamingTransportTimeout | null = null;
    if (now - this.#snapshot.startedAt >= this.policy.totalTimeoutMs) timeout = "total";
    else if (this.#snapshot.connectedAt === null && now - this.#snapshot.startedAt >= this.policy.connectTimeoutMs) timeout = "connect";
    else if (this.#snapshot.connectedAt !== null && now - this.#snapshot.lastActivityAt >= this.policy.idleTimeoutMs) timeout = "idle";
    if (timeout) {
      this.#snapshot.timeout = timeout;
      this.#snapshot.state = "terminal";
      return { heartbeatDue: false, timeout };
    }
    const heartbeatDue = now - this.#snapshot.lastHeartbeatAt >= this.policy.heartbeatIntervalMs;
    if (heartbeatDue) this.#snapshot.lastHeartbeatAt = now;
    return { heartbeatDue, timeout: null };
  }

  finish(): boolean {
    if (this.#snapshot.state === "terminal") return false;
    this.#snapshot.state = "terminal";
    return true;
  }
}

function validatePolicy(policy: StreamingTransportPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (name === "supportsResume") continue;
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  }
  if (!Number.isInteger(policy.maxReconnectAttempts)) throw new Error("maxReconnectAttempts must be an integer.");
  if (policy.connectTimeoutMs > policy.totalTimeoutMs || policy.idleTimeoutMs > policy.totalTimeoutMs) {
    throw new Error("Connect and idle timeouts cannot exceed the total timeout.");
  }
}
