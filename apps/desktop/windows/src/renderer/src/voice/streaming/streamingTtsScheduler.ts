import type { DesktopStreamingVoiceTtsAudioSegment, DesktopStreamingVoiceTtsSegmentRequest, DesktopVoiceError } from "@shared/desktopApi";

export interface StreamingTtsRuntime {
  readonly id: string;
  synthesize(request: DesktopStreamingVoiceTtsSegmentRequest, signal: AbortSignal): Promise<DesktopStreamingVoiceTtsAudioSegment>;
  dispose(): void;
}

export type StreamingTtsSchedulerEvent =
  | { type: "started"; request: DesktopStreamingVoiceTtsSegmentRequest; attempt: number }
  | { type: "audio"; segment: DesktopStreamingVoiceTtsAudioSegment }
  | { type: "retry"; request: DesktopStreamingVoiceTtsSegmentRequest; attempt: number; error: DesktopVoiceError }
  | { type: "failed"; request: DesktopStreamingVoiceTtsSegmentRequest; error: DesktopVoiceError }
  | { type: "idle" }
  | { type: "cancelled" };

export class BoundedStreamingTtsScheduler {
  readonly runtime: StreamingTtsRuntime;
  readonly maxRetries: number;
  readonly onEvent: (event: StreamingTtsSchedulerEvent) => void;
  #active: DesktopStreamingVoiceTtsSegmentRequest | null = null;
  #pending: DesktopStreamingVoiceTtsSegmentRequest | null = null;
  #controller: AbortController | null = null;
  #cancelled = false;
  #seenIds = new Set<string>();
  #seenIndexes = new Set<number>();

  constructor(runtime: StreamingTtsRuntime, options: { maxRetries?: number; onEvent: (event: StreamingTtsSchedulerEvent) => void }) {
    this.runtime = runtime;
    this.maxRetries = options.maxRetries ?? 2;
    this.onEvent = options.onEvent;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 5) throw new Error("maxRetries must be between zero and five.");
  }

  get active(): DesktopStreamingVoiceTtsSegmentRequest | null { return this.#active; }
  get pending(): DesktopStreamingVoiceTtsSegmentRequest | null { return this.#pending; }
  get capacity(): number { return Number(this.#active === null) + Number(this.#pending === null); }

  enqueue(request: DesktopStreamingVoiceTtsSegmentRequest): boolean {
    if (this.#cancelled || this.#contains(request.segmentId, request.segmentIndex)) return false;
    this.#seenIds.add(request.segmentId);
    this.#seenIndexes.add(request.segmentIndex);
    if (!this.#active) {
      this.#active = request;
      void this.#run(request);
      return true;
    }
    if (this.#pending) return false;
    this.#pending = request;
    return true;
  }

  cancel(): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    this.#pending = null;
    this.#controller?.abort();
    this.#controller = null;
    this.#active = null;
    this.runtime.dispose();
    this.onEvent({ type: "cancelled" });
  }

  async #run(request: DesktopStreamingVoiceTtsSegmentRequest): Promise<void> {
    this.#controller = new AbortController();
    for (let attempt = 0; attempt <= this.maxRetries && !this.#cancelled; attempt += 1) {
      try {
        this.onEvent({ type: "started", request, attempt });
        const segment = await this.runtime.synthesize(request, this.#controller.signal);
        if (this.#cancelled || this.#controller.signal.aborted) return;
        if (segment.segmentId !== request.segmentId || segment.segmentIndex !== request.segmentIndex) {
          throw voiceError("provider_error", "TTS provider returned the wrong segment identity.", false);
        }
        this.onEvent({ type: "audio", segment });
        this.#advance();
        return;
      } catch (error) {
        if (this.#cancelled || this.#controller.signal.aborted) return;
        const normalized = normalizeSchedulerError(error);
        if (!normalized.retryable || attempt >= this.maxRetries) {
          this.onEvent({ type: "failed", request, error: normalized });
          this.#advance();
          return;
        }
        this.onEvent({ type: "retry", request, attempt: attempt + 1, error: normalized });
      }
    }
  }

  #advance(): void {
    this.#controller = null;
    this.#active = this.#pending;
    this.#pending = null;
    if (this.#active) void this.#run(this.#active);
    else this.onEvent({ type: "idle" });
  }

  #contains(segmentId: string, segmentIndex: number): boolean {
    return this.#seenIds.has(segmentId) || this.#seenIndexes.has(segmentIndex);
  }
}

function normalizeSchedulerError(error: unknown): DesktopVoiceError {
  if (error && typeof error === "object" && "code" in error && "retryable" in error) return error as DesktopVoiceError;
  return voiceError("internal_error", error instanceof Error ? error.message : "TTS synthesis failed.", true);
}
function voiceError(code: DesktopVoiceError["code"], message: string, retryable: boolean): DesktopVoiceError { return { code, message, retryable }; }
