import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { WebContents } from "electron";
import type {
  DesktopVoiceTranscriptHandoffRequest,
  DesktopVoiceTranscriptHandoffResult,
  DesktopVoiceTranscriptionRequest,
  DesktopVoiceTranscriptionResult,
  DesktopVoiceTranscriptionEvent,
  DesktopVoiceTranscriptionStartResult,
  DesktopVoiceRuntimeStatus,
  DesktopVoiceError,
} from "../api/desktopApi";
import { getGatewayRequestHeaders, getGatewayStatus, startGateway } from "./gateway";
import { desktopDiagnostics, type DiagnosticOperationHandle } from "./diagnostics";
import {
  clampVoiceDuration,
  decodeVoiceAudioData,
  MAX_VOICE_RECORDING_BYTES,
  MAX_VOICE_RECORDING_SECONDS,
  normalizeVoiceMimeType,
  SUPPORTED_VOICE_MIME_TYPES,
  validateVoiceSignature,
} from "./voiceValidation";
export { cleanupAllVoiceTempFiles, cleanupExpiredVoiceTempFiles } from "./voiceTempFiles";

const MAX_VOICE_TRANSCRIPT_CHARS = 12_000;
const DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH = ".drsai/voice-context.json";
const VOICE_TIMEOUT_MS = 60_000;

interface ActiveVoiceTask {
  cleanupSenderListener: () => void;
  controller: AbortController;
  diagnostic: Promise<DiagnosticOperationHandle>;
  sender: WebContents;
  tempPath?: string;
  terminal: boolean;
}

interface VoiceRuntimeInput {
  requestId: string;
  request: DesktopVoiceTranscriptionRequest;
  audio: Uint8Array;
  mimeType: string;
  durationSeconds: number;
  gatewayBaseUrl: string;
}

interface VoiceRuntime {
  readonly id: "gateway-provider" | "mock-local";
  getStatus(): Promise<DesktopVoiceRuntimeStatus>;
  transcribe(input: VoiceRuntimeInput, signal: AbortSignal): Promise<DesktopVoiceTranscriptionResult>;
}

const activeVoiceTasks = new Map<string, ActiveVoiceTask>();

async function getGatewayVoiceRuntimeStatus(): Promise<DesktopVoiceRuntimeStatus> {
  const status = await getGatewayStatus();
  const hasCredential = Boolean(process.env.HEPAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
  const state = !status.ready ? "unavailable" : hasCredential ? "ready" : "auth_required";
  return {
    runtimeId: "gateway-provider",
    state,
    supportedMimeTypes: [...SUPPORTED_VOICE_MIME_TYPES],
    maxBytes: MAX_VOICE_RECORDING_BYTES,
    maxDurationSeconds: MAX_VOICE_RECORDING_SECONDS,
    supportsPartial: false,
    providerDisclosure: "Recorded audio is sent through the local OpenDrSai gateway to the configured speech transcription provider.",
    message: state === "ready"
      ? "Voice transcription runtime is ready."
      : state === "auth_required"
        ? "Configure a transcription provider API key."
        : "Start the local gateway and configure a transcription provider.",
  };
}

const gatewayProviderRuntime: VoiceRuntime = {
  id: "gateway-provider",
  getStatus: getGatewayVoiceRuntimeStatus,
  transcribe: transcribeGatewayWithRetry,
};

async function transcribeGatewayWithRetry(
  input: VoiceRuntimeInput,
  signal: AbortSignal,
): Promise<DesktopVoiceTranscriptionResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await transcribeThroughGateway(
        input.requestId, input.request, input.audio, input.mimeType,
        input.durationSeconds, input.gatewayBaseUrl, signal,
      );
    } catch (error) {
      const voiceError = error as Partial<DesktopVoiceError>;
      if (attempt > 0 || voiceError.code !== "network_error" || signal.aborted) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
    }
  }
  throw voiceFailure("internal_error", "Voice transcription retry failed.", true);
}

const fixtureVoiceRuntime: VoiceRuntime = {
  id: "mock-local",
  getStatus: async () => ({
    runtimeId: "mock-local",
    state: "ready",
    supportedMimeTypes: [...SUPPORTED_VOICE_MIME_TYPES],
    maxBytes: MAX_VOICE_RECORDING_BYTES,
    maxDurationSeconds: MAX_VOICE_RECORDING_SECONDS,
    supportsPartial: false,
    providerDisclosure: "Deterministic fixture transcription is active for tests.",
    message: "Fixture voice runtime is ready.",
  }),
  transcribe: async (input, signal) => {
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(resolvePromise, 25);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
    });
    return {
      ok: true,
      transcript: "Fixture voice transcript.",
      language: input.request.languageHint,
      durationSeconds: input.durationSeconds,
      runtimeId: "mock-local",
      sourceId: `voice-${input.requestId}`,
      createdAt: new Date().toISOString(),
      truncated: false,
      providerDisclosure: "Deterministic fixture transcription is active for tests.",
      message: "Fixture transcription completed.",
    };
  },
};

