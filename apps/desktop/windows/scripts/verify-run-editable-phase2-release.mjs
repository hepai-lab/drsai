import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const ledgerPath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-editable-phase2-acceptance-ledger.json");
const e2ePath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-editable-phase2-windows-e2e-result.json");
const attestationPath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-editable-phase2-release-attestation.json");
const windowsE2eSourceFiles = [
  "apps/desktop/windows/scripts/verify-run-editable-phase2-windows-e2e.mjs",
  "apps/desktop/windows/scripts/fixtures/run_editable_phase2_fixture.py",
  "apps/desktop/windows/src/main/e2eSmoke.ts",
  "apps/desktop/windows/src/main/index.ts",
  "apps/desktop/shared/api/runExperiment.ts",
  "apps/desktop/shared/main/runtimeClient.ts",
  "apps/desktop/shared/renderer/src/components/RunExperimentPanel.tsx",
  "apps/desktop/shared/renderer/src/components/RunInspectorPanel.tsx",
  "cores/python/packages/drsai/src/drsai/backend/gateway.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/replay_execution.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/replay_planner.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/adoptions.py",
  "cores/python/packages/drsai/src/drsai/backend/workspace/git_worktree_service.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/experiment_export.py",
];
const liveBackendSourceFiles = [
  "cores/python/packages/drsai/src/drsai/backend/gateway.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/replay_planner.py",
  "apps/desktop/windows/scripts/verify-run-editable-phase2-live-backend.mjs",
];
const expectedIds = Object.entries({ M20:5, M21:4, M22:5, M23:4, M24:5, M25:5, M26:5, M27:5, M28:6, M29:5, M30:5, M31:5 })
  .flatMap(([moduleId, count]) => Array.from({ length: count }, (_, index) => `${moduleId}-${String(index + 1).padStart(2, "0")}`));
