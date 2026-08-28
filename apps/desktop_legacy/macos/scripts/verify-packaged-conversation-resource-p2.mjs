import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGED_RESOURCE_SESSION_ID,
  assertPackagedConversationResourceChecks,
  packagedConversationResourceOwopResult,
  packagedConversationResourceSnapshot,
  writePackagedConversationResourceFixtures,
} from "../../shared/test-kit/packaged-conversation-resource-p2-fixture.mjs";

if (process.platform !== "darwin") throw new Error("Packaged macOS conversation resource P2 E2E must run on macOS.");
if (process.arch !== "arm64") throw new Error("Packaged macOS conversation resource P2 E2E requires an Apple Silicon arm64 runner.");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultAppDirectory = "mac-arm64";
const appPath = resolve(process.env.OPENDRSAI_MACOS_APP_PATH || join(root, "release", defaultAppDirectory, "OpenDrSai.app"));
const executable = join(appPath, "Contents", "MacOS", "OpenDrSai");
assert.ok(existsSync(executable), `Packaged macOS executable is missing: ${executable}`);

const temp = await mkdtemp(join(tmpdir(), "opendrsai-macos-resource-p2-"));
const workspacePath = join(temp, "workspace");
const saveDirectory = join(temp, "downloads");
const resultPath = join(temp, "result.json");
await mkdir(workspacePath, { recursive: true });
await mkdir(saveDirectory, { recursive: true });
writePackagedConversationResourceFixtures(workspacePath);

const requests = [];
const server = createServer(async (request, response) => {
  requests.push(`${request.method || "GET"} ${request.url || "/"}`);
  try {
    if (request.url === "/health") return json(response, { status: "ok" });
    if (request.url === "/v1/runtime") return json(response, { runtime_id: "runtime-local-packaged-p2", instance_id: "instance-macos-packaged-p2", version: "1.5.8-e2e", protocol_version: 1, platform: "darwin", dev_managed: true });
    if (request.url === "/v1/capabilities") return json(response, { protocol_version: 1, capabilities: ["oaep", "owop"], capability_versions: { oaep: 1, owop: 1 }, protocols: { oaep: { version: "1.0", profiles: ["conversation-resource-association-p2"] }, owop: { version: "1.0", capabilities: ["resources.resolve_batch", "resources.preview", "resources.download"] } } });
    if (request.url?.startsWith("/v1/workspaces?") && request.method === "GET") return json(response, { data: [{ workspace_id: "e2e-agent-run-workspace", path: workspacePath, created_at: "2026-08-16T00:00:00Z", last_opened_at: "2026-08-16T00:00:00Z", closed_at: null, open: true }] });
    if (request.url === "/v1/workspaces" && request.method === "POST") return json(response, { workspace_id: "e2e-agent-run-workspace", path: (await body(request))?.path || workspacePath, created_at: "2026-08-16T00:00:00Z", last_opened_at: "2026-08-16T00:00:00Z", closed_at: null, open: true });
    if (request.url === `/v1/sessions/${PACKAGED_RESOURCE_SESSION_ID}/oaep-snapshot` && request.method === "GET") return json(response, packagedConversationResourceSnapshot());
    if (request.url === "/v1/owop" && request.method === "POST") return json(response, { ok: true, result: packagedConversationResourceOwopResult(await body(request)) });
    return json(response, { error: "packaged-resource-p2-fixture" }, 404);
  } catch (error) {
    return json(response, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const address = server.address();
assert.ok(address && typeof address === "object");

let stderr = "";
const child = spawn(executable, [], {
  env: {
    ...process.env,
    DRSAI_HOME: join(temp, "home"), DRSAI_API_PORT: String(address.port), OPENDRSAI_RUNTIME_PERSIST: "0",
    OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath, OPENDRSAI_MACOS_PACKAGED_SCENARIO: "conversation-resource-p2",
    OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG: JSON.stringify({ workspacePath }),
    OPENDRSAI_E2E_AGENT_RUN: "1", OPENDRSAI_E2E_AUTH_USER_ID: "packaged-resource-p2-user",
    OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_RESOURCE_SAVE_DIR: saveDirectory,
    ELECTRON_ENABLE_LOGGING: "1",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

try {
  const exitCode = await waitForClose(child, 90_000);
  assert.equal(exitCode, 0, stderr);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(result.ok, true, result.error || stderr);
  assert.equal(result.scenario, "conversation-resource-p2");
  assert.equal(result.descriptor?.id, "macos");
  assertPackagedConversationResourceChecks(result.checks);
  assert.ok(requests.includes(`GET /v1/sessions/${PACKAGED_RESOURCE_SESSION_ID}/oaep-snapshot`));
  assert.ok(requests.includes("POST /v1/owop"));
  const evidencePath = process.env.OPENDRSAI_MACOS_PACKAGED_RESOURCE_EVIDENCE_FILE || join(root, "build", "acceptance", "packaged-conversation-resource-p2.json");
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify({ schemaVersion: 1, testId: "P2-DESKTOP-08-macos", platform: `darwin-${process.arch}`, passed: true, checks: result.checks, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  console.log("macOS packaged conversation resource P2 E2E passed with real renderer/preload/main IPC.");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}

function json(response, value, status = 200) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); }
function body(request) { return new Promise((resolveBody, reject) => { let raw = ""; request.setEncoding("utf8"); request.on("data", (chunk) => { raw += chunk; if (raw.length > 2_000_000) reject(new Error("request too large")); }); request.on("end", () => { try { resolveBody(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } }); request.on("error", reject); }); }
function waitForClose(processHandle, timeoutMs) { return new Promise((resolveClose, reject) => { const timer = setTimeout(() => { processHandle.kill("SIGKILL"); reject(new Error(`Packaged macOS resource E2E timed out after ${timeoutMs} ms.`)); }, timeoutMs); processHandle.once("close", (code, signal) => { clearTimeout(timer); if (signal) reject(new Error(`Packaged macOS app exited from signal ${signal}.`)); else resolveClose(code); }); }); }
