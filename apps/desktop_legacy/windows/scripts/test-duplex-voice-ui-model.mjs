import assert from "node:assert/strict";
import { deriveDuplexHudState, duplexFailureTraceId, duplexHudLabel, duplexStartupLabel, getDuplexErrorRecovery, getDuplexShortcutAction, realtimeDisclosureFingerprint } from "../../shared/renderer/src/voice/duplex/duplexUiModel.ts";

const base = { phase: "active", turnPhase: "listening", microphonePaused: false, speechCandidate: false, playbackStarted: false };
assert.equal(deriveDuplexHudState({ ...base, phase: "starting" }), "connecting");
assert.equal(deriveDuplexHudState(base), "listening");
assert.equal(deriveDuplexHudState({ ...base, speechCandidate: true }), "speaking");
assert.equal(deriveDuplexHudState({ ...base, turnPhase: "responding", playbackStarted: true }), "answering");
assert.equal(deriveDuplexHudState({ ...base, turnPhase: "interrupting" }), "speaking");
assert.equal(deriveDuplexHudState({ ...base, phase: "recovering" }), "recovering");
assert.equal(deriveDuplexHudState({ ...base, microphonePaused: true }), "paused");
assert.equal(duplexHudLabel("listening", true), "正在听"); assert.equal(duplexHudLabel("answering", false), "OpenDrSai is answering");
assert.equal(duplexStartupLabel("preparing_microphone", true), "正在准备麦克风"); assert.equal(duplexStartupLabel("connecting_provider", false), "Connecting to the Realtime model"); assert.equal(duplexStartupLabel(null, true), null);
for (const code of ["auth", "model", "protocol", "network", "device", "audio", "rate_limit", "policy", "cancelled", "internal"]) assert.ok(getDuplexErrorRecovery(code).primary);
for (const code of ["permission_denied", "device_missing", "unsupported", "timeout", "invalid_invocation", "resource_exhausted", "unknown"]) {
  const recovery = getDuplexErrorRecovery(code);
  assert.ok(recovery.primary);
  if (code !== "cancelled") assert.equal(recovery.fallback, "switch_to_serial");
}
for (const code of ["readiness_unavailable", "stage_failed", "stage_timeout", "provider_unavailable", "activation_failed"]) {
  const recovery = getDuplexErrorRecovery(code);
  assert.equal(recovery.primary, "retry"); assert.equal(recovery.fallback, "switch_to_serial");
}
assert.equal(getDuplexErrorRecovery("auth").primary, "open_agent_settings"); assert.equal(getDuplexErrorRecovery("network").primary, "retry");
assert.equal(duplexFailureTraceId({ domain: "local_media", stage: "audio_worklet", code: "invalid_invocation", retryable: true, userMessageKey: "fixture", traceId: "trace-local", message: "fixture" }), "trace-local");
assert.equal(realtimeDisclosureFingerprint("provider", "model"), "realtime-disclosure-v1:provider:model"); assert.equal(realtimeDisclosureFingerprint(null, "model"), "");
const shortcut = (key, phase = "active", overrides = {}) => getDuplexShortcutAction({ key, phase, altKey: true, shiftKey: true, enabled: true, ...overrides });
assert.deepEqual([shortcut("v", "idle"), shortcut("p"), shortcut("s"), shortcut("i")], ["toggle_start", "toggle_pause", "stop", null]);
assert.equal(deriveDuplexHudState({ ...base, phase: "stopping" }), "ending");
assert.equal(deriveDuplexHudState({ ...base, phase: "failed" }), "needs_attention");
assert.equal(shortcut("p", "idle"), null); assert.equal(shortcut("v", "idle", { ctrlKey: true }), null); assert.equal(shortcut("v", "idle", { enabled: false }), null);
console.log("Duplex Voice UI model verified (localized HUD states, complete recovery mapping, and versioned disclosure memory).");
