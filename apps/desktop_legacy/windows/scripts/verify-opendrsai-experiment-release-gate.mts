import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertExperimentReleaseEnabled,
  evaluateExperimentReleaseGateResource,
  EXPERIMENT_RELEASE_GATE_FEATURES,
} from "../../shared/main/experimentReleaseGate.ts";

const root = process.cwd();
const digest = "a".repeat(64);
const partial = evaluateExperimentReleaseGateResource({
  schema_version: "opendrsai.experiment-release-gate/1",
  enabled: true,
  passed_features: ["M31-03"],
  source_ledger_sha256: digest,
});
assert.equal(partial.enabled, false, "a forged enabled bit must not bypass missing release evidence");
assert.deepEqual(partial.blocking_features, ["M31-02", "M31-04", "M31-05"]);
assert.throws(() => assertExperimentReleaseEnabled(partial), (error: unknown) => {
  const row = error as Error & { code?: string; detail?: { blocking_features?: string[] } };
  return row.code === "experiment_release_gate_blocked"
    && row.detail?.blocking_features?.join(",") === "M31-02,M31-04,M31-05";
});

const complete = evaluateExperimentReleaseGateResource({
  schema_version: "opendrsai.experiment-release-gate/1",
  enabled: false,
  passed_features: [...EXPERIMENT_RELEASE_GATE_FEATURES],
  source_ledger_sha256: digest,
});
assert.equal(complete.enabled, true, "all four bound release features must open the gate regardless of a stale serialized bit");
assert.deepEqual(complete.blocking_features, []);
assert.doesNotThrow(() => assertExperimentReleaseEnabled(complete));

for (const invalid of [null, {}, { schema_version: "future/2" }, {
  schema_version: "opendrsai.experiment-release-gate/1",
  passed_features: [...EXPERIMENT_RELEASE_GATE_FEATURES],
  source_ledger_sha256: "not-a-digest",
}]) {
  assert.equal(evaluateExperimentReleaseGateResource(invalid).enabled, false, "missing, future, or unbound evidence must fail closed");
}

const generated = JSON.parse(await readFile(resolve(root, "resources/release/experiment-release-gate.json"), "utf8"));
const current = evaluateExperimentReleaseGateResource(generated);
assert.equal(current.enabled, false, "the current P2 evidence is incomplete and must keep Experiment disabled");
assert.deepEqual(current.passed_features, ["M31-03"]);
assert.deepEqual(current.blocking_features, ["M31-02", "M31-04", "M31-05"]);

const app = await readFile(resolve(root, "../shared/renderer/src/App.tsx"), "utf8");
assert(app.includes("!experimentReleaseGate.enabled ? undefined"), "the chat entry must be hidden while the release gate is closed");
assert(app.includes("detail.createExperiment === true && experimentReleaseGate.enabled"), "deep links must not bypass the release gate");
const main = await readFile(resolve(root, "src/main/index.ts"), "utf8");
assert(main.includes('secureHandle("desktop:experiment-release-gate"'), "the gate state IPC is missing");
const guardedOperations = [
  "desktop:run-experiment-create", "desktop:run-experiment-capabilities", "desktop:run-experiment-candidate-snapshot",
  "desktop:run-experiment-get", "desktop:run-experiment-export", "desktop:run-experiment-update", "desktop:run-experiment-delete",
  "desktop:replay-plan-create", "desktop:replay-plan-get", "desktop:replay-plan-execute",
  "desktop:run-comparison-create", "desktop:run-comparison-get", "desktop:worktree-adoption-preview", "desktop:worktree-adoption-apply",
  "desktop:run-adoption-preview", "desktop:run-adoption-apply", "desktop:run-adoption-discard",
];
for (const operation of guardedOperations) {
  const start = main.indexOf(`secureHandle("${operation}"`);
  const next = main.indexOf("secureHandle(\"", start + 20);
  assert(start >= 0, `${operation} is missing`);
  assert(main.slice(start, next < 0 ? main.length : next).includes("await requireExperimentReleaseGate()"), `${operation} is not fail-closed`);
}

console.log("OpenDrSai Experiment release gate verification passed.", {
  currentEnabled: current.enabled,
  passed: current.passed_features,
  blocking: current.blocking_features,
  guardedOperations: guardedOperations.length,
});
