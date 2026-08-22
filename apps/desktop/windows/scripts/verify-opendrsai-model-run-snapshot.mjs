import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(windowsRoot, "../../..");
const python = resolve(repoRoot, ".venv/Scripts/python.exe");
const tests = [
  "cores/python/packages/drsai/tests/test_agent_runtime.py::AgentRuntimeTests::test_execution_model_override_reaches_backend_without_mutating_asset",
  "cores/python/packages/drsai/tests/test_agent_runtime.py::AgentRuntimeTests::test_running_run_keeps_snapshot_and_next_run_uses_committed_model",
  "cores/python/packages/drsai/tests/test_model_provider_config_service.py::test_run_config_snapshot_binds_model_and_revision_atomically",
];
const result = spawnSync(python, ["-m", "pytest", ...tests, "-q"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(`Model Run snapshot tests failed.\n${result.stdout}\n${result.stderr}`);

const gatewayPath = resolve(repoRoot, "cores/python/packages/drsai/src/drsai/backend/gateway.py");
const servicePath = resolve(repoRoot, "cores/python/packages/drsai/src/drsai/config/service.py");
const gateway = readFileSync(gatewayPath, "utf8");
const service = readFileSync(servicePath, "utf8");
const checks = {
  atomicSnapshotApi: /def load_config_snapshot\([\s\S]{0,900}config_write_lock[\s\S]{0,900}revision_before[\s\S]{0,900}revision_after/.test(service),
  gatewayUsesSingleSnapshot: /model_snapshot = load_model_config_snapshot\(\)[\s\S]{0,700}configured = model_snapshot\.config/.test(gateway),
  manifestUsesCapturedRevision: /"revision_digest": model_snapshot\.revision/.test(gateway),
  focusedRuntimeTests: /3 passed/.test(result.stdout),
};
if (!Object.values(checks).every(Boolean)) throw new Error(`Model Run snapshot contracts failed: ${JSON.stringify(checks, null, 2)}`);

const evidencePath = process.env.OPENDRSAI_MODEL_RUN_SNAPSHOT_EVIDENCE?.trim();
if (evidencePath) {
  const executable = resolve(windowsRoot, "release/win-unpacked/OpenDrSai.exe");
  const asar = resolve(windowsRoot, "release/win-unpacked/resources/app.asar");
  const backendSource = resolve(windowsRoot, "release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip");
  if (!existsSync(executable) || !existsSync(asar) || !existsSync(backendSource)) throw new Error("Build release/win-unpacked before recording evidence.");
  const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({
    schema_version: "opendrsai.windows.model-run-snapshot-evidence/1",
    captured_at: new Date().toISOString(),
    package: { version: "1.5.5", platform: "windows", arch: "x64" },
    checks,
    scenarios: {
      running_run: { model: "model-a", revision_binding: "snapshot-a", hot_switched: false },
      next_run: { model: "model-b", revision_binding: "snapshot-b" },
    },
    artifacts: {
      executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) },
      app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) },
      packaged_backend_source: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip", sha256: sha256(backendSource) },
      gateway: { path: "cores/python/packages/drsai/src/drsai/backend/gateway.py", sha256: sha256(gatewayPath) },
      config_service: { path: "cores/python/packages/drsai/src/drsai/config/service.py", sha256: sha256(servicePath) },
    },
  }, null, 2)}\n`, "utf8");
}

console.log("OpenDrSai model Run snapshot acceptance passed (3 focused tests; immutable model/provider/revision binding across concurrent commit).");
