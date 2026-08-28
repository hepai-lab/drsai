import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../../..");
const plan = readFileSync(resolve(root, "docs/remote_workespace/OpenDrSaiCodexAdapter_OAEP_V3用户产品化开发方案.md"), "utf8");
const ids = [...plan.matchAll(/\| (V3-M\d{2}-F\d{2}) \|/g)].map((match) => match[1]);
if (ids.length !== 54 || new Set(ids).size !== 54) throw new Error(`Release ledger expected 54 unique feature IDs, found ${ids.length}/${new Set(ids).size}.`);

const executeEvidencePath = process.env.OPENDRSAI_CODEX_V3_LIVE_EVIDENCE;
const recoveryEvidencePath = process.env.OPENDRSAI_CODEX_V3_RECOVERY_EVIDENCE;
if (!executeEvidencePath || !recoveryEvidencePath) {
  throw new Error("Release gate requires OPENDRSAI_CODEX_V3_LIVE_EVIDENCE and OPENDRSAI_CODEX_V3_RECOVERY_EVIDENCE.");
}
for (const evidencePath of [executeEvidencePath, recoveryEvidencePath]) {
  if (!existsSync(evidencePath)) throw new Error(`Required live evidence does not exist: ${evidencePath}`);
}
const live = JSON.parse(readFileSync(executeEvidencePath, "utf8"));
const recovery = JSON.parse(readFileSync(recoveryEvidencePath, "utf8"));
const liveAccepted = live.passed === true
  && live.auth_mode === "chatgpt"
  && live.archive_roundtrip === true
  && live.multi_turn?.turn_count === 20
  && live.multi_turn?.turn_ids_unique === true
  && live.multi_turn?.context_retained === true
  && live.oaep?.first?.delta_count > 0
  && live.oaep?.second?.delta_count > 0;
const recoveryAccepted = recovery.passed === true
  && recovery.recovered === true
  && recovery.context_retained === true
  && recovery.thread_id === live.multi_turn?.thread_id
  && recovery.oaep?.delta_count > 0;
if (!liveAccepted || !recoveryAccepted) {
  throw new Error("Live Codex 20-turn or Runtime recovery evidence is incomplete; release gate failed closed.");
}

const gates = [
  ...[1, 2, 3, 4, 5].map((phase) => [`P${phase}`, process.execPath, [`scripts/verify-codex-v3-p${phase}.mjs`]]),
  ["OAEP/OWOP contract", process.execPath, ["scripts/verify-oaep-runtime-contract.mjs"]],
  ["Codex architecture", process.execPath, ["scripts/verify-codex-dependency-boundaries.mjs"]],
  ["Desktop integration", process.execPath, ["scripts/verify-codex-desktop-integration.mjs"]],
  ["Structured performance", process.execPath, ["scripts/verify-structured-quality.mjs"]],
];
for (const [name, command, args] of gates) {
  const result = spawnSync(command, args, { cwd: resolve(root, "apps/desktop/windows"), encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || ""); process.stderr.write(result.stderr || "");
    throw new Error(`Release gate failed closed at ${name}.`);
  }
}
const ledger = ids.map((id) => ({ id, status: "accepted", evidence: `verify:codex-v3-p${id.startsWith("V3-M01") ? 1 : id.startsWith("V3-M02") || id.startsWith("V3-M03") ? 2 : id.startsWith("V3-M04") || id.startsWith("V3-M05") ? 3 : id.startsWith("V3-M06") || id.startsWith("V3-M07") ? 4 : 5}` }));
console.log(JSON.stringify({ schema: "opendrsai.codex-v3.release-ledger.v1", accepted: ledger.length, total: 54, liveEvidence: { turnCount: live.multi_turn.turn_count, threadId: live.multi_turn.thread_id, recovered: recovery.recovered }, ledger }, null, 2));
