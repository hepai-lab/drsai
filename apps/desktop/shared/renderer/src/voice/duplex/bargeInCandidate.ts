import type { DuplexVadSignal } from "./localVad";

export type DuplexBargeInCandidateAction = "idle" | "duck" | "await_transcript" | "commit_stop";
export interface DuplexBargeInCandidateSnapshot { action: DuplexBargeInCandidateAction; confidence: number; echoRisk: number; localSpeechMs: number; stopDecisionLatencyMs: number | null; providerSpeech: boolean; asrPrefix: string; reasons: string[] }

export class DuplexBargeInCandidate {
  readonly #now: () => number; #localSpeechMs = 0; #localPeak = 0; #localActive = false; #speechStartedAt: number | null = null; #providerSpeech = false; #asrPrefix = ""; #playbackActive = false; #playbackLevel = 0; #committedStop = false; #stopDecisionLatencyMs: number | null = null;
  constructor(now: () => number = () => performance.now()) { this.#now = now; }
  reset(): void { this.#localSpeechMs = 0; this.#localPeak = 0; this.#localActive = false; this.#speechStartedAt = null; this.#providerSpeech = false; this.#asrPrefix = ""; this.#playbackActive = false; this.#playbackLevel = 0; this.#committedStop = false; this.#stopDecisionLatencyMs = null; }
  completeUtterance(): void { this.#localSpeechMs = 0; this.#localPeak = 0; this.#localActive = false; this.#speechStartedAt = null; this.#providerSpeech = false; this.#asrPrefix = ""; this.#committedStop = false; this.#stopDecisionLatencyMs = null; }
  setPlayback(active: boolean, referenceLevel = 0): DuplexBargeInCandidateSnapshot { this.#playbackActive = active; this.#playbackLevel = Math.max(0, Math.min(1, referenceLevel)); return this.snapshot(); }
  setProviderSpeech(active: boolean): DuplexBargeInCandidateSnapshot { if (active) this.#providerSpeech = true; return this.snapshot(); }
  observeAsrPrefix(prefix: string): DuplexBargeInCandidateSnapshot { this.#asrPrefix = normalize(prefix).slice(0, 160); return this.snapshot(); }
  observeLocal(signal: DuplexVadSignal, durationMs: number): DuplexBargeInCandidateSnapshot { this.#localActive = signal.speechCandidate; if (signal.speechCandidate) { if (this.#speechStartedAt === null) this.#speechStartedAt = this.#now(); this.#localSpeechMs += Math.max(0, durationMs); this.#localPeak = Math.max(this.#localPeak, signal.level); } return this.snapshot(signal.level); }
  snapshot(localLevel = 0): DuplexBargeInCandidateSnapshot {
    const reasons: string[] = []; const meaningfulPrefix = hasMeaningfulSpeech(this.#asrPrefix); const stopPrefix = isFastStopPrefix(this.#asrPrefix);
    let confidence = 0;
    if (this.#localSpeechMs >= 120) { confidence += 0.2; reasons.push("local_vad"); }
    if (this.#localSpeechMs >= 320) { confidence += 0.2; reasons.push("sustained"); }
    if (this.#providerSpeech) { confidence += 0.3; reasons.push("provider_vad"); }
    if (meaningfulPrefix) { confidence += 0.4; reasons.push("asr_prefix"); }
    const localReference = Math.max(localLevel, this.#localPeak); const playbackDominates = this.#playbackLevel >= Math.max(0.08, localReference * 0.8);
    const echoRisk = this.#playbackActive && playbackDominates && !this.#providerSpeech ? Math.min(1, 0.55 + this.#playbackLevel * 0.3) : 0;
    if (echoRisk > 0) reasons.push("playback_echo_risk");
    let action: DuplexBargeInCandidateAction = "idle";
    const protectedStop = this.#providerSpeech || !playbackDominates;
    if (this.#playbackActive && stopPrefix && this.#localSpeechMs >= 120 && protectedStop && !this.#committedStop) { action = "commit_stop"; this.#committedStop = true; this.#stopDecisionLatencyMs = this.#speechStartedAt === null ? null : Math.max(0, this.#now() - this.#speechStartedAt); reasons.push("fast_stop"); }
    else if (this.#playbackActive && this.#localActive) action = confidence - echoRisk >= 0.55 && meaningfulPrefix ? "await_transcript" : "duck";
    else if (this.#playbackActive && meaningfulPrefix && confidence - echoRisk >= 0.55) action = "await_transcript";
    return Object.freeze({ action, confidence: Math.max(0, Math.min(1, confidence)), echoRisk, localSpeechMs: this.#localSpeechMs, stopDecisionLatencyMs: this.#stopDecisionLatencyMs, providerSpeech: this.#providerSpeech, asrPrefix: this.#asrPrefix, reasons });
  }
}

export function isFastStopPrefix(value: string): boolean { const text = normalize(value).replace(/[\s,.!?，。！？]+$/u, ""); return /^(?:停|停止|别说了|不用说了|闭嘴|stop|stop talking|quiet|cancel)$/iu.test(text); }
function hasMeaningfulSpeech(value: string): boolean { const text = normalize(value).replace(/[\s,.!?，。！？]/gu, ""); return text.length >= 2 && !/^(?:嗯|呃|啊|唔|mm+|uh+|er+)$/iu.test(text); }
function normalize(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase(); }
