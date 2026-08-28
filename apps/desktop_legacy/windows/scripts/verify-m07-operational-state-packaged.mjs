import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const runId = process.env.OPENDRSAI_M07_STATE_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("M07 run id is invalid.");
const evidenceDir = join(root, "release", "product-evidence", "m07-operational-state", runId);
const resultPath = join(evidenceDir, "packaged-m07-operational-state-result.json");
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before running M07 operational-state acceptance.");
mkdirSync(evidenceDir, { recursive: true });
rmSync(resultPath, { force: true });
const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-m07-state-"));
const appHome = join(testRoot, "中文用户", "OpenDrSai 数据");
const userData = join(testRoot, "Electron user data");
const workspace = join(testRoot, "中文工作区");
mkdirSync(appHome, { recursive: true });
mkdirSync(userData, { recursive: true });
mkdirSync(workspace, { recursive: true });

try {
  const gateway = await startGateway();
  try { await run(gateway.address().port); } finally { await new Promise((resolveClose) => gateway.close(resolveClose)); }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const checks = Object.entries(result.checks || {});
  assert(result.ok === true, `M07 packaged operational-state acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  assert(checks.length >= 23 && checks.every(([, passed]) => passed === true), `M07 expected at least 23 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  console.log(`M07 packaged operational-state acceptance passed (${checks.length}/${checks.length}; 7 state scenarios).`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function run(port) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("OPENDRSAI_E2E_")));
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...cleanEnvironment, DRSAI_HOME: appHome, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_OPERATIONAL_STATE: "1", OPENDRSAI_E2E_OPERATIONAL_STATE_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_OPERATIONAL_STATE_WORKSPACE: workspace, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_TIMEOUT_MS: "60000" },
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("M07 packaged operational-state acceptance timed out.")); } }, 75_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`M07 packaged app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function startGateway() {
  const server = createServer((request, response) => {
    if (request.url === "/health") return json(response, { status: "ok" });
    if (request.url === "/v1/models") return json(response, { object: "list", data: [{ id: "drsai", object: "model" }] });
    if (request.url === "/v1/runtime") return json(response, { runtime_id: "runtime-m07-state", instance_id: "instance-m07-state", version: "1.5.5", protocol_version: 1, platform: "windows", dev_managed: true });
    if (request.url === "/v1/capabilities") return json(response, { protocol_version: 1, capabilities: ["chat", "tools", "goals", "approvals"], capability_versions: { chat: 1, tools: 1, goals: 1, approvals: 1 } });
    if (request.url === "/v1/workspaces" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const path = JSON.parse(body || "{}").path;
        const now = new Date().toISOString();
        json(response, { workspace_id: `m07-${Buffer.from(String(path)).toString("base64url").slice(0, 48)}`, path, created_at: now, last_opened_at: now, closed_at: null, open: true });
      });
      return;
    }
    if (request.url === "/v1/config/cli" || request.url === "/v1/models/config") return json(response, {});
    response.writeHead(404, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "M07 fake gateway" }));
  });
  return new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolveListen(server)); });
}
function json(response, value) { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
