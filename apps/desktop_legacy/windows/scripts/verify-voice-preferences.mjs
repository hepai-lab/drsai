import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  },
};

const {
  VOICE_PREFERENCES_STORAGE_KEY,
  LEGACY_STREAMING_VOICE_MIGRATION_KEY,
  VOICE_PREFERENCES_SCHEMA_VERSION,
  defaultVoicePreferences,
  loadVoicePreferencesDocument,
  normalizeVoicePreferences,
  loadVoicePreferences,
  resolveAvailableVoiceName,
  resolveVoiceSynthesisMode,
} = await import("../../shared/renderer/src/voice/useVoicePreferences.ts");

assert.deepEqual(loadVoicePreferences(), defaultVoicePreferences);
assert.equal(VOICE_PREFERENCES_SCHEMA_VERSION, 11);
assert.deepEqual(loadVoicePreferencesDocument(), {
  schemaVersion: 11,
  revision: 0,
  realtimeOptIn: false,
  selectedMode: "serial",
  serial: { inputDeviceId: "", language: "auto", confirmBeforeSend: true },
  duplex: { inputDeviceId: "", outputDeviceId: "", language: "auto", voice: "", volume: 1, autoRecovery: true, transcriptPolicy: "stable", disclosureFingerprint: "" },
  playback: { autoReadResponses: false, playbackRate: 1, remoteSttConsent: false, remoteTtsConsent: false, synthesisMode: "system", voiceName: "" },
});
values.set(VOICE_PREFERENCES_STORAGE_KEY, "not-json");
assert.deepEqual(loadVoicePreferences(), defaultVoicePreferences);

const hookSource = await readFile(new URL("../../shared/renderer/src/voice/useVoicePreferences.ts", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../shared/renderer/src/App.tsx", import.meta.url), "utf8");
const workspaceSource = await readFile(new URL("../../shared/renderer/src/components/ChatWorkspace.tsx", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../../shared/main/preload.ts", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
assert.match(hookSource, /expectedRevision: base\.revision/);
assert.match(hookSource, /candidate\.revision > current\.revision/);
assert.match(preloadSource, /desktop:voice-preferences-changed/);
assert.match(mainSource, /BrowserWindow\.getAllWindows\(\)/);
for (const source of [appSource, workspaceSource]) {
  const confirmation = source.indexOf("Switching to single voice input will end the active Realtime conversation");
  const persistence = source.indexOf('updateVoicePreferences({ interactionMode: "serial" })', confirmation);
  assert.ok(confirmation >= 0 && persistence > confirmation, "active duplex switching must confirm before persistence");
}
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  autoReadResponses: true,
  confirmBeforeSend: true,
  inputDeviceId: "usb-mic",
  inputLanguage: "en-US",
  interactionMode: "serial",
  playbackRate: 9,
  remoteSttConsent: true,
  remoteTtsConsent: true,
  synthesisMode: "provider",
  voiceName: "Test Voice",
}));
assert.deepEqual(loadVoicePreferences(), {
  revision: 0,
  autoReadResponses: true,
  confirmBeforeSend: true,
  inputDeviceId: "usb-mic",
  inputLanguage: "en-US",
  interactionMode: "serial",
  playbackRate: 2,
  realtimeOutputDeviceId: "",
  realtimeVolume: 1,
  realtimeDisclosureFingerprint: "",
  realtimeEnabled: false,
  realtimeAutoRecovery: true,
  realtimeInputDeviceId: "",
  realtimeLanguage: "auto",
  realtimeTranscriptPolicy: "stable",
  realtimeVoiceName: "",
  remoteSttConsent: true,
  remoteTtsConsent: true,
  synthesisMode: "provider",
  voiceName: "Test Voice",
});
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({ inputLanguage: "invalid", playbackRate: 0.1 }));
assert.equal(loadVoicePreferences().inputLanguage, "auto");
assert.equal(loadVoicePreferences().interactionMode, "serial");
assert.equal(loadVoicePreferences().confirmBeforeSend, true);
assert.equal(loadVoicePreferences().playbackRate, 0.5);
assert.equal(loadVoicePreferences().remoteSttConsent, false);
assert.equal(loadVoicePreferences().remoteTtsConsent, false);
assert.equal(loadVoicePreferences().realtimeOutputDeviceId, "");
assert.equal(loadVoicePreferences().realtimeVolume, 1);
assert.equal(loadVoicePreferences().realtimeDisclosureFingerprint, "");
assert.equal(loadVoicePreferences().realtimeEnabled, false);
assert.equal(loadVoicePreferences().realtimeAutoRecovery, true);
assert.equal(loadVoicePreferences().realtimeInputDeviceId, "");
assert.equal(loadVoicePreferences().realtimeLanguage, "auto");
assert.equal(loadVoicePreferences().realtimeTranscriptPolicy, "stable");
assert.equal(loadVoicePreferences().realtimeVoiceName, "");
assert.equal(resolveVoiceSynthesisMode("provider", false), "system");
assert.equal(resolveVoiceSynthesisMode("provider", true), "provider");
assert.equal(resolveVoiceSynthesisMode("system", true), "system");
assert.equal(resolveAvailableVoiceName("Installed", ["Installed", "Other"]), "Installed");
assert.equal(resolveAvailableVoiceName("Removed", ["Installed"]), "");

