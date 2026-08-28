import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe");
const archive = resolve(root, "release/win-unpacked/resources/app.asar");
const home = resolve(process.argv[2] ?? process.env.DRSAI_HOME ?? join(homedir(), ".drsai-dev"));
const output = resolve(process.argv[3] ?? join(root, "release/duplex-voice/packaged-readiness-e2e.json"));
const runtime = resolve(process.env.OPENDRSAI_RUNTIME_ROOT ?? "C:/Program Files/OpenDrSai/drsai-agent");
const developmentHome = home.toLowerCase().endsWith(".drsai-dev");
const stagedRuntimeOverride = process.env.OPENDRSAI_ACCEPTANCE_RUNTIME_ROOT?.trim();
const useDevelopmentSource = developmentHome && !stagedRuntimeOverride;
const workspaceRoot = resolve(root, "../../..");
const developmentRepository = resolve(root, "../../../cores/python/packages/drsai");
const acceptanceRuntime = resolve(stagedRuntimeOverride || runtime);
const repository = useDevelopmentSource ? developmentRepository : acceptanceRuntime;
const runtimeRoot = useDevelopmentSource ? workspaceRoot : acceptanceRuntime;
assert.ok(existsSync(executable), `Packaged executable is missing: ${executable}`);
assert.ok(existsSync(archive), `Packaged app.asar is missing: ${archive}`);
assert.ok(existsSync(acceptanceRuntime), `Acceptance Runtime is missing: ${acceptanceRuntime}`);
if (useDevelopmentSource) assert.ok(existsSync(join(developmentRepository, "src/drsai/backend/gateway.py")), `Development Runtime source is missing: ${developmentRepository}`);
if (useDevelopmentSource) assert.ok(existsSync(join(workspaceRoot, ".venv/Scripts/python.exe")), `Development Python is missing: ${workspaceRoot}`);

const temporary = mkdtempSync(join(tmpdir(), "opendrsai-duplex-readiness-"));
const rawResult = join(temporary, "result.json");
const userData = join(temporary, "electron-user-data");
try {
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(executable, [], {
      cwd: root,
      env: {
        ...process.env,
        DRSAI_HOME: home,
        DRSAI_REPO: repository,
        OPENDRSAI_RUNTIME_ROOT: runtimeRoot,
        OPENDRSAI_RUNTIME_PERSIST: "0",
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_ENABLE_DUPLEX_VOICE: "1",
        OPENDRSAI_ELECTRON_USER_DATA: userData,
        OPENDRSAI_E2E_DUPLEX_READINESS: "1",
        OPENDRSAI_E2E_RESULT: rawResult,
        OPENDRSAI_E2E_TIMEOUT_MS: "120000",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (status) => resolveExit(status));
  });
  assert.ok(existsSync(rawResult), `Packaged Duplex readiness did not write a result (exit ${code}).`);
  const result = JSON.parse(readFileSync(rawResult, "utf8"));
  const failureSummary = JSON.stringify({ error: result.error ?? null, checks: result.checks ?? {}, details: result.details ?? {} });
  const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const report = {
    schemaVersion: 1,
    kind: "packaged-duplex-readiness",
    ok: result.ok === true && code === 0,
    generatedAt: new Date().toISOString(),
    homeProfile: developmentHome ? "development" : "production",
    runtimeProfile: stagedRuntimeOverride ? "staged_candidate" : useDevelopmentSource ? "development_source_with_workspace_venv" : "installed_production",
    artifacts: {
      executable: { sha256: sha256(executable) },
      appAsar: { sha256: sha256(archive) },
    },
    checks: result.checks,
    details: result.details,
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assert.equal(code, 0, failureSummary);
  assert.equal(result.ok, true, failureSummary);
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
