import assert from "node:assert/strict";

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
  loadVoicePreferences,
  resolveAvailableVoiceName,
  resolveVoiceSynthesisMode,
} = await import("../../shared/renderer/src/voice/useVoicePreferences.ts");

assert.deepEqual(loadVoicePreferences(), defaultVoicePreferences);
values.set(VOICE_PREFERENCES_STORAGE_KEY, "not-json");
assert.deepEqual(loadVoicePreferences(), defaultVoicePreferences);
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
  autoReadResponses: true,
  confirmBeforeSend: true,
  inputDeviceId: "usb-mic",
  inputLanguage: "en-US",
  interactionMode: "serial",
  playbackRate: 2,
  realtimeOutputDeviceId: "",
  realtimeVolume: 1,
  realtimeDisclosureFingerprint: "",
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
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: 4,
  preferences: { confirmBeforeSend: false },
}));
assert.equal(loadVoicePreferences().confirmBeforeSend, true);
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: VOICE_PREFERENCES_SCHEMA_VERSION,
  preferences: { confirmBeforeSend: false, interactionMode: "streaming" },
}));
assert.equal(loadVoicePreferences().interactionMode, "serial");
assert.equal(loadVoicePreferences().confirmBeforeSend, false);
assert.ok(values.get(LEGACY_STREAMING_VOICE_MIGRATION_KEY), "legacy streaming migration must be recorded once in local preferences");
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
  version: VOICE_PREFERENCES_SCHEMA_VERSION,
  preferences: { interactionMode: "duplex", realtimeOutputDeviceId: "usb-speaker", realtimeVolume: 4, realtimeDisclosureFingerprint: "realtime-disclosure-v1:p:m", realtimeAutoRecovery: false, realtimeInputDeviceId: "realtime-mic", realtimeLanguage: "en-US", realtimeTranscriptPolicy: "none", realtimeVoiceName: "alloy" },
}));
assert.equal(loadVoicePreferences().interactionMode, "duplex");
assert.equal(loadVoicePreferences().realtimeOutputDeviceId, "usb-speaker"); assert.equal(loadVoicePreferences().realtimeVolume, 1);
assert.equal(loadVoicePreferences().realtimeDisclosureFingerprint, "realtime-disclosure-v1:p:m");
assert.equal(loadVoicePreferences().realtimeAutoRecovery, false);
assert.equal(loadVoicePreferences().realtimeInputDeviceId, "realtime-mic");
assert.equal(loadVoicePreferences().realtimeLanguage, "en-US");
assert.equal(loadVoicePreferences().realtimeTranscriptPolicy, "none");
assert.equal(loadVoicePreferences().realtimeVoiceName, "alloy");
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 999, preferences: { autoReadResponses: true } }));
assert.deepEqual(loadVoicePreferences(), defaultVoicePreferences);

console.log("Voice preferences verification passed (including legacy streaming-to-serial migration, duplex persistence, confirmation-default migration, and removed-voice fallback).");
