import assert from "node:assert/strict";
import {
  configureRuntimeWorkspaceRouting,
  getRuntimeClientRegistryDiagnostics,
  invalidateRuntimeClientRegistry,
  retainRuntimeClient,
  withRuntimeClientForWorkspace,
} from "../../shared/main/runtimeClient";

const originalFetch = globalThis.fetch;
let manifestSignal: AbortSignal | undefined;
let releaseManifestResponse: (() => void) | undefined;
let manifestStarted: (() => void) | undefined;
const manifestDidStart = new Promise<void>((resolve) => { manifestStarted = resolve; });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/v1/runtime")) {
    return new Response(JSON.stringify({
      runtime_id: "runtime-lease-test",
      instance_id: "instance-lease-test",
      version: "test",
      protocol_version: 1,
      platform: "win32",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/v1/runs/run-lease-test/reproduction-manifest")) {
    manifestSignal = init?.signal ?? undefined;
    manifestStarted?.();
    await new Promise<void>((resolve, reject) => {
      releaseManifestResponse = resolve;
      manifestSignal?.addEventListener("abort", () => reject(manifestSignal?.reason), { once: true });
    });
    return new Response(JSON.stringify({ run_id: "run-lease-test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`Unexpected Runtime request: ${url}`);
}) as typeof fetch;

configureRuntimeWorkspaceRouting({
  getRemoteGatewayAccess: () => ({
    baseUrl: "http://127.0.0.1:28642",
    token: "lease-test-token",
    workspaceId: "workspace-lease-test",
    authGeneration: "lease-test-generation",
  }),
  findWorkspaceById: async () => undefined,
});

try {
  const manifestPromise = withRuntimeClientForWorkspace(
    "C:\\workspace-lease-test",
    "workspace-lease-test",
    async ({ client }) => {
      // Model the live OAEP controller that owns the client before chat teardown.
      const releaseOaepController = retainRuntimeClient(client);
      const pendingManifest = client.getRunReproductionManifest("run-lease-test");
      await manifestDidStart;
      releaseOaepController();
      assert.equal(manifestSignal?.aborted, false,
        "OAEP teardown must not close a client borrowed by an in-flight manifest request");
      releaseManifestResponse?.();
      return pendingManifest;
    },
  );
  assert.equal((await manifestPromise).run_id, "run-lease-test");
  assert.equal(getRuntimeClientRegistryDiagnostics().some((entry) => entry.references > 0), false,
    "finite Runtime operation leases must always be released");
} finally {
  invalidateRuntimeClientRegistry();
  globalThis.fetch = originalFetch;
}

console.log("Runtime client finite-operation lease verification passed.");
