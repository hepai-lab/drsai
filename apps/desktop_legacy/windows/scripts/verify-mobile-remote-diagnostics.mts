import assert from "node:assert/strict";
import { classifyMobileRemoteDiagnostics } from "../../shared/main/mobileRemoteDiagnostics";

const healthy = { runtime: "ok", relay: "ok", oidc: "ok", wss: "ok", heartbeat: "ok", protocol: "ok" } as const;
const fixtures = [
  [{ ...healthy, runtime: "failed" }, "start_runtime"],
  [{ ...healthy, relay: "failed" }, "retry_relay"],
  [{ ...healthy, oidc: "failed" }, "sign_in"],
  [{ ...healthy, wss: "failed" }, "reconnect_runtime"],
  [{ ...healthy, protocol: "failed" }, "update_runtime"],
] as const;
for (const [input, expected] of fixtures) {
  const result = classifyMobileRemoteDiagnostics(input);
  assert.equal(result.action, expected);
  assert.equal(result.status, "action_required");
  const serialized = JSON.stringify(result);
  for (const forbidden of ["token", "workspacePath", "message", "command", "https://"]) {
    assert.ok(!serialized.includes(forbidden), `diagnostics leaked ${forbidden}`);
  }
}
assert.equal(classifyMobileRemoteDiagnostics(healthy).action, "none");
console.log("Mobile remote diagnostics verification passed (5 fault fixtures + healthy).");
