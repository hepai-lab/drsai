import { build } from "esbuild";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-port-forward-"));
const bundle = join(temp, "registry.mjs");
const blocker = createServer();
const echo = createServer((socket) => socket.pipe(socket));
try {
  await build({ entryPoints: [join(root, "src/main/portForwardRegistry.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { PortForwardRegistry } = await import(pathToFileURL(bundle).href);
  const children = [];
  const events = [];
  const spawnForward = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit("exit", 0); return true; };
    children.push(child);
    return child;
  };
  await new Promise((ok, fail) => blocker.once("error", fail).listen(0, "127.0.0.1", ok));
  const occupied = blocker.address().port;
  const file = join(temp, "port-forwards.json");
  const registry = new PortForwardRegistry(file, spawnForward, (event) => events.push(event));
  const authorization = (operationId) => ({ permissionGranted: true, approvalId: `approval-${operationId}`, correlationId: "corr-port-forward", operationId });
  const created = await registry.create({ hostAlias: "gpu-lab", workspaceId: "ws-1", remotePort: 8080, localPort: occupied, authorization: authorization("create-1") });
  assert(created.status === "active" && created.bindAddress === "127.0.0.1", "loopback forward was not activated");
  assert(created.localPort !== occupied, "occupied local port was not reassigned");
  assert(events.some((event) => event.type === "local_port_reassigned" && event.previousLocalPort === occupied), "port conflict event is missing");
  assert((await registry.list({ workspaceId: "ws-1" })).length === 1, "owner Workspace filter failed");
  assert((await registry.pause(created.portForwardId)).status === "paused", "pause failed");
  assert((await registry.resume(created.portForwardId)).status === "active", "resume failed");
  assert(await registry.remove(created.portForwardId), "remove failed");
  assert((await registry.list()).length === 0, "removed forward remained visible");
  await expectReject(() => registry.create({ hostAlias: "gpu-lab", workspaceId: "ws-1", remotePort: 80, bindAddress: "0.0.0.0", authorization: authorization("create-2") }), "non-loopback forward bypassed approval");
  const approved = await registry.create({ hostAlias: "gpu-lab", workspaceId: "ws-1", remotePort: 80, bindAddress: "0.0.0.0", nonLoopbackApproval: { approved: true, approvalId: "approval-1" }, authorization: authorization("create-3") });
  assert(approved.bindAddress === "0.0.0.0", "approved non-loopback forward failed");
  assert(!readFileSync(file, "utf8").includes("token"), "Port Forward Registry persisted a Runtime token");
  await registry.remove(approved.portForwardId);
  await new Promise((ok, fail) => echo.once("error", fail).listen(0, "127.0.0.1", ok));
  const bridgeChildren = [];
  const bridgeRegistry = new PortForwardRegistry(join(temp, "bridge.json"), (resource) => {
    const child = new EventEmitter();
    child.exitCode = null;
    const server = createServer((downstream) => {
      const upstream = createConnection(resource.remotePort, resource.remoteHost);
      downstream.pipe(upstream).pipe(downstream);
    });
    server.listen(resource.localPort, resource.bindAddress);
    child.kill = () => { child.exitCode = 0; server.close(() => child.emit("exit", 0)); return true; };
    bridgeChildren.push(child);
    return child;
  });
  const bridged = await bridgeRegistry.create({ hostAlias: "gpu-lab", workspaceId: "ws-echo", remoteHost: "127.0.0.1", remotePort: echo.address().port, authorization: authorization("create-4") });
  assert(await tcpExchange(bridged.localPort, "OWOP_FORWARD") === "OWOP_FORWARD", "real TCP echo did not traverse the managed forward");
  await bridgeRegistry.suspendHost("gpu-lab");
  assert((await bridgeRegistry.list())[0]?.status === "reconnecting", "Host transport loss did not suspend the Port Forward");
  await bridgeRegistry.resumeHost("gpu-lab");
  const resumed = (await bridgeRegistry.list())[0];
  assert(resumed?.status === "active" && await tcpExchange(resumed.localPort, "RECONNECTED") === "RECONNECTED", "Port Forward did not restore after Host reconnect");
  await bridgeRegistry.remove(bridged.portForwardId);
  const audit = readFileSync(`${file}.audit.jsonl`, "utf8");
  assert(audit.includes("port_forward.authorized") && audit.includes("corr-port-forward") && audit.includes("create-1"), "Port Forward authorization audit is incomplete");
  console.log("Port Forward create/list/pause/resume/remove, conflict, persistence, and bind policy verification passed.");
} finally {
  await new Promise((resolveClose) => blocker.close(() => resolveClose()));
  if (echo.listening) await new Promise((resolveClose) => echo.close(() => resolveClose()));
  rmSync(temp, { recursive: true, force: true });
}

function assert(value, message) { if (!value) throw new Error(message); }
async function expectReject(operation, message) { let rejected = false; try { await operation(); } catch { rejected = true; } assert(rejected, message); }
async function tcpExchange(port, payload) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await new Promise((resolveExchange, rejectExchange) => {
        const socket = createConnection(port, "127.0.0.1", () => socket.write(payload));
        socket.setTimeout(1000, () => socket.destroy(new Error("timeout")));
        socket.once("data", (data) => { socket.end(); resolveExchange(data.toString()); });
        socket.once("error", rejectExchange);
      });
    } catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 25)); }
  }
  throw new Error("TCP forward did not become ready");
}
