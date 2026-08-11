import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-runtime-health-"));
const bundle = join(temp, "runtime-health-robustness.mjs");
const home = join(temp, "home");
mkdirSync(home, { recursive: true });

const agentRunWorkspace = readFileSync(
  resolve(desktop, "../shared/renderer/src/components/AgentRunWorkspace.tsx"),
  "utf8",
);
const windowsMain = readFileSync(resolve(desktop, "src/main/index.ts"), "utf8");
assert.ok(
  !agentRunWorkspace.includes("getGatewayStatus()")
    && !agentRunWorkspace.includes("setInterval(() => void refreshGateway"),
  "AgentRunWorkspace must consume centralized health instead of starting one probe loop per mount",
);
assert.ok(
  windowsMain.includes('item.status === "running"')
    && windowsMain.includes("item.id !== activeThreadId"),
  "Runtime catalog sync must exclude idle history and the active OAEP subscription",
);

const unauthorizedServer = createServer((request, response) => {
  if (request.url === "/health" || request.url === "/v1/models" || request.url === "/v1/runtime") {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { code: "unauthorized", message: "Unauthorized", retryable: true } }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "not_found", message: "Not found", retryable: false } }));
});
const tcpOccupant = createTcpServer((socket) => {
  socket.on("error", () => undefined);
  socket.end("not an OpenDrSai Gateway\r\n");
});
let managedDelayMs = 700;
const managedRequests = { health: 0, models: 0 };
const managedServer = createServer((request, response) => {
  const endpoint = request.url === "/health" ? "health" : request.url === "/v1/models" ? "models" : null;
  if (!endpoint) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found" } }));
    return;
  }
  managedRequests[endpoint] += 1;
  setTimeout(() => {
    if (response.destroyed) return;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(endpoint === "health"
      ? { status: "ok" }
      : { object: "list", data: [{ id: "fixture-model" }] }));
  }, managedDelayMs);
});