function getVoiceRuntime(): VoiceRuntime {
  return process.env.OPENDRSAI_VOICE_RUNTIME === "fixture" ? fixtureVoiceRuntime : gatewayProviderRuntime;
}

export function getVoiceRuntimeStatus(): Promise<DesktopVoiceRuntimeStatus> {
  return getVoiceRuntime().getStatus();
}

export function startVoiceTranscription(
  sender: WebContents,
  request: DesktopVoiceTranscriptionRequest,
): DesktopVoiceTranscriptionStartResult {
  if (activeVoiceTasks.size >= 3) throw new Error("Too many active voice transcription tasks.");
  if ([...activeVoiceTasks.values()].some((task) => task.sender === sender && !task.terminal)) {
    throw new Error("A voice transcription task is already active for this window.");
  }
  const requestId = randomUUID();
  const controller = new AbortController();
  const handleSenderDestroyed = (): void => controller.abort();
  const task: ActiveVoiceTask = {
    cleanupSenderListener: () => sender.removeListener("destroyed", handleSenderDestroyed),
    controller,
    diagnostic: desktopDiagnostics.start({
      traceId: requestId,
      module: "voice",
      component: "stt",
      operation: "voice.transcription",
      message: "Voice transcription started",
      attributes: {
        mimeType: request.mimeType,
        bytes: request.audioData?.byteLength ?? 0,
        durationSeconds: request.durationSeconds,
        runtime: getVoiceRuntime().id,
      },
    }),
    sender,
    terminal: false,
  };
  activeVoiceTasks.set(requestId, task);
  sender.once("destroyed", handleSenderDestroyed);
  emitVoiceEvent(task, { requestId, type: "accepted", runtimeId: getVoiceRuntime().id });
  void runVoiceTranscription(requestId, request, task);
  return { requestId, acceptedAt: new Date().toISOString() };
}

export function cancelVoiceTranscription(requestId: string): boolean {
  const task = activeVoiceTasks.get(requestId);
  if (!task || task.terminal) return false;
  task.controller.abort();
  return true;
}

export function cancelVoiceTranscriptionsForSender(sender: WebContents): void {
  for (const task of activeVoiceTasks.values()) {
    if (task.sender === sender && !task.terminal) task.controller.abort();
  }
}

async function runVoiceTranscription(
  requestId: string,
  request: DesktopVoiceTranscriptionRequest,
  task: ActiveVoiceTask,
): Promise<void> {
  try {
    emitVoiceEvent(task, { requestId, type: "progress", stage: "preparing", message: "Preparing audio..." });
    const audio = decodeVoiceAudioData(request);
    const durationSeconds = clampVoiceDuration(request.durationSeconds);
    const mimeType = normalizeVoiceMimeType(request.mimeType);
    validateVoiceSignature(audio, mimeType);
    task.tempPath = writeTemporaryVoiceAudio(requestId, audio, mimeType);
    const storedAudio = new Uint8Array(readFileSync(task.tempPath));
    const runtime = getVoiceRuntime();
    if (runtime.id === "gateway-provider") await startGateway();
    const gateway = await getGatewayStatus();
    if (runtime.id === "gateway-provider" && !gateway.ready) throw voiceFailure("runtime_unavailable", "The local voice gateway is unavailable.", true);
    emitVoiceEvent(task, { requestId, type: "progress", stage: "uploading", message: "Sending audio to the configured transcription service..." });
    const result = await runtime.transcribe({ requestId, request, audio: storedAudio, mimeType, durationSeconds, gatewayBaseUrl: gateway.baseUrl }, task.controller.signal);
    finishVoiceTask(requestId, task, { requestId, type: "completed", result });
  } catch (error) {
    if (task.controller.signal.aborted) {
      finishVoiceTask(requestId, task, { requestId, type: "cancelled" });
    } else {
      const normalized = normalizeVoiceError(error, requestId);
      finishVoiceTask(requestId, task, { requestId, type: "failed", error: normalized });
    }
  }
}

