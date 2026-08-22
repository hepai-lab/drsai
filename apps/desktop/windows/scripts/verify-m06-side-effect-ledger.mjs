import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const read = (path) => readFileSync(path, "utf8");
const engine = read(join(repo, "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py"));
const agent = read(join(repo, "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py"));
const gateway = read(join(repo, "cores/python/packages/drsai/src/drsai/backend/gateway.py"));
const probe = read(join(root, "scripts/probe-m06-side-effect-ledger.py"));

const contracts = [
  [engine, "CREATE TABLE IF NOT EXISTS runtime_side_effects"],
  [engine, "idempotency_key TEXT NOT NULL UNIQUE"],
  [engine, "def claim_side_effect("],
  [engine, "Side effect outcome is unknown after interruption"],
  [engine, "def complete_side_effect("],
  [engine, "def fail_side_effect("],
  [agent, "approved_side_effect_not_executed"],
  [agent, "approval_id=approval_id, recovered=bool(call.get"],
  [gateway, "services.state.claim_side_effect("],
  [gateway, "services.state.complete_side_effect("],
  [gateway, '@app.get("/v1/runs/{run_id}/side-effects")'],
  [probe, "crashBeforeWriteHasNoEffect"],
  [probe, "effectWrittenExactlyOnce"],
  [probe, "unknownOutcomeBlocked"],
];
for (const [source, token] of contracts) {
  if (!source.includes(token)) throw new Error(`M06-F03 contract is missing: ${token}`);
}
console.log(`M06-F03 side-effect ledger contract passed ${contracts.length}/${contracts.length} checks.`);
