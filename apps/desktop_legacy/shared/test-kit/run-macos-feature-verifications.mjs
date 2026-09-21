import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit, worktreeFingerprint } from "./acceptanceEvidence.mjs";
import { macosVerificationSuiteDefinition, macosVerificationSuites } from "./macosVerificationSuites.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const macosRoot = resolve(desktopRoot, "macos");
const output = resolve(macosRoot, "build/acceptance/feature-test-results.json");
assert.equal(new Set(macosVerificationSuites.map((suite) => suite.id)).size, macosVerificationSuites.length, "verification suite IDs must be unique");
const commit = currentCommit(repoRoot);
const fingerprintBefore = worktreeFingerprint(repoRoot);
const results = [];
mkdirSync(dirname(output), { recursive: true });

for (const suite of macosVerificationSuites) {
  const started = Date.now();
  const hash = createHash("sha256");
  const result = await run(suite, hash);
  const definition = macosVerificationSuiteDefinition(suite);
  results.push({
    testId: suite.id,
    passed: result.code === 0,
    skipped: false,
    exitCode: result.code,
    durationMs: Date.now() - started,
    outputSha256: hash.digest("hex"),
    aspects: suite.aspects,
    entryFile: suite.entryFile,
    entrySourceSha256: createHash("sha256").update(readFileSync(resolve(macosRoot, suite.entryFile))).digest("hex"),
    definitionSha256: createHash("sha256").update(JSON.stringify(definition)).digest("hex"),
  });
  writeReport();
  if (result.code !== 0) throw new Error(`${suite.id} failed with exit code ${result.code}`);
}
assert.equal(worktreeFingerprint(repoRoot), fingerprintBefore, "tracked/untracked source changed while feature suites executed");
writeReport();
console.log(`macOS feature verification receipts passed: ${results.length}/${macosVerificationSuites.length}.`);

function writeReport() {
  writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, commit, worktreeFingerprint: fingerprintBefore, platform: `${process.platform}-${process.arch}`, passed: results.length === macosVerificationSuites.length && results.every((result) => result.passed), generatedAt: new Date().toISOString(), tests: results }, null, 2)}\n`, "utf8");
}

function run(suite, hash) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(suite.command, suite.args, { cwd: macosRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const forward = (stream, target) => stream.on("data", (chunk) => { hash.update(chunk); target.write(chunk); });
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code: code ?? 1 }));
  });
}
