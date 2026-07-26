import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentCommit, worktreeFingerprint } from "./acceptanceEvidence.mjs";
import { macosPhase2FeatureRows } from "./macosPhase2Catalog.mjs";
import { macosPhase2Statuses } from "./macosPhase2Status.mjs";

const desktopRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const allowed = new Set(["accepted", "implemented_unsigned", "in_progress", "not_started", "blocked_on_signing"]);
assert.equal(macosPhase2FeatureRows.length, 50);
assert.equal(macosPhase2Statuses.length, 50);
const statusMap = new Map(macosPhase2Statuses.map((item) => [item.featureId, item.status]));
assert.equal(statusMap.size, 50);
const features = macosPhase2FeatureRows.map((row) => {
  const status = statusMap.get(row.featureId);
  assert.ok(allowed.has(status), `${row.featureId} has invalid or missing status`);
  return { featureId: row.featureId, moduleId: row.moduleId, requirement: row.requirement, owner: row.owner, requiredLevels: row.requiredLevels, testIds: row.testIds, originalFeatureIds: row.originalFeatureIds, status };
});
const summary = Object.fromEntries([...allowed].map((status) => [status, features.filter((item) => item.status === status).length]));
assert.equal(Object.values(summary).reduce((sum, value) => sum + value, 0), 50);
const modules = [...new Set(features.map((item) => item.moduleId))].map((moduleId) => {
  const rows = features.filter((item) => item.moduleId === moduleId);
  return { moduleId, summary: Object.fromEntries([...allowed].map((status) => [status, rows.filter((item) => item.status === status).length])) };
});
const report = { schemaVersion: 1, commit: currentCommit(repoRoot), worktreeFingerprint: worktreeFingerprint(repoRoot), platform: `${process.platform}-${process.arch}`, summary, modules, features, generatedAt: new Date().toISOString() };
const output = resolve(desktopRoot, "macos/build/acceptance/macos-phase-2-acceptance.json");
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`macOS P2 status recorded: ${Object.entries(summary).map(([key, value]) => `${key}=${value}`).join(", ")}.`);
