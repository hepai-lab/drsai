import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { WebContents } from "electron";
import type {
  DesktopVoiceError,
  DesktopVoiceSynthesisEvent,
  DesktopVoiceSynthesisRequest,
  DesktopVoiceSynthesisResult,
  DesktopVoiceSynthesisRuntimeId,
  DesktopVoiceSynthesisRuntimeStatus,
  DesktopVoiceSynthesisStartResult,
} from "../api/desktopApi";
import { getGatewayRequestHeaders, getGatewayStatus, startGateway } from "./gateway";
import { hasSavedApiKey, syncSavedApiKeyToGateway } from "./settings";
import { desktopDiagnostics, type DiagnosticOperationHandle } from "./diagnostics";
import {
  MAX_TTS_TEXT_CHARS,
  normalizeAndValidateTtsAudio,
  normalizeVoiceSynthesisRequest,
  readBoundedVoiceAudio,
  SUPPORTED_TTS_FORMATS,
  type NormalizedVoiceSynthesisRequest,
} from "./voiceTtsValidation";

const TTS_TIMEOUT_MS = 60_000;

interface ActiveTtsTask {
  cleanupSenderListener: () => void;
  controller: AbortController;
  diagnostic: Promise<DiagnosticOperationHandle>;
  sender: WebContents;
  terminal: boolean;
}

const activeTtsTasks = new Map<string, ActiveTtsTask>();

function configuredRuntimeId(): DesktopVoiceSynthesisRuntimeId {
  if (process.env.OPENDRSAI_VOICE_TTS_RUNTIME === "fixture") return "mock-local";
  if (process.env.OPENDRSAI_VOICE_TTS_RUNTIME === "system") return "system";
  return "gateway-provider";
}

function resolveRuntimeId(request: DesktopVoiceSynthesisRequest): DesktopVoiceSynthesisRuntimeId {
  if (request.runtime === "system" || request.runtime === "mock-local" || request.runtime === "gateway-provider") {
    return request.runtime;
  }
  return configuredRuntimeId();
}

export async function getVoiceSynthesisRuntimeStatus(): Promise<DesktopVoiceSynthesisRuntimeStatus> {
  const runtimeId = configuredRuntimeId();
  if (runtimeId === "system") {
    return {
      runtimeId,
      state: process.platform === "win32" ? "ready" : "unavailable",
      supportsSynthesisTask: process.platform === "win32",
      supportedFormats: process.platform === "win32" ? ["wav"] : [],
      maxTextChars: MAX_TTS_TEXT_CHARS,
      providerDisclosure: "System speech is synthesized locally with Windows Speech API.",
      message: process.platform === "win32"
        ? "Windows system speech synthesis is ready."
        : "Native system speech synthesis is only available on Windows.",
    };
  }
  if (runtimeId === "mock-local") {
    return {
      runtimeId,
      state: "ready",
      supportsSynthesisTask: true,
      supportedFormats: ["wav"],
      maxTextChars: MAX_TTS_TEXT_CHARS,
      providerDisclosure: "Deterministic fixture synthesis is active for tests.",
      message: "Fixture voice synthesis runtime is ready.",
    };
  }
  const status = await getGatewayStatus();
  const hasCredential = Boolean(
    process.env.HEPAI_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || hasSavedApiKey(),
  );
  const state = !status.ready ? "unavailable" : hasCredential ? "ready" : "auth_required";
  return {
    runtimeId,
    state,
    supportsSynthesisTask: true,
    supportedFormats: SUPPORTED_TTS_FORMATS,
    maxTextChars: MAX_TTS_TEXT_CHARS,
    providerDisclosure: "Reply text is sent through the local OpenDrSai gateway to the configured speech synthesis provider.",
    message: state === "ready"
      ? "Voice synthesis runtime is ready."
      : state === "auth_required"
        ? "Configure a speech synthesis provider API key."
        : "Start the local gateway and configure a speech synthesis provider.",
  };
}

