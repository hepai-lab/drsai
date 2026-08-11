import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../../../..");
const ledgerPath = resolve(repository, "docs/desktop/evidence/agent-runtime-editable-phase2-acceptance-ledger.json");
const outputPath = resolve(import.meta.dirname, "../resources/release/experiment-release-gate.json");
const required = ["M31-02", "M31-03", "M31-04", "M31-05"];
if (!existsSync(ledgerPath)) throw new Error(`Phase 2 acceptance ledger is missing: ${ledgerPath}`);
const source = readFileSync(ledgerPath);
const ledger = JSON.parse(source.toString("utf8"));
const byId = new Map((Array.isArray(ledger.features) ? ledger.features : []).map((feature) => [feature?.id, feature]));
const passed = required.filter((id) => byId.get(id)?.status === "passed");
const blocking = required.filter((id) => !passed.includes(id));
const resource = {
  schema_version: "opendrsai.experiment-release-gate/1",
  enabled: blocking.length === 0,
  required_features: required,
  passed_features: passed,
  blocking_features: blocking,
  source_ledger_sha256: createHash("sha256").update(source).digest("hex"),
  reason: blocking.length === 0 ? "all_release_evidence_passed" : "release_evidence_incomplete",
};
const serialized = `${JSON.stringify(resource, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== serialized) {
    throw new Error("Experiment release gate resource is missing or stale. Regenerate it before building.");
  }
  console.log(`Experiment release gate verified: enabled=${resource.enabled}; blocking=${blocking.join(",") || "none"}.`);
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== serialized) writeFileSync(outputPath, serialized, "utf8");
  console.log(`Experiment release gate generated: enabled=${resource.enabled}; blocking=${blocking.join(",") || "none"}.`);
}
