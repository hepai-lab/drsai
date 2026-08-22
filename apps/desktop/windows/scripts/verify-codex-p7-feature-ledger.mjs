import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../../..");
const planPath = resolve(root, "docs/remote_workespace/OpenDrSaiCodexAdapter_OAEP_P7收敛开发方案.md");
const ledgerPath = resolve(root, "docs/remote_workespace/codex-adapter-p7-feature-ledger.json");
const plan = await readFile(planPath, "utf8");
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const plannedIds = [...plan.matchAll(/\| (M\d{2}-F\d{2}) \|/g)].map((match) => match[1]);
assert.equal(new Set(plannedIds).size, 72, "P7 plan must contain 72 unique feature IDs");

const accepted = [];
const represented = [];
for (let moduleIndex = 1; moduleIndex <= 9; moduleIndex += 1) {
  const moduleId = `M${String(moduleIndex).padStart(2, "0")}`;
  const row = ledger.modules[moduleId];
  assert(row, `${moduleId} is missing from the ledger`);
  for (const status of ["accepted", "planned"]) {
    for (const feature of row[status]) {
      const id = `${moduleId}-${feature}`;
      represented.push(id);
      if (status === "accepted") accepted.push(id);
    }
  }
}
assert.deepEqual([...represented].sort(), [...plannedIds].sort(), "ledger and P7 plan feature IDs must match exactly");
assert.equal(new Set(represented).size, 72, "ledger feature IDs must be unique");
for (const id of accepted) {
  const evidence = ledger.evidence[id];
  assert(evidence?.test && evidence?.source, `${id} lacks executable evidence`);
  await readFile(resolve(root, evidence.source), "utf8");
}
assert.deepEqual(Object.keys(ledger.evidence).sort(), accepted.sort(), "evidence must map one-to-one to accepted features");
if (process.argv.includes("--require-complete")) assert.equal(accepted.length, 72, "P7 release requires 72/72 accepted features");
console.log(`Codex Adapter P7 ledger verified: ${accepted.length}/72 accepted.`);
