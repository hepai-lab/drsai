import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(windowsRoot, "../../..");
const python = resolve(repoRoot, ".venv/Scripts/python.exe");
const archive = resolve(windowsRoot, "release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip");
const executable = resolve(windowsRoot, "release/win-unpacked/OpenDrSai.exe");
const asar = resolve(windowsRoot, "release/win-unpacked/resources/app.asar");
const evidence = resolve(process.env.OPENDRSAI_CANCELLATION_EVIDENCE || resolve(
  repoRoot, "docs/desktop/evidence/opendrsai-windows-phase3-round26-cancellation.json",
));
const probeEvidence = resolve(dirname(evidence), "opendrsai-windows-phase3-round26-cancellation-probe.json");
for (const path of [python, archive, executable, asar]) {
  if (!existsSync(path)) throw new Error(`Cancellation dependency missing: ${path}`);
}

const focused = spawnSync(python, ["-m", "pytest",
  "cores/python/packages/drsai/tests/test_gateway_opendrsai_backend.py",
  "cores/python/packages/drsai/tests/test_gateway_opendrsai_approval.py",
  "cores/python/packages/drsai/tests/test_agent_runtime.py",
  "cores/python/packages/drsai/tests/test_runtime_engine.py",
  "-q", "-k", "cancel or approval"], {
  cwd: repoRoot, encoding: "utf8", windowsHide: true,
});
if (focused.status !== 0) {
  throw new Error(`Cancellation tests failed.\n${focused.stdout}\n${focused.stderr}`);
}

const probe = spawnSync(python, [
  resolve(windowsRoot, "scripts/verify-opendrsai-cancellation.py"),
  "--backend-source", archive,
  "--output", probeEvidence,
], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
if (probe.status !== 0) {
  throw new Error(`Packaged cancellation probe failed.\n${probe.stdout}\n${probe.stderr}`);
}
const probeResult = JSON.parse(readFileSync(probeEvidence, "utf8"));
if (probeResult.passed_checks !== Object.keys(probeResult.checks || {}).length) {
  throw new Error("Packaged cancellation checks are incomplete.");
}
const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
mkdirSync(dirname(evidence), { recursive: true });
writeFileSync(evidence, `${JSON.stringify({
  schema_version: "opendrsai.windows.phase3.round-result/1",
  round: 26,
  captured_at: new Date().toISOString(),
  feature: "M05-F05",
  strict_progress: { accepted: 20, total: 50, percentage: 40 },
  focused_tests: focused.stdout.trim(),
  packaged_probe: {
    passed_checks: probeResult.passed_checks,
    checks: probeResult.checks,
    evidence: "docs/desktop/evidence/opendrsai-windows-phase3-round26-cancellation-probe.json",
  },
  guarantees: {
    stages: ["model", "tool", "approval", "subtask"],
    interruption_modes: ["double_cancel", "disconnect", "runtime_restart"],
    one_cancelled_terminal: true,
    active_execution_stopped: true,
    completed_side_effect_not_rolled_back_or_reexecuted: true,
    backend_cancel_failure_cannot_block_runtime_terminal: true,
  },
  artifacts: {
    executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) },
    app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) },
    packaged_backend_source: {
      path: "apps/desktop/windows/release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip",
      sha256: sha256(archive),
    },
  },
}, null, 2)}\n`, "utf8");
console.log(`${probe.stdout.trim()} Focused cancellation tests passed; evidence: ${evidence}`);
