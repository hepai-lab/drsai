import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const executable = join(root, "release/win-unpacked/OpenDrSai.exe");
const appAsar = join(root, "release/win-unpacked/resources/app.asar");
const backendZip = join(root, "release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip");
const python = join(repo, ".venv/Scripts/python.exe");
const probe = join(root, "scripts/probe-m06-side-effect-ledger.py");
for (const path of [executable, appAsar, backendZip, python, probe]) if (!existsSync(path)) throw new Error(`M06-F03 packaged dependency is missing: ${path}`);

const evidenceDir = join(root, "release/product-evidence/m06-side-effect-ledger");
mkdirSync(evidenceDir, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-m06-packaged-"));
try {
  const completed = spawnSync(python, [probe], {
    cwd: repo, encoding: "utf8", windowsHide: true,
    env: { ...process.env, PYTHONPATH: [backendZip, process.env.PYTHONPATH].filter(Boolean).join(delimiter), DRSAI_HOME: join(temporary, "runtime-home") },
    timeout: 120_000,
  });
  if (completed.status !== 0) throw new Error(`M06-F03 packaged probe failed.\n${completed.stdout}\n${completed.stderr}`);
  const line = completed.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  const result = JSON.parse(line || "{}");
  if (result.ok !== true || result.checkCount !== 10 || !Object.values(result.checks || {}).every(Boolean)) {
    throw new Error(`M06-F03 packaged acceptance failed.\n${JSON.stringify(result, null, 2)}`);
  }
  const summary = {
    ok: true, checks: result.checkCount, configuredRetries: 0, actualRetries: 0,
    packagedBackendSha256: sha256(backendZip), executableSha256: sha256(executable), appAsarSha256: sha256(appAsar),
    crashPoint: "after approval commit and before tool write", effectCount: 1,
    duplicateBlocked: result.checks.duplicateBlocked, unknownOutcomeBlocked: result.checks.unknownOutcomeBlocked,
  };
  writeFileSync(join(evidenceDir, "packaged-m06-side-effect-ledger-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`M06-F03 packaged side-effect ledger passed ${summary.checks}/${summary.checks} checks.`);
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase(); }
