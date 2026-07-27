import assert from "node:assert/strict";
import { getA5ServiceGuidanceScenario } from "../main/a5ServiceGuidanceScenario";

assert.equal(getA5ServiceGuidanceScenario({}), null);
assert.equal(getA5ServiceGuidanceScenario({ OPENDRSAI_E2E_A5_SERVICE_GUIDANCE: "0", OPENDRSAI_A5_SERVICE_GUIDANCE_SCENARIO: "auth_required" }), null);
assert.equal(getA5ServiceGuidanceScenario({ OPENDRSAI_E2E_A5_SERVICE_GUIDANCE: "1", OPENDRSAI_A5_SERVICE_GUIDANCE_SCENARIO: "unknown" }), null);
for (const kind of ["auth_required", "service_unavailable", "runtime_missing", "permission_denied"] as const) {
  const result = getA5ServiceGuidanceScenario({ OPENDRSAI_E2E_A5_SERVICE_GUIDANCE: "1", OPENDRSAI_A5_SERVICE_GUIDANCE_SCENARIO: kind });
  assert.equal(result?.kind, kind);
  assert.equal(result?.blocker.kind, kind);
  assert.equal(result?.session.authenticated, kind !== "auth_required");
  assert.equal(result?.blocker.canRepairRuntime, kind === "runtime_missing");
  assert.equal(result?.blocker.canSignInAgain, kind === "auth_required" || kind === "permission_denied");
  assert.match(result?.message || "", /secret-a5-bearer-token/);
}
console.log("A5 E2E gate and four service-guidance states passed.");
