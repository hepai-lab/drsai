import type {
  DesktopStreamingVoiceTtsAudioSegment,
  DesktopStreamingVoiceTtsSegmentRequest,
  DesktopVoiceSynthesisEvent,
  DesktopVoiceSynthesisRequest,
  DesktopVoiceSynthesisStartResult,
} from "@shared/desktopApi";
import type { StreamingTtsRuntime } from "./streamingTtsScheduler";

export interface DesktopTtsTaskProvider {
  start(request: DesktopVoiceSynthesisRequest): Promise<DesktopVoiceSynthesisStartResult>;
  cancel(requestId: string): Promise<boolean>;
  subscribe(callback: (event: DesktopVoiceSynthesisEvent) => void): () => void;
}

interface PendingTask {
  request: DesktopStreamingVoiceTtsSegmentRequest;
  resolve: (segment: DesktopStreamingVoiceTtsAudioSegment) => void;
  reject: (error: unknown) => void;
  abort: () => void;
  cleanup: () => void;
}

export class DesktopStreamingTtsRuntime implements StreamingTtsRuntime {
  readonly id = "desktop-voice-synthesis";
  readonly provider: DesktopTtsTaskProvider;
  #pending = new Map<string, PendingTask>();
  #earlyEvents = new Map<string, DesktopVoiceSynthesisEvent>();
  #unsubscribe: () => void;
  #disposed = false;

  constructor(provider: DesktopTtsTaskProvider) {
    this.provider = provider;
    this.#unsubscribe = provider.subscribe((event) => this.#handleEvent(event));
  }

  async synthesize(request: DesktopStreamingVoiceTtsSegmentRequest, signal: AbortSignal): Promise<DesktopStreamingVoiceTtsAudioSegment> {
    if (this.#disposed) throw voiceError("cancelled", "Streaming TTS runtime is disposed.", false);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const result = await this.provider.start({ text: request.text, language: undefined, voice: request.voice, speed: request.speed, format: request.format });
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.#pending.delete(result.requestId);
        void this.provider.cancel(result.requestId);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      const cleanup = (): void => signal.removeEventListener("abort", abort);
      this.#pending.set(result.requestId, { request, resolve, reject, abort, cleanup });
      const early = this.#earlyEvents.get(result.requestId);
      if (early) { this.#earlyEvents.delete(result.requestId); this.#handleEvent(early); }
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    for (const [requestId, task] of this.#pending) {
      void this.provider.cancel(requestId);
      task.cleanup();
      task.reject(new DOMException("Cancelled", "AbortError"));
    }
    this.#pending.clear();
    this.#earlyEvents.clear();
  }

  #handleEvent(event: DesktopVoiceSynthesisEvent): void {
    if (event.type === "accepted" || event.type === "progress") return;
    const task = this.#pending.get(event.requestId);
    if (!task) { this.#earlyEvents.set(event.requestId, event); return; }
    this.#pending.delete(event.requestId);
    task.cleanup();
    if (event.type === "completed") {
      task.resolve({
        sessionId: task.request.sessionId, turnId: task.request.turnId, messageId: task.request.messageId,
        segmentId: task.request.segmentId, segmentIndex: task.request.segmentIndex,
        mimeType: event.result.mimeType, audioData: event.result.audioData, final: true,
      });
    } else if (event.type === "failed") task.reject(event.error);
    else task.reject(voiceError("cancelled", "Voice synthesis was cancelled.", false));
  }
}

function voiceError(code: "cancelled", message: string, retryable: boolean): { code: "cancelled"; message: string; retryable: boolean } { return { code, message, retryable }; }
