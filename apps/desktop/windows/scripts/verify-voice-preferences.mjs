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
  interactionMode: "streaming",
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
  interactionMode: "streaming",
  playbackRate: 2,
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
assert.equal(loadVoicePreferences().interactionMode, "streaming");
assert.equal(loadVoicePreferences().confirmBeforeSend, false);
values.set(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 999, preferences: { autoReadResponses: true } }));
assert.deepEqual(loadVoicePreferences(), defaultVoicePreferences);

console.log("Voice preferences verification passed (18 checks, including confirmation-default migration and removed-voice fallback).");
