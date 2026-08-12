import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const acceptance = join(root, "build", "acceptance");
const reports = join(root, "build", "reports");
const requested = process.argv[2];
const stageOrder = ["source", "electron", "packaged", "device", "update", "release"];
assert.ok(requested === "all" || stageOrder.includes(requested), `Unknown v1.5.7 acceptance stage: ${requested ?? "<missing>"}`);
assert.equal(Number(process.versions.node.split(".")[0]), 22, `macOS v1.5.7 acceptance requires Node 22; received ${process.version}`);

const commands = {
  source: [
    "verify:source-snapshot",
    "verify:v1.5.7-parity",
    "verify:contract",
    "verify:security-p2",
    "verify:defects",
    "verify:acceptance",
  ],
  electron: ["build", "verify:renderer-l3", "verify:macos-ux", "verify:coverage"],
  packaged: [
    "verify:build-output",
    "verify:packaged",
    "verify:model-provider-release-gate",
    "verify:packaged:l5",
  ],
  device: ["verify:keychain-lock:device", "verify:sleep-wake:device", "verify:tcc:l6", "record:l4-evidence"],
  update: ["stage:update-lab-feed", "verify:online-update:l6", "record:signed-update-evidence"],
  release: [
    "preflight:release",
    "record:l5-evidence",
    "verify:model-provider-real",
    "record:stability-matrix",
    "verify:release:l6-auto",
    "record:l6-evidence",
    "verify:platform-evidence",
    "decide:release:required",
    "verify:oss-release-permissions",
    "verify:update-publish-plan",
  ],
};

const stages = requested === "all" ? stageOrder : [requested];
const results = [];
let failure;
for (const stage of stages) {
  for (const script of commands[stage]) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const child = spawnSync(process.env.npm_execpath || "npm", ["run", script], {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    const passed = !child.error && child.status === 0;
    results.push({ stage, script, passed, startedAt, durationMs: Date.now() - started, exitCode: child.status });
    writeReports(requested, results, passed ? undefined : child.error?.message || `${script} exited with ${child.status}`);
    if (!passed) {
      failure = new Error(`macOS v1.5.7 ${stage} acceptance failed at npm run ${script}`);
      break;
    }
  }
  if (failure) break;
}

writeReports(requested, results, failure?.message);
if (failure) throw failure;
console.log(`macOS v1.5.7 ${requested} acceptance passed (${results.length} commands).`);

function writeReports(scope, commandResults, error) {
  mkdirSync(acceptance, { recursive: true });
  mkdirSync(reports, { recursive: true });
  const passed = !error && commandResults.length > 0 && commandResults.every((item) => item.passed);
  const bindings = evidenceBindings();
  const receipt = {
    schemaVersion: 1,
    testId: `macos-v1.5.7-${scope}`,
    platform: `${process.platform}-${process.arch}`,
    version: "1.5.7",
    ...bindings,
    scope,
    passed,
    error: error || null,
    commands: commandResults,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(acceptance, `macos-v1.5.7-${scope}.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const failures = commandResults.filter((item) => !item.passed).length + (error && commandResults.every((item) => item.passed) ? 1 : 0);
  const cases = commandResults.map((item) => `<testcase classname="macos.v1.5.7.${escapeXml(item.stage)}" name="${escapeXml(item.script)}" time="${(item.durationMs / 1000).toFixed(3)}">${item.passed ? "" : `<failure message="${escapeXml(error || `exit ${item.exitCode}`)}"/>`}</testcase>`).join("");
  writeFileSync(join(reports, `macos-v1.5.7-${scope}.junit.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="macos-v1.5.7-${escapeXml(scope)}" tests="${commandResults.length}" failures="${failures}">${cases}</testsuite>\n`, "utf8");
}

function evidenceBindings() {
  const snapshotPath = join(acceptance, "source-snapshot.json");
  let snapshot = {};
  try { snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")); } catch { /* source stage may not have produced it yet */ }
  const executable = join(root, "release", "mac-arm64", "OpenDrSai.app", "Contents", "MacOS", "OpenDrSai");
  return {
    commit: typeof snapshot.commit === "string" ? snapshot.commit : null,
    sourceClean: snapshot.clean === true,
    sourceFingerprint: typeof snapshot.aggregateSha256 === "string" ? snapshot.aggregateSha256 : null,
    appExecutableSha256: existsSync(executable) ? createHash("sha256").update(readFileSync(executable)).digest("hex") : null,
  };
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
