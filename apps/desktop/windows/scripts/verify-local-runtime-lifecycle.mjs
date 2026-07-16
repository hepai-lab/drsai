import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const temp = mkdtempSync(join(tmpdir(), "opendrsai-local-runtime-lifecycle-"));
const runtimeHome = join(temp, "runtime-home");
const workspacePath = join(temp, "workspace");
const bundle = join(temp, "local-runtime-acceptance.mjs");
const port = 24_000 + (process.pid % 20_000);

mkdirSync(workspacePath, { recursive: true });
const definition = join(runtimeHome, "assets", "agents", "local-acceptance", "1.json");
mkdirSync(resolve(definition, ".."), { recursive: true });
writeFileSync(definition, JSON.stringify({
  id: "local-acceptance",
  version: "1",
  backend: "opendrsai",
  instructions: "local runtime lifecycle acceptance",
  permissions: [],
  controlled_plan: { content: "local-runtime-complete" },
}));

Object.assign(process.env, {
  DRSAI_HOME: runtimeHome,
  DRSAI_REPO: repo,
  DRSAI_RUNTIME_CONTROLLED_MODEL: "1",
  OPENDRSAI_GATEWAY_PORT: String(port),
  PYTHONPATH: [join(repo, "cores", "python", "packages", "drsai", "src"), process.env.PYTHONPATH].filter(Boolean).join(";"),
});

