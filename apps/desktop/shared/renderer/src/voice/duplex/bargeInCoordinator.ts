import type { DesktopDuplexVoiceInterruptRequest } from "../../../../api/desktopApi";

export interface DuplexActiveResponse { sessionId: string; responseId: string; itemId: string; contentIndex: number }
export interface DuplexBargeInActions {
  stopLocalPlayback(responseId: string): number;
  clearQueuedOutput(responseId: string): void;
  interruptProvider(request: DesktopDuplexVoiceInterruptRequest): Promise<boolean>;
}

export class DuplexBargeInCoordinator {
  readonly #actions: DuplexBargeInActions;
  #generation = 0;
  #committed = new Set<string>();
  constructor(actions: DuplexBargeInActions) { this.#actions = actions; }
  async interrupt(active: DuplexActiveResponse, reason: "user_speech" | "manual" | "stop_intent"): Promise<boolean> {
    if (this.#committed.has(active.responseId)) return true;
    const generation = ++this.#generation;
    const playedAudioMs = Math.max(0, Math.floor(this.#actions.stopLocalPlayback(active.responseId)));
    this.#actions.clearQueuedOutput(active.responseId);
    const accepted = await this.#actions.interruptProvider({ ...active, playedAudioMs, reason });
    if (generation !== this.#generation) return false;
    if (accepted) this.#committed.add(active.responseId);
    return accepted;
  }
  manualOverride(): void { this.#generation += 1; }
  reset(): void { this.#generation += 1; this.#committed.clear(); }
}
