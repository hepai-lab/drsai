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
const evidence = resolve(process.env.OPENDRSAI_WORKSPACE_GUARD_EVIDENCE || resolve(repoRoot, "docs/desktop/evidence/opendrsai-windows-phase3-round25-workspace-guard.json"));
const probeEvidence = resolve(dirname(evidence), "opendrsai-windows-phase3-round25-workspace-guard-probe.json");
const packagedF6Evidence = resolve(repoRoot, "docs/desktop/evidence/round25-f6-packaged-final/summary.json");
for (const path of [python, archive, executable, asar]) if (!existsSync(path)) throw new Error(`Workspace guard dependency missing: ${path}`);

const focused = spawnSync(python, ["-m", "pytest",
  "cores/python/packages/drsai/tests/test_workspace_paths.py",
  "cores/python/packages/drsai/tests/test_owop_local_workspace.py",
  "cores/python/packages/drsai/tests/test_owop_process_pty.py",
  "cores/python/packages/drsai/tests/test_agent_runtime.py",
  "-q", "-m", "not slow"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
if (focused.status !== 0) throw new Error(`Workspace guard tests failed.\n${focused.stdout}\n${focused.stderr}`);

const probe = spawnSync(python, [resolve(windowsRoot, "scripts/verify-opendrsai-workspace-guard.py"), "--backend-source", archive, "--output", probeEvidence], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
if (probe.status !== 0) throw new Error(`Packaged workspace guard probe failed.\n${probe.stdout}\n${probe.stderr}`);
const probeResult = JSON.parse(readFileSync(probeEvidence, "utf8"));
const packagedF6 = existsSync(packagedF6Evidence) ? JSON.parse(readFileSync(packagedF6Evidence, "utf8")) : null;
if (!packagedF6?.ok || packagedF6.completed_rounds !== 20 || packagedF6.path_escape_successes !== 0 || packagedF6.outside_mutations !== 0) {
  throw new Error("Formal packaged F6 20-round evidence is missing or failed.");
}
const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
mkdirSync(dirname(evidence), { recursive: true });
writeFileSync(evidence, `${JSON.stringify({
  schema_version: "opendrsai.windows.phase3.round-result/1",
  round: 25,
  captured_at: new Date().toISOString(),
  feature: "M05-F04",
  focused_tests: focused.stdout.trim(),
  packaged_probe: {
    passed_checks: probeResult.passed_checks,
    checks: probeResult.checks,
    outside_tree_unchanged: probeResult.outside_before === probeResult.outside_after,
    evidence: "docs/desktop/evidence/opendrsai-windows-phase3-round25-workspace-guard-probe.json",
  },
  formal_packaged_f6: {
    completed_rounds: packagedF6.completed_rounds,
    total_checks: packagedF6.total_checks,
    path_escape_successes: packagedF6.path_escape_successes,
    outside_mutations: packagedF6.outside_mutations,
    evidence: "docs/desktop/evidence/round25-f6-packaged-final/summary.json",
  },
  artifacts: {
    executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) },
    app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) },
    packaged_backend_source: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip", sha256: sha256(archive) },
  },
}, null, 2)}\n`, "utf8");
console.log(`${probe.stdout.trim()} Focused Runtime/OWOP tests passed; evidence: ${evidence}`);
