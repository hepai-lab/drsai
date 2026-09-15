import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const temp = mkdtempSync(join(tmpdir(), "opendrsai-terminal-restart-"));
const runtimeHome = join(temp, "runtime-home");
const workspacePath = join(temp, "workspace");
const bundle = join(temp, "runtime.mjs");
const port = await availablePort();
mkdirSync(workspacePath, { recursive: true });
Object.assign(process.env, {
  DRSAI_HOME: runtimeHome, DRSAI_REPO: repo,
  OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_RUNTIME_PERSIST: "1",
  OPENDRSAI_GATEWAY_START_TIMEOUT_MS: "60000",
  OPENDRSAI_NODE_PTY_MODULE: join(desktop, "node_modules", "node-pty"),
  PYTHONPATH: [join(repo, "cores", "python", "packages", "drsai", "src"), process.env.PYTHONPATH].filter(Boolean).join(";"),
});

await build({
  stdin: {
    contents: [
      'export { LocalRuntimeClient } from "./../shared/main/runtimeClient.ts";',
      'export { getGatewayStatus, getGatewayRequestHeaders, shutdownGateway, stopGateway } from "./../shared/main/gateway.ts";',
    ].join("\n"),
    resolveDir: desktop, sourcefile: "terminal-restart.ts",
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  plugins: [{
    name: "electron-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "electron-test-stub" }));
      buildApi.onLoad({ filter: /.*/, namespace: "electron-test-stub" }, () => ({
        contents: `export const app = { isPackaged: false, getAppPath: () => ${JSON.stringify(desktop)} };`,
        loader: "js",
      }));
    },
  }],
});

let first;
let second;
try {
  first = await import(`${pathToFileURL(bundle).href}?desktop=1`);
  const client = await first.LocalRuntimeClient.connect();
  const identity = await client.getRuntime();
  const workspace = await client.openWorkspace(workspacePath);
  const created = await client.executeOWOP(workspace.workspace_id, "pty.create", {
    argv: ["powershell.exe", "-NoLogo", "-NoProfile", "-NoExit"], cwd: ".", cols: 100, rows: 30,
  });
  const terminal = created.terminal;
  let attached = await client.executeOWOP(workspace.workspace_id, "pty.attach", {
    pty_id: terminal.terminal_id, client_id: "desktop-before-restart", mode: "writer", after_sequence: 0, prefer_snapshot: true,
  });
  const marker = "DESKTOP_RESTART_TERMINAL_OK";
  await client.executeOWOP(workspace.workspace_id, "pty.write", {
    pty_id: terminal.terminal_id, lease_id: attached.lease_id,
    content_base64: Buffer.from(`Write-Output '${marker}'\r`, "utf8").toString("base64"),
  });
  let observed = "";
  await waitUntil(async () => {
    attached = await client.executeOWOP(workspace.workspace_id, "pty.attach", {
      pty_id: terminal.terminal_id, lease_id: attached.lease_id,
      client_id: "desktop-before-restart", mode: "writer", after_sequence: attached.last_sequence || 0,
    });
    observed += eventText(attached.events);
    return observed.includes(marker);
  }, 15_000, "Runtime Terminal did not produce pre-restart output");
  await client.executeOWOP(workspace.workspace_id, "pty.detach", { pty_id: terminal.terminal_id, lease_id: attached.lease_id });
  await first.shutdownGateway(true);
  await waitUntil(async () => health(port, first.getGatewayRequestHeaders()), 5_000, "Desktop shutdown stopped the persistent Runtime");

  second = await import(`${pathToFileURL(bundle).href}?desktop=2`);
  const restoredClient = await second.LocalRuntimeClient.connect();
  const restoredIdentity = await restoredClient.getRuntime();
  assert(restoredIdentity.runtime_id === identity.runtime_id && restoredIdentity.instance_id === identity.instance_id,
    "Desktop restart did not reconnect to the same live Runtime instance");
  const listed = await restoredClient.executeOWOP(workspace.workspace_id, "pty.list", {});
  const restored = listed.terminals.find((item) => item.terminal_id === terminal.terminal_id);
  assert(restored && ["running", "detached"].includes(restored.status), "Desktop restart lost the live Terminal identity");
  const replay = await restoredClient.executeOWOP(workspace.workspace_id, "pty.attach", {
    pty_id: terminal.terminal_id, client_id: "desktop-after-restart", mode: "writer", after_sequence: 0, prefer_snapshot: true,
  });
  assert(snapshotText(replay.snapshot).includes(marker), "Desktop restart snapshot did not restore Terminal screen content");
  await restoredClient.executeOWOP(workspace.workspace_id, "pty.kill", { pty_id: terminal.terminal_id });
  const secondHeaders = second.getGatewayRequestHeaders();
  await second.stopGateway();
  await waitUntil(async () => !(await health(port, secondHeaders)), 10_000, "Explicit Runtime stop left the persistent Gateway alive");
  second = null;
  console.log("Desktop restart preserved Runtime identity, Terminal ID, process state, and screen snapshot.");
} finally {
  try { await second?.stopGateway(); } catch {}
  try { await first?.stopGateway(); } catch {}
  try { rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); }
  catch (error) {
    if (error?.code !== "EPERM") throw error;
    // Windows may retain the just-imported bundle until this verifier exits.
  }
}

function eventText(events) {
  return (Array.isArray(events) ? events : []).map((item) => Buffer.from(item.content_base64, "base64").toString("utf8")).join("");
}
function snapshotText(snapshot) {
  return [...(snapshot?.scrollback || []), ...(snapshot?.screen || [])].flatMap((line) => line.map((run) => run.text)).join("\n");
}
async function health(portValue, headers) {
  try { return (await fetch(`http://127.0.0.1:${portValue}/health`, { headers })).ok; } catch { return false; }
}
async function waitUntil(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(message);
}
function assert(value, message) { if (!value) throw new Error(message); }
function availablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const value = typeof address === "object" && address ? address.port : 0;
      server.close(() => value ? resolvePort(value) : rejectPort(new Error("No Runtime test port was available.")));
    });
  });
}
