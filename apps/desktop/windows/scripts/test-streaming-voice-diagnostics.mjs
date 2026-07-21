import assert from "node:assert/strict";
const { createStreamingVoiceDiagnostic, containsForbiddenStreamingDiagnosticData } = await import("../../shared/renderer/src/voice/streaming/streamingVoiceDiagnostics.ts");

const event = createStreamingVoiceDiagnostic({
  traceId: "trace-1", turnId: "turn-1", stage: "asr", status: "completed",
  metrics: { sequence: 18, bufferedAudioMs: 320, partialCount: 4, finalCount: 2, latencyMs: 480, transcript: "secret words", audioData: [1, 2] },
  errorCode: "provider.timeout",
});
assert.equal(event.module, "voice");
assert.equal(event.operation, "voice.streaming.asr");
assert.deepEqual(event.attributes, { mode: "streaming", sequence: 18, bufferedAudioMs: 320, partialCount: 4, finalCount: 2, latencyMs: 480 });
assert.equal(containsForbiddenStreamingDiagnosticData(event), false);
assert.equal(createStreamingVoiceDiagnostic({ traceId: "t", turnId: "x", stage: "tts", status: "failed", errorCode: "Bearer secret value" }).errorCode, "streaming_voice_error");
assert.equal(containsForbiddenStreamingDiagnosticData({ transcript: "must not export" }), true);
console.log("Streaming voice diagnostics tests passed (schema, metric allowlist, error sanitization, and raw audio/transcript/credential exclusion).");
