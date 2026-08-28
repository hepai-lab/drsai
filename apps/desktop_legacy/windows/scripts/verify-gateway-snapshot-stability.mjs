import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-gateway-snapshot-"));
const bundle = join(temp, "gateway-snapshot.mjs");
let healthDelayMs = 0;
const server = createServer((request, response) => {
  if (request.url === "/health") {
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
    }, healthDelayMs);
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "not_found" } }));
});

try {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert(address && typeof address === "object");
  Object.assign(process.env, {
    DRSAI_HOME: join(temp, "home"),
    OPENDRSAI_GATEWAY_PORT: String(address.port),
    OPENDRSAI_GATEWAY_INSTANCE_TOKEN: "fixture-runtime-token-0123456789abcdef",
    OPENDRSAI_GATEWAY_PROBE_CACHE_MS: "1",
    OPENDRSAI_GATEWAY_PROBE_TIMEOUT_MS: "500",
    OPENDRSAI_GATEWAY_FAILURE_THRESHOLD: "3",
    OPENDRSAI_GATEWAY_DEGRADED_GRACE_MS: "10000",
    DRSAI_GATEWAY_DEV_MANAGED: "1",
  });
  await build({
    stdin: {
      contents: 'export { getGatewaySnapshot, getGatewayStatus } from "./../shared/main/gateway.ts";',
      resolveDir: desktop,
      sourcefile: "gateway-snapshot-stability.ts",
    },
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["electron"],
  });
  const runtime = await import(pathToFileURL(bundle).href);
  const verified = await runtime.getGatewayStatus();
  assert.equal(verified.ready, true, "Fixture Runtime did not become ready");
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  const snapshot = runtime.getGatewaySnapshot();
  assert.equal(snapshot.ready, true, "Probe TTL expiry incorrectly changed Runtime readiness");
  assert.equal(snapshot.diagnosticCode, "gateway_ready", "Snapshot lost the last verified diagnostics");

  healthDelayMs = 700;
  const firstTimeout = await runtime.getGatewayStatus();
  assert.equal(firstTimeout.ready, true, "One transient timeout must preserve the last verified connection");
  assert.equal(firstTimeout.liveness.state, "degraded", "One timeout must enter degraded, not fault");
  assert.equal(firstTimeout.liveness.observedReady, false, "Timeout must remain visible as the latest observation");
  assert.equal(firstTimeout.liveness.effectiveReady, true, "Last-known-good must remain effective during grace");
  assert.equal(firstTimeout.diagnosticCode, "gateway_reconnecting", "Transient timeout needs retry diagnostics");

  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  const secondTimeout = await runtime.getGatewayStatus();
  assert.equal(secondTimeout.ready, true, "Two transient timeouts must remain inside the configured threshold");
  assert.equal(secondTimeout.liveness.state, "reconnecting", "Repeated timeout must expose reconnecting state");

  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  const confirmedFailure = await runtime.getGatewayStatus();
  assert.equal(confirmedFailure.ready, false, "Three consecutive timeouts must confirm an actionable failure");
  assert.equal(confirmedFailure.liveness.state, "action_required", "Confirmed busy Runtime must require action");

  healthDelayMs = 0;
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  const recovered = await runtime.getGatewayStatus();
  assert.equal(recovered.ready, true, "A healthy observation must automatically clear a confirmed failure");
  assert.equal(recovered.liveness.state, "ready", "Recovered Runtime must return to ready");
  assert.equal(recovered.liveness.consecutiveFailures, 0, "Recovery must clear the failure counter");
  assert.ok(recovered.liveness.generation > verified.liveness.generation, "Recovery must advance observation generation");
  console.log("Gateway snapshot stability verification passed.");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(temp, { recursive: true, force: true });
}
