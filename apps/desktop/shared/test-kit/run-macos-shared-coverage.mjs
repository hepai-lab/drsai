import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testKitRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(testKitRoot, "../..");
const macosRoot = resolve(desktopRoot, "macos");
const coverageRoot = resolve(macosRoot, "build/acceptance/coverage");
const c8 = resolve(desktopRoot, "node_modules/c8/bin/c8.js");
const suiteRunner = resolve(testKitRoot, "run-macos-feature-verifications.mjs");
const verifier = resolve(testKitRoot, "verify-macos-shared-coverage.mjs");
const integrityVerifier = resolve(testKitRoot, "verify-macos-coverage-integrity.mjs");

assert(coverageRoot.startsWith(resolve(macosRoot, "build/acceptance") + "\\") || coverageRoot.startsWith(resolve(macosRoot, "build/acceptance") + "/"), "unsafe coverage output path");
rmSync(coverageRoot, { recursive: true, force: true });
mkdirSync(coverageRoot, { recursive: true });

const coverage = spawnSync(process.execPath, [
  c8,
  "--clean",
  "--temp-directory", resolve(coverageRoot, "tmp"),
  "--report-dir", resolve(coverageRoot, "raw"),
  "--reporter=json",
  process.execPath,
  suiteRunner,
], {
  cwd: macosRoot,
  env: { ...process.env, OPENDRSAI_COVERAGE_BUNDLE_DIR: resolve(coverageRoot, "bundles") },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(coverage.stdout ?? "");
process.stderr.write(coverage.stderr ?? "");
assert.equal(coverage.status, 0, `feature verification under c8 failed with exit code ${coverage.status}`);

const verification = spawnSync(process.execPath, [verifier], { cwd: macosRoot, encoding: "utf8" });
process.stdout.write(verification.stdout ?? "");
process.stderr.write(verification.stderr ?? "");
assert.equal(verification.status, 0, `coverage threshold verification failed with exit code ${verification.status}`);

const integrity = spawnSync(process.execPath, [integrityVerifier], { cwd: macosRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
process.stdout.write(integrity.stdout ?? "");
process.stderr.write(integrity.stderr ?? "");
assert.equal(integrity.status, 0, `coverage receipt integrity failed with exit code ${integrity.status}`);
if (process.env.OPENDRSAI_V157_RECORD_SCOPE) {
  const recorder = resolve(macosRoot, "scripts/record-v157-acceptance.mjs");
  const recorded = spawnSync(process.execPath, [recorder, process.env.OPENDRSAI_V157_RECORD_SCOPE], { cwd: macosRoot, encoding: "utf8" });
  process.stdout.write(recorded.stdout ?? "");
  process.stderr.write(recorded.stderr ?? "");
  assert.equal(recorded.status, 0, `v1.5.7 acceptance recorder failed with exit code ${recorded.status}`);
}
