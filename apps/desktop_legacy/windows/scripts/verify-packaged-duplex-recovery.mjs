import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe");
const archive = resolve(root, "release/win-unpacked/resources/app.asar");
const home = resolve(process.argv[2] ?? join(homedir(), ".drsai-dev"));
const output = resolve(process.argv[3] ?? join(root, "release/duplex-voice/packaged-recovery-e2e.json"));
const stagedRuntime = resolve(process.env.OPENDRSAI_ACCEPTANCE_RUNTIME_ROOT ?? join(root, ".tmp/bootstrapper-msi3/.drsai/drsai-agent"));
for (const path of [executable, archive, stagedRuntime]) assert.ok(existsSync(path), `Required packaged recovery input is missing: ${path}`);

const temporary = mkdtempSync(join(tmpdir(), "opendrsai-duplex-recovery-"));
const rawResult = join(temporary, "result.json");
const userData = join(temporary, "electron-user-data");
try {
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(executable, [], {
      cwd: root,
      env: {
        ...process.env,
        DRSAI_HOME: home,
        DRSAI_REPO: stagedRuntime,
        OPENDRSAI_RUNTIME_ROOT: stagedRuntime,
        OPENDRSAI_RUNTIME_PERSIST: "0",
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_ENABLE_DUPLEX_VOICE: "1",
        OPENDRSAI_ELECTRON_USER_DATA: userData,
        OPENDRSAI_E2E_DUPLEX_RECOVERY: "1",
        OPENDRSAI_E2E_DUPLEX_DISCONNECT_ONCE: "1",
        OPENDRSAI_E2E_RESULT: rawResult,
        OPENDRSAI_E2E_TIMEOUT_MS: "120000",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  assert.ok(existsSync(rawResult), `Packaged Duplex recovery did not write a result (exit ${code}).`);
  const result = JSON.parse(readFileSync(rawResult, "utf8"));
  const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const report = {
    schemaVersion: 1,
    kind: "packaged-duplex-recovery",
    ok: result.ok === true && code === 0,
    generatedAt: new Date().toISOString(),
    homeProfile: home.toLowerCase().endsWith(".drsai-dev") ? "development" : "production",
    runtimeProfile: "staged_candidate",
    fault: { domain: "network", injection: "close_first_gateway_realtime_socket_after_session_ready", occurrences: 1 },
    artifacts: { executable: { sha256: sha256(executable) }, appAsar: { sha256: sha256(archive) } },
    checks: result.checks ?? {},
    details: result.details ?? {},
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const summary = JSON.stringify({ error: result.error ?? null, checks: report.checks, details: report.details });
  assert.equal(code, 0, summary);
  assert.equal(result.ok, true, summary);
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
