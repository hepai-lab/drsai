import type {
  DesktopStreamingVoiceAudioChunk,
  DesktopStreamingVoiceTranscriptionEvent,
  DesktopVoiceRuntimeId,
} from "../../api/desktopApi";
import type { StreamingTranscriptionRuntime } from "./runtime";

type FixtureTranscriptionEvent = DesktopStreamingVoiceTranscriptionEvent extends infer Event
  ? Event extends DesktopStreamingVoiceTranscriptionEvent
    ? Omit<Event, "sessionId" | "turnId" | "sequence">
    : never
  : never;

export interface FixtureStreamingRuntimeOptions {
  sessionId: string;
  turnId: string;
  partials: string[];
  finalText: string;
  partialEveryChunks?: number;
  runtimeId?: DesktopVoiceRuntimeId;
  emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void;
}

export class FixtureStreamingTranscriptionRuntime implements StreamingTranscriptionRuntime {
  #eventSequence = 0;
  #lastAudioSequence = -1;
  #partialIndex = 0;
  #terminal = false;
  readonly options: Required<Pick<FixtureStreamingRuntimeOptions, "partialEveryChunks" | "runtimeId">> & FixtureStreamingRuntimeOptions;
  readonly id: DesktopVoiceRuntimeId;
  readonly capabilities = {
    serialStt: true, serialTts: true, streamingStt: true, streamingTts: false,
    audioEncodings: ["pcm_s16le" as const], sampleRatesHz: [16_000, 24_000, 48_000],
    supportsPartialTranscripts: true, supportsProviderEndpointing: true, supportsSessionResume: false, maxBufferedAudioMs: 2_000,
  };

  constructor(options: FixtureStreamingRuntimeOptions) {
    if (!options.sessionId || !options.turnId || !options.finalText.trim()) throw new Error("Fixture session, turn, and final text are required.");
    this.options = {
      ...options,
      partialEveryChunks: options.partialEveryChunks ?? 2,
      runtimeId: options.runtimeId ?? "mock-local",
    };
    this.id = this.options.runtimeId;
    if (!Number.isInteger(this.options.partialEveryChunks) || this.options.partialEveryChunks <= 0) {
      throw new Error("partialEveryChunks must be a positive integer.");
    }
  }

  start(): void {
    if (this.#terminal) return;
    this.#emit({ type: "accepted", runtimeId: this.options.runtimeId });
  }

  pushAudio(chunk: DesktopStreamingVoiceAudioChunk): boolean {
    if (this.#terminal || chunk.sessionId !== this.options.sessionId || chunk.turnId !== this.options.turnId) return false;
    if (chunk.sequence !== this.#lastAudioSequence + 1) return false;
    this.#lastAudioSequence = chunk.sequence;
    this.#emit({
      type: "audio_ack",
      ack: {
        sessionId: this.options.sessionId,
        turnId: this.options.turnId,
        acknowledgedSequence: chunk.sequence,
        bufferedAudioMs: 0,
        receivedAt: new Date(0).toISOString(),
      },
    });
    if ((chunk.sequence + 1) % this.options.partialEveryChunks === 0 && this.#partialIndex < this.options.partials.length) {
      this.#emit({
        type: "partial",
        segment: { text: this.options.partials[this.#partialIndex], revision: this.#partialIndex + 1 },
      });
      this.#partialIndex += 1;
    }
    return true;
  }

  endInput(reason: "provider" | "local_vad" | "manual" = "manual"): boolean {
    if (this.#terminal) return false;
    this.#emit({ type: "endpoint", reason });
    this.#emit({
      type: "final",
      segment: { text: this.options.finalText, revision: this.#partialIndex + 1, confidence: 1 },
    });
    this.#terminal = true;
    this.#emit({ type: "completed" });
    return true;
  }

  cancel(): boolean {
    if (this.#terminal) return false;
    this.#terminal = true;
    this.#emit({ type: "cancelled" });
    return true;
  }

  dispose(): void { this.#terminal = true; }

  #emit(event: FixtureTranscriptionEvent): void {
    this.options.emit({
      ...event,
      sessionId: this.options.sessionId,
      turnId: this.options.turnId,
      sequence: this.#eventSequence,
    } as DesktopStreamingVoiceTranscriptionEvent);
    this.#eventSequence += 1;
  }
}
