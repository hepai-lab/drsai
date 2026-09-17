import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { deriveEvidenceStatus, verifyAcceptedEvidence } from "./codex-p9-evidence-policy.mjs";

const root = resolve(import.meta.dirname, "../../../..");
const generator = readFileSync(resolve(root, "apps/desktop/windows/scripts/generate-codex-p9-ledger.mjs"), "utf8");
const verifier = readFileSync(resolve(root, "apps/desktop/windows/scripts/verify-codex-p9-feature-ledger.mjs"), "utf8");
const releaseRunner = readFileSync(resolve(root, "apps/desktop/windows/scripts/verify-codex-p9-release.mjs"), "utf8");
const sourceScope = readFileSync(resolve(root, "apps/desktop/windows/scripts/codex-p9-source-scope.mjs"), "utf8");
const plan = readFileSync(resolve(root, "docs/remote_workespace/OpenDrSaiCodexAdapter_OAEP_P9真实增量与恢复闭环开发方案.md"), "utf8");
assert.equal([...plan.matchAll(/\| M\d{2}-F\d{2} \|/g)].length, 48);
assert(generator.includes("deriveEvidenceStatus(result, id)"));
assert(!generator.includes('{ status: "accepted"'));
for (const field of ["sourceDigest", "dirtyDigest", "buildDigest", "codexBinaryDigest", "codexVersion", "observedAt", "host"]) assert(verifier.includes(field));
assert(verifier.includes("result.features.includes(id)"));
assert(verifier.includes("row.artifactDigest !== digest"));
assert(verifier.includes("result.sourceDigest !== currentSourceDigest"));
assert(verifier.includes("assertion.passed !== true"));
for (const required of ["verifyElectronEvidence", "electron-ipc-main-preload-renderer", "latencyP95Ms",
  "verifyLiveEvidence", "evidenceDigest", "firstContentBeforeTerminal", "restartVerified"]) {
  assert(verifier.includes(required), `P9 ledger verifier omitted inspectable evidence check: ${required}`);
}
for (const required of ["parseStructuredResult", "relatedEvidence", "evidenceDigest"]) {
  assert(releaseRunner.includes(required), `P9 release runner omitted structured evidence capture: ${required}`);
}
for (const source of [verifier, releaseRunner]) {
  for (const derived of ["__pycache__", "pyc", "tsbuildinfo"]) {
    assert(source.includes(derived), `P9 source identity must exclude derived file class: ${derived}`);
  }
}
for (const source of [verifier, releaseRunner]) assert(source.includes("p9GitDiffArgs(root, planPath)"));
assert(sourceScope.includes("CODEX_P9_SOURCE_PATHS"));
assert(!sourceScope.includes("codex-adapter-p9-feature-ledger.json"),
  "machine-generated ledger must not invalidate its own source/dirty evidence");
for (const required of ["codex_adapter", "agent_bindings.py", "sessionViewStore.ts", "threadSnapshotPatch.ts",
  "codex-app-server-stable-contract.json", "test_codex_stable_contract.py", "App.tsx", "desktopApi.ts",
  "e2eSmoke.ts", "run-codex-p9-live.mjs", "verify-codex-p9-release.mjs"]) {
  assert(sourceScope.includes(required), `P9 evidence scope omitted ${required}`);
}
assert(sourceScope.includes('resolve(local, "OpenAI/Codex/bin")'),
  "P9 release evidence must prefer the same signed Codex Desktop binary as product Runtime");
assert.deepEqual(deriveEvidenceStatus(null, "M01-F01"), { status: "missing", reason: "evidence_missing" });
assert.equal(deriveEvidenceStatus({ blocked: true, features: ["M01-F01"] }, "M01-F01").status, "blocked");
assert.equal(deriveEvidenceStatus({ executed: true, status: 1, features: ["M01-F01"] }, "M01-F01").status, "failed");
assert.equal(deriveEvidenceStatus({ executed: true, status: 0, features: ["M01-F01"] }, "M01-F01").status, "accepted");
const identity = { sourceDigest: "source", dirtyDigest: "dirty" };
const result = { executed: true, status: 0, features: ["M01-F01"], assertions: [{ feature: "M01-F01", id: "real-assertion", passed: true }],
  commands: [{ command: "real command", status: 0 }], ...identity };
const bytes = Buffer.from(JSON.stringify(result));
const row = { artifactDigest: createHash("sha256").update(bytes).digest("hex") };
assert.equal(verifyAcceptedEvidence(row, bytes, "M01-F01", identity).status, 0);
assert.throws(() => verifyAcceptedEvidence({ artifactDigest: "tampered" }, bytes, "M01-F01", identity), /digest/);
assert.throws(() => verifyAcceptedEvidence(row, bytes, "M01-F01", { ...identity, sourceDigest: "changed" }), /identity/);
console.log("P9 fail-closed evidence contract verification passed.");
