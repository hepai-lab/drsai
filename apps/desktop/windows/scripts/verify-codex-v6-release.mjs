import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../../..");
const windows = resolve(root, "apps/desktop/windows");
const full = process.argv.includes("--full");
const gates = [
  ["feature audit", process.execPath, ["scripts/verify-codex-v6-feature-audit.mjs"]],
  ["latest input", process.execPath, ["../shared/test-kit/run-bundled-test.mjs", "scripts/verify-codex-v6-input.mts"]],
  ["session stream", process.execPath, ["../shared/test-kit/run-bundled-test.mjs", "scripts/verify-oaep-session-stream.mts"]],
  ["presentation parity", process.execPath, ["../shared/test-kit/run-bundled-test.mjs", "scripts/verify-oaep-presentation-projector.mts"]],
  ["10k performance", process.execPath, ["../shared/test-kit/run-bundled-test.mjs", "scripts/verify-codex-v6-performance.mts"]],
  ["structured contract", process.execPath, ["scripts/verify-structured-conversation.mjs"]],
  ["four-layer renderer", process.execPath, ["scripts/verify-structured-message-renderer.mjs"]],
];
for (const [name, command, args] of gates) {
  const result = spawnSync(command, args, { cwd: windows, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`Codex V6 release gate failed closed at ${name}.`);
  }
}

let liveEvidence = null;
if (full) {
  const evidencePath = process.env.OPENDRSAI_CODEX_V6_LIVE_EVIDENCE;
  if (!evidencePath || !existsSync(evidencePath)) {
    throw new Error("Full V6 release gate requires OPENDRSAI_CODEX_V6_LIVE_EVIDENCE.");
  }
  liveEvidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const accepted = liveEvidence.passed === true
    && liveEvidence.recovered === true
    && liveEvidence.multi_turn?.turn_count >= 3
    && liveEvidence.multi_turn?.turn_ids_unique === true
    && liveEvidence.multi_turn?.context_retained === true
    && typeof liveEvidence.multi_turn?.thread_id === "string"
    && liveEvidence.oaep?.first?.delta_count > 0
    && liveEvidence.oaep?.second?.delta_count > 0
    && liveEvidence.oaep?.recovery?.delta_count > 0
    && liveEvidence.approval_count >= 1
    && liveEvidence.cancellation_verified === true
    && liveEvidence.archive_roundtrip === true;
  if (!accepted) throw new Error("V6 live evidence is incomplete; full release gate failed closed.");
}

console.log(JSON.stringify({
  schema: "opendrsai.codex-adapter-v6.release.v1",
  passed: true,
  mode: full ? "full" : "contract",
  gates: gates.map(([name]) => name),
  ...(liveEvidence ? { live: { threadId: liveEvidence.multi_turn.thread_id, turns: liveEvidence.multi_turn.turn_count } } : {}),
}, null, 2));
