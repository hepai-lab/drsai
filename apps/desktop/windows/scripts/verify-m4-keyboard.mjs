import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const requestedRunId = process.env.OPENDRSAI_M4_RUN_ID?.trim();
if (requestedRunId && !/^[a-z0-9-]+$/i.test(requestedRunId)) throw new Error("OPENDRSAI_M4_RUN_ID must be alphanumeric with optional hyphens.");
const evidenceDir = join(root, "release", "product-evidence", "m4-keyboard", requestedRunId || "latest");
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before running M4 acceptance.");
if (!existsSync(sourcePdf)) throw new Error(`Fixed CERN PDF fixture is missing: ${sourcePdf}`);
const source = readFileSync(sourcePdf);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(createHash("sha256").update(source).digest("hex").toUpperCase() === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-m4-keyboard-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 数据");
const workspace = join(testRoot, "中文 用户", "CERN 工作区");
const userData = join(testRoot, "electron user data");
const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const resultPath = join(evidenceDir, "packaged-m4-keyboard-result.json");
for (const path of [appHome, workspace, userData, evidenceDir]) mkdirSync(path, { recursive: true });
copyFileSync(sourcePdf, fixturePath);
rmSync(resultPath, { force: true });

try {
  const gateway = await startGateway();
  try {
    await run(gateway.address().port);
  } finally {
    await new Promise((resolveClose) => gateway.close(resolveClose));
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `M4 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 35 && checks.every(([, passed]) => passed === true), `M4 expected at least 35 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  assert(result.details?.focusTrace?.length === 17, "M4 focus snapshot must contain exactly 17 milestones.");
  console.log(`M4 packaged keyboard acceptance passed (${checks.length}/${checks.length} checks; 17 focus milestones; zero pointer events).`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function run(port) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...process.env, DRSAI_HOME: appHome, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_M4_KEYBOARD: "1", OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_M4_CERN_PDF: fixturePath, OPENDRSAI_E2E_M4_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_TIMEOUT_MS: "120000" },
      stdio: "ignore", windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("M4 packaged acceptance timed out.")); } }, 135_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`M4 packaged app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function startGateway() {
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "drsai", object: "model" }] }));
      return;
    }
    if (req.url === "/v1/runtime") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ runtime_id: "runtime-m4-keyboard", instance_id: "instance-m4-keyboard", version: "1.5.5", protocol_version: 1, platform: "windows", dev_managed: true }));
      return;
    }
    if (req.url === "/v1/capabilities") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ protocol_version: 1, capabilities: ["chat", "tools", "goals", "approvals"], capability_versions: { chat: 1, tools: 1, goals: 1, approvals: 1 } }));
      return;
    }
    if (req.url === "/v1/workspaces" && req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const path = JSON.parse(body || "{}").path;
        const now = new Date().toISOString();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ workspace_id: `m4-${Buffer.from(String(path)).toString("base64url").slice(0, 48)}`, path, created_at: now, last_opened_at: now, closed_at: null, open: true }));
      });
      return;
    }
    if (req.url === "/v1/config/cli" || req.url === "/v1/models/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      for await (const _chunk of req) { /* consume request */ }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "CERN WLCG manager report request received." }, index: 0 }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "M4 fake gateway" }));
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(server));
  });
}

function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
