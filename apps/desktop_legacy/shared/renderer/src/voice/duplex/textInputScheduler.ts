export type DuplexTextSendStrategy = "after_response" | "interrupt_now";
export interface DuplexPendingText { id: string; text: string; queuedAt: number }
export interface DuplexTextInputSchedulerOptions {
  isResponseActive: () => boolean;
  send: (item: DuplexPendingText) => Promise<boolean>;
  interrupt: () => Promise<boolean>;
  onPendingChange?: (pending: DuplexPendingText | null) => void;
  createId?: () => string;
  now?: () => number;
}

/** Owns the single, visible text slot used while a Realtime response is speaking. */
export class DuplexTextInputScheduler {
  readonly #options: DuplexTextInputSchedulerOptions;
  #pending: DuplexPendingText | null = null;
  #flushing: Promise<boolean> | null = null;
  constructor(options: DuplexTextInputSchedulerOptions) { this.#options = options; }
  get pending(): DuplexPendingText | null { return this.#pending; }
  async submit(text: string, strategy: DuplexTextSendStrategy): Promise<boolean> {
    const value = text.trim();
    if (!value || value.length > 20_000 || this.#pending || this.#flushing) return false;
    const item = { id: this.#options.createId?.() ?? `t-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`, text: value, queuedAt: this.#options.now?.() ?? Date.now() };
    if (strategy === "after_response" && this.#options.isResponseActive()) { this.#pending = item; this.#options.onPendingChange?.(item); return true; }
    if (strategy === "interrupt_now" && this.#options.isResponseActive() && !await this.#options.interrupt()) return false;
    return this.#options.send(item);
  }
  flush(): Promise<boolean> {
    if (!this.#pending) return Promise.resolve(false);
    if (this.#flushing) return this.#flushing;
    const item = this.#pending;
    this.#pending = null; this.#options.onPendingChange?.(null);
    this.#flushing = this.#options.send(item).then((sent) => { if (!sent && !this.#pending) { this.#pending = item; this.#options.onPendingChange?.(item); } return sent; }).finally(() => { this.#flushing = null; });
    return this.#flushing;
  }
  cancel(): DuplexPendingText | null { const pending = this.#pending; this.#pending = null; if (pending) this.#options.onPendingChange?.(null); return pending; }
}
