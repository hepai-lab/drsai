import assert from "node:assert/strict";
import { VoicePlaybackController } from "../../shared/renderer/src/voice/voicePlaybackController.ts";

function voice(name, lang, localService = true, isDefault = false) {
  return { name, lang, localService, default: isDefault };
}

function createHarness({ audioPlayError = null, mediaError = null, providerStatus = "ready", withProvider = true, withSystem = true } = {}) {
  const snapshots = [];
  const utterances = [];
  const audios = [];
  const revoked = [];
  const cancelledRequests = [];
  const providerListeners = new Set();
  let nextRequest = 0;
  const system = {
    cancelCount: 0,
    pauseCount: 0,
    resumeCount: 0,
    speakCount: 0,
    cancel() { this.cancelCount += 1; },
    getVoices: () => [voice("Chinese", "zh-CN"), voice("English", "en-US", true, true)],
    pause() { this.pauseCount += 1; },
    resume() { this.resumeCount += 1; },
    speak() { this.speakCount += 1; },
  };
  const provider = {
    cancel: async (requestId) => { cancelledRequests.push(requestId); return true; },
    getStatus: async () => ({
      runtimeId: "mock-local",
      state: providerStatus,
      supportsSynthesisTask: providerStatus === "ready",
      supportedFormats: ["wav"],
      maxTextChars: 12_000,
      providerDisclosure: "fixture",
      message: "fixture",
    }),
    start: async () => ({ requestId: `tts-${++nextRequest}`, acceptedAt: new Date(0).toISOString() }),
    subscribe: (callback) => { providerListeners.add(callback); return () => providerListeners.delete(callback); },
  };
  const controller = new VoicePlaybackController({
    createAudio: (url) => {
      const audio = {
        error: mediaError,
        loadCount: 0,
        onended: null,
        onerror: null,
        pauseCount: 0,
        playCount: 0,
        playbackRate: 1,
        removed: [],
        load() { this.loadCount += 1; },
        pause() { this.pauseCount += 1; },
        async play() { this.playCount += 1; if (audioPlayError) throw audioPlayError; },
        removeAttribute(name) { this.removed.push(name); },
        url,
      };
      audios.push(audio);
      return audio;
    },
    createObjectUrl: () => `blob:voice-${audios.length + 1}`,
    createUtterance: (text) => {
      const utterance = { text, lang: "", rate: 1, voice: null, onstart: null, onend: null, onerror: null };
      utterances.push(utterance);
      return utterance;
    },
    provider: withProvider ? provider : undefined,
    revokeObjectUrl: (url) => revoked.push(url),
    selectVoice: (voices, language, preferredName) => voices.find((item) => item.name === preferredName)
      ?? voices.find((item) => item.lang.toLowerCase().startsWith(language))
      ?? null,
    system: withSystem ? system : undefined,
  }, (snapshot) => snapshots.push({ ...snapshot }));
  return {
    audios,
    cancelledRequests,
    controller,
    emit(event) { for (const listener of [...providerListeners]) listener(event); },
    providerListeners,
    revoked,
    snapshots,
    system,
    utterances,
  };
}

const systemRequest = {
  language: "en",
  messageId: "message-1",
  mode: "system",
  rate: 3,
  text: "Hello",
  voiceName: "English",
};

{
  const harness = createHarness();
  harness.controller.play(systemRequest);
  assert.equal(harness.utterances.length, 1);
  assert.equal(harness.utterances[0].rate, 2, "rate must be clamped");
  assert.equal(harness.utterances[0].voice.name, "English");
  assert.equal(harness.system.speakCount, 1);
  harness.utterances[0].onstart();
  assert.equal(harness.snapshots.at(-1).phase, "playing");
  assert.equal(harness.controller.pause(), true);
  assert.equal(harness.system.pauseCount, 1);
  assert.equal(harness.controller.resume(), true);
  assert.equal(harness.system.resumeCount, 1);
  harness.utterances[0].onend();
  assert.equal(harness.snapshots.at(-1).phase, "idle");
}

{
  const harness = createHarness();
  harness.controller.play({ ...systemRequest, mode: "provider" });
  await Promise.resolve();
  harness.emit({ requestId: "tts-1", type: "accepted", runtimeId: "mock-local" });
  harness.emit({ requestId: "tts-1", type: "completed", result: {
    audioData: new Uint8Array([82, 73, 70, 70]),
    mimeType: "audio/wav",
    runtimeId: "mock-local",
    createdAt: new Date(0).toISOString(),
    providerDisclosure: "fixture",
  } });
  await Promise.resolve();
  await Promise.resolve();
  harness.audios[0].onended();
  harness.controller.stop();
  assert.deepEqual(harness.cancelledRequests, [], "synchronous completion must not resurrect a finished provider request");
}

