import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const app = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = resolve(app, "../../..");
const read = (path) => readFile(resolve(root, path), "utf8");

const security = await read("cores/python/packages/drsai/src/drsai/backend/runtime/security.py");
const observability = await read("cores/python/packages/drsai/src/drsai/backend/runtime/observability.py");
const codex = await read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/backend_client.py");
const gates = JSON.parse(await read("cores/protocol/orca-inspired/compatibility-gates.json"));
const boundary = await read("apps/desktop/windows/scripts/verify-orca-inspired-boundaries.mjs");

for (const action of ["worktree.write", "pty.execute", "file.write", "shell.execute"]) {
  assert.match(security, new RegExp(action.replace(".", "\\.")), `${action} is absent from Runtime security policy`);
}
assert.ok(security.indexOf("permission.denied") < security.indexOf("approval.requested"), "Permission must be evaluated before Approval creation");
for (const field of ["host_id", "runtime_id", "workspace_id", "worktree_id", "terminal_id", "session_id", "run_id", "operation_id", "correlation_id"]) {
  assert.match(security + observability, new RegExp(field), `correlation field ${field} is missing`);
}
for (const metric of ["host.connection.success", "host.reconnect.count", "pty.replay.lag", "pty.snapshot.bytes", "pty.output.dropped", "worktree.conflict.count", "worktree.reconcile.count"]) {
  assert.match(observability, new RegExp(metric.replaceAll(".", "\\.")), `metric ${metric} is missing`);
}
assert.match(codex, /codex_approval_policy_unsafe/);
assert.match(codex, /codex_sandbox_policy_unsafe/);
assert.doesNotMatch(codex, /dangerously-bypass-approvals-and-sandbox/);

assert.equal(gates.policy.minimum_stable_releases, 2);
assert.equal(gates.policy.required_legacy_call_count, 0);
for (const entry of gates.entries) {
  const removable = entry.stable_releases >= 2 && entry.legacy_call_count === 0;
  assert.equal(entry.removal_approved, removable, `${entry.id} removal decision violates the two-release/zero-call gate`);
  assert.match(boundary, new RegExp(entry.owner_file.split("/").at(-1).replace(".", "\\.")), `${entry.id} is not retained in the migration boundary allowlist`);
}

console.log("ORCA security, correlation, bounded observability, Codex policy, and compatibility-removal gates passed.");