async function transcribeThroughGateway(
  requestId: string,
  request: DesktopVoiceTranscriptionRequest,
  audio: Uint8Array,
  mimeType: string,
  durationSeconds: number,
  baseUrl: string,
  parentSignal: AbortSignal,
): Promise<DesktopVoiceTranscriptionResult> {
  const timeout = AbortSignal.timeout(VOICE_TIMEOUT_MS);
  const signal = AbortSignal.any([parentSignal, timeout]);
  const form = new FormData();
  const audioBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  form.append("file", new Blob([audioBuffer], { type: mimeType }), `recording${extensionForMimeType(mimeType)}`);
  form.append("model", process.env.OPENDRSAI_VOICE_MODEL?.trim() || "whisper-1");
  if (request.languageHint) form.append("language", request.languageHint);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: getGatewayRequestHeaders(),
      body: form,
      signal,
    });
  } catch (error) {
    if (timeout.aborted && !parentSignal.aborted) throw voiceFailure("timeout", "Voice transcription timed out.", true);
    throw error;
  }
  const body = await readBoundedJson(response);
  if (!response.ok) throw providerHttpError(response.status, body);
  const transcript = typeof body.text === "string" ? body.text.trim() : "";
  if (!transcript) throw voiceFailure("empty_audio", "No speech was detected in the recording.", false);
  return {
    ok: true,
    transcript: transcript.slice(0, MAX_VOICE_TRANSCRIPT_CHARS),
    language: typeof body.language === "string" ? body.language : request.languageHint,
    durationSeconds,
    confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    runtimeId: "gateway-provider",
    sourceId: `voice-${requestId}`,
    createdAt: new Date().toISOString(),
    truncated: transcript.length > MAX_VOICE_TRANSCRIPT_CHARS,
    providerDisclosure: "Recorded audio was sent through the local OpenDrSai gateway to the configured transcription provider.",
    message: `Voice transcription completed in ${Date.now() - startedAt} ms.`,
  };
}

function writeTemporaryVoiceAudio(requestId: string, audio: Uint8Array, mimeType: string): string {
  const path = join(tmpdir(), `opendrsai-voice-${requestId}${extensionForMimeType(mimeType)}`);
  writeFileSync(path, audio, { flag: "wx" });
  return path;
}

function extensionForMimeType(mimeType: string): string {
  return ({ "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/mp4": ".m4a", "audio/mpeg": ".mp3" } as Record<string, string>)[mimeType] || ".audio";
}

function emitVoiceEvent(task: ActiveVoiceTask, event: DesktopVoiceTranscriptionEvent): void {
  if (!task.sender.isDestroyed()) task.sender.send("desktop:voice-transcription-event", event);
}

function finishVoiceTask(requestId: string, task: ActiveVoiceTask, event: DesktopVoiceTranscriptionEvent): void {
  if (task.terminal) return;
  task.terminal = true;
  task.cleanupSenderListener();
  emitVoiceEvent(task, event);
  if (task.tempPath) { try { unlinkSync(task.tempPath); } catch { /* best effort */ } }
  activeVoiceTasks.delete(requestId);
  void task.diagnostic.then((diagnostic) => {
    if (event.type === "completed") return diagnostic.complete("Voice transcription completed", { runtime: event.result.runtimeId });
    if (event.type === "cancelled") return diagnostic.cancel("Voice transcription cancelled");
    if (event.type === "failed") return diagnostic.fail(new Error("Voice transcription failed"), event.error.code);
    return undefined;
  }).catch(() => undefined);
}

function voiceFailure(code: DesktopVoiceError["code"], message: string, retryable: boolean): DesktopVoiceError {
  return { code, message, retryable };
}

function normalizeVoiceError(error: unknown, requestId: string): DesktopVoiceError {
  if (error && typeof error === "object" && "code" in error && "retryable" in error) return { ...(error as DesktopVoiceError), requestId };
  const message = error instanceof Error ? error.message : "Voice transcription failed.";
  return { code: message.toLowerCase().includes("fetch") ? "network_error" : "internal_error", message, retryable: true, requestId };
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.length > 256_000) throw voiceFailure("provider_error", "Voice provider response was too large.", false);
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw voiceFailure("provider_error", "Voice provider returned an invalid response.", true); }
}

function providerHttpError(status: number, body: Record<string, unknown>): DesktopVoiceError {
  const detail = typeof body.detail === "string" ? body.detail : `Voice provider failed with HTTP ${status}.`;
  if (status === 401 || status === 403) return voiceFailure("auth_required", detail, false);
  if (status === 413) return voiceFailure("audio_too_large", detail, false);
  if (status === 429) return voiceFailure("rate_limited", detail, true);
  return voiceFailure(status >= 500 ? "network_error" : "provider_error", detail, status >= 500);
}

interface VoiceTranscriptRecord {
  id: string;
  title: string;
  speaker: string;
  language?: string;
  transcript: string;
  durationSeconds?: number;
  sourceId?: string;
  runtimeId?: string;
  capturedAt: string;
  createdAt: string;
}