export function startVoiceSynthesis(
  sender: WebContents,
  request: DesktopVoiceSynthesisRequest,
): DesktopVoiceSynthesisStartResult {
  const runtimeId = resolveRuntimeId(request);
  if (runtimeId === "system" && process.platform !== "win32") {
    throw ttsFailure("runtime_unavailable", "Native system speech synthesis is only available on Windows.", false);
  }
  if (activeTtsTasks.size >= 3) throw ttsFailure("runtime_unavailable", "Too many active voice synthesis tasks.", true);
  if ([...activeTtsTasks.values()].some((task) => task.sender === sender && !task.terminal)) {
    throw ttsFailure("runtime_unavailable", "A voice synthesis task is already active for this window.", true);
  }
  const normalizedRequest = normalizeVoiceSynthesisRequest({
    ...request,
    format: runtimeId === "system" ? "wav" : request.format,
  });
  const requestId = randomUUID();
  const controller = new AbortController();
  const handleSenderDestroyed = (): void => controller.abort();
  const task: ActiveTtsTask = {
    cleanupSenderListener: () => sender.removeListener("destroyed", handleSenderDestroyed),
    controller,
    diagnostic: desktopDiagnostics.start({
      traceId: requestId,
      module: "voice",
      component: "tts",
      operation: "voice.synthesis",
      message: "Voice synthesis started",
      attributes: {
        textLength: normalizedRequest.text.length,
        speed: normalizedRequest.speed,
        format: normalizedRequest.format,
        runtime: runtimeId,
      },
    }),
    sender,
    terminal: false,
  };
  activeTtsTasks.set(requestId, task);
  sender.once("destroyed", handleSenderDestroyed);
  emitTtsEvent(task, { requestId, type: "accepted", runtimeId });
  void runVoiceSynthesis(requestId, normalizedRequest, runtimeId, task);
  return { requestId, acceptedAt: new Date().toISOString() };
}

export function cancelVoiceSynthesis(requestId: string): boolean {
  const task = activeTtsTasks.get(requestId);
  if (!task || task.terminal) return false;
  task.controller.abort();
  return true;
}

export function cancelVoiceSynthesisForSender(sender: WebContents): void {
  for (const task of activeTtsTasks.values()) {
    if (task.sender === sender && !task.terminal) task.controller.abort();
  }
}

async function runVoiceSynthesis(
  requestId: string,
  request: NormalizedVoiceSynthesisRequest,
  runtimeId: DesktopVoiceSynthesisRuntimeId,
  task: ActiveTtsTask,
): Promise<void> {
  try {
    emitTtsEvent(task, { requestId, type: "progress", stage: "preparing", message: "Preparing reply text..." });
    const result = runtimeId === "mock-local"
      ? await synthesizeFixture(request, task.controller.signal)
      : runtimeId === "system"
        ? await synthesizeWithWindowsSpeech(request, task.controller.signal)
        : await synthesizeThroughGateway(request, task.controller.signal);
    finishTtsTask(requestId, task, { requestId, type: "completed", result });
  } catch (error) {
    if (task.controller.signal.aborted) {
      finishTtsTask(requestId, task, { requestId, type: "cancelled" });
    } else {
      finishTtsTask(requestId, task, { requestId, type: "failed", error: normalizeTtsError(error, requestId) });
    }
  }
}

async function synthesizeFixture(
  _request: DesktopVoiceSynthesisRequest,
  signal: AbortSignal,
): Promise<DesktopVoiceSynthesisResult> {
  await abortableDelay(25, signal);
  const audioData = createSilentWav();
  return {
    audioData,
    mimeType: "audio/wav",
    runtimeId: "mock-local",
    createdAt: new Date().toISOString(),
    providerDisclosure: "Deterministic fixture synthesis is active for tests.",
  };
}

