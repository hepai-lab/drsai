import type { VoiceRecordingState } from "./voiceAudio";

export type VoiceCaptureStopMode = "transcribe" | "discard";

export interface VoiceCaptureResult {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

export interface VoiceCaptureCallbacks {
  beforeStart: () => Promise<void>;
  onDevices: (devices: MediaDeviceInfo[]) => void;
  onElapsed: (seconds: number) => void;
  onError: (error: unknown) => void;
  onLevelsReset: () => void;
  onRecorded: (result: VoiceCaptureResult) => void;
  onState: (state: VoiceRecordingState) => void;
  onStreamStarted: (stream: MediaStream) => void;
  onStreamStopped: () => void;
}

export interface VoiceCaptureEnvironment {
  clearInterval: (timer: number) => void;
  createRecorder: (stream: MediaStream, mimeType?: string) => MediaRecorder;
  getPreferredMimeType: () => string | undefined;
  mediaDevices: Pick<MediaDevices, "enumerateDevices" | "getUserMedia">;
  now: () => number;
  setInterval: (callback: () => void, milliseconds: number) => number;
}

export class VoiceCaptureController {
  private readonly callbacks: VoiceCaptureCallbacks;
  private chunks: Blob[] = [];
  private disposed = false;
  private generation = 0;
  private pending = false;
  private recorder: MediaRecorder | null = null;
  private startedAt: number | null = null;
  private stopMode: VoiceCaptureStopMode = "transcribe";
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private readonly environment: VoiceCaptureEnvironment;

  constructor(
    environment: VoiceCaptureEnvironment,
    callbacks: VoiceCaptureCallbacks,
  ) {
    this.environment = environment;
    this.callbacks = callbacks;
  }

  get isActive(): boolean {
    return this.pending || this.recorder?.state === "recording";
  }

  async start(deviceId = ""): Promise<boolean> {
    if (this.disposed || this.isActive) return false;
    this.pending = true;
    const generation = ++this.generation;
    this.callbacks.onError(null);
    this.callbacks.onElapsed(0);
    this.callbacks.onLevelsReset();
    this.callbacks.onState("requesting_permission");
    try {
      await this.callbacks.beforeStart();
      if (!this.isCurrent(generation)) return false;
      const stream = await this.environment.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.isCurrent(generation)) {
        stopTracks(stream);
        return false;
      }
      const devices = await this.environment.mediaDevices.enumerateDevices();
      if (!this.isCurrent(generation)) {
        stopTracks(stream);
        return false;
      }
      const mimeType = this.environment.getPreferredMimeType();
      const recorder = this.environment.createRecorder(stream, mimeType);
      this.stream = stream;
      this.recorder = recorder;
      this.chunks = [];
      this.stopMode = "transcribe";
      this.startedAt = this.environment.now();
      this.callbacks.onDevices(devices.filter((device) => device.kind === "audioinput"));
      this.callbacks.onStreamStarted(stream);
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => this.handleTrackEnded(generation), { once: true });
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => this.fail(new Error("Voice recording failed. Please try again."));
      recorder.onstop = () => this.finish(recorder.mimeType || mimeType || "audio/webm");
      recorder.start();
      this.pending = false;
      this.callbacks.onState("recording");
      this.startTimer();
      return true;
    } catch (error) {
      if (this.isCurrent(generation)) this.fail(error);
      return false;
    } finally {
      if (this.isCurrent(generation)) this.pending = false;
    }
  }

  stop(mode: VoiceCaptureStopMode): void {
    if (this.disposed) return;
    this.generation += 1;
    this.pending = false;
    this.stopMode = mode;
    this.stopTimer();
    this.callbacks.onStreamStopped();
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    this.releaseStream();
    this.callbacks.onLevelsReset();
    this.callbacks.onState("idle");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pending = false;
    this.stopTimer();
    const recorder = this.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    this.recorder = null;
    this.chunks = [];
    this.startedAt = null;
    this.callbacks.onStreamStopped();
    this.releaseStream();
  }

  private finish(mimeType: string): void {
    const durationSeconds = this.startedAt !== null
      ? Math.max(0, Math.round((this.environment.now() - this.startedAt)) / 1000)
      : 0;
    this.startedAt = null;
    const chunks = this.chunks;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = null;
    this.stopTimer();
    this.callbacks.onStreamStopped();
    this.releaseStream();
    this.callbacks.onLevelsReset();
    if (this.stopMode === "discard") {
      this.callbacks.onElapsed(0);
      this.callbacks.onState("idle");
      return;
    }
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) {
      this.callbacks.onState("failed");
      this.callbacks.onError(new Error("Voice recording was empty. Please try again."));
      return;
    }
    this.callbacks.onRecorded({ blob, durationSeconds, mimeType });
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = this.environment.setInterval(() => {
      if (this.startedAt === null || this.recorder?.state !== "recording") return;
      const elapsed = Math.max(0, Math.floor((this.environment.now() - this.startedAt) / 1000));
      this.callbacks.onElapsed(elapsed);
      if (elapsed >= 120) this.stop("transcribe");
    }, 250);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.environment.clearInterval(this.timer);
    this.timer = null;
  }

  private handleTrackEnded(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.generation += 1;
    const recorder = this.recorder;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    this.recorder = null;
    this.chunks = [];
    this.startedAt = null;
    this.stopTimer();
    this.callbacks.onStreamStopped();
    this.releaseStream();
    this.callbacks.onState("failed");
    this.callbacks.onError(new Error("The selected microphone disconnected. Choose another device and try again."));
  }

  private fail(error: unknown): void {
    this.generation += 1;
    this.pending = false;
    const recorder = this.recorder;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    this.recorder = null;
    this.chunks = [];
    this.stopTimer();
    this.callbacks.onStreamStopped();
    this.releaseStream();
    this.callbacks.onState("failed");
    this.callbacks.onError(error);
  }

  private releaseStream(): void {
    stopTracks(this.stream);
    this.stream = null;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
