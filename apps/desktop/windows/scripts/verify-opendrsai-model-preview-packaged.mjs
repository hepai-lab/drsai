import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const asar = join(root, "release", "win-unpacked", "resources", "app.asar");
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before packaged model preview acceptance.");
const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-model-preview-"));
const appHome = join(testRoot, "OpenDrSai data");
const userData = join(testRoot, "Electron user data");
const resultPath = join(testRoot, "result.json");
for (const path of [appHome, userData]) mkdirSync(path, { recursive: true });
const requests = { previews: [], commits: [] };
let active = { model: "deepseek-v4-pro", provider: "hepai", baseUrl: "https://aiapi.ihep.ac.cn/apiv2/v1", revision: "a".repeat(64) };

try {
  const gateway = await startGateway();
  try { await run(gateway.address().port); }
  finally { await new Promise((resolveClose) => gateway.close(resolveClose)); }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `Packaged model preview UI failed:\n${JSON.stringify(result, null, 2)}`);
  assert(Object.values(result.checks || {}).every(Boolean), "Every packaged model preview UI check must pass.");
  assert(requests.previews.length === 2, `Cancel + confirm must issue exactly two previews, got ${requests.previews.length}.`);
  assert(requests.commits.length === 1, `Cancel must write zero and confirm exactly once, got ${requests.commits.length}.`);
  assert(JSON.stringify(requests.previews[1]) === JSON.stringify(requests.commits[0]), "Confirmed request must exactly match its reviewed preview.");
  assert(requests.previews.every((body) => body.api_key === "sk-preview-must-never-render") && requests.commits[0].api_key === "sk-preview-must-never-render", "The fixture credential did not traverse the real secure write path.");
  writeEvidence(result);
  console.log(`OpenDrSai packaged model preview acceptance passed (${Object.keys(result.checks).length}/${Object.keys(result.checks).length}; 2 previews, cancel writes 0, confirm writes 1, exact request binding).`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function run(port) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...process.env, DRSAI_HOME: appHome, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_MODEL_PREVIEW: "1", OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_TIMEOUT_MS: "45000" },
      stdio: "ignore", windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("Packaged model preview timed out.")); } }, 55_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`Packaged model preview exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : ""}`)); });
  });
}

function startGateway() {
  const server = createServer(async (req, res) => {
    if (req.url === "/health") return json(res, { status: "ok" });
    if (req.url === "/v1/runtime") return json(res, { runtime_id: "runtime-model-preview", instance_id: "instance-model-preview", version: "1.5.5", protocol_version: 1, platform: "windows", dev_managed: true });
    if (req.url === "/v1/capabilities") return json(res, { protocol_version: 1, capabilities: ["chat", "tools", "goals", "approvals"], capability_versions: { chat: 1, tools: 1, goals: 1, approvals: 1 } });
    if (req.url === "/v1/models") return json(res, { object: "list", data: [{ id: "deepseek-v4-pro", object: "model" }, { id: "deepseek-chat", object: "model" }] });
    if (req.url === "/v1/config/cli") return json(res, { config: {} });
    if (req.url === "/v1/models/config") return json(res, { default_alias: active.model, models: [{ alias: active.model, display_name: active.model, client_type: "openai", model: active.model }] });
    if (req.url === "/v1/config/model-providers/presets") return json(res, { presets: [] });
    if (req.url === "/v1/config/model-state") return json(res, modelState());
    if (req.url === "/v1/config/model/preview" && req.method === "POST") {
      const body = await readJson(req); requests.previews.push(body);
      return json(res, { ok: true, persisted: false, base_revision: active.revision, effective: publicConnection(body) });
    }
    if (req.url === "/v1/config/model" && req.method === "PUT") {
      const body = await readJson(req); requests.commits.push(body);
      active = { model: body.model, provider: body.model_provider, baseUrl: body.base_url, revision: "b".repeat(64) };
      return json(res, { ok: true, ...publicConnection(body), revision: active.revision, evicted_sessions: 0, apply_strategy: "next_turn_atomic_client_swap" });
    }
    res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "model preview fixture" }));
  });
  return new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolveListen(server)); });
}

function publicConnection(body) {
  return { model: body.model, model_provider: body.model_provider, provider: { name: body.model_provider, base_url: body.base_url, wire_api: body.wire_api || "openai", requires_api_key: body.requires_api_key !== false, has_api_key: true, api_key_source: "credential" }, metadata: { known_model: true } };
}
function modelState() {
  const connection = { model: active.model, model_provider: active.provider, provider: { name: active.provider, base_url: active.baseUrl, wire_api: "openai", requires_api_key: true, has_api_key: active.provider !== "hepai", api_key_source: active.provider === "hepai" ? "oidc" : "credential" }, metadata: { known_model: true } };
  return { effective: connection, providers: [connection.provider], revision: active.revision, runtime: { configured_revision: active.revision, running_revision: active.revision, runtime_status: "applied" }, last_test: { provider: active.provider, mode: "model", ok: true, tested_at: "2026-08-05T00:00:00.000Z" } };
}
async function readJson(req) { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); }
function json(res, value) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); }
function writeEvidence(result) {
  const path = process.env.OPENDRSAI_MODEL_PREVIEW_EVIDENCE?.trim(); if (!path) return;
  const sha256 = (file) => `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
  mkdirSync(dirname(path), { recursive: true });
  const sanitized = { ...result, details: { ...result.details, firstPreview: { ...result.details?.firstPreview, secretRendered: false } } };
  const payload = { schema_version: "opendrsai.windows.model-preview-evidence/1", captured_at: new Date().toISOString(), package: { version: "1.5.5", platform: "windows", arch: "x64" }, ui: sanitized, side_effects: { preview_calls: 2, writes_after_cancel: 0, writes_after_confirm: 1, confirmed_request_matches_preview: true, plaintext_key_in_evidence: false }, artifacts: { executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) }, app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) } } };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
