import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveEvidenceStatus } from "./codex-p9-evidence-policy.mjs";

const root = resolve(import.meta.dirname, "../../../..");
const planName = "OpenDrSaiCodexAdapter_OAEP_P9真实增量与恢复闭环开发方案.md";
const planPath = resolve(root, "docs/remote_workespace", planName);
const plan = readFileSync(planPath, "utf8");
const ids = [...plan.matchAll(/\| (M\d{2}-F\d{2}) \|/g)].map((match) => match[1]);
if (ids.length !== 48 || new Set(ids).size !== 48) throw new Error("P9 plan must contain exactly 48 unique feature IDs.");

const suiteByModule = {
  M01: "p9-evidence", M02: "p9-binding", M03: "p9-snapshot",
  M04: "p9-patch", M05: "p9-models", M06: "p9-sync-identity",
  M07: "p9-ux-security", M08: "p9-release",
};
const sourceByModule = {
  M01: "apps/desktop/windows/scripts/verify-codex-p9-feature-ledger.mjs",
  M02: "cores/python/packages/drsai/src/drsai/backend/runtime/agent_bindings.py",
  M03: "apps/desktop/shared/renderer/src/threadSnapshotPatch.ts",
  M04: "apps/desktop/shared/main/sessionViewStore.ts",
  M05: "cores/python/packages/drsai/src/drsai/backend/codex_adapter/models.py",
  M06: "apps/desktop/shared/main/sessionHistorySync.ts",
  M07: "apps/desktop/shared/renderer/src/App.tsx",
  M08: "apps/desktop/windows/scripts/verify-codex-p9-release.mjs",
};
const liveFeatures = new Set(["M01-F04", "M08-F05"]);
const electronFeatures = new Set(["M01-F05", "M08-F04"]);
const governanceFeatures = new Set(["M08-F01", "M08-F02", "M08-F03"]);
const features = {};
for (const id of ids) {
  const moduleId = id.slice(0, 3);
  const suite = liveFeatures.has(id) ? "p9-live"
    : electronFeatures.has(id) ? "p9-electron"
    : governanceFeatures.has(id) ? "p9-governance"
    : suiteByModule[moduleId];
  const artifactPath = `.artifacts/codex-p9/results/${suite}.json`;
  const absoluteArtifact = resolve(root, artifactPath);
  let status = "missing";
  let artifactDigest = null;
  let reason = "evidence_missing";
  if (existsSync(absoluteArtifact)) {
    const bytes = readFileSync(absoluteArtifact);
    artifactDigest = createHash("sha256").update(bytes).digest("hex");
    try {
      const result = JSON.parse(bytes.toString("utf8"));
      ({ status, reason } = deriveEvidenceStatus(result, id));
    } catch {
      status = "failed";
      reason = "artifact_invalid";
    }
  }
  features[id] = { status, source: liveFeatures.has(id)
    ? "apps/desktop/windows/scripts/run-codex-p9-live.mjs" : sourceByModule[moduleId],
    suite, artifact: artifactPath, artifactDigest, ...(reason ? { reason } : {}) };
}
const totals = Object.values(features).reduce((value, row) => ({ ...value,
  [row.status]: (value[row.status] || 0) + 1 }), {});
const output = resolve(root, "docs/remote_workespace/codex-adapter-p9-feature-ledger.json");
writeFileSync(output, `${JSON.stringify({ schema: "opendrsai.codex-adapter-p9.ledger.v1",
  plan: `docs/remote_workespace/${planName}`, total: 48, totals, generatedAt: new Date().toISOString(), features }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ledger: output, total: ids.length, totals }));
