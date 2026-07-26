import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("macOS platform evidence must be recorded on Apple Silicon macOS.");
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const acceptanceRoot = resolve(desktopRoot, "macos/build/acceptance");
const source = read("source-snapshot.json");
const runtime = read("runtime-reproducibility.json");
const packaged = read("packaged-smoke.json");
assert.equal(source.clean, true, "L4 evidence requires a clean source snapshot");
assert.equal(runtime.passed, true);
assert.equal(packaged.passed, true);
assert.equal(runtime.schemaVersion, 2); assert.equal(packaged.schemaVersion, 2);
const featureIds = verifiedFeatureIds([runtime, packaged]);
assert.equal(runtime.platform, "darwin-arm64");
assert.equal(packaged.platform, "darwin-arm64");
const artifactPaths = [
  resolve(acceptanceRoot, "runtime-reproducibility.json"),
  resolve(acceptanceRoot, "packaged-smoke.json"),
  resolve(desktopRoot, "macos/resources/runtime/runtime-manifest.json"),
  resolve(desktopRoot, "macos/release/mac-arm64/OpenDrSai.app/Contents/MacOS/OpenDrSai"),
];
for (const path of artifactPaths) assert.ok(existsSync(path), `L4 artifact missing: ${path}`);
const report = {
  schemaVersion: 2,
  level: "L4",
  commit: source.commit,
  sourceTree: source.tree,
  sourceAggregateSha256: source.aggregateSha256,
  platform: "darwin-arm64",
  runner: process.env.RUNNER_NAME || "local-apple-silicon",
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  passed: true,
  featureIds,
  tests: [runtime, packaged].map((item) => ({ testId: item.testId, passed: item.passed, featureIds: item.featureIds })),
  artifacts: artifactPaths.map((path) => ({ path: path.replace(desktopRoot, "").replace(/^[/\\]/, "").replace(/\\/g, "/"), size: readFileSync(path).length, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  generatedAt: new Date().toISOString(),
};
writeFileSync(resolve(acceptanceRoot, "macos-l4-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`macOS L4 evidence recorded for ${report.commit}: ${report.sourceAggregateSha256}`);

function read(name) { return JSON.parse(readFileSync(resolve(acceptanceRoot, name), "utf8")); }
function verifiedFeatureIds(receipts) { const ids = [...new Set(receipts.flatMap((item) => item.featureIds ?? []))].sort(); assert.ok(ids.length > 0 && ids.every((id) => /^F(?:0[1-9]|1[0-2])\.[1-6]$/.test(id)), "L4 receipts require valid featureIds"); return ids; }