async function synthesizeWithWindowsSpeech(
  request: NormalizedVoiceSynthesisRequest,
  parentSignal: AbortSignal,
): Promise<DesktopVoiceSynthesisResult> {
  if (process.platform !== "win32") {
    throw ttsFailure("runtime_unavailable", "Windows Speech API is unavailable on this platform.", false);
  }
  const dir = await mkdtemp(join(tmpdir(), "opendrsai-tts-"));
  const scriptPath = join(dir, "speak.ps1");
  const wavPath = join(dir, "speech.wav");
  const payloadPath = join(dir, "text.txt");
  try {
    await writeFile(payloadPath, request.text, "utf8");
    const rate = Math.max(-10, Math.min(10, Math.round((request.speed - 1) * 10)));
    const preferredVoice = request.voice?.trim() ?? "";
    const language = (request.language || "zh-CN").replace(/'/g, "''");
    const voiceBlock = preferredVoice
      ? `
  $preferred = '${preferredVoice.replace(/'/g, "''")}'
  try { $synth.SelectVoice($preferred) } catch {
    $match = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq $preferred } | Select-Object -First 1
    if (-not $match) {
      $match = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ('${language}'.Split('-')[0] + '*') } | Select-Object -First 1
    }
    if ($match) { $synth.SelectVoice($match.VoiceInfo.Name) }
  }`
      : `
  $match = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ('${language}'.Split('-')[0] + '*') } | Select-Object -First 1
  if ($match) { $synth.SelectVoice($match.VoiceInfo.Name) }`;
    // Render to WAV so the renderer can play/pause/stop. Chromium speechSynthesis is unreliable in Electron.
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.Rate = ${rate}
${voiceBlock}
  $text = [System.IO.File]::ReadAllText(${JSON.stringify(payloadPath)}, [System.Text.Encoding]::UTF8)
  $synth.SetOutputToWaveFile(${JSON.stringify(wavPath)})
  $synth.Speak($text)
  $synth.SetOutputToNull()
} finally {
  $synth.Dispose()
}
`;
    await writeFile(scriptPath, script, "utf8");
    await runPowerShell(scriptPath, parentSignal);
    const audioData = new Uint8Array(await readFile(wavPath));
    if (audioData.byteLength < 44) {
      throw ttsFailure("provider_error", "Windows speech synthesis produced empty audio.", true);
    }
    return {
      audioData,
      mimeType: "audio/wav",
      runtimeId: "system",
      createdAt: new Date().toISOString(),
      providerDisclosure: "Reply text was synthesized locally with Windows Speech API.",
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runPowerShell(scriptPath: string, parentSignal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true },
    );
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(ttsFailure("timeout", "Windows speech synthesis timed out.", true));
    }, TTS_TIMEOUT_MS);
    const onAbort = (): void => {
      child.kill();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    parentSignal.addEventListener("abort", onAbort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onAbort);
      reject(ttsFailure("internal_error", error.message, true));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onAbort);
      if (parentSignal.aborted) {
        reject(new DOMException("Cancelled", "AbortError"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(ttsFailure(
        "provider_error",
        stderr.trim() || `Windows speech synthesis failed (exit ${code ?? "unknown"}).`,
        true,
      ));
    });
  });
}

async function synthesizeThroughGateway(
  request: NormalizedVoiceSynthesisRequest,
  parentSignal: AbortSignal,
): Promise<DesktopVoiceSynthesisResult> {
  await startGateway();
  const gateway = await getGatewayStatus();
  if (!gateway.ready) throw ttsFailure("runtime_unavailable", "The local voice gateway is unavailable.", true);
  await syncSavedApiKeyToGateway();
  const timeout = AbortSignal.timeout(TTS_TIMEOUT_MS);
  const signal = AbortSignal.any([parentSignal, timeout]);
  let response: Response;
  try {
    response = await fetch(`${gateway.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { ...getGatewayRequestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (timeout.aborted && !parentSignal.aborted) throw ttsFailure("timeout", "Voice synthesis timed out.", true);
    throw ttsFailure("network_error", error instanceof Error ? error.message : "Voice synthesis provider is unreachable.", true);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2_000) || `Voice synthesis failed with HTTP ${response.status}.`;
    if (response.status === 401 || response.status === 403) throw ttsFailure("auth_required", detail, false);
    if (response.status === 429) throw ttsFailure("rate_limited", detail, true);
    throw ttsFailure(response.status >= 500 ? "network_error" : "provider_error", detail, response.status >= 500);
  }
  const audioData = await readBoundedVoiceAudio(response);
  const mimeType = normalizeAndValidateTtsAudio(audioData, response.headers.get("content-type"), request.format);
  return {
    audioData,
    mimeType,
    runtimeId: "gateway-provider",
    createdAt: new Date().toISOString(),
    providerDisclosure: "Reply text was sent through the local OpenDrSai gateway to the configured speech synthesis provider.",
  };
}

function emitTtsEvent(task: ActiveTtsTask, event: DesktopVoiceSynthesisEvent): void {
  if (!task.sender.isDestroyed()) task.sender.send("desktop:voice-synthesis-event", event);
}

function finishTtsTask(taskRequestId: string, task: ActiveTtsTask, event: DesktopVoiceSynthesisEvent): void {
  if (task.terminal) return;
  task.terminal = true;
  task.cleanupSenderListener();
  emitTtsEvent(task, event);
  activeTtsTasks.delete(taskRequestId);
  void task.diagnostic.then((diagnostic) => {
    if (event.type === "completed") return diagnostic.complete("Voice synthesis completed", { runtime: event.result.runtimeId, audioBytes: event.result.audioData.byteLength });
    if (event.type === "cancelled") return diagnostic.cancel("Voice synthesis cancelled");
    if (event.type === "failed") return diagnostic.fail(new Error("Voice synthesis failed"), event.error.code);
    return undefined;
  }).catch(() => undefined);
}

function ttsFailure(code: DesktopVoiceError["code"], message: string, retryable: boolean): DesktopVoiceError {
  return { code, message, retryable };
}

function normalizeTtsError(error: unknown, requestId: string): DesktopVoiceError {
  if (error && typeof error === "object" && "code" in error && "retryable" in error) {
    return { ...(error as DesktopVoiceError), requestId };
  }
  return { code: "internal_error", message: error instanceof Error ? error.message : "Voice synthesis failed.", retryable: true, requestId };
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    }, { once: true });
  });
}

function createSilentWav(): Uint8Array {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 38, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 2, true);
  return bytes;
}
