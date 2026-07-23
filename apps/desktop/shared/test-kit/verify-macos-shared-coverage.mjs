import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit, worktreeFingerprint } from "./acceptanceEvidence.mjs";
import { coreStateMachineSources, coverageThresholds, integrationAdapterSources, sharedBusinessSources } from "./macosCoveragePolicy.mjs";

const require = createRequire(import.meta.url);
const { createCoverageMap } = require("istanbul-lib-coverage");
const testKitRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(testKitRoot, "../..");
const repositoryRoot = resolve(desktopRoot, "../..");
const sharedMainRoot = resolve(desktopRoot, "shared/main");
const coverageRoot = resolve(desktopRoot, "macos/build/acceptance/coverage");
const inputPath = resolve(coverageRoot, "raw/coverage-final.json");
const outputPath = resolve(coverageRoot, "shared-business-summary.json");
const featureReceiptPath = resolve(desktopRoot, "macos/build/acceptance/feature-test-results.json");

assert(existsSync(inputPath), `Missing c8 JSON report: ${inputPath}`);
assert.equal(new Set(sharedBusinessSources).size, sharedBusinessSources.length, "shared business coverage sources must be unique");
assert.equal(new Set(coreStateMachineSources).size, coreStateMachineSources.length, "core state-machine coverage sources must be unique");
assert.equal(new Set(integrationAdapterSources).size, integrationAdapterSources.length, "integration adapter coverage sources must be unique");
for (const source of coreStateMachineSources) assert(sharedBusinessSources.includes(source), `core state-machine source is outside shared business scope: ${source}`);
const allPolicySources = [...new Set([...sharedBusinessSources, ...integrationAdapterSources])];
for (const source of allPolicySources) assert(existsSync(resolve(sharedMainRoot, source)), `coverage policy source does not exist: ${source}`);
assert(existsSync(featureReceiptPath), `Missing feature-suite receipt: ${featureReceiptPath}`);

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const bySource = new Map();
for (const [absolutePath, coverage] of Object.entries(raw)) {
  const source = relative(sharedMainRoot, absolutePath).replace(/\\/g, "/");
  if (!source.startsWith("../") && source !== "..") bySource.set(source, coverage);
}

function aggregate(sources) {
  const map = createCoverageMap({});
  for (const source of sources) {
    const coverage = bySource.get(source);
    assert(coverage, `coverage report is missing an in-scope source: ${source}`);
    map.addFileCoverage(coverage);
  }
  return map.getCoverageSummary().toJSON();
}

const business = aggregate(sharedBusinessSources);
const core = aggregate(coreStateMachineSources);
const adapters = aggregate(integrationAdapterSources);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceSha256 = Object.fromEntries(allPolicySources.map((source) => [source, sha256(readFileSync(resolve(sharedMainRoot, source)))]));
const scopeSha256 = sha256(JSON.stringify({ sharedBusinessSources, coreStateMachineSources, integrationAdapterSources }));
const passed = business.lines.pct >= coverageThresholds.sharedBusinessLines
  && core.branches.pct >= coverageThresholds.coreStateMachineBranches
  && adapters.lines.pct >= coverageThresholds.integrationAdapterLines;
const receipt = {
  schemaVersion: 1,
  commit: currentCommit(repositoryRoot),
  worktreeFingerprint: worktreeFingerprint(repositoryRoot),
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  passed,
  thresholds: coverageThresholds,
  integrity: {
    scopeSha256,
    rawCoverageSha256: sha256(readFileSync(inputPath)),
    featureTestReceiptSha256: sha256(readFileSync(featureReceiptPath)),
    sourceSha256,
  },
  scopes: {
    sharedBusiness: { files: sharedBusinessSources.length, sources: sharedBusinessSources, summary: business },
    coreStateMachines: { files: coreStateMachineSources.length, sources: coreStateMachineSources, summary: core },
    integrationAdapters: { files: integrationAdapterSources.length, sources: integrationAdapterSources, summary: adapters },
  },
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

console.log(`Shared business line coverage: ${business.lines.pct}% (required ${coverageThresholds.sharedBusinessLines}%).`);
console.log(`Core state-machine branch coverage: ${core.branches.pct}% (required ${coverageThresholds.coreStateMachineBranches}%).`);
console.log(`Integration adapter line coverage: ${adapters.lines.pct}% (required ${coverageThresholds.integrationAdapterLines}%).`);
assert(passed, `Coverage gate failed; inspect ${relative(desktopRoot, outputPath).replace(/\\/g, "/")}`);
console.log(`macOS shared coverage gate passed (${basename(outputPath)}).`);
