import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const python = resolve(root, ".venv/Scripts/python.exe");
const runner = resolve(root, "scripts/verify-codex-runtime-online.py");
if (!existsSync(python)) throw new Error("P8 live acceptance requires the repository .venv.");
const artifact = resolve(root, process.env.OPENDRSAI_CODEX_P8_LIVE_DIR || ".artifacts/codex-p8-live-current");
const home = join(artifact, "home");
const workspace = join(artifact, "workspace");
const state = join(artifact, "state.json");
const execute = join(artifact, "execute.json");
const recover = join(artifact, "recover.json");
const authRequest = join(artifact, "auth-request.json");
const evidencePath = join(artifact, "evidence.json");
mkdirSync(artifact, { recursive: true });
const port = 31000 + process.pid % 12000;
const token = randomBytes(32).toString("base64url");
const base = [runner, "--self-host-gateway", "--base-url", `http://127.0.0.1:${port}`,
  "--gateway-token", token, "--state", state];
const env = { ...process.env, DRSAI_HOME: home, DRSAI_REPO: workspace,
  OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_GATEWAY_INSTANCE_TOKEN: token,
  DRSAI_GATEWAY_DEV_MANAGED: "1" };
run([...base, "--phase", "execute", "--workspace", workspace, "--runtime-state-root", home,
  "--auth-request", authRequest, "--continuous-turns", "3", "--result", execute], env);
run([...base, "--phase", "recover", "--result", recover], env);
const first = JSON.parse(readFileSync(execute, "utf8"));
const second = JSON.parse(readFileSync(recover, "utf8"));
const deltaRows = [second.oaep?.first, second.oaep?.second, second.oaep?.recovery];
const evidence = {
  schema: "opendrsai.codex-adapter-p8.live.v1",
  passed: first.passed === true && second.passed === true && second.recovered === true,
  observedAt: new Date().toISOString(), host: hostname(), platform: process.platform, architecture: process.arch,
  runtime: { homeDigestScope: "isolated-p8-live", restartVerified: second.recovered === true },
  multiTurn: { threadId: second.multi_turn?.thread_id, turnCount: second.multi_turn?.turn_count,
    threadIdStable: second.thread_id === second.multi_turn?.thread_id,
    turnIdsUnique: second.multi_turn?.turn_ids_unique === true, contextRetained: second.context_retained === true },
  streaming: { firstContentBeforeTerminal: deltaRows.every((row) => Number(row?.delta_count) > 0), paths: deltaRows },
  approval: { count: Number(second.approval_count || 0) },
  cancellation: { verified: second.cancellation_verified === true },
  archive: { roundTrip: second.archive_roundtrip === true },
  workspaceFileOperation: { verified: existsSync(join(workspace, "approval-proof.txt")) },
  source: { execute, recover, state },
};
if (!(evidence.passed && evidence.multiTurn.turnCount >= 3 && evidence.multiTurn.threadIdStable
  && evidence.multiTurn.turnIdsUnique && evidence.multiTurn.contextRetained
  && evidence.streaming.firstContentBeforeTerminal && evidence.approval.count >= 1
  && evidence.cancellation.verified && evidence.archive.roundTrip && evidence.workspaceFileOperation.verified)) {
  throw new Error(`P8 native live acceptance was incomplete: ${JSON.stringify(evidence)}`);
}
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: true, evidence: evidencePath, threadId: evidence.multiTurn.threadId }));

function run(args, environment) {
  const result = spawnSync(python, args, { cwd: root, env: environment, encoding: "utf8",
    windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`P8 native live phase failed (${result.status}).\n${result.stdout}\n${result.stderr}`);
}
