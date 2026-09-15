import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe");
const output = resolve(process.argv[2] ?? join(root, "release/duplex-voice/voice-preferences-multi-window-e2e.json"));
assert.ok(existsSync(executable), `Packaged executable is missing: ${executable}`);

const temporary = mkdtempSync(join(tmpdir(), "opendrsai-voice-preferences-multi-window-"));
const rawResult = join(temporary, "result.json");
try {
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(executable, [], {
      cwd: root,
      env: {
        ...process.env,
        DRSAI_HOME: join(temporary, ".drsai-dev"),
        OPENDRSAI_ELECTRON_USER_DATA: join(temporary, "electron-user-data"),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_DISABLE_GPU: "1",
        OPENDRSAI_E2E_VOICE_PREFERENCES_MULTI_WINDOW: "1",
        OPENDRSAI_E2E_RESULT: rawResult,
        OPENDRSAI_E2E_TIMEOUT_MS: "60000",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  assert.ok(existsSync(rawResult), `Packaged multi-window test did not write a result (exit ${code}).`);
  const result = JSON.parse(readFileSync(rawResult, "utf8"));
  const report = {
    schemaVersion: 1,
    kind: "packaged-voice-preferences-multi-window",
    ok: code === 0 && result.ok === true,
    generatedAt: new Date().toISOString(),
    checks: result.checks ?? {},
    details: result.details ?? {},
    ...(result.error ? { error: result.error } : {}),
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assert.equal(code, 0, JSON.stringify(report));
  assert.equal(result.ok, true, JSON.stringify(report));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
