import type { StreamingProviderSocket } from "./websocketStreamingRuntime";

export interface PrewarmedSocketPoolOptions {
  maxIdle?: number;
  idleTimeoutMs?: number;
  createSocket: (url: string) => StreamingProviderSocket;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface IdleSocket { url: string; socket: StreamingProviderSocket; timer: ReturnType<typeof setTimeout>; }

/** Bounded pool of fresh sockets. A leased socket is never recycled across voice sessions. */
export class PrewarmedStreamingSocketPool {
  readonly options: Required<Pick<PrewarmedSocketPoolOptions, "maxIdle" | "idleTimeoutMs">> & PrewarmedSocketPoolOptions;
  #idle: IdleSocket[] = [];

  constructor(options: PrewarmedSocketPoolOptions) {
    this.options = { maxIdle: 2, idleTimeoutMs: 15_000, ...options };
    if (!Number.isInteger(this.options.maxIdle) || this.options.maxIdle < 1 || this.options.idleTimeoutMs <= 0) throw new Error("Invalid prewarmed socket pool limits.");
  }

  prewarm(url: string, count = 1): number {
    let created = 0;
    while (created < count && this.#idle.length < this.options.maxIdle) {
      const socket = this.options.createSocket(url);
      const entry = {} as IdleSocket;
      entry.url = url;
      entry.socket = socket;
      entry.timer = (this.options.schedule ?? setTimeout)(() => this.#expire(entry), this.options.idleTimeoutMs);
      this.#idle.push(entry);
      created += 1;
    }
    return created;
  }

  acquire(url: string): StreamingProviderSocket | null {
    const index = this.#idle.findIndex((entry) => entry.url === url && entry.socket.readyState <= 1);
    if (index < 0) return null;
    const [entry] = this.#idle.splice(index, 1);
    (this.options.cancelSchedule ?? clearTimeout)(entry.timer);
    return entry.socket;
  }

  dispose(): void {
    for (const entry of this.#idle.splice(0)) {
      (this.options.cancelSchedule ?? clearTimeout)(entry.timer);
      entry.socket.close(1000, "prewarm pool disposed");
    }
  }

  get idleCount(): number { return this.#idle.length; }

  #expire(entry: IdleSocket): void {
    const index = this.#idle.indexOf(entry);
    if (index < 0) return;
    this.#idle.splice(index, 1);
    entry.socket.close(1000, "prewarm idle timeout");
  }
}
