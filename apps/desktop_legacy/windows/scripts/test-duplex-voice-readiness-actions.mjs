import assert from "node:assert/strict";
import { getDuplexVoiceReadinessActions } from "../../shared/renderer/src/voice/duplex/readinessActions.ts";

for (const reason of ["model_unconfigured", "provider_unsupported", "model_unsupported", "capability_unverified"]) {
  assert.deepEqual(getDuplexVoiceReadinessActions(reason), {
    primary: "open_agent_settings",
    fallback: "switch_to_serial",
  });
}
for (const reason of ["gateway_unavailable", "credential_unavailable", "internal"]) {
  assert.deepEqual(getDuplexVoiceReadinessActions(reason), {
    primary: "retry",
    fallback: "switch_to_serial",
  });
}
for (const reason of ["rollout_disabled", "audio_worklet_unavailable", "media_devices_unavailable"]) {
  assert.deepEqual(getDuplexVoiceReadinessActions(reason), {
    primary: "switch_to_serial",
    fallback: null,
  });
}

console.log("Duplex Voice readiness actions verified (configuration, retry, and serial fallback routes).");
