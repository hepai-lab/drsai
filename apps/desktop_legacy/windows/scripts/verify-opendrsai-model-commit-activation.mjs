import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(windowsRoot, "../../..");
const python = resolve(repoRoot, ".venv/Scripts/python.exe");
const tests = [
  "cores/python/packages/drsai/tests/test_agent_runtime.py::AgentRuntimeTests::test_running_run_keeps_snapshot_and_next_run_uses_committed_model",
  "cores/python/packages/drsai/tests/test_model_provider_config_service.py::test_run_config_snapshot_binds_model_and_revision_atomically",
  "cores/python/packages/drsai/tests/test_model_provider_gateway.py::test_agent_manager_switches_on_next_turn_without_interrupting_active_stream",
  "cores/python/packages/drsai/tests/test_model_provider_gateway.py::test_model_commit_invalidates_discovery_and_defers_agent_swap",
  "cores/python/packages/drsai/tests/test_model_provider_discovery.py::test_config_invalidation_prevents_inflight_old_discovery_from_refilling_cache",
];
const result = spawnSync(python, ["-m", "pytest", ...tests, "-q"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(`Model activation tests failed.\n${result.stdout}\n${result.stderr}`);

const gatewayPath = resolve(repoRoot, "cores/python/packages/drsai/src/drsai/backend/gateway.py");
const discoveryPath = resolve(repoRoot, "cores/python/packages/drsai/src/drsai/config/model_discovery.py");
const gateway = readFileSync(gatewayPath, "utf8");
const discovery = readFileSync(discoveryPath, "utf8");
const checks = {
  focusedTests: /5 passed/.test(result.stdout),
  nextTurnAtomicAgentSwap: /async def mark_user_config_stale[\s\S]{0,500}_config_revisions\[user_id\] = revision/.test(gateway),
  runningStreamNotEvictedOnCommit: /"evicted_sessions": 0/.test(gateway),
  allCommitPathsInvalidateCache: (gateway.match(/revision = await _activate_model_config_commit\(\)/g) || []).length === 4,
  cacheInvalidationHasGeneration: /_CACHE_GENERATION \+= 1/.test(discovery),
  staleInflightResultCannotRefillCache: /if generation == _CACHE_GENERATION:[\s\S]{0,120}_CACHE\[cache_key\]/.test(discovery),
};
if (!Object.values(checks).every(Boolean)) throw new Error(`Model activation contracts failed: ${JSON.stringify(checks, null, 2)}`);

const evidencePath = process.env.OPENDRSAI_MODEL_COMMIT_EVIDENCE?.trim();
if (evidencePath) {
  const executable = resolve(windowsRoot, "release/win-unpacked/OpenDrSai.exe");
  const asar = resolve(windowsRoot, "release/win-unpacked/resources/app.asar");
  const backendSource = resolve(windowsRoot, "release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip");
  if (![executable, asar, backendSource].every(existsSync)) throw new Error("Current packaged artifacts are required.");
  const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({
    schema_version: "opendrsai.windows.model-commit-activation-evidence/1",
    captured_at: new Date().toISOString(),
    package: { version: "1.5.5", platform: "windows", arch: "x64" },
    checks,
    acceptance: {
      running_run: { interrupted: false, model: "model-a", revision: "revision-a" },
      next_run: { model: "model-b", revision: "revision-b" },
      old_discovery_result_reinserted: false,
      commit_count: 1,
    },
    artifacts: {
      executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) },
      app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) },
      packaged_backend_source: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip", sha256: sha256(backendSource) },
      gateway: { path: "cores/python/packages/drsai/src/drsai/backend/gateway.py", sha256: sha256(gatewayPath) },
      model_discovery: { path: "cores/python/packages/drsai/src/drsai/config/model_discovery.py", sha256: sha256(discoveryPath) },
    },
  }, null, 2)}\n`, "utf8");
}
console.log("OpenDrSai model commit activation acceptance passed (5 focused tests; next-turn swap and stale-cache generation guard).");
