import assert from "node:assert/strict";
import { alignHeardTranscript, DuplexTranscriptProjection, sanitizeTranscript } from "../../shared/renderer/src/voice/duplex/transcriptProjection.ts";
import { DuplexStableHistoryWriter } from "../../shared/renderer/src/voice/duplex/stableHistoryWriter.ts";
import { buildDuplexSessionContext, interruptedVoiceStatus, trustedContextContent } from "../../shared/renderer/src/voice/duplex/sessionContext.ts";

const sessionId = "s1"; let sequence = 0; const event = (body) => ({ protocolVersion: 2, sessionId, sequence: sequence++, ...body }); const projection = new DuplexTranscriptProjection(sessionId);
const firstDelta = event({ type: "input_transcript_delta", delta: { itemId: "u1", contentIndex: 0, text: "你" } });
assert.equal(projection.apply(firstDelta), true); assert.equal(projection.apply(firstDelta), false);
projection.apply(event({ type: "input_transcript_delta", delta: { itemId: "u2", contentIndex: 0, text: "并行" } }));
projection.apply(event({ type: "input_transcript_delta", delta: { itemId: "u1", contentIndex: 0, text: "好" } }));
assert.deepEqual([...projection.inputDrafts.values()], ["你好", "并行"], "input drafts are isolated by item/content");
projection.apply(event({ type: "input_transcript_completed", itemId: "u1", text: "你好" }));
assert.equal(projection.inputDrafts.size, 1); assert.equal([...projection.inputDrafts.values()][0], "并行", "finalizing one input item does not clear another draft");
assert.equal(projection.pendingStableRevisions().length, 1, "only the completed item becomes persistable; concurrent drafts remain transient");

projection.apply(event({ type: "response_transcript_delta", delta: { responseId: "r1", itemId: "a1", contentIndex: 0, text: "第一" } }));
projection.apply(event({ type: "response_transcript_delta", delta: { responseId: "r2", itemId: "a2", contentIndex: 0, text: "第二" } }));
projection.apply(event({ type: "response_transcript_delta", delta: { responseId: "r1", itemId: "a1", contentIndex: 1, text: "段" } }));
assert.deepEqual([...projection.outputDrafts.values()], ["第一", "第二", "段"], "responses and content indexes never concatenate across keys");
projection.apply(event({ type: "response_audio_delta", delta: { responseId: "r1", itemId: "a1", contentIndex: 0, sequence: 0, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array(48_000) } }));
projection.apply(event({ type: "response_transcript_completed", responseId: "r1", itemId: "a1", text: "第一段完整回答" }));
assert.equal(projection.outputDrafts.size, 1); assert.equal([...projection.outputDrafts.values()][0], "第二", "finalizing one response preserves concurrent response drafts");
const firstRevision = projection.pendingStableRevisions().find((message) => message.id.endsWith(":assistant:a1")); assert.equal(firstRevision.revision, 1); assert.equal(firstRevision.expectedRevision, 0); projection.acknowledgeStableRevisions([firstRevision]);
projection.apply(event({ type: "interrupted", interruptId: "i1", responseId: "r1", playedAudioMs: 500, reason: "user_speech" }));
const assistant = projection.messages.find((message) => message.responseId === "r1"); assert.equal(assistant.interrupted, true); assert.equal(assistant.heardContent, undefined, "duration ratio alone cannot claim exact heard text"); assert.equal(assistant.voice.alignmentConfidence, "none"); assert.equal(assistant.voice.playedAudioMs, 500); const interruptedRevision = projection.pendingStableRevisions().find((message) => message.id === assistant.id); assert.deepEqual([interruptedRevision.expectedRevision, interruptedRevision.revision], [1, 2]);
assert.deepEqual(alignHeardTranscript("你好世界", 450), { confidence: "none" }); assert.deepEqual(alignHeardTranscript("你好世界", 450, [{ word: "你", endMs: 100 }, { word: "好", endMs: 250 }, { word: "世", endMs: 500 }]), { heardContent: "你好", confidence: "word_timing" });
projection.apply(event({ type: "response_transcript_completed", responseId: "r1", itemId: "a1", text: "第一段完整回答" })); assert.equal(projection.messages.filter((message) => message.providerItemId === "a1").length, 1);
assert.match(sanitizeTranscript("Authorization: secret API_KEY=abc token:xyz"), /Authorization=\[redacted\].*API_KEY=\[redacted\].*token=\[redacted\]/i);

