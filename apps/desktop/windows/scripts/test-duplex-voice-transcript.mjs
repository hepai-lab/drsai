import assert from "node:assert/strict";
import { DuplexTranscriptProjection, sanitizeTranscript } from "../../shared/renderer/src/voice/duplex/transcriptProjection.ts";

const sessionId = "s1"; let sequence = 0;
const event = (body) => ({ protocolVersion: 1, sessionId, sequence: sequence++, ...body });
const projection = new DuplexTranscriptProjection(sessionId);
const firstDelta = event({ type: "input_transcript_delta", delta: { itemId: "u1", contentIndex: 0, text: "你" } });
assert.equal(projection.apply(firstDelta), true);
assert.equal(projection.apply(firstDelta), false, "replayed event sequence is ignored");
projection.apply(event({ type: "input_transcript_delta", delta: { itemId: "u1", contentIndex: 0, text: "好" } }));
assert.equal(projection.inputDraft, "你好"); assert.equal(projection.messages.length, 0, "delta is not stable history");
projection.apply(event({ type: "input_transcript_completed", itemId: "u1", text: "你好" }));
assert.deepEqual(projection.messages.map((message) => [message.role, message.content]), [["user", "你好"]]);

projection.apply(event({ type: "response_transcript_delta", delta: { responseId: "r1", itemId: "a1", contentIndex: 0, text: "你" } }));
projection.apply(event({ type: "response_transcript_delta", delta: { responseId: "r1", itemId: "a1", contentIndex: 0, text: "好！" } }));
assert.equal(projection.outputDrafts.get("r1"), "你好！");
projection.apply(event({ type: "response_audio_delta", delta: { responseId: "r1", itemId: "a1", contentIndex: 0, sequence: 0, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array(48_000) } }));
projection.apply(event({ type: "response_transcript_completed", responseId: "r1", itemId: "a1", text: "你好，欢迎！" }));
projection.apply(event({ type: "interrupted", responseId: "r1", playedAudioMs: 500, reason: "user_speech" }));
const assistant = projection.messages[1]; assert.equal(assistant.interrupted, true); assert.ok(assistant.heardContent.length > 0 && assistant.heardContent.length < assistant.content.length);

projection.apply(event({ type: "response_audio_delta", delta: { responseId: "r2", itemId: "a2", contentIndex: 0, sequence: 1, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array(1_920) } }));
assert.equal(projection.messages.length, 2, "audio without completed transcript creates no fake text history");
projection.apply(event({ type: "response_transcript_completed", responseId: "r1", itemId: "a1", text: "你好，欢迎！" }));
assert.equal(projection.messages.length, 2, "same Provider item is upserted, never duplicated");
assert.equal(projection.queueManualText(" draft remains ", true), "queued"); assert.deepEqual(projection.drainManualText(), ["draft remains"]);
assert.match(sanitizeTranscript("Authorization: secret API_KEY=abc token:xyz"), /Authorization=\[redacted\].*API_KEY=\[redacted\].*token=\[redacted\]/i);

const long = new DuplexTranscriptProjection("long"); let longSequence = 0;
for (let minute = 0; minute < 60; minute += 1) for (let turn = 0; turn < 10; turn += 1) long.apply({ protocolVersion: 1, sessionId: "long", sequence: longSequence++, type: "input_transcript_completed", itemId: `u-${minute}-${turn}`, text: `minute ${minute} topic ${"x".repeat(80)}` });
const context = long.context(2_000, 12);
assert.equal(context.totalMessages, 600); assert.equal(context.recent.length, 12); assert.ok(context.summary.length <= 2_000); assert.equal(context.truncated, true);
assert.equal(JSON.stringify(context).includes("audioData"), false, "context never persists raw audio");

console.log("Duplex Voice M7 transcript verified (draft/stable boundary, replay dedupe, output sync, heard range, bounded 60-minute context, privacy, and text coexistence).")