const commands = [
  { id:"backend", cwd:".", command:".venv\\Scripts\\python.exe -m pytest cores/python/packages/drsai/tests/test_runtime_experiments.py cores/python/packages/drsai/tests/test_experiment_overrides.py cores/python/packages/drsai/tests/test_replay_planner.py cores/python/packages/drsai/tests/test_replay_policy.py cores/python/packages/drsai/tests/test_replay_execution.py cores/python/packages/drsai/tests/test_run_comparison.py cores/python/packages/drsai/tests/test_runtime_adoptions.py cores/python/packages/drsai/tests/test_runtime_operation_metrics.py cores/python/packages/drsai/tests/test_phase2_controlled_execute_e2e.py cores/python/packages/drsai/tests/test_run_inspection_gateway.py -q" },
  { id:"desktop", cwd:"apps/desktop/windows", command:"npm run typecheck && npm run verify:run-inspector-ui && npm run verify:phase2-runtime-auth && npm run verify:mojibake" },
  { id:"visual", cwd:"apps/desktop/windows", command:"node scripts/verify-renderer-visual.mjs" },
  { id:"windows_e2e", cwd:"apps/desktop/windows", command:"npm run verify:run-editable-phase2-windows-e2e" },
  { id:"p1_regression", cwd:"apps/desktop/windows", command:"npm run verify:run-traceability-phase1-release" },
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
function validatePath(path, label) {
  assert.equal(typeof path, "string", `${label}: evidence path must be text`);
  assert.ok(!/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(path), `${label}: evidence path must be repository-relative`);
  assert.ok(existsSync(resolve(repoRoot, path)), `${label}: missing evidence ${path}`);
}
function validateLedger(ledger) {
  assert.equal(ledger.schema_version, "opendrsai.acceptance-ledger/3");
  assert.equal(ledger.release_gate, "fail_closed");
  validatePath(ledger.plan, "plan");
  assert.equal(ledger.feature_count, 59);
  assert.equal(ledger.features?.length, 59, "release requires exactly 59 feature records");
  const ids = ledger.features.map((feature) => feature.id);
  assert.equal(new Set(ids).size, 59, "feature ids must be unique");
  assert.deepEqual([...ids].sort(), [...expectedIds].sort(), "feature ledger is incomplete");
  const preReleaseStatuses = {
    "M31-02":"awaiting_live_evidence", "M31-03":"awaiting_windows_e2e",
    "M31-04":"awaiting_release_attestation", "M31-05":"awaiting_p1_regression",
  };
  for (const feature of ledger.features) {
    const preReleaseStatus = preReleaseStatuses[feature.id];
    assert.ok(
      feature.status === "passed" || feature.status === preReleaseStatus || feature.status === "superseded_fail_closed",
      `${feature.id}: feature has an unknown or unevidenced status`,
    );
    const profile = ledger.evidence_profiles?.[feature.profile];
    assert.ok(profile, `${feature.id}: evidence profile is missing`);
    assert.ok(profile.implementation?.length && profile.tests?.length, `${feature.id}: implementation or tests missing`);
    for (const path of [...profile.implementation, ...profile.tests]) validatePath(path, feature.id);
  }
  assert.equal(ledger.features.find((feature) => feature.id === "M31-02")?.verification_tier, "nightly_rc");
  assert.equal(typeof ledger.nightly_rc_evidence, "string");
}
function validateE2e(result) {
  assert.equal(result.schema_version, "opendrsai.run-editable-phase2-windows-e2e-result/1");
  assert.equal(result.platform, "win32");
  assert.deepEqual(result.scenarios, ["G","H","I","J","K","L","M","N"]);
  assert.equal(result.real_gateway, true);
  assert.equal(result.real_electron, true);
  assert.equal(result.offline_database_verification, true);
  assert.ok(Object.values(result.checks || {}).every((value) => value === true), "Windows E2E contains a failed check");
  assert.equal(result.details?.stage, "complete");
  assert.equal(result.commit, execFileSync("git", ["rev-parse","HEAD"], { cwd:repoRoot, encoding:"utf8", windowsHide:true }).trim());
  for (const field of ["source_digest", "application_build_digest", "desktop_result_digest"]) assert.match(result[field], /^[0-9a-f]{64}$/);
  assert.equal(result.source_digest, digestPaths(windowsE2eSourceFiles), "Windows E2E evidence is stale for the current source");
  assert.equal(result.exit_code, 0);
  assert.ok(result.started_at && result.generated_at && result.command);
  assert.ok(result.proof_scope?.includes("renderer") && result.not_proven?.includes("real_backend_account"));
}
function validateLiveBackend(result) {
  assert.equal(result.schema_version, "opendrsai.run-editable-phase2-live-backend-result/1");
  assert.equal(result.account_backed, true);
  assert.equal(result.controlled_model, false);
  assert.equal(result.run_status, "completed");
  assert.equal(result.tool?.classification, "read_only_mutable");
  assert.equal(result.replay_plan?.mutable_decision, "reexecute");
  assert.equal(result.commit, currentCommit(), "live Backend evidence belongs to a different commit");
  assert.equal(result.source_digest, digestPaths(liveBackendSourceFiles), "live Backend evidence is stale for the current source");
  assert.match(result.manifest_digest, /^[0-9a-f]{64}$/);
}
function currentCommit() { return execFileSync("git", ["rev-parse","HEAD"], { cwd:repoRoot, encoding:"utf8", windowsHide:true }).trim(); }
function digestPaths(paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) { hash.update(path); hash.update("\0"); hash.update(readFileSync(resolve(repoRoot, path))); hash.update("\0"); }
  return hash.digest("hex");
}
function sourceDigest(ledger) {
  const paths = [...new Set(Object.values(ledger.evidence_profiles).flatMap((profile) => [...profile.implementation, ...profile.tests]))].sort();
  const hash = createHash("sha256");
  for (const path of paths) { hash.update(path); hash.update("\0"); hash.update(readFileSync(resolve(repoRoot, path))); hash.update("\0"); }
  return hash.digest("hex");
}
function runCommand(specification) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const child = spawnSync(specification.command, { cwd: resolve(repoRoot, specification.cwd), shell:true, encoding:"utf8", windowsHide:true, timeout:30*60*1000 });
  return { id:specification.id, command:specification.command, cwd:specification.cwd, started_at:startedAt, completed_at:new Date().toISOString(), duration_ms:Math.round(performance.now()-started), exit_code:typeof child.status === "number" ? child.status : -1, signal:child.signal || null, error_code:child.error?.code || null, stdout_sha256:sha256(child.stdout || ""), stderr_sha256:sha256(child.stderr || "") };
}
function scanSecrets(value, label) {
  const text = JSON.stringify(value);
  for (const pattern of [/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i, /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]) assert.ok(!pattern.test(text), `${label}: credential material detected`);
}

