export type ManagedProcessKind = "gateway" | "pty" | "browser-worker" | "native-helper" | "update-watchdog";
export type ManagedProcessState = "starting" | "running" | "stopping" | "exited" | "crashed" | "detached";

export interface ManagedProcessSnapshot {
  id: string;
  kind: ManagedProcessKind;
  owner: string;
  pid: number;
  state: ManagedProcessState;
  startedAt: string;
  updatedAt: string;
  detached: boolean;
  exitCode?: number | null;
  signal?: string | null;
}

export interface ManagedProcessRegistration {
  readonly id: string;
  transition(state: "running" | "stopping" | "detached"): void;
  exited(exitCode?: number | null, signal?: string | null): void;
  crashed(exitCode?: number | null, signal?: string | null): void;
}

export interface RegisterManagedProcessInput {
  id: string;
  kind: ManagedProcessKind;
  owner: string;
  pid: number;
  detached?: boolean;
  stop(): void | Promise<void>;
  forceStop?(): void | Promise<void>;
  alive?(): boolean;
}

type Entry = ManagedProcessSnapshot & Pick<RegisterManagedProcessInput, "stop" | "forceStop" | "alive">;
const TERMINAL_STATES = new Set<ManagedProcessState>(["exited", "crashed"]);
const HISTORY_LIMIT = 200;

export class ManagedProcessRegistry {
  #entries = new Map<string, Entry>();
  #accepting = true;

  get accepting(): boolean { return this.#accepting; }

  register(input: RegisterManagedProcessInput): ManagedProcessRegistration {
    if (!this.#accepting) throw new Error("Managed process registry is shutting down; new processes are rejected.");
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(input.id)) throw new Error("Managed process id is invalid.");
    if (!input.owner.trim() || input.owner.length > 180) throw new Error("Managed process owner is invalid.");
    if (!Number.isInteger(input.pid) || input.pid <= 0) throw new Error("Managed process pid is invalid.");
    const existing = this.#entries.get(input.id);
    if (existing && !TERMINAL_STATES.has(existing.state)) throw new Error(`Managed process ${input.id} is already active.`);
    const now = new Date().toISOString();
    const entry: Entry = {
      ...input, owner: input.owner.trim(), detached: input.detached === true,
      state: input.detached ? "detached" : "starting", startedAt: now, updatedAt: now,
    };
    this.#entries.set(input.id, entry);
    this.#trimHistory();
    return {
      id: input.id,
      transition: (state) => this.#transition(input.id, state),
      exited: (exitCode = null, signal = null) => this.#finish(input.id, "exited", exitCode, signal),
      crashed: (exitCode = null, signal = null) => this.#finish(input.id, "crashed", exitCode, signal),
    };
  }

  snapshots(options: { activeOnly?: boolean } = {}): ManagedProcessSnapshot[] {
    return [...this.#entries.values()]
      .filter((entry) => !options.activeOnly || !TERMINAL_STATES.has(entry.state))
      .map(({ stop: _stop, forceStop: _forceStop, alive: _alive, ...snapshot }) => ({ ...snapshot }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  }

  beginShutdown(): void { this.#accepting = false; }
  resumeForTests(): void { this.#accepting = true; }

  async shutdownAll(timeoutMs = 1_500): Promise<void> {
    this.beginShutdown();
    const order: ManagedProcessKind[] = ["browser-worker", "pty", "native-helper", "gateway"];
    for (const kind of order) {
      const entries = [...this.#entries.values()].filter((entry) => entry.kind === kind && !entry.detached && !TERMINAL_STATES.has(entry.state));
      await Promise.allSettled(entries.map((entry) => this.#shutdownEntry(entry, timeoutMs)));
    }
  }

  resetForTests(): void { this.#entries.clear(); this.#accepting = true; }

  async #shutdownEntry(entry: Entry, timeoutMs: number): Promise<void> {
    this.#transition(entry.id, "stopping");
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.resolve().then(entry.stop),
      new Promise<void>((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, Math.max(10, timeoutMs)); }),
    ]).catch(() => undefined).finally(() => { if (timer) clearTimeout(timer); });
    const current = this.#entries.get(entry.id);
    const alive = current && !TERMINAL_STATES.has(current.state) && (current.alive?.() ?? true);
    if (timedOut || alive) await Promise.resolve().then(current?.forceStop ?? (() => undefined)).catch(() => undefined);
    if (current && !TERMINAL_STATES.has(current.state)) this.#finish(entry.id, timedOut ? "crashed" : "exited", null, timedOut ? "SIGKILL" : "SIGTERM");
  }

  #transition(id: string, state: "running" | "stopping" | "detached"): void {
    const entry = this.#entries.get(id); if (!entry || TERMINAL_STATES.has(entry.state)) return;
    entry.state = state; entry.updatedAt = new Date().toISOString();
  }
  #finish(id: string, state: "exited" | "crashed", exitCode: number | null, signal: string | null): void {
    const entry = this.#entries.get(id); if (!entry || TERMINAL_STATES.has(entry.state)) return;
    entry.state = state; entry.exitCode = exitCode; entry.signal = signal; entry.updatedAt = new Date().toISOString();
  }
  #trimHistory(): void {
    if (this.#entries.size <= HISTORY_LIMIT) return;
    for (const entry of this.#entries.values()) {
      if (!TERMINAL_STATES.has(entry.state)) continue;
      this.#entries.delete(entry.id);
      if (this.#entries.size <= HISTORY_LIMIT) break;
    }
  }
}

export const managedProcessRegistry = new ManagedProcessRegistry();
