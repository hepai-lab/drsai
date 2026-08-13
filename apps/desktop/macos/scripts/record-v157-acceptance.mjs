import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "../../..");
const acceptance = join(root, "build", "acceptance");
const reports = join(root, "build", "reports");
const scope = process.argv[2];
const stageCommands = {
  source: ["verify:source-snapshot", "verify:v1.5.7-parity", "verify:contract", "verify:security-p2", "verify:defects", "verify:acceptance"],
  electron: ["build", "verify:coverage", "verify:macos-ux"],
  packaged: ["verify:build-output", "verify:packaged", "verify:model-provider-release-gate", "verify:packaged:l5"],
  device: ["verify:keychain-lock:device", "verify:sleep-wake:device", "verify:tcc:l6", "record:l4-evidence"],
  update: ["stage:update-lab-feed", "verify:online-update:l6", "record:signed-update-evidence"],
  release: ["preflight:release", "record:l5-evidence", "verify:model-provider-real", "record:stability-matrix", "verify:release:l6-auto", "record:l6-evidence", "verify:platform-evidence", "decide:release:required", "verify:oss-release-permissions", "verify:update-publish-plan"],
};
assert.ok(scope === "all" || stageCommands[scope], `Unknown v1.5.7 acceptance scope: ${scope ?? "<missing>"}`);
assert.equal(Number(process.versions.node.split(".")[0]), 22, `macOS v1.5.7 acceptance requires Node 22; received ${process.version}`);
const snapshot = JSON.parse(readFileSync(join(acceptance, "source-snapshot.json"), "utf8"));
const commit = git(["rev-parse", "HEAD"]).trim();
assert.equal(snapshot.commit, commit, "v1.5.7 acceptance source snapshot is stale");
assert.equal(snapshot.clean, true, "v1.5.7 acceptance requires a clean source snapshot");
assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all", "--", ...snapshot.scopes]).trim(), "", "v1.5.7 acceptance source scopes changed after snapshot");

const commands = scope === "all" ? Object.keys(stageCommands).map((stage) => `verify:v1.5.7:${stage}`) : stageCommands[scope];
if (scope === "all") for (const stage of Object.keys(stageCommands)) {
  const prior = JSON.parse(readFileSync(join(acceptance, `macos-v1.5.7-${stage}.json`), "utf8"));
  assert.equal(prior.passed, true, `v1.5.7 ${stage} receipt did not pass`);
  assert.equal(prior.commit, commit, `v1.5.7 ${stage} receipt is stale`);
  assert.equal(prior.sourceFingerprint, snapshot.aggregateSha256, `v1.5.7 ${stage} source fingerprint differs`);
}
const executable = join(root, "release", "mac-arm64", "OpenDrSai.app", "Contents", "MacOS", "OpenDrSai");
const receipt = {
  schemaVersion: 2,
  testId: `macos-v1.5.7-${scope}`,
  platform: `${process.platform}-${process.arch}`,
  version: "1.5.7",
  commit,
  sourceClean: true,
  sourceFingerprint: snapshot.aggregateSha256,
  appExecutableSha256: existsSync(executable) ? sha256(executable) : null,
  scope,
  status: "passed",
  expectedCommandCount: commands.length,
  passed: true,
  commands: commands.map((script) => ({ script, passed: true })),
  generatedAt: new Date().toISOString(),
};
mkdirSync(acceptance, { recursive: true });
mkdirSync(reports, { recursive: true });
writeFileSync(join(acceptance, `macos-v1.5.7-${scope}.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
const cases = commands.map((script) => `<testcase classname="macos.v1.5.7.${xml(scope)}" name="${xml(script)}"/>`).join("");
writeFileSync(join(reports, `macos-v1.5.7-${scope}.junit.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="macos-v1.5.7-${xml(scope)}" tests="${commands.length}" failures="0">${cases}</testsuite>\n`, "utf8");
console.log(`macOS v1.5.7 ${scope} acceptance recorded (${commands.length} required commands).`);

function git(args) { const result = spawnSync("/usr/bin/git", args, { cwd: repoRoot, encoding: "utf8" }); if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed`); return result.stdout; }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function xml(value) { return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
