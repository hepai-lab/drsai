import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [workspace, settings, hook, capture, lifecycle, context] = await Promise.all([
  read("shared/renderer/src/components/ChatWorkspace.tsx"),
  read("shared/renderer/src/App.tsx"),
  read("shared/renderer/src/voice/duplex/useDuplexVoiceInput.ts"),
  read("shared/renderer/src/voice/duplex/captureController.ts"),
  read("shared/renderer/src/voice/duplex/lifecyclePolicy.ts"),
  read("shared/renderer/src/voice/duplex/sessionContext.ts"),
]);

assert.match(workspace, /if \(voicePreferences\.interactionMode === "duplex"\)[\s\S]*duplexVoiceInput\.start\(\)/);
assert.match(workspace, /onClick=\{\(\) => \{[\s\S]*toggleVoiceRecording/);
assert.match(workspace, /data-testid="duplex-voice-status"/);
assert.match(workspace, /className="duplex-hud-main"/);
assert.match(workspace, /className="duplex-hud-details"/);
assert.match(workspace, /className="duplex-hud-details-panel"/);
assert.match(workspace, /!duplexVoiceCapabilities\?\.supportsServerVad/);
const hud = workspace.slice(workspace.indexOf('data-testid="duplex-voice-status"'), workspace.indexOf(") : showVoiceCaptureBar"));
assert.equal((hud.match(/className="duplex-hud-actions"/g) ?? []).length, 1);
assert.equal((hud.match(/aria-keyshortcuts="Alt\+Shift\+[PS]"/g) ?? []).length, 2, "primary HUD must expose only pause/resume and end shortcuts");
assert.ok(hud.indexOf("duplexVoiceInput.cancel()") > hud.indexOf('className="duplex-hud-details-panel"'), "advanced cancel must remain inside details");
assert.match(workspace, /realtimeDisclosureFingerprint/);
assert.match(workspace, /aria-keyshortcuts="Alt\+Shift\+P"/);
assert.doesNotMatch(workspace, /aria-keyshortcuts="Alt\+Shift\+I"/);
assert.match(workspace, /aria-keyshortcuts="Alt\+Shift\+S"/);
assert.match(workspace, /duplexStartButtonRef\.current\?\.focus/);
assert.match(workspace, /data-testid="duplex-runtime-recovery"/);
assert.match(workspace, /data-testid="duplex-voice-occupancy"/);
assert.doesNotMatch(workspace, /data-testid="duplex-voice-preflight"/);
assert.doesNotMatch(workspace, /data-testid="duplex-voice-recovery"/);
assert.match(workspace, /data-testid="composer-voice-mode-trigger"/);
assert.match(workspace, /data-testid="composer-voice-mode-menu"/);
assert.match(workspace, /voicePreferences\.interactionMode === "duplex" \? <AudioLines size=\{16\} \/> : <Mic size=\{16\} \/>/);
assert.match(workspace, /voiceInteractionAttempted && \(voiceError/);
assert.match(workspace, /Open voice settings/);
assert.match(workspace, /duplexVoiceInput\.takeOver\(\)/);
assert.match(workspace, /onOpenAgentSettings/);
assert.match(workspace, /duplexVoiceInput\.cancel\(\)/);
assert.match(hook, /runDuplexStartupTransaction/);
assert.match(hook, /reduceDuplexSession/);
assert.match(hook, /claim_history_flush/);
assert.match(hook, /claim_cleanup/);
assert.doesNotMatch(hook, /terminalizingSessionRef|phaseRef/);
assert.match(hook, /prepareFromUserGesture\(\)/);
assert.match(hook, /startProvider:[\s\S]{0,300}startDuplexVoiceSession/);
assert.match(hook, /switchInputDevice/);
assert.match(hook, /submitDuplexVoiceTextInput/);
assert.match(hook, /autoRecovery: optionsRef\.current\.autoRecovery !== false/);
assert.match(hook, /session_update_ack/);
assert.match(hook, /DuplexTemporaryDiagnostics/);
assert.match(hook, /buildDuplexSloSnapshot/);
assert.doesNotMatch(hook, /queueManualText|queuedManualText/);
assert.match(workspace, /submitDuplexText/);
assert.doesNotMatch(workspace, /Text sending is paused during a Realtime voice session/);
assert.match(workspace, /jitterBufferTargetMs/);
assert.match(workspace, /networkQuality/);
assert.doesNotMatch(workspace, /Realtime voice microphone/);
assert.doesNotMatch(workspace, /Realtime voice output device/);
assert.doesNotMatch(workspace, /Realtime voice volume/);
assert.match(hook, /\.duck\(0\.25, 100\)/);
assert.match(hook, /restoreVolume\(100\)/);
assert.match(workspace, /duplexVoiceInput\.connectionNotice/);
assert.match(workspace, /duplexVoiceInput\.finishTurn\(\)/);
assert.match(workspace, /duplexVoiceInput\.pauseMicrophone\(\)/);
assert.match(workspace, /duplexVoiceInput\.resumeMicrophone\(\)/);
assert.match(workspace, /aria-pressed=\{duplexVoiceInput\.microphonePaused\}/);
assert.match(hook, /window\.addEventListener\("offline"/);
assert.match(hook, /window\.addEventListener\("pagehide"/);
assert.match(lifecycle, /hidden: "keep_session"/);
assert.match(lifecycle, /window_close: "dispose_session"/);
assert.match(context, /exact heard text is unavailable/);
assert.match(context, /do not repeat hidden or unheard content/);
assert.match(hook, /desktopApi\.getDuplexVoiceReadiness\(\)/);
assert.doesNotMatch(hook, /desktopApi\.getDuplexVoiceCapabilities\(\)/);
assert.match(capture, /mediaDevices\.getUserMedia/);
assert.doesNotMatch(hook, /useEffect\([^)]*=>[\s\S]{0,200}prepareFromUserGesture/);
assert.doesNotMatch(workspace, /useEffect\([^)]*=>[\s\S]{0,200}duplexVoiceInput\.start/);
assert.match(settings, /className=\{`voice-mode-card\$\{voicePreferences\.interactionMode === "serial"/);
assert.match(settings, /zh \? "单次语音输入" : "Single voice input"/);
assert.match(settings, /zh \? "全双工实时对话" : "Full-duplex Realtime"/);
assert.doesNotMatch(settings, /<option value="streaming"/);
assert.match(settings, /data-testid="voice-duplex-readiness"/);
assert.match(settings, /realtimeEnabled: true, interactionMode: "duplex"/);
assert.match(settings, /voicePreferences\.interactionMode === "duplex" \? <section className="settings-section voice-settings-compact" data-testid="realtime-voice-settings"/);
assert.match(settings, /open_agent_settings/);
assert.match(settings, /switch_to_serial/);
assert.match(settings, /data-testid="realtime-voice-settings"/);
assert.match(settings, /data-testid="realtime-voice-name"/);
assert.match(settings, /data-testid="realtime-voice-language"/);
assert.match(settings, /data-testid="realtime-input-device"/);
assert.match(settings, /data-testid="realtime-output-device"/);
assert.match(settings, /data-testid="realtime-auto-recovery"/);
assert.match(settings, /data-testid="realtime-transcript-policy"/);

console.log("Duplex Voice UI verified (Settings-owned configuration, attempt-gated errors, explicit start, status, cancellation, and no automatic microphone start).")
