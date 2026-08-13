import assert from "node:assert/strict";

const { DuplexCapabilityProbe } = await import("../../shared/main/voice/duplex/capabilityProbe.ts");
const { ZhizengzengRealtimeAdapter, resolveZhizengzengRealtimeUrl } = await import("../../shared/main/voice/duplex/zhizengzengRealtimeAdapter.ts");

const secret = "sk-test-secret-not-for-network";
const adapter = new ZhizengzengRealtimeAdapter({
  transcriptionModel: "gpt-4o-mini-transcribe",
  tools: [{ type: "function", name: "search_docs", parameters: { type: "object", properties: { q: { type: "string" } } } }],
});

assert.equal(resolveZhizengzengRealtimeUrl("https://api.zhizengzeng.com/v1").toString(), "wss://api.zhizengzeng.com/v1/realtime");
assert.equal(resolveZhizengzengRealtimeUrl("https://api.zhizengzeng.com").toString(), "wss://api.zhizengzeng.com/v1/realtime");
assert.equal(resolveZhizengzengRealtimeUrl("https://api.zhizengzeng.com/v1/realtime").toString(), "wss://api.zhizengzeng.com/v1/realtime");
for (const invalid of ["http://api.zhizengzeng.com/v1", "https://user:pass@api.zhizengzeng.com/v1", "https://api.zhizengzeng.com/v1?key=secret", "https://localhost/v1"]) {
  assert.throws(() => resolveZhizengzengRealtimeUrl(invalid), /HTTPS|clean|non-loopback/i);
}
const connection = adapter.resolveConnection("https://api.zhizengzeng.com/v1", `Bearer ${secret}`);
assert.equal(connection.headers.Authorization, `Bearer ${secret}`);
assert.equal(connection.headers["OpenAI-Beta"], undefined, "GA must not send the removed beta header");
assert.equal(connection.url.includes(secret), false);
assert.equal(JSON.stringify(connection).includes(secret), true, "the secret exists only in the in-memory header binding");
assert.throws(() => adapter.resolveConnection("https://api.zhizengzeng.com/v1", "Basic bad"), /authorization/i);

const startRequest = {
  protocolVersion: 1,
  sessionId: "session-1",
  providerId: "zhizengzeng",
  modelId: "gpt-realtime-2",
  inputEncoding: "pcm_s16le",
  inputSampleRateHz: 24_000,
  outputEncoding: "pcm_s16le",
  outputSampleRateHz: 24_000,
  channels: 1,
  languageHint: "zh-CN",
  voice: "alloy",
  instructions: "Be concise.",
  enableInputTranscription: true,
  enableOutputTranscription: true,
  enableServerVad: true,
  enableToolCalling: true,
};
const sessionUpdate = adapter.createSessionUpdate(startRequest);
assert.equal(sessionUpdate.type, "session.update");
assert.equal(sessionUpdate.session.model, "gpt-realtime-2");
assert.equal(sessionUpdate.session.type, "realtime");
assert.deepEqual(sessionUpdate.session.output_modalities, ["audio"]);
assert.deepEqual(sessionUpdate.session.audio.input.format, { type: "audio/pcm", rate: 24_000 });
assert.equal(sessionUpdate.session.audio.input.turn_detection.type, "server_vad");
assert.equal(sessionUpdate.session.audio.input.turn_detection.interrupt_response, true);
assert.equal(sessionUpdate.session.audio.input.transcription.model, "gpt-4o-mini-transcribe");
assert.deepEqual(sessionUpdate.session.audio.output.format, { type: "audio/pcm", rate: 24_000 });
assert.equal(sessionUpdate.session.tools[0].name, "search_docs");
assert.equal(JSON.stringify(sessionUpdate).includes(secret), false, "authorization must never enter Session JSON");
assert.throws(() => adapter.createSessionUpdate({ ...startRequest, modelId: "tts-1" }), /model binding/i);
assert.throws(() => adapter.createSessionUpdate({ ...startRequest, providerId: "other" }), /Provider binding/i);
assert.throws(() => adapter.createSessionUpdate({ ...startRequest, inputSampleRateHz: 16_000 }), /sample rate/i);

const legacyAdapter = new ZhizengzengRealtimeAdapter({ protocol: "legacy-beta", transcriptionModel: "gpt-4o-mini-transcribe" });
assert.equal(legacyAdapter.resolveConnection("https://api.zhizengzeng.com/v1", `Bearer ${secret}`).headers["OpenAI-Beta"], "realtime=v1");
const legacySession = legacyAdapter.createSessionUpdate(startRequest).session;
assert.equal(legacySession.input_audio_format, "pcm16");
assert.equal(legacySession.turn_detection.type, "server_vad");

