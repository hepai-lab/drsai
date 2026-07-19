import assert from "node:assert/strict";
import { VoicePlaybackController } from "../src/renderer/src/voice/voicePlaybackController.ts";
import { VoiceTranscriptionController } from "../src/renderer/src/voice/voiceTranscriptionController.ts";

const ITERATIONS = 1_000;

for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
  const listeners = new Set();
  let cancellationCount = 0;
  const requestId = `stt-race-${iteration}`;
  const controller = new VoiceTranscriptionController({
    cancel: async () => { cancellationCount += 1; return true; },
    start: async () => {
      for (const listener of [...listeners]) listener({ requestId, type: "accepted", runtimeId: "mock-local" });
      for (const listener of [...listeners]) listener({ requestId, type: "completed", result: {
        ok: true,
        transcript: "fixture",
        durationSeconds: 0.25,
        runtimeId: "mock-local",
        sourceId: requestId,
        createdAt: new Date(0).toISOString(),
        truncated: false,
        providerDisclosure: "fixture",
        message: "done",
      } });
      return { requestId, acceptedAt: new Date(0).toISOString() };
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  }, () => {});
  const result = await controller.transcribe({
    audioData: new Uint8Array([1]),
    durationSeconds: 0.25,
    mimeType: "audio/webm",
  });
  assert.equal(result.transcript, "fixture");
  assert.equal(cancellationCount, 0);
  assert.equal(listeners.size, 0);
  controller.dispose();
}

for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
  const listeners = new Set();
  const urls = new Set();
  let cancellationCount = 0;
  let audio = null;
  const requestId = `tts-race-${iteration}`;
  const controller = new VoicePlaybackController({
    createAudio: () => {
      audio = {
        load() {},
        onended: null,
        onerror: null,
        pause() {},
        play: async () => {},
        playbackRate: 1,
        removeAttribute() {},
      };
      return audio;
    },
    createObjectUrl: () => { const url = `blob:tts-${iteration}`; urls.add(url); return url; },
    createUtterance: () => { throw new Error("system speech must not run"); },
    provider: {
      cancel: async () => { cancellationCount += 1; return true; },
      getStatus: async () => ({
        runtimeId: "mock-local",
        state: "ready",
        supportsSynthesisTask: true,
        supportedFormats: ["wav"],
        maxTextChars: 12_000,
        providerDisclosure: "fixture",
        message: "ready",
      }),
      start: async () => {
        for (const listener of [...listeners]) listener({ requestId, type: "accepted", runtimeId: "mock-local" });
        for (const listener of [...listeners]) listener({ requestId, type: "completed", result: {
          audioData: new Uint8Array([82, 73, 70, 70]),
          mimeType: "audio/wav",
          runtimeId: "mock-local",
          createdAt: new Date(0).toISOString(),
          providerDisclosure: "fixture",
        } });
        return { requestId, acceptedAt: new Date(0).toISOString() };
      },
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    },
    revokeObjectUrl: (url) => { assert.equal(urls.delete(url), true); },
    selectVoice: () => null,
  }, () => {});
  controller.play({ language: "en", messageId: requestId, mode: "provider", rate: 1, text: "Fixture", voiceName: "" });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(audio);
  audio.onended?.();
  controller.stop();
  assert.equal(cancellationCount, 0);
  assert.equal(listeners.size, 0);
  assert.equal(urls.size, 0);
  controller.dispose();
}

console.log(`Voice terminal race tests passed (${ITERATIONS} STT and ${ITERATIONS} TTS synchronous completions).`);
