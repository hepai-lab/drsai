import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const sourceDir = resolve(root, process.argv[2] || ".artifacts/v6-live-exact-20260804");
const executePath = resolve(sourceDir, "execute.json");
const recoverPath = resolve(sourceDir, "recover.json");
if (!existsSync(executePath) || !existsSync(recoverPath)) throw new Error("Authoritative Windows Codex evidence is missing.");
const execute = JSON.parse(readFileSync(executePath, "utf8"));
const recover = JSON.parse(readFileSync(recoverPath, "utf8"));
const observedAt = new Date(Math.max(statSync(executePath).mtimeMs, statSync(recoverPath).mtimeMs)).toISOString();
const output = {
  schema: "opendrsai.codex-adapter-p7.live.v1",
  passed: execute.passed === true && recover.passed === true && recover.recovered === true,
  observedAt,
  source: { schema: "opendrsai.codex-adapter-v6.live", directory: sourceDir.slice(root.length + 1).replaceAll("\\", "/") },
  multiTurn: {
    turnCount: recover.multi_turn?.turn_count,
    threadId: recover.multi_turn?.thread_id,
    threadIdStable: recover.multi_turn?.context_retained === true && recover.multi_turn?.turn_ids_unique === true,
  },
  streaming: { firstContentBeforeTerminal: [recover.oaep?.first, recover.oaep?.second, recover.oaep?.recovery].every((row) => row?.delta_count > 0) },
  restart: { converged: recover.recovered === true, restartTurnId: recover.multi_turn?.restart_turn_id },
  archive: { roundTrip: recover.archive_roundtrip === true },
  approval: { count: recover.approval_count ?? 0 },
  cancellation: { verified: recover.cancellation_verified === true },
  workspaceFileOperation: { verified: existsSync(resolve(sourceDir, "workspace/approval-proof.txt")) },
};
if (!(output.passed && output.multiTurn.turnCount >= 3 && output.multiTurn.threadIdStable
  && output.streaming.firstContentBeforeTerminal && output.restart.converged && output.archive.roundTrip
  && output.approval.count >= 1 && output.cancellation.verified && output.workspaceFileOperation.verified)) {
  throw new Error("Authoritative Windows Codex evidence is incomplete.");
}
const target = resolve(root, ".artifacts/codex-p7-live-evidence.json");
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: true, evidence: target, observedAt }, null, 2));
