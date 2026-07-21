import assert from "node:assert/strict";

const { normalizeStreamingVoiceError, redactStreamingVoiceError } = await import("../src/main/voiceStreaming/errors.ts");
const cases = [
  [{ status: 401, message: "bad" }, "auth_required", false],
  [{ status: 429, message: "slow" }, "rate_limited", true],
  [Object.assign(new Error("socket failed"), { code: "ECONNRESET" }), "network_error", true],
  [Object.assign(new Error("provider timeout"), { code: "ETIMEDOUT" }), "timeout", true],
  [new Error("unsupported encoding format"), "unsupported_format", false],
  [new Error("audio byte limit exceeded"), "audio_too_large", false],
  [new Error("audio duration exceeds limit"), "duration_exceeded", false],
  [new Error("provider rejected request"), "provider_error", false],
];
for (const [error, code, retryable] of cases) {
  const normalized = normalizeStreamingVoiceError(error, "request-1");
  assert.equal(normalized.code, code);
  assert.equal(normalized.retryable, retryable);
  assert.equal(normalized.requestId, "request-1");
}
const redacted = redactStreamingVoiceError("authorization=Bearer-secret sk-1234567890 at wss://private.example/v1?token=secret\nnext");
assert.doesNotMatch(redacted, /Bearer-secret|sk-123|private\.example|token=secret/);
assert.match(redacted, /REDACTED|provider endpoint/);
assert.ok(redactStreamingVoiceError("x".repeat(1_000)).length <= 500);

console.log("Streaming runtime error tests passed (auth, rate limit, network, timeout, format, quota, provider, and secret/endpoint redaction).");
