import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { macosPhase2FeatureRows, macosPhase2Modules } from "./macosPhase2Catalog.mjs";
import { macosPhase2Statuses } from "./macosPhase2Status.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const plan = readFileSync(resolve(root, "macos/docs/macos-phase-2-development-plan.zh-CN.md"), "utf8");
const adr = readFileSync(resolve(root, "macos/docs/adr/0001-electron-swift-helper.md"), "utf8");
const validLevels = new Set(["P2-L0", "P2-L1", "P2-L2", "P2-L3", "P2-L4", "P2-L5", "P2-L6"]);

assert.equal(macosPhase2Modules.length, 10, "P2 catalog must contain exactly 10 modules");
assert.equal(macosPhase2FeatureRows.length, 50, "P2 catalog must contain exactly 50 features");
assert.equal(new Set(macosPhase2FeatureRows.map((row) => row.featureId)).size, 50, "P2 feature IDs must be unique");
assert.equal(macosPhase2Statuses.length, 50, "P2 status ledger must contain exactly 50 features");
assert.equal(new Set(macosPhase2Statuses.map((row) => row.featureId)).size, 50, "P2 status feature IDs must be unique");
assert.deepEqual(macosPhase2Statuses.map((row) => row.featureId).sort(), macosPhase2FeatureRows.map((row) => row.featureId).sort());
assert.match(plan, /N=10 个模块、M=50 个功能点/);
assert.match(adr, /状态：Accepted/);
assert.match(adr, /sandbox: false/);

for (const [index, module] of macosPhase2Modules.entries()) {
  assert.equal(module.features.length, 5, `P2-MOD-${String(index + 1).padStart(2, "0")} must contain five features`);
}
for (const row of macosPhase2FeatureRows) {
  assert.match(row.featureId, /^P2-F(?:0[1-9]|10)\.[1-5]$/);
  assert.match(row.moduleId, /^P2-MOD-(?:0[1-9]|10)$/);
  assert.ok(plan.includes(`| ${row.featureId} |`), `${row.featureId} is absent from the phase-2 plan`);
  assert.ok(row.requirement && row.owner);
  assert.ok(row.requiredLevels.length > 0 && row.requiredLevels.every((level) => validLevels.has(level)), `${row.featureId} has invalid levels`);
  assert.ok(row.testIds.length > 0 && row.testIds.every((id) => /^(?:p2:|suite:)[a-z0-9-]+$/.test(id)), `${row.featureId} has invalid tests`);
  assert.ok(row.originalFeatureIds.every((id) => /^F(?:0[1-9]|1[0-2])\.[1-6]$/.test(id)), `${row.featureId} has invalid product mappings`);
}

console.log("macOS phase-2 catalog verified (10 modules, 50 features).");