const retryProjection = new DuplexTranscriptProjection("retry"); let retrySequence = 0;
retryProjection.apply({ protocolVersion: 2, sessionId: "retry", sequence: retrySequence++, type: "input_transcript_delta", delta: { itemId: "draft-canary", contentIndex: 0, text: "DRAFT-MUST-NOT-PERSIST" } });
assert.equal(retryProjection.pendingStableRevisions().length, 0, "delta-only captions are never offered to persistence");
retryProjection.apply({ protocolVersion: 2, sessionId: "retry", sequence: retrySequence++, type: "input_transcript_completed", itemId: "stable", text: "stable transcript" });
const writes = []; let attempts = 0;
const writer = new DuplexStableHistoryWriter({ threadId: "thread", projection: retryProjection, append: async (request) => { attempts += 1; if (attempts === 1) throw new Error("disk temporarily unavailable"); writes.push(structuredClone(request)); } });
assert.equal(await writer.enqueue(), false, "a transient persistence failure remains observable");
assert.equal(retryProjection.pendingStableRevisions().length, 1, "failed stable revisions remain dirty");
assert.equal(await writer.flush(2), true, "terminal flush retries dirty stable revisions");
assert.equal(retryProjection.pendingStableRevisions().length, 0, "successful retry acknowledges the exact revision");
assert.equal(writes.length, 1); assert.equal(writes[0].messages[0].content, "stable transcript"); assert.equal(JSON.stringify(writes).includes("DRAFT-MUST-NOT-PERSIST"), false, "terminal flush cannot persist a draft caption");

const long = new DuplexTranscriptProjection("long"); let longSequence = 0;
for (let minute = 0; minute < 60; minute += 1) for (let turn = 0; turn < 10; turn += 1) long.apply({ protocolVersion: 2, sessionId: "long", sequence: longSequence++, type: "input_transcript_completed", itemId: `u-${minute}-${turn}`, text: `minute ${minute} topic ${"x".repeat(80)}` });
const context = long.context(2_000, 12); assert.equal(context.totalMessages, 600); assert.equal(context.recent.length, 12); assert.ok(context.summary.length <= 2_000); assert.equal(context.truncated, true); assert.equal(JSON.stringify(context).includes("audioData"), false);
const bounded = new DuplexTranscriptProjection("bounded"); for (let index = 0; index < 100; index += 1) bounded.apply({ protocolVersion: 2, sessionId: "bounded", sequence: index, type: "input_transcript_delta", delta: { itemId: `draft-${index}`, contentIndex: 0, text: "x" } }); assert.equal(bounded.inputDrafts.size, 64, "orphan drafts are bounded");
for (let index = 100; index < 10_000; index += 1) bounded.apply({ protocolVersion: 2, sessionId: "bounded", sequence: index, type: "connection_state", state: "connected" }); assert.equal(bounded.apply({ protocolVersion: 2, sessionId: "bounded", sequence: 10_000, type: "input_transcript_delta", delta: { itemId: "live", contentIndex: 0, text: "ok" } }), true, "irrelevant high-frequency events do not consume transcript dedupe capacity");
const contextSnapshot = { threadId: "thread", title: "Thread", updatedAt: 1, messageCount: 4, messages: [
  { id: "u", role: "user", content: "API_KEY=secret explain caching" },
  { id: "heard", role: "assistant", content: "generated hidden suffix", voice: { revision: 2, interruptedAt: 2, playedAudioMs: 300, alignmentConfidence: "word_timing", heardContent: "heard prefix" } },
  { id: "unheard", role: "assistant", content: "UNHEARD-CANARY", voice: { revision: 2, interruptedAt: 3, playedAudioMs: 100, alignmentConfidence: "none" } },
  { id: "latest", role: "user", content: "continue" },
] };
const sessionContext = buildDuplexSessionContext("Be concise", contextSnapshot, 8_000, 12); assert.match(sessionContext.instructions, /Be concise/); assert.match(sessionContext.instructions, /api_key=\[redacted\]/i); assert.match(sessionContext.instructions, /heard prefix/); assert.doesNotMatch(sessionContext.instructions, /UNHEARD-CANARY|generated hidden suffix/); assert.equal(sessionContext.includedMessages, 3);
assert.equal(trustedContextContent(contextSnapshot.messages[2]), ""); assert.match(interruptedVoiceStatus(contextSnapshot.messages[2].voice), /exact heard text is unavailable/);

console.log("Duplex Voice transcript verified (per-item drafts, concurrent responses, stable history, heard projection, context bounds, privacy, and text coexistence).");