{
  const harness = createHarness();
  harness.controller.play(systemRequest);
  const first = harness.utterances[0];
  harness.controller.play({ ...systemRequest, messageId: "message-2" });
  assert.equal(harness.system.cancelCount, 2, "starting a second item must cancel the first owner");
  first.onend();
  assert.equal(harness.snapshots.at(-1).activeMessageId, "message-2", "old completion must not stop the new item");
  harness.controller.stop();
  assert.equal(harness.snapshots.at(-1).phase, "idle");
}

{
  const harness = createHarness({ providerStatus: "unavailable" });
  harness.controller.play({ ...systemRequest, mode: "provider" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.system.speakCount, 0, "provider failure must not silently cross the user's runtime choice");
  assert.equal(harness.snapshots.at(-1).phase, "failed");
  assert.equal(harness.snapshots.at(-1).error, "fixture");
}

{
  const harness = createHarness();
  harness.controller.play({ ...systemRequest, mode: "provider", rate: 1.25 });
  await Promise.resolve();
  await Promise.resolve();
  harness.emit({ requestId: "tts-1", type: "completed", result: {
    audioData: new Uint8Array([82, 73, 70, 70]),
    mimeType: "audio/wav",
    runtimeId: "mock-local",
    createdAt: new Date(0).toISOString(),
    providerDisclosure: "fixture",
  } });
  assert.equal(harness.audios.length, 1);
  assert.equal(harness.audios[0].playbackRate, 1.25);
  assert.equal(harness.audios[0].playCount, 1);
  harness.controller.pause();
  harness.controller.resume();
  assert.equal(harness.audios[0].pauseCount, 1);
  assert.equal(harness.audios[0].playCount, 2);
  harness.audios[0].onended();
  assert.deepEqual(harness.revoked, ["blob:voice-1"]);
  assert.equal(harness.snapshots.at(-1).phase, "idle");
}

{
  const harness = createHarness();
  harness.controller.play({ ...systemRequest, mode: "provider" });
  await Promise.resolve();
  await Promise.resolve();
  harness.controller.stop();
  assert.deepEqual(harness.cancelledRequests, ["tts-1"]);
  harness.emit({ requestId: "tts-1", type: "completed", result: {
    audioData: new Uint8Array([1]), mimeType: "audio/wav", runtimeId: "mock-local",
    createdAt: new Date(0).toISOString(), providerDisclosure: "fixture",
  } });
  assert.equal(harness.audios.length, 0, "completion after cancellation must be ignored");
}

{
  const harness = createHarness();
  harness.controller.play({ ...systemRequest, mode: "provider" });
  await Promise.resolve();
  await Promise.resolve();
  harness.emit({ requestId: "tts-1", type: "failed", error: { code: "provider_error", message: "TTS failed", retryable: true } });
  assert.equal(harness.snapshots.at(-1).phase, "failed");
  assert.equal(harness.snapshots.at(-1).error, "TTS failed");
  assert.equal(harness.providerListeners.size, 0);
}

{
  const harness = createHarness({ withSystem: false, withProvider: false });
  assert.equal(harness.controller.isAvailable, false);
  harness.controller.play(systemRequest);
  assert.equal(harness.snapshots.at(-1).phase, "failed");
}

{
  const harness = createHarness({ audioPlayError: new DOMException("play() requires a user gesture", "NotAllowedError") });
  harness.controller.play({ ...systemRequest, mode: "provider" });
  await Promise.resolve();
  await Promise.resolve();
  harness.emit({ requestId: "tts-1", type: "completed", result: {
    audioData: new Uint8Array([82, 73, 70, 70]), mimeType: "audio/wav", runtimeId: "mock-local",
    createdAt: new Date(0).toISOString(), providerDisclosure: "fixture",
  } });
  await Promise.resolve();
  assert.equal(harness.snapshots.at(-1).phase, "failed");
  assert.match(harness.snapshots.at(-1).error, /NotAllowedError/);
}

{
  const harness = createHarness({ mediaError: { code: 4, message: "DEMUXER_ERROR_COULD_NOT_OPEN" } });
  harness.controller.play({ ...systemRequest, mode: "provider" });
  await Promise.resolve();
  await Promise.resolve();
  harness.emit({ requestId: "tts-1", type: "completed", result: {
    audioData: new Uint8Array([82, 73, 70, 70]), mimeType: "audio/wav", runtimeId: "mock-local",
    createdAt: new Date(0).toISOString(), providerDisclosure: "fixture",
  } });
  harness.audios[0].onerror();
  assert.equal(harness.snapshots.at(-1).phase, "failed");
  assert.match(harness.snapshots.at(-1).error, /media code 4: DEMUXER_ERROR_COULD_NOT_OPEN/);
}

console.log("Voice playback behavior tests passed (10 scenarios).");
