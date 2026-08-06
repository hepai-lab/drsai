import assert from "node:assert/strict";
import { LocalRuntimeClient } from "../../shared/main/runtimeClient";

const observed: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  observed.push(url);
  if (url.includes("/inspection")) return new Response(JSON.stringify({
    schema_version: "opendrsai.run-inspection/1",
    run: { run_id: "run-1", session_id: "session-1", workspace_id: "workspace-1", backend_id: "codex", agent_definition: "codex@1", status: "completed", created_at: new Date().toISOString() },
    summary: { duration_ms: 10, counts_by_item_type: {}, counts_by_status: {}, error: null, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, artifact_count: 0, warning_count: 0 },
    timeline: [],
    manifest: { schema_version: "opendrsai.run-manifest/1", run_id: "run-1", manifest: {}, manifest_digest: "a", safe_manifest_digest: "b", reproducibility_level: "partial", missing_evidence: [], created_at: new Date().toISOString(), finalized_at: null },
    page: { next_cursor: null, has_more: false },
  }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("reproduction-manifest")) return new Response(JSON.stringify({
    schema_version: "opendrsai.run-manifest/1", run_id: "run-1", manifest: {}, manifest_digest: "a", safe_manifest_digest: "b", reproducibility_level: "partial", missing_evidence: [], created_at: new Date().toISOString(), finalized_at: null,
  }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ schema_version: "opendrsai.run-inspection/1", object: "list", data: [], next_cursor: null, has_more: false }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

try {
  const client = LocalRuntimeClient.forAccess("http://127.0.0.1:9911", { "X-OpenDrSai-Gateway-Token": "test-token" });
  await client.listSessionRuns("session/one", "cursor one", 25, "completed");
  await client.getRunInspection("run/one", "cursor two", 50, "tool_call", "failed");
  const manifest = await client.getRunReproductionManifest("run/one");
  const exported = await client.exportRunReproductionManifest("run/one");

  assert.ok(observed[0].includes("/v1/sessions/session%2Fone/runs?"));
  assert.ok(observed[0].includes("cursor=cursor+one"));
  assert.ok(observed[0].includes("status=completed"));
  assert.ok(observed[1].includes("/v1/runs/run%2Fone/inspection?"));
  assert.ok(observed[1].includes("timeline_cursor=cursor+two"));
  assert.ok(observed[1].includes("type=tool_call"));
  assert.ok(observed[1].includes("status=failed"));
  assert.equal(manifest.run_id, "run-1");
  assert.equal(exported.run_id, "run-1");
  assert.ok(observed[3].includes("/v1/runs/run%2Fone/reproduction-manifest/export"));
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Run Inspection Desktop contract verification passed.");
