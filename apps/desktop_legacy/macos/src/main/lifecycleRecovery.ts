export type RendererRecoveryAction = "reload" | "recreate" | "relaunch";
export type InterruptionReason = "resume" | "unlock" | "network-online" | "display-change" | "renderer-recovered" | "gpu-recovered";

export type DesktopLifecycleRecoveryEvent = {
  reason: InterruptionReason;
  recoveredGateway: boolean;
  at: string;
};

export class MacosLifecycleRecoveryCoordinator {
  readonly #rendererFailures: number[] = [];
  #gatewayWasReady = false;
  #online: boolean | null = null;
  #recovery: Promise<DesktopLifecycleRecoveryEvent> | null = null;
  readonly #interruptionObservations = new Set<Promise<void>>();
  #shuttingDown = false;

  recordRendererFailure(now = Date.now()): RendererRecoveryAction {
    const cutoff = now - 60_000;
    while (this.#rendererFailures.length && this.#rendererFailures[0]! < cutoff) this.#rendererFailures.shift();
    this.#rendererFailures.push(now);
    if (this.#rendererFailures.length <= 2) return "reload";
    if (this.#rendererFailures.length === 3) return "recreate";
    return "relaunch";
  }

  suspend(gatewayReady: boolean): void {
    this.#gatewayWasReady ||= gatewayReady;
  }

  observeInterruption(getGatewayReady: () => Promise<boolean>): void {
    let observation!: Promise<void>;
    observation = Promise.resolve().then(getGatewayReady)
      .then((ready) => this.suspend(ready))
      .catch(() => undefined)
      .finally(() => this.#interruptionObservations.delete(observation));
    this.#interruptionObservations.add(observation);
  }

  setNetworkOnline(online: boolean): boolean {
    const recovered = this.#online === false && online;
    this.#online = online;
    return recovered;
  }

  beginShutdown(): void {
    this.#shuttingDown = true;
  }

  get shuttingDown(): boolean {
    return this.#shuttingDown;
  }

  recover(
    reason: InterruptionReason,
    startGateway: () => Promise<unknown>,
    clock: () => Date = () => new Date(),
  ): Promise<DesktopLifecycleRecoveryEvent> {
    if (this.#recovery) return this.#recovery;
    this.#recovery = (async () => {
      await Promise.allSettled([...this.#interruptionObservations]);
      const recoverGateway = this.#gatewayWasReady && !this.#shuttingDown;
      if (recoverGateway) await startGateway();
      this.#gatewayWasReady = false;
      return { reason, recoveredGateway: recoverGateway, at: clock().toISOString() };
    })().finally(() => { this.#recovery = null; });
    return this.#recovery;
  }
}
