import assert from "node:assert/strict";
import { DuplexSessionBudget, reconnectDelayMs } from "../../shared/main/voice/duplex/runtimePolicy.ts";
import { classifyDuplexSessionUpdate } from "../../shared/main/voice/duplex/sessionUpdatePolicy.ts";
import { buildDuplexSloSnapshot } from "../../shared/renderer/src/voice/duplex/sloProjection.ts";

const SEED = 0x5eedc0de;
let state = SEED >>> 0;
const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
const baseRequest = { protocolVersion: 2, sessionId: "property-session", providerId: "provider", modelId: "gpt-realtime-2", inputEncoding: "pcm_s16le", inputSampleRateHz: 24_000, outputEncoding: "pcm_s16le", outputSampleRateHz: 24_000, channels: 1, enableInputTranscription: true, enableOutputTranscription: true, enableServerVad: true, enableToolCalling: true };

for (let iteration = 0; iteration < 10_000; iteration += 1) {
  const attempt = 1 + Math.floor(random() * 30);
  const baseMs = 1 + Math.floor(random() * 1_000);
  const maxMs = baseMs + Math.floor(random() * 20_000);
  const delay = reconnectDelayMs(attempt, baseMs, maxMs);
  assert.ok(delay >= baseMs && delay <= maxMs, `network:reconnect_bounds seed=${SEED} iteration=${iteration}`);

  const budget = new DuplexSessionBudget({ maxAudioMs: 1 + Math.floor(random() * 100_000) });
  const duration = random() * 120_000;
  budget.addInputAudio(duration);
  budget.addOutputAudio(duration / 2);
  const snapshot = budget.snapshot();
  assert.ok(snapshot.inputAudioMs >= 0 && snapshot.outputAudioMs >= 0, `io:budget_nonnegative seed=${SEED} iteration=${iteration}`);

  const instructionOnly = { ...baseRequest, instructions: `instruction-${iteration}`, updateId: `update-${iteration}` };
  assert.deepEqual(classifyDuplexSessionUpdate(baseRequest, instructionOnly), { hot: ["instructions"], restart: [] }, `provider:update_matrix seed=${SEED} iteration=${iteration}`);
  const modelChange = { ...instructionOnly, modelId: `model-${iteration}` };
  assert.ok(classifyDuplexSessionUpdate(baseRequest, modelChange).restart.includes("modelId"), `provider:model_restart seed=${SEED} iteration=${iteration}`);

  const attempts = Math.floor(random() * 20);
  const accepted = Math.floor(random() * (attempts + 1));
  const slo = buildDuplexSloSnapshot({ interruptAttempts: attempts, interruptAccepted: accepted, underruns: random() * 20 - 5 });
  assert.ok(slo.underruns >= 0 && (slo.interruptAccuracy === null || slo.interruptAccuracy >= 0 && slo.interruptAccuracy <= 1), `audio:slo_bounds seed=${SEED} iteration=${iteration}`);
}

console.log(`Duplex fault properties passed (fixed seed ${SEED}, 10,000 generated cases, bounded reconnect/budget/update/SLO invariants).`);
