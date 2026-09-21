import type { DesktopDuplexVoiceInterruptRequest } from "../../../../api/desktopApi";

export interface DuplexActiveResponse { sessionId: string; responseId: string; itemId: string; contentIndex: number }
export type DuplexInterruptOutcome = "candidate" | "committed" | "reverted" | "rejected" | "timeout" | "superseded";
export interface DuplexInterruptTransaction { interruptId: string; responseId: string; reason: "user_speech" | "manual" | "stop_intent" | null; outcome: DuplexInterruptOutcome; playedAudioMs: number | null }
export interface DuplexBargeInActions {
  duckLocalPlayback?(responseId: string): void;
  restoreLocalPlayback?(responseId: string): void;
  stopLocalPlayback(responseId: string): number;
  clearQueuedOutput(responseId: string): void;
  interruptProvider(request: DesktopDuplexVoiceInterruptRequest): Promise<boolean>;
  onTransaction?(transaction: Readonly<DuplexInterruptTransaction>): void;
}

export class DuplexBargeInCoordinator {
  readonly #actions: DuplexBargeInActions; readonly #timeoutMs: number;
  #generation = 0; #sequence = 0; #active: DuplexInterruptTransaction | null = null; #committed = new Set<string>(); #pending = new Map<string, Promise<boolean>>();
  constructor(actions: DuplexBargeInActions, timeoutMs = 2_000) { this.#actions = actions; this.#timeoutMs = timeoutMs; }
  get transaction(): Readonly<DuplexInterruptTransaction> | null { return this.#active ? Object.freeze({ ...this.#active }) : null; }
  candidate(active: DuplexActiveResponse): Readonly<DuplexInterruptTransaction> {
    if (this.#active?.responseId === active.responseId && this.#active.outcome === "candidate") return this.transaction!;
    this.#active = { interruptId: `${active.responseId}:${++this.#sequence}`, responseId: active.responseId, reason: null, outcome: "candidate", playedAudioMs: null };
    this.#actions.duckLocalPlayback?.(active.responseId); this.#publish(); return this.transaction!;
  }
  revokeCandidate(active: DuplexActiveResponse): boolean {
    if (this.#active?.responseId !== active.responseId || this.#active.outcome !== "candidate") return false;
    this.#active.outcome = "reverted"; this.#actions.restoreLocalPlayback?.(active.responseId); this.#publish(); return true;
  }
  async interrupt(active: DuplexActiveResponse, reason: "user_speech" | "manual" | "stop_intent"): Promise<boolean> {
    if (this.#committed.has(active.responseId)) return true;
    const existing = this.#pending.get(active.responseId); if (existing) return existing;
    const pending = this.#commit(active, reason); this.#pending.set(active.responseId, pending);
    try { return await pending; } finally { if (this.#pending.get(active.responseId) === pending) this.#pending.delete(active.responseId); }
  }
  async #commit(active: DuplexActiveResponse, reason: "user_speech" | "manual" | "stop_intent"): Promise<boolean> {
    if (this.#active?.responseId !== active.responseId || this.#active.outcome !== "candidate") this.candidate(active);
    const transaction = this.#active!; transaction.reason = reason;
    const generation = ++this.#generation; const playedAudioMs = Math.max(0, Math.floor(this.#actions.stopLocalPlayback(active.responseId)));
    transaction.playedAudioMs = playedAudioMs; this.#actions.clearQueuedOutput(active.responseId);
    const request = { ...active, interruptId: transaction.interruptId, playedAudioMs, reason };
    let accepted: boolean;
    try { accepted = await withTimeout(this.#actions.interruptProvider(request), this.#timeoutMs); }
    catch { accepted = false; if (generation === this.#generation) transaction.outcome = "timeout"; }
    if (generation !== this.#generation) { transaction.outcome = "superseded"; this.#publish(); return false; }
    if (accepted) { transaction.outcome = "committed"; this.#committed.add(active.responseId); }
    else if (transaction.outcome !== "timeout") { transaction.outcome = "rejected"; this.#actions.restoreLocalPlayback?.(active.responseId); }
    this.#publish(); return accepted;
  }
  manualOverride(): void { this.#generation += 1; if (this.#active && this.#active.outcome === "candidate") { this.#active.outcome = "superseded"; this.#publish(); } }
  reset(): void { this.#generation += 1; this.#active = null; this.#committed.clear(); this.#pending.clear(); }
  #publish(): void { if (this.#active) this.#actions.onTransaction?.(Object.freeze({ ...this.#active })); }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("interrupt_timeout")), timeoutMs); promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); }); }); }