await build({
  stdin: {
    contents: [
      'export { LocalRuntimeClient } from "./src/main/runtimeClient.ts";',
      'export { getGatewayRequestHeaders, getGatewayStatus, startGateway, stopGateway } from "./src/main/gateway.ts";',
    ].join("\n"),
    resolveDir: desktop,
    sourcefile: "local-runtime-acceptance.ts",
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
});

let active;
try {
  const firstDesktop = await import(`${pathToFileURL(bundle).href}?desktop=1`);
  const before = await firstDesktop.getGatewayStatus();
  assert(!before.ready && before.pid === null, "Local Runtime unexpectedly existed before first connection");

  let clients;
  try {
    clients = await Promise.all(Array.from({ length: 20 }, () => firstDesktop.LocalRuntimeClient.connect()));
  } catch (error) {
    const failed = await firstDesktop.getGatewayStatus();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${failed.lastLog || "<no gateway log>"}`);
  }
  const started = await firstDesktop.getGatewayStatus();
  assert(started.ready && started.pid, "Desktop did not start and handshake with Local Runtime");
  const identities = await Promise.all(clients.map((client) => client.getRuntime()));
  assert(new Set(identities.map((item) => item.runtime_id)).size === 1, "Concurrent connections reached different Runtime identities");
  assert(new Set(identities.map((item) => item.instance_id)).size === 1, "Concurrent connections created duplicate Runtime instances");
  assert((await firstDesktop.getGatewayStatus()).pid === started.pid, "Repeated Local Runtime connection changed process identity");

  const access = { baseUrl: `http://127.0.0.1:${port}`, headers: firstDesktop.getGatewayRequestHeaders() };
  const workspace = await request(access, "POST", "/v1/workspaces", { path: workspacePath });
  const session = await request(access, "POST", "/v1/sessions", { workspace_id: workspace.workspace_id, title: "Local lifecycle" });
  const run = await request(access, "POST", `/v1/sessions/${session.session_id}/runs`, { agent_definition: "local-acceptance@1" }, { "Idempotency-Key": "local-lifecycle-run" }, 201);
  const executed = await request(access, "POST", `/v1/runs/${run.run_id}/execute`, { prompt: "persist through Desktop restart" });
  assert(executed.run.status === "completed", "Local Runtime Run did not complete");
  const events = await request(access, "GET", `/v1/runs/${run.run_id}/events`);
  assert(events.data.length > 0, "Local Runtime Run did not persist Events");

  await firstDesktop.stopGateway();
  const secondDesktop = await import(`${pathToFileURL(bundle).href}?desktop=2`);
  const secondClient = await secondDesktop.LocalRuntimeClient.connect();
  active = secondDesktop;
  const afterDesktopRestart = await secondClient.getRuntime();
  assert(afterDesktopRestart.runtime_id === identities[0].runtime_id, "Desktop restart changed stable runtime_id");
  assert(afterDesktopRestart.instance_id !== identities[0].instance_id, "Runtime process restart reused instance_id");
  const restoredWorkspace = (await secondClient.listWorkspaces()).find((item) => item.workspace_id === workspace.workspace_id);
  assert(restoredWorkspace, "Desktop restart lost Runtime Workspace Registry");
  const restoredRun = await request({ baseUrl: `http://127.0.0.1:${port}`, headers: secondDesktop.getGatewayRequestHeaders() }, "GET", `/v1/runs/${run.run_id}`);
  const restoredEvents = await request({ baseUrl: `http://127.0.0.1:${port}`, headers: secondDesktop.getGatewayRequestHeaders() }, "GET", `/v1/runs/${run.run_id}/events`);
  assert(restoredRun.status === "completed" && restoredEvents.data.length === events.data.length, "Desktop restart lost Run/Event history");

  const beforeCrash = await secondDesktop.getGatewayStatus();
  killProcessTree(beforeCrash.pid);
  await waitUntil(async () => !(await secondDesktop.getGatewayStatus()).ready, 10_000, "Desktop did not detect Local Runtime exit");
  assert(await secondDesktop.startGateway(), "Desktop did not restart Local Runtime after abnormal exit");
  const afterCrash = await secondClient.getRuntime();
  assert(afterCrash.runtime_id === afterDesktopRestart.runtime_id, "Runtime crash changed stable runtime_id");
  assert(afterCrash.instance_id !== afterDesktopRestart.instance_id, "Runtime crash did not rotate instance_id");
  assert((await secondClient.listWorkspaces()).some((item) => item.workspace_id === workspace.workspace_id), "Runtime crash recovery lost Workspace Registry");

  await secondDesktop.stopGateway();
  active = null;
  await waitUntil(async () => !(await secondDesktop.getGatewayStatus()).ready, 10_000, "Default shutdown policy left Runtime ready");
  const stopped = await secondDesktop.getGatewayStatus();
  assert(stopped.pid === null, "Default shutdown policy left an orphan Runtime process");

  const externalPort = port + 1;
  const externalHome = join(temp, "external-runtime-home");
  const externalToken = `external-retain-${randomUUID()}`;
  const externalProcess = spawn(join(repo, "venv", "Scripts", "python.exe"), ["-m", "drsai.backend.gateway"], {
    cwd: repo,
    env: {
      ...process.env,
      DRSAI_HOME: externalHome,
      DRSAI_API_PORT: String(externalPort),
      OPENDRSAI_GATEWAY_INSTANCE_TOKEN: externalToken,
    },
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let externalLog = "";
  externalProcess.stderr.on("data", (chunk) => { externalLog = `${externalLog}${chunk}`.slice(-8000); });
  try {
    await waitUntil(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${externalPort}/health`, { headers: { "X-OpenDrSai-Gateway-Token": externalToken } })).ok;
      } catch { return false; }
    }, 25_000, `External retain Runtime did not start: ${externalLog}`);
    Object.assign(process.env, {
      OPENDRSAI_GATEWAY_PORT: String(externalPort),
      OPENDRSAI_GATEWAY_STARTUP: "external",
      OPENDRSAI_GATEWAY_INSTANCE_TOKEN: externalToken,
    });
    const retainedDesktop = await import(`${pathToFileURL(bundle).href}?desktop=external`);
    const retainedClient = await retainedDesktop.LocalRuntimeClient.connect();
    assert((await retainedClient.getRuntime()).runtime_id, "Desktop did not connect to retained external Runtime");
    const retainedStatus = await retainedDesktop.getGatewayStatus();
    assert(retainedStatus.ready && retainedStatus.pid === null, "Retained Runtime was incorrectly treated as Desktop child");
    assert((await retainedDesktop.stopGateway()) === false, "Desktop attempted to stop externally retained Runtime");
    assert(externalProcess.exitCode === null, "Retain policy stopped external Runtime");
  } finally {
    if (externalProcess.exitCode === null) killProcessTree(externalProcess.pid);
    delete process.env.OPENDRSAI_GATEWAY_STARTUP;
  }

  console.log("Windows Local Runtime lifecycle verification passed.");
} finally {
  try { await active?.stopGateway(); } catch {}
  rmSync(temp, { recursive: true, force: true });
}

async function request(access, method, path, body, extraHeaders = {}, expected = 200) {
  const response = await fetch(`${access.baseUrl}${path}`, {
    method,
    headers: { ...access.headers, ...extraHeaders, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert(response.status === expected, `${method} ${path} returned ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

function killProcessTree(pid) {
  assert(Number.isInteger(pid) && pid > 0, "Runtime PID is unavailable for fault injection");
  const result = process.platform === "win32"
    ? spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" })
    : spawnSync("kill", ["-9", String(pid)], { encoding: "utf8" });
  assert(result.status === 0, `Could not terminate Runtime ${pid}: ${result.stderr || result.stdout}`);
}

async function waitUntil(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(message);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
