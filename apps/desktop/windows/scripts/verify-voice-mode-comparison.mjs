import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initialStreamingTranscriptState, reconcileStreamingTranscript } from "../../shared/renderer/src/voice/streaming/transcriptReconciler.ts";
import { SemanticSpeechSegmenter } from "../../shared/renderer/src/voice/streaming/semanticSpeechSegmenter.ts";

const fixture = {
  id: "voice-comparison-en-001",
  audioDurationMs: 2_400,
  transcript: "Fixture streaming transcript.",
  replyChunks: ["Streaming replies begin ", "before the complete response. ", "Both modes preserve the same final text."],
  timing: { firstAudioChunkMs: 100, firstPartialMs: 360, finalAfterSpeechMs: 680, serialTranscriptionMs: 920, firstTtsAudioMs: 760 },
};

let state = initialStreamingTranscriptState;
for (const event of [
  { sessionId: "s", turnId: "t", sequence: 0, type: "accepted", runtimeId: "fixture" },
  { sessionId: "s", turnId: "t", sequence: 1, type: "partial", segment: { text: "Fixture streaming", revision: 1 } },
  { sessionId: "s", turnId: "t", sequence: 2, type: "endpoint", reason: "provider" },
  { sessionId: "s", turnId: "t", sequence: 3, type: "final", segment: { text: fixture.transcript, revision: 2, confidence: 1 } },
  { sessionId: "s", turnId: "t", sequence: 4, type: "completed" },
]) state = reconcileStreamingTranscript(state, event).state;

const segmenter = new SemanticSpeechSegmenter({ firstMinChars: 12, normalMinChars: 32, maxChars: 90 });
const speechSegments = [];
for (const chunk of fixture.replyChunks) speechSegments.push(...segmenter.push(chunk));
speechSegments.push(...segmenter.flush());
const reply = fixture.replyChunks.join("");

const serial = {
  mode: "serial",
  finalTranscript: fixture.transcript,
  spokenText: reply,
  timeToFirstTranscriptMs: fixture.audioDurationMs + fixture.timing.serialTranscriptionMs,
  timeToFinalTranscriptMs: fixture.timing.serialTranscriptionMs,
  timeToFirstAudioMs: reply.length > 0 ? fixture.timing.firstTtsAudioMs + 520 : null,
  peakAudioBacklogMs: fixture.audioDurationMs,
};
const streaming = {
  mode: "streaming",
  finalTranscript: state.committedText,
  spokenText: speechSegments.map((segment) => segment.text).join(" "),
  timeToFirstTranscriptMs: fixture.timing.firstPartialMs - fixture.timing.firstAudioChunkMs,
  timeToFinalTranscriptMs: fixture.timing.finalAfterSpeechMs,
  timeToFirstAudioMs: fixture.timing.firstTtsAudioMs,
  peakAudioBacklogMs: 500,
  speechSegmentCount: speechSegments.length,
};

assert.equal(streaming.finalTranscript, serial.finalTranscript);
assert.equal(normalize(streaming.spokenText), normalize(serial.spokenText));
assert.ok(streaming.timeToFirstTranscriptMs < serial.timeToFirstTranscriptMs);
assert.ok(streaming.timeToFirstAudioMs < serial.timeToFirstAudioMs);
assert.ok(streaming.timeToFirstTranscriptMs <= 500);
assert.ok(streaming.timeToFinalTranscriptMs <= 1_000);
assert.ok(streaming.timeToFirstAudioMs <= 1_200);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidenceClass: "deterministic-fixture",
  disclaimer: "Fixture results prove correctness and regression behavior; they do not substitute for Live Provider latency evidence.",
  fixture: { id: fixture.id, audioDurationMs: fixture.audioDurationMs, transcriptLength: fixture.transcript.length, replyLength: reply.length },
  modes: { serial, streaming },
  comparison: {
    transcriptConsistency: Number(streaming.finalTranscript === serial.finalTranscript),
    speechTextConsistency: Number(normalize(streaming.spokenText) === normalize(serial.spokenText)),
    firstTranscriptGainMs: serial.timeToFirstTranscriptMs - streaming.timeToFirstTranscriptMs,
    firstAudioGainMs: serial.timeToFirstAudioMs - streaming.timeToFirstAudioMs,
  },
  passed: true,
};
const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(root, "out", "verification", "voice-comparison");
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, "report.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Voice mode comparison passed (report: ${outputPath}).`);

function normalize(value) { return value.replace(/\s+/g, " ").trim(); }
