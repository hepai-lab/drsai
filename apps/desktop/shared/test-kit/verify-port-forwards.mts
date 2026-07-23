import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopPortForward } from "../api/desktopApi.ts";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill(): boolean { this.killed = true; return true; }
  crash(code = 1): void { this.exitCode = code; this.emit("exit", code); }
}

const root = await mkdtemp(join(tmpdir(), "drsai-port-forward-"));
try {
  process.env.DRSAI_HOME = root;
  const { PortForwardRegistry } = await import("../main/portForwards.ts");
  const filePath = join(root, "port-forwards.json");
  const children: FakeChild[] = [];
  const ensured: string[] = [];
  const events: Array<{ type: string; previousLocalPort?: number }> = [];
  let nextPort = 41000;
  let failStartup = false;
  const platform = {
    async ensureHost(alias: string) { ensured.push(alias); },
    spawn(_resource: DesktopPortForward) { const child = new FakeChild(); children.push(child); return child; },
    async choosePort(_host: string, preferred?: number) { return preferred === 40000 ? nextPort : preferred ?? nextPort; },
    async waitForStart(_child: FakeChild) { if (failStartup) throw new Error("fixture startup failed"); },
  };
  const registry = new PortForwardRegistry(filePath, platform, (event) => events.push({ type: event.type, previousLocalPort: event.previousLocalPort }));
  const request = {
    hostAlias: "alpha", workspaceId: "workspace-1", remoteHost: "127.0.0.1", remotePort: 8080, localPort: 40000,
    reconnectPolicy: "automatic" as const,
    authorization: { permissionGranted: true as const, approvalId: `approval:${"a".repeat(64)}`, correlationId: "correlation-1", operationId: "operation-1" },
  };
  const created = await registry.create(request);
  assert.equal(created.status, "active"); assert.equal(created.localPort, 41000); assert.equal(created.requestedLocalPort, 40000);
  assert.deepEqual(ensured, ["alpha"]); assert(events.some((event) => event.type === "local_port_reassigned" && event.previousLocalPort === 40000));
  assert.equal((await registry.list({ hostAlias: "alpha" })).length, 1);
  await assert.rejects(() => registry.list({ hostAlias: "../bad" }), /filter is invalid/i);
  await assert.rejects(() => registry.create({ ...request, remotePort: 0 }), /Remote port is invalid/);
  await assert.rejects(() => registry.create({ ...request, authorization: { ...request.authorization, approvalId: "forged" } }), /requires Permission/i);

  const paused = await registry.pause(created.portForwardId); assert.equal(paused.status, "paused"); assert.equal(children[0].killed, true);
  nextPort = 42000; const resumed = await registry.resume(created.portForwardId); assert.equal(resumed.status, "active"); assert.equal(resumed.localPort, 42000);
  children.at(-1)?.crash(); assert.equal((await registry.list())[0].status, "reconnecting");
  nextPort = 43000; await new Promise((resolve) => setTimeout(resolve, 300));
  const reconnected = (await registry.list())[0]; assert.equal(reconnected.status, "active"); assert.equal(reconnected.localPort, 43000);

  await registry.suspendHost("alpha"); assert.equal((await registry.list())[0].status, "reconnecting");
  nextPort = 44000; await registry.resumeHost("alpha"); assert.equal((await registry.list())[0].status, "active");
  const persisted = JSON.parse(await readFile(filePath, "utf8")); assert.equal(persisted.version, 2);
  if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  const audit = await readFile(`${filePath}.audit.jsonl`, "utf8"); assert.match(audit, /port_forward\.authorized/); assert.doesNotMatch(audit, /fixture-token/);

  assert.equal(await registry.remove(created.portForwardId), true); assert.equal((await registry.list()).length, 0);
  await assert.rejects(() => registry.remove(created.portForwardId), /not found/i);
  failStartup = true;
  await assert.rejects(() => registry.create({ ...request, localPort: undefined, authorization: { ...request.authorization, operationId: "operation-2" } }), /fixture startup failed/);
  assert((await registry.list()).some((item) => item.status === "failed"));
  await registry.shutdown();
  await assert.rejects(() => registry.create(request), /shutting down/i);
  console.log("Port Forward validation, startup, conflict reassignment, reconnect, persistence, audit and shutdown passed.");
} finally { await rm(root, { recursive: true, force: true }); }
