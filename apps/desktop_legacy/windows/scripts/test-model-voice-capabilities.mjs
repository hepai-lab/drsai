import assert from "node:assert/strict";
import { knownVoiceModelCapabilities, mergeKnownVoiceModalities } from "../../shared/renderer/src/modelVoiceCapabilities.ts";

const realtime = knownVoiceModelCapabilities("vendor/gpt-realtime-2");
assert.deepEqual(realtime, {
  inputModalities: ["text", "audio"],
  outputModalities: ["text", "audio"],
  capabilities: ["chat", "tool_calling"],
  kind: "realtime",
});
assert.deepEqual(
  mergeKnownVoiceModalities("gpt-realtime-2", ["text"], ["text"]),
  { input: ["text", "audio"], output: ["text", "audio"] },
  "Realtime defaults must repair a discovery result that incorrectly reports text-only modalities",
);
assert.deepEqual(knownVoiceModelCapabilities("whisper-1")?.inputModalities, ["audio"]);
assert.deepEqual(knownVoiceModelCapabilities("tts-1")?.outputModalities, ["audio"]);
assert.equal(knownVoiceModelCapabilities("ordinary-chat-model"), null);
assert.deepEqual(
  mergeKnownVoiceModalities("ordinary-chat-model", ["text"], ["text"]),
  { input: ["text"], output: ["text"] },
  "Unknown model metadata must remain unchanged",
);

console.log("Model voice capability inference checks passed.");
