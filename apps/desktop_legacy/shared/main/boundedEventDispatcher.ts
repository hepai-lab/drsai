export interface BoundedEventDispatcherOptions<T> {
  capacity?: number;
  deliver: (event: T) => void;
  merge?: (previous: T, next: T) => T | null;
  schedule?: (flush: () => void) => unknown;
}

/**
 * Batches renderer-bound stream events and bounds the main-process queue.
 * Adjacent deltas may be merged, while control events retain FIFO ordering.
 */
export class BoundedEventDispatcher<T> {
  readonly #capacity: number;
  readonly #deliver: (event: T) => void;
  readonly #merge?: (previous: T, next: T) => T | null;
  readonly #schedule: (flush: () => void) => unknown;
  #queue: T[] = [];
  #scheduled = false;
  #closed = false;

  constructor(options: BoundedEventDispatcherOptions<T>) {
    this.#capacity = Math.max(8, Math.min(4_096, Math.trunc(options.capacity ?? 256)));
    this.#deliver = options.deliver;
    this.#merge = options.merge;
    this.#schedule = options.schedule ?? ((flush) => setImmediate(flush));
  }

  enqueue(event: T): void {
    if (this.#closed) return;
    const previous = this.#queue.at(-1);
    const merged = previous === undefined ? null : this.#merge?.(previous, event) ?? null;
    if (merged !== null) this.#queue[this.#queue.length - 1] = merged;
    else {
      if (this.#queue.length >= this.#capacity) this.flush();
      this.#queue.push(event);
    }
    if (!this.#scheduled) {
      this.#scheduled = true;
      this.#schedule(() => this.flush());
    }
  }

  flush(): void {
    if (this.#closed) return;
    this.#scheduled = false;
    const batch = this.#queue;
    this.#queue = [];
    for (const event of batch) this.#deliver(event);
  }

  close(options: { flush?: boolean } = {}): void {
    if (options.flush) this.flush();
    this.#closed = true;
    this.#queue = [];
  }

  get pendingCount(): number { return this.#queue.length; }
}
