import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requirements = [
  {
    name: "Playwright voice visual and serial-turn E2E",
    path: join(root, "out", "verification", "voice-visual", "report.json"),
    validate: (report) => {
      const serialTurn = report.results?.find((item) => item.name === "serial-turn");
      const requiredPhases = [
        "requesting_permission", "recording", "preparing_audio", "transcribing", "ready_to_send",
        "submitting", "awaiting_response", "response_ready", "completed",
      ];
      return report.ok === true
        && requiredPhases.every((phase) => serialTurn?.turnPhases?.includes(phase))
        && report.results?.some((item) => item.name === "error-150")
        && report.results?.some((item) => item.name === "error-200");
    },
  },
  {
    name: "Packaged Main/Preload voice IPC smoke",
    path: join(root, "release", "voice-packaged-evidence", "report.json"),
    validate: (report) => report.ok === true
      && report.liveMode === false
      && report.noNewVoiceTempFiles === true
      && report.noVoiceContentInLogs === true
      && report.checks?.maxBoundaryCompleted === true
      && report.checks?.maxBoundaryDiagnostic === true
      && report.checks?.noInvalidTransitions === true
      && report.checks?.streamingCapabilitiesReady === true
      && report.checks?.streamingCompleted === true
      && report.checks?.streamingCancelled === true
      && report.details?.maxBoundaryBytes === 10 * 1024 * 1024,
  },
  {
    name: "Live serial voice round (capture, ASR, LLM, TTS, playback)",
    path: join(root, "release", "voice-provider-live-evidence", "report.json"),
    validate: (report) => {
      const requiredChecks = [
        "sttCompleted", "ttsCompleted", "fullRoundLoginBootstrap", "fullRoundCaptureStarted",
        "fullRoundTranscribed", "fullRoundAutoSubmitted", "fullRoundLlmReplied",
        "fullRoundProviderTts", "fullRoundPlayback", "fullRoundCompleted", "fullRoundPhases",
        "fullRoundDiagnosticsPrivate",
      ];
      const requiredPhases = [
        "requesting_permission", "recording", "preparing_audio", "transcribing", "ready_to_send",
        "submitting", "awaiting_response", "response_ready", "synthesizing",
        "playing", "completed",
      ];
      return report.ok === true
        && report.liveMode === true
        && report.noNewVoiceTempFiles === true
        && report.noVoiceContentInLogs === true
        && requiredChecks.every((check) => report.checks?.[check] === true)
        && requiredPhases.every((phase) => report.details?.fullRound?.phases?.includes(phase))
        && report.details?.runtimeIds?.stt === "gateway-provider"
        && report.details?.runtimeIds?.tts === "gateway-provider";
    },
  },
  {
    name: "Windows physical audio-device matrix",
    path: join(root, "release", "voice-windows-hardware-evidence", "report.json"),
    validate: (report) => report.ok === true && [
      "windows10", "windows11", "builtinMicrophone", "usbMicrophone", "bluetoothMicrophone",
      "builtinOutput", "usbOutput", "bluetoothOutput", "permissionDenied", "sleepResume",
      "deviceUnplug", "networkLoss", "systemSpeech", "twentyTurnStability", "memoryStable",
      "handleStable", "tempFilesClean", "privacyLogsClean",
    ].every((check) => report.checks?.[check] === true),
  },
];

const failed = [];
for (const requirement of requirements) {
  if (!existsSync(requirement.path)) {
    failed.push(`${requirement.name}: missing ${requirement.path}`);
    continue;
  }
  try {
    const report = JSON.parse(readFileSync(requirement.path, "utf8"));
    if (!requirement.validate(report)) failed.push(`${requirement.name}: report is incomplete or failed`);
  } catch (error) {
    failed.push(`${requirement.name}: invalid report (${error instanceof Error ? error.message : String(error)})`);
  }
}

if (failed.length) {
  throw new Error(`Voice release readiness failed:\n- ${failed.join("\n- ")}`);
}

console.log("Voice release readiness passed (automated, packaged, live-provider, and Windows hardware evidence).")
