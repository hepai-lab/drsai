import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundlePath = join(tmpdir(), `opendrsai-streaming-voice-main-${process.pid}-${Date.now()}.mjs`);
process.env.OPENDRSAI_VOICE_RUNTIME = "fixture";
await build({
  entryPoints: [new URL("../../shared/main/voiceStreaming/index.ts", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))],
  outfile: bundlePath,
  bundle: true,
  format: "esm",
  platform: "node",
  sourcemap: false,
});
const {
  attachStreamingVoiceAudioPort,
  cancelStreamingVoiceSessionsForSender,
  cancelStreamingVoiceTranscription,
  getStreamingVoiceCapabilities,
  startStreamingVoiceTranscription,
  stopStreamingVoiceTranscription,
} = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);

class FakeSender extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.events = [];
    this.destroyed = false;
  }
  send(channel, event) { this.events.push({ channel, event }); }
  isDestroyed() { return this.destroyed; }
  destroyForTest() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakePort extends EventEmitter {
  closed = false;
  started = false;
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
  start() { this.started = true; }
  sendChunk(chunk) { this.emit("message", { data: chunk }); }
}

const request = {
  turnId: "turn-main-1",
  languageHint: "zh-CN",
  encoding: "pcm_s16le",
  sampleRateHz: 16_000,
  channels: 1,
  frameDurationMs: 20,
  providerEndpointing: true,
};
const makeChunk = (result, sequence, overrides = {}) => ({
  sessionId: result.sessionId,
  turnId: result.turnId,
  sequence,
  capturedAtMs: sequence * 100,
  durationMs: 100,
  encoding: "pcm_s16le",
  sampleRateHz: 16_000,
  channels: 1,
  audioData: new Uint8Array(3_200),
  ...overrides,
});

const capabilities = getStreamingVoiceCapabilities();
assert.equal(capabilities.streamingStt, true);
assert.equal(capabilities.streamingTts, false);
assert.equal(capabilities.maxBufferedAudioMs, 2_000);

const sender = new FakeSender(101);
const result = startStreamingVoiceTranscription(sender, request);
assert.equal(result.turnId, request.turnId);
assert.equal(sender.events[0].event.type, "accepted");
assert.equal(sender.events[0].event.sequence, 0);
assert.throws(() => startStreamingVoiceTranscription(sender, { ...request, turnId: "turn-main-2" }), /already has an active/);

const wrongOwner = new FakeSender(202);
const wrongPort = new FakePort();
assert.equal(attachStreamingVoiceAudioPort(wrongOwner, result.sessionId, wrongPort), false);
assert.equal(wrongPort.closed, true);
assert.equal(stopStreamingVoiceTranscription(wrongOwner, result.sessionId), false);

const port = new FakePort();
assert.equal(attachStreamingVoiceAudioPort(sender, result.sessionId, port), true);
assert.equal(port.started, true);
const duplicatePort = new FakePort();
assert.equal(attachStreamingVoiceAudioPort(sender, result.sessionId, duplicatePort), false);
assert.equal(duplicatePort.closed, true);
port.sendChunk(makeChunk(result, 0));
port.sendChunk(makeChunk(result, 1));
assert.deepEqual(sender.events.map(({ event }) => event.type), ["accepted", "audio_ack", "audio_ack", "partial"]);
assert.deepEqual(sender.events.map(({ event }) => event.sequence), [0, 1, 2, 3]);
assert.equal(stopStreamingVoiceTranscription(sender, result.sessionId), true);
assert.deepEqual(sender.events.slice(-3).map(({ event }) => event.type), ["endpoint", "final", "completed"]);
assert.equal(port.closed, true);
assert.equal(stopStreamingVoiceTranscription(sender, result.sessionId), false);
assert.equal(cancelStreamingVoiceTranscription(sender, result.sessionId), false);

const cancelSender = new FakeSender(303);
const cancelResult = startStreamingVoiceTranscription(cancelSender, { ...request, turnId: "cancel-turn" });
const cancelPort = new FakePort();
assert.equal(attachStreamingVoiceAudioPort(cancelSender, cancelResult.sessionId, cancelPort), true);
assert.equal(cancelStreamingVoiceTranscription(cancelSender, cancelResult.sessionId), true);
assert.equal(cancelSender.events.at(-1).event.type, "cancelled");
assert.equal(cancelPort.closed, true);
assert.equal(cancelStreamingVoiceTranscription(cancelSender, cancelResult.sessionId), false);

const destroySender = new FakeSender(404);
const destroyResult = startStreamingVoiceTranscription(destroySender, { ...request, turnId: "destroy-turn" });
const destroyPort = new FakePort();
assert.equal(attachStreamingVoiceAudioPort(destroySender, destroyResult.sessionId, destroyPort), true);
destroySender.destroyForTest();
assert.equal(destroyPort.closed, true, "destroying a window must close its audio port");
assert.equal(cancelStreamingVoiceTranscription(destroySender, destroyResult.sessionId), false, "destroyed sessions must be removed");

const explicitCleanupSender = new FakeSender(505);
const cleanupResult = startStreamingVoiceTranscription(explicitCleanupSender, { ...request, turnId: "cleanup-turn" });
const cleanupPort = new FakePort();
attachStreamingVoiceAudioPort(explicitCleanupSender, cleanupResult.sessionId, cleanupPort);
cancelStreamingVoiceSessionsForSender(explicitCleanupSender);
assert.equal(cleanupPort.closed, true);
assert.equal(cancelStreamingVoiceTranscription(explicitCleanupSender, cleanupResult.sessionId), false);

process.env.OPENDRSAI_VOICE_TTS_RUNTIME = "fixture";
assert.equal(getStreamingVoiceCapabilities().streamingTts, true, "configured segment synthesis runtime must be negotiated independently");
delete process.env.OPENDRSAI_VOICE_TTS_RUNTIME;

const quotaSender = new FakeSender(606);
const quotaResult = startStreamingVoiceTranscription(quotaSender, { ...request, turnId: "quota-turn" });
const quotaPort = new FakePort();
attachStreamingVoiceAudioPort(quotaSender, quotaResult.sessionId, quotaPort);
for (let sequence = 0; sequence <= 1_200 && !quotaPort.closed; sequence += 1) quotaPort.sendChunk(makeChunk(quotaResult, sequence));
assert.equal(quotaPort.closed, true, "session duration quota must close the audio port");
assert.equal(quotaSender.events.at(-1).event.type, "failed");
assert.equal(quotaSender.events.at(-1).event.error.code, "duration_exceeded");
assert.doesNotMatch(quotaSender.events.at(-1).event.error.message, /https?:|wss?:|token|secret/i);

process.env.OPENDRSAI_VOICE_RUNTIME = "gateway";
assert.equal(getStreamingVoiceCapabilities().streamingStt, false, "production must not advertise an unimplemented streaming provider");
assert.throws(
  () => startStreamingVoiceTranscription(new FakeSender(707), { ...request, turnId: "unavailable-turn" }),
  /unavailable for the configured production runtime/,
);

console.log("Streaming voice Main integration tests passed (ownership, one port, ordered events, stop, cancel, cleanup, and honest production capability gating)." );
rmSync(bundlePath, { force: true });
