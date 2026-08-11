import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(root, ".artifacts/codex-p10/results");
const resultFiles = ["p10-contract", "p10-input-session", "p10-errors", "p10-snapshot", "p10-approval",
  "p10-history", "p10-resources", "p10-bridge", "p10-architecture", "p10-electron", "p10-live",
  "p10-bridge-equivalence", "p10-user-journey", "p10-runner"];
const results = resultFiles.flatMap((name) => {
  const path = resolve(resultRoot, `${name}.json`); if (!existsSync(path)) return [];
  const bytes = readFileSync(path); try { return [{ name, path, digest: createHash("sha256").update(bytes).digest("hex"), value: JSON.parse(bytes) }]; }
  catch { return [{ name, path, digest: null, value: { status: 1, features: [] } }]; }
});
const current = results.find((row) => row.name === "p10-runner")?.value;
const features = {};
for (let module = 1; module <= 10; module += 1) for (let feature = 1; feature <= 6; feature += 1) {
  const id = `M${String(module).padStart(2, "0")}-F${String(feature).padStart(2, "0")}`;
  const evidence = [...results].reverse().find((row) => row.value.features?.includes(id));
  const identityCurrent = evidence && current
    && evidence.value.sourceDigest === current.sourceDigest && evidence.value.dirtyDigest === current.dirtyDigest
    && evidence.value.codexVersion === current.codexVersion && evidence.value.schemaDigest === current.schemaDigest
    && evidence.value.hostDigest === current.hostDigest;
  features[id] = evidence ? { status: evidence.value.status !== 0 ? "failed" : identityCurrent ? "passed" : "missing",
    suite: evidence.name, artifact: `.artifacts/codex-p10/results/${evidence.name}.json`, artifactDigest: evidence.digest,
    sourceDigest: evidence.value.sourceDigest, dirtyDigest: evidence.value.dirtyDigest,
    buildDigest: evidence.value.buildDigest, codexVersion: evidence.value.codexVersion,
    schemaDigest: evidence.value.schemaDigest, hostDigest: evidence.value.hostDigest,
    testDigest: createHash("sha256").update(JSON.stringify({
      commands: evidence.value.commands ?? [], assertions: evidence.value.assertions ?? [],
    })).digest("hex"),
    observedAt: evidence.value.observedAt,
    ...(!identityCurrent ? { reason: "evidence_identity_stale" } : {})
  } : { status: "missing", reason: "current_evidence_missing" };
}
const totals = Object.values(features).reduce((out, row) => ({ ...out, [row.status]: (out[row.status] ?? 0) + 1 }), {});
const output = resolve(root, "docs/remote_workespace/codex-adapter-p10-feature-ledger.json");
writeFileSync(output, `${JSON.stringify({ schema: "opendrsai.codex-adapter-p10.ledger.v1", total: 60,
  generatedAt: new Date().toISOString(), totals, features }, null, 2)}\n`);
if (current?.status === 0) {
  const manifestDirectory = resolve(root, ".artifacts/codex-p10");
  mkdirSync(manifestDirectory, { recursive: true });
  writeFileSync(resolve(manifestDirectory, "manifest.json"), `${JSON.stringify({
    schema: "opendrsai.codex-adapter-p10.release.v1",
    mode: current.mode,
    passed: totals.passed === 60,
    suites: results.filter((row) => row.name !== "p10-runner").map((row) => row.name),
    ledger: "docs/remote_workespace/codex-adapter-p10-feature-ledger.json",
    ledgerDigest: createHash("sha256").update(readFileSync(output)).digest("hex"),
    sourceDigest: current.sourceDigest,
    dirtyDigest: current.dirtyDigest,
    buildDigest: current.buildDigest,
    codexVersion: current.codexVersion,
    schemaDigest: current.schemaDigest,
    hostDigest: current.hostDigest,
    observedAt: current.observedAt,
  }, null, 2)}\n`);
}
console.log(JSON.stringify({ ledger: output, totals }));
