import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe");
const archive = resolve(root, "release/win-unpacked/resources/app.asar");
const output = resolve(process.argv[2] ?? join(root, "release/duplex-voice/packaged-media-e2e.json"));
for (const path of [executable, archive]) assert.ok(existsSync(path), `Required packaged media input is missing: ${path}`);
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-duplex-media-"));
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
        OPENDRSAI_E2E_DUPLEX_MEDIA: "1",
        OPENDRSAI_E2E_RESULT: rawResult,
        OPENDRSAI_E2E_TIMEOUT_MS: "60000",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  assert.ok(existsSync(rawResult), `Packaged Duplex media test did not write a result (exit ${code}).`);
  const result = JSON.parse(readFileSync(rawResult, "utf8"));
  const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const report = {
    schemaVersion: 1,
    kind: "packaged-duplex-electron-media",
    ok: code === 0 && result.ok === true,
    generatedAt: new Date().toISOString(),
    inputProfile: "chromium-fake-device-through-real-electron-media-apis",
    artifacts: { executable: { sha256: sha256(executable) }, appAsar: { sha256: sha256(archive) } },
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
