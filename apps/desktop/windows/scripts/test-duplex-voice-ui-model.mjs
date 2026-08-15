import assert from "node:assert/strict";
import { deriveDuplexHudState, duplexHudLabel, getDuplexErrorRecovery, getDuplexShortcutAction, realtimeDisclosureFingerprint } from "../../shared/renderer/src/voice/duplex/duplexUiModel.ts";

const base = { phase: "active", turnPhase: "listening", microphonePaused: false, speechCandidate: false, playbackStarted: false };
assert.equal(deriveDuplexHudState({ ...base, phase: "starting" }), "connecting");
assert.equal(deriveDuplexHudState(base), "listening");
assert.equal(deriveDuplexHudState({ ...base, speechCandidate: true }), "speaking");
assert.equal(deriveDuplexHudState({ ...base, turnPhase: "responding", playbackStarted: true }), "answering");
assert.equal(deriveDuplexHudState({ ...base, turnPhase: "interrupting" }), "interrupting");
assert.equal(deriveDuplexHudState({ ...base, phase: "recovering" }), "recovering");
assert.equal(deriveDuplexHudState({ ...base, microphonePaused: true }), "paused");
assert.equal(duplexHudLabel("listening", true), "正在听"); assert.equal(duplexHudLabel("answering", false), "OpenDrSai is answering");
for (const code of ["auth", "model", "protocol", "network", "device", "audio", "rate_limit", "policy", "cancelled", "internal"]) assert.ok(getDuplexErrorRecovery(code).primary);
assert.equal(getDuplexErrorRecovery("auth").primary, "open_agent_settings"); assert.equal(getDuplexErrorRecovery("network").primary, "retry");
assert.equal(realtimeDisclosureFingerprint("provider", "model"), "realtime-disclosure-v1:provider:model"); assert.equal(realtimeDisclosureFingerprint(null, "model"), "");
const shortcut = (key, phase = "active", overrides = {}) => getDuplexShortcutAction({ key, phase, altKey: true, shiftKey: true, enabled: true, ...overrides });
assert.deepEqual([shortcut("v", "idle"), shortcut("p"), shortcut("s"), shortcut("i")], ["toggle_start", "toggle_pause", "stop", "interrupt"]);
assert.equal(shortcut("p", "idle"), null); assert.equal(shortcut("v", "idle", { ctrlKey: true }), null); assert.equal(shortcut("v", "idle", { enabled: false }), null);
console.log("Duplex Voice UI model verified (localized HUD states, complete recovery mapping, and versioned disclosure memory).");
