import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRegressionReference } from "../main/regressionReferences.ts";

const home = mkdtempSync(join(tmpdir(), "opendrsai-regression-ref-"));
const evaluationId = "eval-00000000-0000-4000-8000-000000000001";
const directory = join(home, "regression", "agent-p4", "user-1", evaluationId);
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "summary.json"), "{}\n", "utf8");

assert.equal(
  resolveRegressionReference(home, `opendrsai://regression/evaluations/${evaluationId}/summary`),
  join(directory, "summary.json"),
);
assert.equal(resolveRegressionReference(home, "opendrsai://regression/evaluations/../../auth/summary"), null);
assert.equal(resolveRegressionReference(home, `https://example.com/${evaluationId}`), null);
assert.equal(resolveRegressionReference(home, `opendrsai://regression/evaluations/${evaluationId}/raw`), null);

console.log("Regression reference resolver verified.");