const ledger = readJson(ledgerPath);
validateLedger(ledger);
scanSecrets(ledger, "ledger");
if (process.argv.includes("--self-test")) {
  assert.equal(runCommand({ id:"pass", cwd:".", command:'node -e "process.exit(0)"' }).exit_code, 0);
  assert.equal(runCommand({ id:"fail", cwd:".", command:'node -e "process.exit(9)"' }).exit_code, 9);
  const broken = structuredClone(ledger); broken.features[0].status = "pending";
  assert.throws(() => validateLedger(broken), /unknown or unevidenced status/);
  console.log("Phase 2 release gate executable fail-closed self-test passed.\n");
  process.exit(0);
}
const unresolved = ledger.features.filter((feature) => feature.status !== "passed");
assert.equal(
  unresolved.length,
  0,
  `Phase 2 release remains blocked by: ${unresolved.map((feature) => `${feature.id}=${feature.status}`).join(", ")}`,
);
const liveBackendPath = resolve(repoRoot, ledger.nightly_rc_evidence);
assert.ok(existsSync(liveBackendPath), "real account-backed Backend nightly/RC evidence is missing");
const liveBackend = readJson(liveBackendPath); validateLiveBackend(liveBackend); scanSecrets(liveBackend, "live Backend evidence");
if (process.argv.includes("--validate-only")) {
  assert.ok(existsSync(e2ePath), "real Phase 2 Windows E2E evidence is missing");
  const e2e = readJson(e2ePath); validateE2e(e2e); scanSecrets(e2e, "Windows E2E evidence");
  console.log("Phase 2 acceptance ledger, Windows E2E and live Backend evidence validated.\n"); process.exit(0);
}
const results = [];
for (const command of commands) { const result = runCommand(command); results.push(result); if (result.exit_code !== 0 || result.error_code) break; }
const failed = results.find((result) => result.exit_code !== 0 || result.error_code);
assert.equal(
  failed,
  undefined,
  failed
    ? `blocking command ${failed.id} failed (exit=${failed.exit_code}, error=${failed.error_code || "none"})`
    : "a blocking command failed",
);
assert.equal(results.length, commands.length, "not every blocking command executed");
assert.ok(existsSync(e2ePath), "real Phase 2 Windows E2E evidence was not produced");
const e2e = readJson(e2ePath); validateE2e(e2e); scanSecrets(e2e, "Windows E2E evidence");
const attestation = { schema_version:"opendrsai.run-editable-phase2-release-attestation/1", generated_at:new Date().toISOString(), commit:execFileSync("git", ["rev-parse","HEAD"], { cwd:repoRoot, encoding:"utf8", windowsHide:true }).trim(), source_digest:sourceDigest(ledger), ledger_digest:sha256(readFileSync(ledgerPath)), artifact_digests:{ windows_e2e:sha256(readFileSync(e2ePath)), live_backend:sha256(readFileSync(liveBackendPath)), application_build:e2e.application_build_digest }, commands:results };
writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
console.log(`Phase 2 release gate passed; attestation: ${attestationPath}\n`);
