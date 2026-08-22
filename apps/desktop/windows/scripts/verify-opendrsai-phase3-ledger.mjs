import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const ledgerPath = resolve(repoRoot, "docs/desktop/evidence/opendrsai-windows-phase3-acceptance-ledger.json");
const planPath = resolve(repoRoot, "docs/desktop/opendrsai-windows-full-agent-runtime-phase3-product-completion-plan.md");
const allowedStatuses = new Set(["pending", "in_progress", "implemented", "accepted"]);

function fail(message) {
  console.error(`OpenDrSai Windows P3 ledger verification failed: ${message}`);
  process.exitCode = 1;
}

if (!existsSync(ledgerPath)) {
  fail(`missing ledger: ${ledgerPath}`);
} else if (!existsSync(planPath)) {
  fail(`missing plan: ${planPath}`);
} else {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const plan = readFileSync(planPath, "utf8");
  const expectedIds = [];
  for (let module = 1; module <= 10; module += 1) {
    for (let feature = 1; feature <= 5; feature += 1) {
      expectedIds.push(`M${String(module).padStart(2, "0")}-F${String(feature).padStart(2, "0")}`);
    }
  }
  const features = Array.isArray(ledger.features) ? ledger.features : [];
  const actualIds = features.map((feature) => feature?.id);
  if (ledger.schema_version !== "opendrsai.windows.phase3.acceptance-ledger/1") fail("unexpected schema_version");
  if (ledger.release_gate !== "fail_closed") fail("release_gate must be fail_closed");
  if (ledger.feature_count !== 50 || features.length !== 50) fail("ledger must contain exactly 50 features");
  if (new Set(actualIds).size !== actualIds.length) fail("feature ids must be unique");
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) fail("feature ids or ordering differ from M01-F01..M10-F05");

  const planIds = [...plan.matchAll(/^\| (M\d{2}-F\d{2}) \|/gm)].map((match) => match[1]);
  if (JSON.stringify(planIds) !== JSON.stringify(expectedIds)) fail("plan must define the same ordered 50 feature ids");

  for (const feature of features) {
    if (!allowedStatuses.has(feature.status)) fail(`${feature.id} has unsupported status ${feature.status}`);
    const serialized = JSON.stringify(feature).toLowerCase();
    if (serialized.includes("codex")) fail(`${feature.id} uses out-of-scope Codex evidence`);
    if (feature.status === "accepted") {
      for (const field of ["implementation", "tests", "evidence"]) {
        if (!Array.isArray(feature[field]) || feature[field].length === 0) {
          fail(`${feature.id} is accepted without ${field}`);
          continue;
        }
        for (const relativePath of feature[field]) {
          if (typeof relativePath !== "string" || !relativePath.trim()) {
            fail(`${feature.id} contains an invalid ${field} path`);
          } else if (!existsSync(resolve(repoRoot, relativePath))) {
            fail(`${feature.id} references missing ${field} path ${relativePath}`);
          }
        }
      }
      if (typeof feature.acceptance !== "object" || feature.acceptance?.passed !== true) {
        fail(`${feature.id} is accepted without a passing acceptance record`);
      }
    }
  }

  const accepted = features.filter((feature) => feature.status === "accepted").length;
  const percent = Math.floor((accepted * 10000) / 50) / 100;
  if (ledger.progress?.accepted !== accepted || ledger.progress?.percent !== percent) {
    fail(`progress must equal accepted features (${accepted}/50, ${percent}%)`);
  }
  if (!process.exitCode) {
    console.log(`OpenDrSai Windows P3 ledger verified: ${accepted}/50 accepted (${percent}%).`);
  }
}