values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: 2,
  preferences: { autoReadResponses: true, inputLanguage: "zh-CN", playbackRate: 1.25 },
}));
assert.equal(loadVoicePreferences().autoReadResponses, true);
assert.equal(loadVoicePreferences().inputLanguage, "zh-CN");
assert.equal(loadVoicePreferences().playbackRate, 1.25);
assert.equal(loadVoicePreferences().interactionMode, "serial");
assert.equal(loadVoicePreferences().confirmBeforeSend, true);
for (let version = 1; version <= 10; version += 1) {
  values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version, preferences: { interactionMode: version % 2 ? "streaming" : "serial" } }));
  const migrated = loadVoicePreferencesDocument();
  assert.equal(migrated.schemaVersion, 11, `v${version} migrates to v11`);
  assert.equal(migrated.selectedMode, "serial", `v${version} produces a legal product mode`);
}
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: 4,
  preferences: { confirmBeforeSend: false },
}));
assert.equal(loadVoicePreferences().confirmBeforeSend, true);
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: 10,
  preferences: { confirmBeforeSend: false, interactionMode: "streaming" },
}));
assert.equal(loadVoicePreferences().interactionMode, "serial");
assert.equal(loadVoicePreferences().confirmBeforeSend, false);
assert.ok(values.get(LEGACY_STREAMING_VOICE_MIGRATION_KEY), "legacy streaming migration must be recorded once in local preferences");
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: 10,
  preferences: { interactionMode: "duplex", realtimeOutputDeviceId: "usb-speaker", realtimeVolume: 4, realtimeDisclosureFingerprint: "realtime-disclosure-v1:p:m", realtimeAutoRecovery: false, realtimeInputDeviceId: "realtime-mic", realtimeLanguage: "en-US", realtimeTranscriptPolicy: "none", realtimeVoiceName: "alloy" },
}));
assert.equal(loadVoicePreferences().interactionMode, "duplex");
assert.equal(loadVoicePreferences().realtimeEnabled, true);
assert.equal(loadVoicePreferences().realtimeOutputDeviceId, "usb-speaker"); assert.equal(loadVoicePreferences().realtimeVolume, 1);
assert.equal(loadVoicePreferences().realtimeDisclosureFingerprint, "realtime-disclosure-v1:p:m");
assert.equal(loadVoicePreferences().realtimeAutoRecovery, false);
assert.equal(loadVoicePreferences().realtimeInputDeviceId, "realtime-mic");
assert.equal(loadVoicePreferences().realtimeLanguage, "en-US");
assert.equal(loadVoicePreferences().realtimeTranscriptPolicy, "none");
assert.equal(loadVoicePreferences().realtimeVoiceName, "alloy");
const migratedDocument = JSON.parse(values.get(VOICE_PREFERENCES_STORAGE_KEY));
assert.equal(migratedDocument.schemaVersion, 11);
assert.equal(migratedDocument.selectedMode, "duplex");
assert.equal(migratedDocument.realtimeOptIn, true);
assert.equal(migratedDocument.serial.confirmBeforeSend, true);
assert.equal(migratedDocument.duplex.outputDeviceId, "usb-speaker");
assert.equal(migratedDocument.duplex.voice, "alloy");
assert.equal(migratedDocument.playback.playbackRate, 1);

const normalized = normalizeVoicePreferences({
  schemaVersion: 11, revision: 7, realtimeOptIn: false, selectedMode: "duplex",
  serial: { confirmBeforeSend: false, language: "bad" }, duplex: { volume: -4 }, playback: { playbackRate: 8 },
});
assert.equal(normalized.revision, 7);
assert.equal(normalized.selectedMode, "serial", "duplex cannot remain selected without explicit opt-in");
assert.equal(normalized.serial.language, "auto");
assert.equal(normalized.duplex.volume, 0);
assert.equal(normalized.playback.playbackRate, 2);
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 999, preferences: { autoReadResponses: true } }));
assert.deepEqual(loadVoicePreferences(), defaultVoicePreferences);

console.log("Voice preferences verification passed (including legacy streaming-to-serial migration, duplex persistence, confirmation-default migration, and removed-voice fallback).");
