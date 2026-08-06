import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const root = resolve(import.meta.dirname, "../../../..");
const python = resolve(root, ".venv/Scripts/python.exe");
const runner = resolve(root, "scripts/verify-codex-runtime-online.py");
if (!existsSync(python)) throw new Error("P9 live acceptance requires the repository .venv.");
const artifact = resolve(root, process.env.OPENDRSAI_CODEX_P9_LIVE_DIR
  || `.artifacts/codex-p9-live-${Date.now()}-${process.pid}`);
const home = join(artifact, "home");
const workspace = join(artifact, "workspace");
const state = join(artifact, "state.json");
const execute = join(artifact, "execute.json");
const recover = join(artifact, "recover.json");
const authRequest = join(artifact, "auth-request.json");
const evidencePath = join(artifact, "evidence.json");
mkdirSync(artifact, { recursive: true });
const port = await reservePort();
const token = randomBytes(32).toString("base64url");
const base = [runner, "--self-host-gateway", "--base-url", `http://127.0.0.1:${port}`,
  "--gateway-token", token, "--state", state];
const env = { ...process.env, DRSAI_HOME: home, DRSAI_REPO: workspace,
  OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_GATEWAY_INSTANCE_TOKEN: token,
  DRSAI_GATEWAY_DEV_MANAGED: "1" };
run([...base, "--phase", "execute", "--workspace", workspace, "--runtime-state-root", home,
  "--auth-request", authRequest, "--continuous-turns", "30", "--result", execute], env);
run([...base, "--phase", "recover", "--result", recover], env);
const first = JSON.parse(readFileSync(execute, "utf8"));
const second = JSON.parse(readFileSync(recover, "utf8"));
const deltaRows = [second.oaep?.first, second.oaep?.second, second.oaep?.resources, second.oaep?.approval, second.oaep?.recovery];
const evidence = {
  schema: "opendrsai.codex-adapter-p9.live.v1", passed: first.passed === true && second.passed === true && second.recovered === true,
  observedAt: new Date().toISOString(), host: hostname(), platform: process.platform, architecture: process.arch,
  runtime: { restartVerified: second.recovered === true },
  multiTurn: { threadId: second.multi_turn?.thread_id, turnCount: second.multi_turn?.turn_count,
    threadIdStable: second.thread_id === second.multi_turn?.thread_id,
    turnIdsUnique: second.multi_turn?.turn_ids_unique === true, contextRetained: second.context_retained === true },
  streaming: { firstContentBeforeTerminal: deltaRows.every((row) => Number(row?.delta_count) > 0), paths: deltaRows },
  approval: { count: Number(second.approval_count || 0) }, cancellation: { verified: second.cancellation_verified === true },
  archive: { roundTrip: second.archive_roundtrip === true },
  inputResources: {
    kinds: second.input_resources?.kinds,
    allMarkersObserved: second.input_resources?.all_markers_observed === true,
  },
  processingOrder: second.processing_order,
  workspaceFileOperation: { verified: existsSync(join(workspace, "approval-proof.txt")) },
  inputs: { runnerDigest: digest(readFileSync(runner)), executeDigest: digest(readFileSync(execute)), recoverDigest: digest(readFileSync(recover)) },
};
if (!(evidence.passed && evidence.multiTurn.turnCount >= 30 && evidence.multiTurn.threadIdStable
  && evidence.multiTurn.turnIdsUnique && evidence.multiTurn.contextRetained
  && evidence.streaming.firstContentBeforeTerminal && evidence.approval.count >= 1
  && ["file", "folder", "selection", "terminal", "browser"].every((kind) => evidence.inputResources.kinds?.includes(kind))
  && evidence.inputResources.allMarkersObserved && evidence.processingOrder?.ordered === true
  && evidence.cancellation.verified && evidence.archive.roundTrip && evidence.workspaceFileOperation.verified)) {
  throw new Error(`P9 native live acceptance was incomplete: ${JSON.stringify(evidence)}`);
}
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
const stableEvidencePath = resolve(root, ".artifacts/codex-p10/live-evidence.json");
mkdirSync(resolve(root, ".artifacts/codex-p10"), { recursive: true });
copyFileSync(evidencePath, stableEvidencePath);
console.log(JSON.stringify({ passed: true, evidence: evidencePath, threadId: evidence.multiTurn.threadId }));

function run(args, environment) {
  const result = spawnSync(python, args, { cwd: root, env: environment, encoding: "utf8",
    windowsHide: true, timeout: 60 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`P9 native live phase failed (${result.status}; signal=${result.signal || "none"}; error=${result.error?.message || "none"}).\n${result.stdout}\n${result.stderr}`);
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a loopback Gateway port.")));
        return;
      }
      const selected = address.port;
      server.close((error) => error ? reject(error) : resolvePort(selected));
    });
  });
}
