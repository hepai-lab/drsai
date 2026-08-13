import type { DesktopStreamingVoiceAudioChunk, DesktopStreamingVoiceCapabilities, DesktopStreamingVoiceTranscriptionEvent } from "../../api/desktopApi";
import type { StreamingTranscriptionRuntime } from "./runtime";
import type { StreamingProviderCapability } from "./providerPolicy";
import { decideStreamingRecovery } from "./providerPolicy";

export interface FailoverRuntimeCandidate {
  capability: StreamingProviderCapability;
  create: (emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void) => StreamingTranscriptionRuntime;
}

export class FailoverStreamingTranscriptionRuntime implements StreamingTranscriptionRuntime {
  readonly id = "gateway-provider" as const;
  readonly capabilities: DesktopStreamingVoiceCapabilities;
  #candidateIndex = 0;
  #runtime: StreamingTranscriptionRuntime;
  #sequence = 0;
  #terminal = false;
  #hasFinal = false;
  #unacknowledged = new Map<number, DesktopStreamingVoiceAudioChunk>();
  #inputEnded: "provider" | "local_vad" | "manual" | null = null;
  readonly candidates: readonly FailoverRuntimeCandidate[];
  readonly emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void;
  readonly allowCrossProvider: boolean;

  constructor(candidates: readonly FailoverRuntimeCandidate[], emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void, allowCrossProvider: boolean) {
    if (!candidates.length) throw new Error("Failover runtime requires at least one Provider.");
    this.candidates = candidates; this.emit = emit; this.allowCrossProvider = allowCrossProvider;
    this.#runtime = this.#createCurrent();
    this.capabilities = { ...this.#runtime.capabilities, supportsProviderFailover: allowCrossProvider && candidates.length > 1 };
  }

  start(): void { this.#runtime.start(); }
  pushAudio(chunk: DesktopStreamingVoiceAudioChunk): boolean {
    if (this.#terminal || !this.#runtime.pushAudio(chunk)) return false;
    this.#unacknowledged.set(chunk.sequence, chunk); return true;
  }
  endInput(reason: "provider" | "local_vad" | "manual" = "manual"): boolean { this.#inputEnded = reason; return this.#runtime.endInput(reason); }
  cancel(): boolean { if (this.#terminal) return false; this.#terminal = true; return this.#runtime.cancel(); }
  dispose(): void { this.#terminal = true; this.#unacknowledged.clear(); this.#runtime.dispose(); }

  #createCurrent(): StreamingTranscriptionRuntime { return this.candidates[this.#candidateIndex].create((event) => this.#onEvent(event)); }
  #onEvent(event: DesktopStreamingVoiceTranscriptionEvent): void {
    if (this.#terminal) return;
    if (event.type === "audio_ack") for (const sequence of this.#unacknowledged.keys()) if (sequence <= event.ack.acknowledgedSequence) this.#unacknowledged.delete(sequence);
    if (event.type === "final") this.#hasFinal = true;
    if (event.type === "failed" && !this.#hasFinal) {
      const current = this.candidates[this.#candidateIndex].capability;
      const decision = decideStreamingRecovery({ current, candidates: this.candidates.map((item) => item.capability), retryable: false, attempt: 1, maxSameProviderRetries: 1, allowCrossProvider: this.allowCrossProvider, serialAvailable: false });
      const nextIndex = decision.action === "switch_provider" ? this.candidates.findIndex((item) => item.capability.id === decision.providerId) : -1;
      if (nextIndex >= 0) {
        this.#runtime.dispose(); this.#candidateIndex = nextIndex; this.#runtime = this.#createCurrent();
        this.#emit({ ...event, type: "connection_state", state: "reconnecting", attempt: 1 });
        this.#runtime.start();
        for (const chunk of this.#unacknowledged.values()) this.#runtime.pushAudio(chunk);
        if (this.#inputEnded) this.#runtime.endInput(this.#inputEnded);
        return;
      }
    }
    if (["failed", "completed", "cancelled"].includes(event.type)) this.#terminal = true;
    this.#emit(event);
  }
  #emit(event: DesktopStreamingVoiceTranscriptionEvent): void { this.emit({ ...event, sequence: this.#sequence++ }); }
}
