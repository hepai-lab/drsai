import assert from "node:assert/strict";
const { createStreamingVoiceDiagnostic, containsForbiddenStreamingDiagnosticData, StreamingVoiceSloTracker, streamingVoiceQualityMetrics, StreamingVoiceCostBudget, streamingVoiceRecoveryAdvice } = await import("../../shared/renderer/src/voice/streaming/streamingVoiceDiagnostics.ts");

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
let clock = 1_000;
const slo = new StreamingVoiceSloTracker(() => clock);
clock = 1_050; slo.mark("audio_ack"); clock = 1_120; slo.mark("partial"); clock = 1_300; slo.mark("final"); clock = 1_450; slo.mark("tts"); clock = 1_500; slo.mark("playback");
assert.deepEqual(slo.metrics(), { firstAudioAckMs: 50, firstPartialMs: 120, finalMs: 300, firstTtsMs: 450, firstPlaybackMs: 500 });
assert.deepEqual(streamingVoiceQualityMetrics({ turns: 10, repaired: 2, endpointErrors: 1, underruns: 2, recoveries: 1 }), { repairRate: 0.2, endpointErrorRate: 0.1, underrunRate: 0.2, recoveryRate: 0.5 });
const budget = new StreamingVoiceCostBudget({ audioUsageMs: 1_000, ttsCharacters: 20, connectionCount: 2 });
assert.equal(budget.consume({ audioUsageMs: 800, ttsCharacters: 10, connectionCount: 1 }), true);
assert.equal(budget.consume({ audioUsageMs: 201 }), false, "over-budget use must be rejected without mutating usage");
assert.deepEqual(budget.metrics(), { audioUsageMs: 800, ttsCharacters: 10, connectionCount: 1 });
assert.deepEqual(streamingVoiceRecoveryAdvice("transport", "network_error", true), { retry: true, fallbackMode: null, messageKey: "voice.streaming.transport.retry" });
assert.equal(streamingVoiceRecoveryAdvice("asr", "auth_required", false).fallbackMode, "serial");
assert.equal(containsForbiddenStreamingDiagnosticData(createStreamingVoiceDiagnostic({ traceId: "t", turnId: "x", stage: "asr", status: "completed", metrics: { ...slo.metrics(), ...budget.metrics() } })), false);
console.log("Streaming voice diagnostics tests passed (segmented SLO, quality rates, cost budgets, recovery advice, allowlist, sanitization, and privacy exclusion).");
