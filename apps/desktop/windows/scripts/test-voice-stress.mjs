import assert from "node:assert/strict";
import { VoiceCaptureController } from "../../shared/renderer/src/voice/voiceCaptureController.ts";
import { VoicePlaybackController } from "../../shared/renderer/src/voice/voicePlaybackController.ts";
import { VoiceTranscriptionController } from "../../shared/renderer/src/voice/voiceTranscriptionController.ts";

const CYCLES = 20;
globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;

class FakeTrack {
  stopCount = 0;
  addEventListener() {}
  stop() { this.stopCount += 1; }
}

class FakeStream {
  track = new FakeTrack();
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}

class FakeRecorder {
  mimeType = "audio/webm";
  ondataavailable = null;
  onerror = null;
  onstop = null;
  state = "inactive";
  start() { this.state = "recording"; }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

{
  const streams = [];
  const timers = new Map();
  let timerId = 0;
  let recorded = 0;
  const controller = new VoiceCaptureController({
    clearInterval: (id) => timers.delete(id),
    createRecorder: () => new FakeRecorder(),
    getPreferredMimeType: () => "audio/webm",
    mediaDevices: {
      enumerateDevices: async () => [],
      getUserMedia: async () => {
        const stream = new FakeStream();
        streams.push(stream);
        return stream;
      },
    },
    now: () => Date.now(),
    setInterval: (callback) => {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
  }, {
    beforeStart: async () => {},
    onDevices: () => {},
    onElapsed: () => {},
    onError: (error) => { if (error) throw error; },
    onLevelsReset: () => {},
    onRecorded: () => { recorded += 1; },
    onState: () => {},
    onStreamStarted: () => {},
    onStreamStopped: () => {},
  });
  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    assert.equal(await controller.start(), true);
    controller.stop("transcribe");
  }
  controller.dispose();
  assert.equal(recorded, CYCLES);
  assert.equal(timers.size, 0);
  assert.equal(streams.length, CYCLES);
  assert.ok(streams.every((stream) => stream.track.stopCount === 1));
}

{
  const listeners = new Set();
  let sequence = 0;
  let cancellations = 0;
  const controller = new VoiceTranscriptionController({
    cancel: async () => { cancellations += 1; return true; },
    start: async () => {
      const requestId = `stt-${++sequence}`;
      for (const listener of [...listeners]) listener({ requestId, type: "accepted", runtimeId: "mock-local" });
      for (const listener of [...listeners]) listener({ requestId, type: "completed", result: {
        ok: true,
        transcript: "fixture",
        durationSeconds: 1,
        runtimeId: "mock-local",
        sourceId: requestId,
        createdAt: new Date().toISOString(),
        truncated: false,
        providerDisclosure: "fixture",
        message: "done",
      } });
      return { requestId, acceptedAt: new Date().toISOString() };
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  }, () => {});
  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    const result = await controller.transcribe({ audioData: new Uint8Array([1]), durationSeconds: 1, mimeType: "audio/webm" });
    assert.equal(result.transcript, "fixture");
    assert.equal(listeners.size, 0);
  }
  controller.dispose();
  assert.equal(cancellations, 0);
}

{
  const listeners = new Set();
  const audios = [];
  const urls = new Set();
  let sequence = 0;
  let revoked = 0;
  const controller = new VoicePlaybackController({
    createAudio: (url) => {
      const audio = {
        load() {},
        onended: null,
        onerror: null,
        pause() {},
        play: async () => {},
        playbackRate: 1,
        removeAttribute() {},
        url,
      };
      audios.push(audio);
      return audio;
    },
    createObjectUrl: () => { const url = `blob:voice-${urls.size + 1}`; urls.add(url); return url; },
    createUtterance: () => { throw new Error("system speech should not be used"); },
    provider: {
      cancel: async () => true,
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
        const requestId = `tts-${++sequence}`;
        for (const listener of [...listeners]) listener({ requestId, type: "accepted", runtimeId: "mock-local" });
        for (const listener of [...listeners]) listener({ requestId, type: "completed", result: {
          audioData: new Uint8Array(46),
          mimeType: "audio/wav",
          runtimeId: "mock-local",
          createdAt: new Date().toISOString(),
          providerDisclosure: "fixture",
        } });
        return { requestId, acceptedAt: new Date().toISOString() };
      },
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    },
    revokeObjectUrl: (url) => { assert.equal(urls.delete(url), true); revoked += 1; },
    selectVoice: () => null,
  }, () => {});
  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    controller.play({ language: "en", messageId: `message-${cycle}`, mode: "provider", rate: 1, text: "Fixture reply", voiceName: "" });
    await Promise.resolve();
    await Promise.resolve();
    const audio = audios.at(-1);
    assert.ok(audio, `cycle ${cycle + 1}: provider audio was not created`);
    audio.onended?.();
    assert.equal(listeners.size, 0);
    assert.equal(urls.size, 0);
  }
  controller.dispose();
  assert.equal(audios.length, CYCLES);
  assert.equal(revoked, CYCLES);
  assert.equal(listeners.size, 0);
  assert.equal(urls.size, 0);
}

globalThis.gc?.();
const heapAfter = process.memoryUsage().heapUsed;
const heapGrowthBytes = heapAfter - heapBefore;
assert.ok(heapGrowthBytes < 4 * 1024 * 1024, `voice stress heap grew by ${heapGrowthBytes} bytes`);

console.log(`Voice resource stress tests passed (${CYCLES} capture, STT, and playback cycles; heap delta ${heapGrowthBytes} bytes).`);
