import type {
  DesktopVoiceTranscriptionEvent,
  DesktopVoiceTranscriptionRequest,
  DesktopVoiceTranscriptionResult,
  DesktopVoiceTranscriptionStartResult,
} from "@shared/desktopApi";

export interface VoiceTranscriptionBridge {
  cancel: (requestId: string) => Promise<boolean>;
  start: (request: DesktopVoiceTranscriptionRequest) => Promise<DesktopVoiceTranscriptionStartResult>;
  subscribe: (callback: (event: DesktopVoiceTranscriptionEvent) => void) => () => void;
}

interface ActiveTranscription {
  cancelled: boolean;
  generation: number;
  reject: (error: Error) => void;
  requestId: string | null;
  settled: boolean;
  unsubscribe: () => void;
}

export class VoiceTranscriptionController {
  private active: ActiveTranscription | null = null;
  private readonly bridge: VoiceTranscriptionBridge;
  private disposed = false;
  private generation = 0;
  private readonly onProgress: (message: string) => void;

  constructor(
    bridge: VoiceTranscriptionBridge,
    onProgress: (message: string) => void,
  ) {
    this.bridge = bridge;
    this.onProgress = onProgress;
  }

  transcribe(request: DesktopVoiceTranscriptionRequest): Promise<DesktopVoiceTranscriptionResult> {
    if (this.disposed) return Promise.reject(new Error("Voice transcription controller is disposed."));
    if (this.active && !this.active.settled) return Promise.reject(new Error("A voice transcription request is already active."));
    const generation = ++this.generation;
    return new Promise((resolve, reject) => {
      const task: ActiveTranscription = {
        cancelled: false,
        generation,
        reject,
        requestId: null,
        settled: false,
        unsubscribe: () => undefined,
      };
      task.unsubscribe = this.bridge.subscribe((event) => {
        if (this.active !== task || task.settled || task.cancelled) return;
        if (!task.requestId && event.type === "accepted") task.requestId = event.requestId;
        if (!task.requestId || event.requestId !== task.requestId) return;
        if (event.type === "progress") {
          this.onProgress(event.message);
        } else if (event.type === "completed") {
          this.finish(task);
          resolve(event.result);
        } else if (event.type === "failed") {
          this.finish(task);
          reject(new Error(event.error.message));
        } else if (event.type === "cancelled") {
          this.finish(task);
          reject(cancelledError());
        }
      });
      this.active = task;
      void this.bridge.start(request).then((started) => {
        if (task.cancelled || this.disposed) {
          void this.bridge.cancel(started.requestId);
          task.unsubscribe();
          return;
        }
        if (task.settled) return;
        if (this.active !== task) {
          void this.bridge.cancel(started.requestId);
          task.unsubscribe();
          return;
        }
        task.requestId ??= started.requestId;
      }).catch((error) => {
        if (task.settled) return;
        this.finish(task);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  cancel(): boolean {
    const task = this.active;
    if (!task || task.settled || task.cancelled) return false;
    task.cancelled = true;
    task.settled = true;
    task.unsubscribe();
    if (task.requestId) void this.bridge.cancel(task.requestId);
    task.reject(cancelledError());
    if (this.active === task && task.requestId) this.active = null;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  private finish(task: ActiveTranscription): void {
    if (task.settled) return;
    task.settled = true;
    task.unsubscribe();
    if (this.active === task) this.active = null;
  }
}

function cancelledError(): DOMException {
  return new DOMException("Voice transcription was cancelled.", "AbortError");
}