interface VoiceTranscriptStore {
  version: 1;
  transcripts: VoiceTranscriptRecord[];
}

export function writeVoiceTranscriptHandoff(
  request: DesktopVoiceTranscriptHandoffRequest,
): DesktopVoiceTranscriptHandoffResult {
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const transcript = clampMultiline(
    request.transcript,
    MAX_VOICE_TRANSCRIPT_CHARS,
    "Voice transcript text is required.",
  );
  const transcriptPath = resolveInsideWorkspace(
    workspacePath,
    DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH,
  );
  ensureWritableHandoffPath(workspacePath, transcriptPath);
  const now = new Date().toISOString();
  const store = readVoiceTranscriptStore(transcriptPath);
  const record: VoiceTranscriptRecord = {
    id: `voice-${randomUUID()}`,
    title: clampOptionalSingleLine(request.title, 160) || "Desktop voice transcript",
    speaker: clampOptionalSingleLine(request.speaker, 80) || "desktop-user",
    language: clampOptionalSingleLine(request.language, 32),
    transcript,
    durationSeconds:
      typeof request.durationSeconds === "number"
        ? Math.max(0, Math.min(MAX_VOICE_RECORDING_SECONDS, Math.round(request.durationSeconds)))
        : undefined,
    sourceId: clampOptionalSingleLine(request.sourceId, 120),
    runtimeId: clampOptionalSingleLine(request.runtimeId, 80),
    capturedAt: clampOptionalSingleLine(request.capturedAt, 80) || now,
    createdAt: now,
  };
  const nextStore: VoiceTranscriptStore = {
    version: 1,
    transcripts: [record, ...store.transcripts].slice(0, 50),
  };
  writeFileSync(transcriptPath, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
  return {
    ok: true,
    transcriptPath,
    relativePath: DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH,
    recordId: record.id,
    itemCount: nextStore.transcripts.length,
    importRequest: {
      adapterId: "voice-input",
      workspacePath,
      voiceTranscriptPath: DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH,
      limit: 1,
    },
    message:
      "Voice transcript handoff was written inside the workspace for explicit Channels review.",
  };
}

function readVoiceTranscriptStore(transcriptPath: string): VoiceTranscriptStore {
  if (!existsSync(transcriptPath)) return { version: 1, transcripts: [] };
  const stats = statSync(transcriptPath);
  if (!stats.isFile() || stats.size > 1024 * 1024) {
    throw new Error("Existing voice handoff is not a bounded file.");
  }
  try {
    const parsed = JSON.parse(readFileSync(transcriptPath, "utf8")) as Partial<VoiceTranscriptStore>;
    const transcripts = Array.isArray(parsed.transcripts)
      ? parsed.transcripts.filter(isVoiceTranscriptRecord)
      : [];
    return { version: 1, transcripts };
  } catch {
    return { version: 1, transcripts: [] };
  }
}

function ensureWritableHandoffPath(workspacePath: string, transcriptPath: string): void {
  const parent = dirname(transcriptPath);
  if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
    throw new Error("Voice handoff directory cannot be a symlink.");
  }
  mkdirSync(parent, { recursive: true });
  if (existsSync(transcriptPath) && lstatSync(transcriptPath).isSymbolicLink()) {
    throw new Error("Voice handoff file cannot be a symlink.");
  }
  resolveInsideWorkspace(workspacePath, transcriptPath);
}

function resolveWorkspacePath(rawWorkspacePath: string): string {
  const workspacePath = clampSingleLine(rawWorkspacePath, 2048, "Workspace path is required.");
  if (!existsSync(workspacePath)) throw new Error("Workspace path does not exist.");
  return realpathSync.native(resolve(workspacePath));
}

function resolveInsideWorkspace(workspacePath: string, rawPath: string): string {
  const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspacePath, rawPath);
  const rel = relative(workspacePath, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."))) {
    return target;
  }
  throw new Error("Voice handoff path must stay inside the workspace.");
}

function isVoiceTranscriptRecord(value: unknown): value is VoiceTranscriptRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as VoiceTranscriptRecord).id === "string" &&
    typeof (value as VoiceTranscriptRecord).transcript === "string"
  );
}

function clampSingleLine(value: unknown, maxLength: number, fallback?: string): string {
  const normalized =
    typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
  if (!normalized) {
    if (fallback) throw new Error(fallback);
    return "";
  }
  return normalized.slice(0, maxLength);
}

function clampOptionalSingleLine(value: unknown, maxLength: number): string | undefined {
  return clampSingleLine(value, maxLength) || undefined;
}

function clampMultiline(value: unknown, maxLength: number, fallback?: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    if (fallback) throw new Error(fallback);
    return "";
  }
  return normalized.slice(0, maxLength);
}
