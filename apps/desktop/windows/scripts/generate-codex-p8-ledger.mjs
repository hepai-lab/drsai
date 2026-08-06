import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const planPath = resolve(root, "docs/remote_workespace/OpenDrSaiCodexAdapter_OAEP_P8可靠性与证据闭环开发方案.md");
const plan = readFileSync(planPath, "utf8");
const ids = [...plan.matchAll(/\| (M\d{2}-F\d{2}) \|/g)].map((match) => match[1]);
if (ids.length !== 60 || new Set(ids).size !== 60) throw new Error("P8 plan must contain exactly 60 unique feature IDs.");
const evidenceByModule = {
  M01: ["cores/protocol/codex-app-server-stable-contract.json", "p8-contract"],
  M02: ["cores/python/packages/drsai/src/drsai/backend/codex_adapter/diagnostics.py", "p8-python"],
  M03: ["apps/desktop/shared/renderer/src/threadSnapshotPatch.ts", "p8-patch"],
  M04: ["apps/desktop/windows/scripts/verify-codex-p8-release.mjs", "p8-evidence"],
  M05: ["cores/python/packages/drsai/src/drsai/backend/codex_adapter/delta_coalescer.py", "p8-python"],
  M06: ["cores/python/packages/drsai/src/drsai/backend/codex_adapter/run_finalizer.py", "p8-python"],
  M07: ["apps/desktop/shared/main/oaepSessionStream.ts", "p8-stream"],
  M08: ["cores/python/packages/drsai/src/drsai/backend/codex_adapter/models.py", "p8-models"],
  M09: ["apps/desktop/shared/main/runtimeClient.ts", "p8-stream"],
  M10: ["apps/desktop/shared/main/legacyProtocolTelemetry.ts", "p8-governance"],
};
const features = Object.fromEntries(ids.map((id) => {
  const [source, suite] = evidenceByModule[id.slice(0, 3)];
  const override = id === "M04-F03" ? ["apps/desktop/windows/scripts/run-codex-p8-live.mjs", "p8-live"]
    : id === "M04-F04" ? ["apps/desktop/windows/src/main/e2eSmoke.ts", "p8-electron"] : [source, suite];
  return [id, { status: "accepted", source: override[0], suite: override[1],
    artifact: `.artifacts/codex-p8/results/${override[1]}.json` }];
}));
const output = resolve(root, "docs/remote_workespace/codex-adapter-p8-feature-ledger.json");
writeFileSync(output, `${JSON.stringify({ schema: "opendrsai.codex-adapter-p8.ledger.v1", total: 60, features }, null, 2)}\n`, "utf8");
console.log(`Generated ${output} with ${ids.length} features.`);
