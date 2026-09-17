import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getExternalAgentRuntimeDescriptor,
  listExternalAgentRuntimeAgents,
  parseExternalAgentRuntimeManifest,
} from "../main/externalAgentRuntimes.ts";
import { ExternalOaepRuntimeClient } from "../main/externalOaepRuntimeClient.ts";
import { OAEP_SCHEMA_SHA256 } from "../api/oaep.generated.ts";

const root = mkdtempSync(join(tmpdir(), "opendrsai-dsh-registry-"));
try {
  const tokenPath = join(root, "dsh.token");
  const token = "runtime-secret-".padEnd(48, "x");
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  const manifest = {
    schema_version: 1,
    runtime_id: "runtime-dsh-fixture",
    endpoint: { base_url: "http://127.0.0.1:43871", bearer_token_file: tokenPath },
    agent: {
      id: "runtime:deepseek-harness",
      name: "DeepSeek Harness",
      description: "DeepSeek Harness through OAEP Runtime Bridge.",
      owner: "DeepSeek",
    },
    protocols: {
      control: { version: "1" },
      oaep: {
        version: "1.0",
        profiles: ["oaep.session-stream/1"],
        schema_sha256: OAEP_SCHEMA_SHA256,
      },
    },
  };
  assert.equal(parseExternalAgentRuntimeManifest(manifest, { registryRoot: root }).agent.id, "runtime:deepseek-harness");
  assert.throws(
    () => parseExternalAgentRuntimeManifest({ ...manifest, endpoint: { ...manifest.endpoint, base_url: "http://example.com" } }, { registryRoot: root }),
    /HTTPS or loopback/,
  );
  assert.throws(
    () => parseExternalAgentRuntimeManifest({ ...manifest, endpoint: { ...manifest.endpoint, bearer_token_file: join(root, "..", "escape.token") } }, { registryRoot: root }),
    /outside the registry root/,
  );

  writeFileSync(join(root, "deepseek-harness.json"), JSON.stringify(manifest));
  let initializeCalls = 0;
  const probeFetch: typeof fetch = async (_input, init) => {
    initializeCalls += 1;
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    return Response.json({
      runtime_id: manifest.runtime_id,
      protocols: manifest.protocols,
      native_runtime: { version: "0.2.0" },
      mapping_version: "dsh-oaep/v2",
      generation: 3,
      availability: "production",
      capabilities: ["run.start", "run.cancel", "approval.respond", "session.events.stream"],
    });
  };
  const agents = await listExternalAgentRuntimeAgents({ registryRoot: root, fetcher: probeFetch });
  assert.equal(initializeCalls, 1);
  assert.deepEqual(agents.map(({ id, mode, available }) => ({ id, mode, available })), [{
    id: "runtime:deepseek-harness", mode: "oaep-runtime", available: true,
  }]);
  assert.equal(getExternalAgentRuntimeDescriptor("runtime:deepseek-harness")?.generation, 3);

  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    if (url.endsWith("/v1/sessions")) return Response.json({ session: { id: "session-dsh" } });
    if (url.endsWith("/v1/sessions/session-dsh/runs")) return Response.json({ run_id: "run-dsh", status: "starting" });
    if (url.includes("/oaep-events/stream")) return new Response(
      'id: 7\nevent: oaep\ndata: {"version":"1.0","event_id":"event-7","session_id":"session-dsh","run_id":"run-dsh","sequence":7,"type":"event.run.completed","timestamp":"2026-08-16T00:00:00Z","dedupe_key":"terminal","source":{"backend":"deepseek-harness"},"data":{}}\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
    return Response.json({ error: { code: "unexpected", message: "Unexpected route", retryable: false } }, { status: 404 });
  };
  try {
    const descriptor = getExternalAgentRuntimeDescriptor("runtime:deepseek-harness");
    assert.ok(descriptor);
    const client = new ExternalOaepRuntimeClient(descriptor);
    assert.equal(await client.createSession("session-key"), "session-dsh");
    assert.equal((await client.startRun("session-dsh", "run-key", [{ type: "text", text: "hello" }])).run_id, "run-dsh");
    assert.equal((await client.waitEvents("session-dsh", 6))[0]?.sequence, 7);
    assert.equal(requests.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write("DSH external OAEP Runtime registration and client contract passed.\n");