const audio = new Uint8Array([0, 1, 2, 253, 254, 255]);
const append = adapter.createInputAudioAppend({ protocolVersion: 1, sessionId: "session-1", sequence: 0, capturedAtMs: 1, durationMs: 20, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: audio });
assert.deepEqual(new Uint8Array(Buffer.from(append.audio, "base64")), audio);
assert.deepEqual(adapter.createInputAudioCommit(), { type: "input_audio_buffer.commit" });
assert.deepEqual(adapter.createInputAudioClear(), { type: "input_audio_buffer.clear" });
assert.deepEqual(adapter.createResponseCancel("response-1"), { type: "response.cancel", response_id: "response-1" });
assert.deepEqual(adapter.createConversationTruncate("item-1", 0, 640), { type: "conversation.item.truncate", item_id: "item-1", content_index: 0, audio_end_ms: 640 });
assert.deepEqual(adapter.createToolResult("call-1", '{"ok":true}'), { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call-1", output: '{"ok":true}' } });

const encode = (value) => JSON.stringify(value);
const fixtures = [
  { raw: { type: "session.created", session: { id: "session-1" } }, expected: "session_ready" },
  { raw: { type: "input_audio_buffer.committed", sequence: 7 }, expected: "input_audio_ack" },
  { raw: { type: "input_audio_buffer.speech_started", item_id: "user-1", audio_start_ms: 10 }, expected: "input_speech_started" },
  { raw: { type: "input_audio_buffer.speech_stopped", item_id: "user-1", audio_end_ms: 500 }, expected: "input_speech_stopped" },
  { raw: { type: "conversation.item.input_audio_transcription.delta", item_id: "user-1", content_index: 0, delta: "你" }, expected: "input_transcript_delta" },
  { raw: { type: "conversation.item.input_audio_transcription.completed", item_id: "user-1", transcript: "你好" }, expected: "input_transcript_completed" },
  { raw: { type: "response.created", response: { id: "response-1" } }, expected: "response_started" },
  { raw: { type: "response.audio.delta", response_id: "response-1", item_id: "assistant-1", content_index: 0, delta: Buffer.from(audio).toString("base64") }, expected: "response_audio_delta" },
  { raw: { type: "response.audio.done", response_id: "response-1", item_id: "assistant-1", content_index: 0 }, expected: "response_audio_completed" },
  { raw: { type: "response.output_audio_transcript.delta", response_id: "response-1", item_id: "assistant-1", content_index: 0, delta: "你" }, expected: "response_transcript_delta" },
  { raw: { type: "response.output_audio_transcript.done", response_id: "response-1", item_id: "assistant-1", transcript: "你好" }, expected: "response_transcript_completed" },
  { raw: { type: "response.function_call_arguments.done", call_id: "call-1", item_id: "tool-1", name: "search_docs", arguments: '{"q":"voice"}' }, expected: "tool_call" },
  { raw: { type: "response.done", response: { id: "response-1", status: "completed" } }, expected: "response_completed" },
];
const probe = new DuplexCapabilityProbe("zhizengzeng", "gpt-realtime-2");
for (const fixture of fixtures) {
  const events = adapter.decodeEvent(encode(fixture.raw));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, fixture.expected);
  probe.observe(events);
}
const report = probe.report();
assert.equal(report.status, "passed");
assert.equal(report.observed.toolCall, true);
assert.equal(JSON.stringify(report).includes("你好"), false, "probe report must not retain transcript content");
assert.equal(JSON.stringify(report).includes(secret), false, "probe report must not retain credentials");

assert.deepEqual(adapter.decodeEvent("{"), [{ type: "provider_error", error: { code: "protocol", message: "Realtime Provider returned invalid JSON.", retryable: false } }]);
const providerError = adapter.decodeEvent(encode({ type: "error", error: { code: "rate_limit_exceeded", message: "slow down" } }))[0];
assert.equal(providerError.type, "provider_error");
assert.equal(providerError.error.code, "rate_limit");
assert.equal(providerError.error.retryable, true);
const failedProbe = new DuplexCapabilityProbe("zhizengzeng", "gpt-realtime-2");
failedProbe.observe([providerError]);
assert.equal(failedProbe.report().status, "failed");
assert.deepEqual(adapter.decodeEvent(encode({ type: "unknown.future.event", secret })), [], "unknown events must be ignored without retaining content");

console.log("Duplex Provider M2 fixture verified (secure binding, Session config, audio, transcripts, cancel/truncate, tools, errors, and redacted probe report).");
