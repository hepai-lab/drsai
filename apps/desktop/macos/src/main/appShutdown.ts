export type ShutdownTask = () => void | Promise<unknown>;

export class MacosAppShutdownCoordinator {
  #shutdown: Promise<void> | null = null;

  run(tasks: ShutdownTask[], timeoutMs = 8_000): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#shutdown = Promise.race([
      Promise.allSettled(tasks.map((task) => Promise.resolve().then(task))).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return this.#shutdown;
  }

  get running(): boolean { return this.#shutdown !== null; }
}
