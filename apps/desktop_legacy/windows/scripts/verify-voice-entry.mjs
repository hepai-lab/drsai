import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatWorkspace = await readFile(
  new URL("../../shared/renderer/src/components/ChatWorkspace.tsx", import.meta.url),
  "utf8",
);
const workspaceShell = await readFile(
  new URL("../../shared/renderer/src/components/WorkspaceShell.tsx", import.meta.url),
  "utf8",
);

const voiceButtonStart = chatWorkspace.indexOf("composer-voice-button");
assert.notEqual(voiceButtonStart, -1, "voice button must exist in the composer");

const voiceButtonMarkup = chatWorkspace.slice(voiceButtonStart, voiceButtonStart + 900);
assert.match(
  voiceButtonMarkup,
  /disabled=\{voiceState === "requesting_permission" \|\| voiceState === "processing"(?: \|\| duplexVoiceInput\.phase === "starting" \|\| duplexVoiceInput\.phase === "stopping")?\}/,
  "voice capture must be disabled only during an active serial or Duplex input transition",
);
assert.doesNotMatch(
  voiceButtonMarkup,
  /disabled=\{showStop/,
  "voice capture must remain actionable while a chat request is active",
);
assert.doesNotMatch(
  voiceButtonMarkup,
  /disabled=\{!canChat/,
  "voice capture must remain actionable when chat readiness is stale so runtime errors are visible",
);

for (const shortcutContract of [
  'fallback: "Ctrl+Shift+D"',
  'en: "Hold to record voice"',
  'new CustomEvent("drsai:voice-recording-shortcut"',
  'window.addEventListener("keyup", handleKeyUp)',
  'event.repeat || voiceShortcutHeldRef.current',
]) {
  assert.ok(workspaceShell.includes(shortcutContract), `missing voice shortcut contract: ${shortcutContract}`);
}
for (const localizedEntryContract of [
  'window.addEventListener("drsai:voice-recording-shortcut"',
  '`Click to start, or hold ${voiceRecordingShortcut} to record`',
  '`Release ${voiceRecordingShortcut} to stop recording`',
  'aria-keyshortcuts={shortcutToAriaKeyShortcut(voiceRecordingShortcut)}',
]) {
  assert.ok(chatWorkspace.includes(localizedEntryContract), `missing localized voice entry contract: ${localizedEntryContract}`);
}

const capturePreflightStart = chatWorkspace.indexOf("beforeStart: async () => {");
const capturePreflightEnd = chatWorkspace.indexOf("deviceId: voiceDeviceId", capturePreflightStart);
assert.notEqual(capturePreflightStart, -1, "voice capture preflight must exist");
assert.notEqual(capturePreflightEnd, -1, "voice capture preflight boundary must exist");
const capturePreflight = chatWorkspace.slice(capturePreflightStart, capturePreflightEnd);
assert.doesNotMatch(
  capturePreflight,
  /getVoiceRuntimeStatus|remoteSttConsent/,
  "microphone capture must not wait for provider readiness or upload consent",
);

const recordingProcessorStart = chatWorkspace.indexOf("async function processVoiceRecording");
const recordingProcessorEnd = chatWorkspace.indexOf("function insertTextAtCursor", recordingProcessorStart);
const recordingProcessor = chatWorkspace.slice(recordingProcessorStart, recordingProcessorEnd);
assert.match(
  recordingProcessor,
  /prepareSerialVoiceTranscription\(\)/,
  "provider metadata and upload consent must be checked after recording stops",
);
assert.doesNotMatch(
  recordingProcessor,
  /runtime\.state !== "ready"/,
  "a cold gateway must be started on demand by the Main transcription task instead of blocking the recording in the renderer",
);

for (const diagnosticContract of [
  'operation: "voice.button.click"',
  'operation: "voice.capture"',
  'onCaptureError: (error, message)',
  'stack: voiceDiagnosticStack(error)',
  'onOpenDebug?.(undefined, "app-errors")',
]) {
  assert.ok(chatWorkspace.includes(diagnosticContract), `missing voice capture diagnostic contract: ${diagnosticContract}`);
}

console.log("Voice entry verification passed.");