try {
  await build({
    stdin: {
      contents: [
        'export { LocalRuntimeClient, isLocalRuntimeUnavailableError } from "./../shared/main/runtimeClient.ts";',
        'export { getGatewayStatus } from "./../shared/main/gateway.ts";',
        'export { desktopDiagnostics } from "./../shared/main/diagnostics.ts";',
        'export { listRuntimeWorktreeEvents } from "./../shared/main/worktrees.ts";',
      ].join("\n"),
      resolveDir: desktop,
      sourcefile: "runtime-health-robustness.ts",
    },
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["electron"],
  });

  await new Promise((resolveListen) => unauthorizedServer.listen(0, "127.0.0.1", resolveListen));
  const unauthorizedAddress = unauthorizedServer.address();
  assert(unauthorizedAddress && typeof unauthorizedAddress === "object", "Unauthorized fixture did not expose a TCP port");
  Object.assign(process.env, {
    DRSAI_HOME: home,
    OPENDRSAI_GATEWAY_PORT: String(unauthorizedAddress.port),
    OPENDRSAI_GATEWAY_INSTANCE_TOKEN: "fixture-runtime-token-0123456789abcdef",
  });
  const runtime = await import(`${pathToFileURL(bundle).href}?case=unauthorized`);
  const status = await runtime.getGatewayStatus();
  assert.equal(status.ready, false, "Unauthorized Gateway unexpectedly reported ready");
  assert.equal(status.externalReady, false, "Unauthorized Gateway should not be an external-ready Runtime");
  assert.equal(status.externalConflict, true, "Unauthorized Gateway should be reported as a port/token conflict");
  assert.equal(status.portOpen, true, "Unauthorized Gateway should report the port as open");
  assert.equal(status.diagnosticCode, "gateway_unauthorized", "Gateway diagnostic code did not preserve unauthorized state");
  assert.equal(status.endpoints.health.state, "unauthorized", "Health endpoint state was not classified");
  assert.equal(status.endpoints.models.state, "not_checked", "Liveness probe must not initialize the model catalog");

  const unavailableError = await captureError(() => runtime.LocalRuntimeClient.connect());
  assert(
    runtime.isLocalRuntimeUnavailableError(unavailableError)
      && unavailableError.gatewayStatus?.diagnosticCode === "gateway_unauthorized"
      && /rejected this Desktop token|gateway_unauthorized/i.test(unavailableError.message)
      && !/failed its health check/i.test(unavailableError.message),
    "Local Runtime health failure did not surface a structured unavailable error",
  );
  const diagnosticOperation = await runtime.desktopDiagnostics.start({
    module: "runtime",
    component: "runtime-engine",
    operation: "fixture.runtime.connect",
    message: "Fixture Runtime connection started",
  });
  const failureEvent = await diagnosticOperation.fail(unavailableError);
  assert.equal(failureEvent.attributes?.runtimeUnavailable, true, "Runtime diagnostic did not mark unavailable state");
  assert.equal(failureEvent.attributes?.gatewayDiagnosticCode, "gateway_unauthorized", "Runtime diagnostic lost Gateway code");
  assert.equal(failureEvent.attributes?.gatewayHealthState, "unauthorized", "Runtime diagnostic lost /health state");
  assert.equal(failureEvent.attributes?.gatewayModelsState, "not_checked", "Runtime diagnostic must record deferred model discovery");

  const degraded = await runtime.listRuntimeWorktreeEvents({ workspacePath: temp, afterSequence: 9 });
  assert.deepEqual(degraded.events, [], "Degraded Worktree event poll must not fabricate events");
  assert.equal(degraded.nextSequence, 9, "Degraded Worktree event poll must preserve the caller cursor");
  assert.equal(degraded.degraded?.code, "local_runtime_unavailable", "Degraded Worktree event poll did not expose the Runtime reason");
  assert.equal(degraded.degraded?.retryable, true, "Local Runtime unavailable should remain retryable");

  await closeServer(unauthorizedServer);
  await new Promise((resolveListen) => tcpOccupant.listen(0, "127.0.0.1", resolveListen));
  const tcpAddress = tcpOccupant.address();
  assert(tcpAddress && typeof tcpAddress === "object", "TCP fixture did not expose a TCP port");
  Object.assign(process.env, {
    DRSAI_HOME: home,
    OPENDRSAI_GATEWAY_PORT: String(tcpAddress.port),
    OPENDRSAI_GATEWAY_INSTANCE_TOKEN: "fixture-runtime-token-0123456789abcdef",
  });
  const tcpRuntime = await import(`${pathToFileURL(bundle).href}?case=tcp-occupied`);
  const tcpStatus = await tcpRuntime.getGatewayStatus();
  assert.equal(tcpStatus.ready, false, "Non-HTTP port occupant unexpectedly reported ready");
  assert.equal(tcpStatus.portOpen, true, "Non-HTTP port occupant was not detected as an open port");
  assert.equal(tcpStatus.externalConflict, true, "Non-HTTP port occupant should be reported as a conflict");
  assert.equal(tcpStatus.diagnosticCode, "gateway_port_occupied", "Non-HTTP port occupant was not classified");
  await assert.rejects(
    () => tcpRuntime.LocalRuntimeClient.connect(),
    (error) => tcpRuntime.isLocalRuntimeUnavailableError(error)
      && error.gatewayStatus?.diagnosticCode === "gateway_port_occupied"
      && /non-OpenDrSai process|gateway_port_occupied/i.test(error.message)
      && !/failed its health check/i.test(error.message),
    "Non-HTTP port occupant did not surface a structured unavailable error",
  );

  await closeServer(tcpOccupant);
  await new Promise((resolveListen) => managedServer.listen(0, "127.0.0.1", resolveListen));
  const managedAddress = managedServer.address();
  assert(managedAddress && typeof managedAddress === "object", "Managed fixture did not expose a TCP port");
  Object.assign(process.env, {
    DRSAI_HOME: home,
    OPENDRSAI_GATEWAY_PORT: String(managedAddress.port),
    OPENDRSAI_GATEWAY_INSTANCE_TOKEN: "fixture-runtime-token-0123456789abcdef",
    OPENDRSAI_GATEWAY_PROBE_TIMEOUT_MS: "500",
    OPENDRSAI_GATEWAY_PROBE_CACHE_MS: "1",
    DRSAI_GATEWAY_DEV_MANAGED: "1",
  });
  const managedRuntime = await import(`${pathToFileURL(bundle).href}?case=managed-busy`);
  const busyStatus = await managedRuntime.getGatewayStatus();
  assert.equal(busyStatus.ready, false, "Slow managed Gateway unexpectedly reported ready");
  assert.equal(busyStatus.managed, true, "Slow managed Gateway lost its ownership state");
  assert.equal(busyStatus.externalConflict, false, "Slow managed Gateway was misclassified as an external conflict");
  assert.equal(busyStatus.diagnosticCode, "gateway_probe_timeout", "Slow managed Gateway did not preserve timeout diagnostics");
  assert.match(busyStatus.diagnosticMessage, /managed OpenDrSai Runtime is busy/i, "Managed timeout did not expose recovery guidance");

  setTimeout(() => { managedDelayMs = 0; }, 100);
  const recoveredClient = await managedRuntime.LocalRuntimeClient.connect();
  assert(recoveredClient, "A managed Runtime did not recover within the same connect call after a transient timeout");

  managedRequests.health = 0;
  managedRequests.models = 0;
  await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  const clients = await Promise.all(Array.from({ length: 20 }, () => managedRuntime.LocalRuntimeClient.connect()));
  assert.equal(clients.length, 20, "Concurrent managed Runtime connections did not recover");
  assert(
    managedRequests.health <= 2 && managedRequests.models === 0,
    `Concurrent connections did not share Gateway probes: ${JSON.stringify(managedRequests)}`,
  );

  console.log("Runtime health robustness verification passed.");
} finally {
  await closeServer(unauthorizedServer);
  await closeServer(tcpOccupant);
  await closeServer(managedServer);
  rmSync(temp, { recursive: true, force: true });
}

function closeServer(server) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 500);
    try {
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function captureError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail.");
}
