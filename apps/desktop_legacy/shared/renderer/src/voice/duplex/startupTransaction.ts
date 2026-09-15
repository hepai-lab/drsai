export type DuplexStartupStage = "preparing_microphone" | "preparing_playback" | "connecting_provider" | "activating_audio";
export type DuplexVoiceStartupStage = "checking_readiness" | "awaiting_disclosure" | DuplexStartupStage;

export class DuplexStartupError extends Error {
  readonly stage: DuplexVoiceStartupStage;
  readonly code: "stage_failed" | "stage_timeout";
  constructor(stage: DuplexVoiceStartupStage, code: "stage_failed" | "stage_timeout", message: string) { super(message); this.name = "DuplexStartupError"; this.stage = stage; this.code = code; }
}

export interface DuplexStartupTransactionOptions<Result> {
  prepareCapture: () => Promise<boolean>;
  preparePlayback?: () => Promise<boolean>;
  startProvider: () => Promise<Result>;
  activateCapture: (result: Result) => boolean | Promise<boolean>;
  releaseCapture: () => Promise<void>;
  releasePlayback?: () => Promise<void>;
  cancelProvider: (result: Result) => Promise<unknown>;
  onStage?: (stage: DuplexStartupStage) => void;
  timeoutMs?: number | Partial<Record<DuplexStartupStage, number>>;
}

/** Runs startup in billing-safe order and rolls completed stages back in reverse. */
export async function runDuplexStartupTransaction<Result>(options: DuplexStartupTransactionOptions<Result>): Promise<Result> {
  let prepareAttempted = false; let playbackAttempted = false; let providerResult: Result | undefined; let providerStarted = false;
  try {
    prepareAttempted = true; options.onStage?.("preparing_microphone");
    if (!await runDuplexStartupStage("preparing_microphone", options.prepareCapture, resolveTimeout(options.timeoutMs, "preparing_microphone"))) throw new DuplexStartupError("preparing_microphone", "stage_failed", "Microphone permission or audio capture initialization failed.");
    if (options.preparePlayback) { playbackAttempted = true; options.onStage?.("preparing_playback"); if (!await runDuplexStartupStage("preparing_playback", options.preparePlayback, resolveTimeout(options.timeoutMs, "preparing_playback"))) throw new DuplexStartupError("preparing_playback", "stage_failed", "Audio playback initialization failed."); }
    options.onStage?.("connecting_provider"); providerResult = await runDuplexStartupStage("connecting_provider", options.startProvider, resolveTimeout(options.timeoutMs, "connecting_provider")); providerStarted = true;
    options.onStage?.("activating_audio"); if (!await runDuplexStartupStage("activating_audio", () => Promise.resolve(options.activateCapture(providerResult as Result)), resolveTimeout(options.timeoutMs, "activating_audio"))) throw new DuplexStartupError("activating_audio", "stage_failed", "Microphone capture could not be activated after the Realtime Session started.");
    return providerResult;
  } catch (error) {
    if (providerStarted) await options.cancelProvider(providerResult as Result).catch(() => undefined);
    if (playbackAttempted) await options.releasePlayback?.().catch(() => undefined);
    if (prepareAttempted) await options.releaseCapture().catch(() => undefined);
    throw error;
  }
}

function resolveTimeout(configuredTimeout: DuplexStartupTransactionOptions<unknown>["timeoutMs"], stage: DuplexStartupStage): number {
  return typeof configuredTimeout === "number" ? configuredTimeout : configuredTimeout?.[stage] ?? 10_000;
}

export async function runDuplexStartupStage<Result>(stage: DuplexVoiceStartupStage, operation: () => Promise<Result>, timeoutMs = 10_000): Promise<Result> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new DuplexStartupError(stage, "stage_timeout", `Realtime startup stage ${stage} has an invalid timeout.`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DuplexStartupError(stage, "stage_timeout", `Realtime startup stage ${stage} timed out after ${timeoutMs} ms.`)), timeoutMs); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
