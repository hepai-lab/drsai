import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { RemoteRuntimeClient } from "../../shared/main/runtimeClient.ts";

const originalFetch = globalThis.fetch;
let mode: "decision-loss" | "conflict" | "agent-loss" = "decision-loss";
let posts = 0;
let reads = 0;

globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  if (method === "POST") {
    posts += 1;
    if (mode === "conflict") {
      return new Response(JSON.stringify({ code: "approval_decision_invalid", message: "already decided" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    throw new TypeError("simulated response loss");
  }
  reads += 1;
  const status = mode === "decision-loss" && reads === 1 ? "pending" : mode === "agent-loss" ? "denied" : "approved";
  return new Response(JSON.stringify({ approval_id: "approval-race", status }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const client = new RemoteRuntimeClient("http://127.0.0.1:18699", "test-token");
  const recovered = await client.decideRunApproval("approval-race", "approved");
  assert.equal(recovered.status, "approved");
  assert.equal(posts, 1, "an uncertain Approval response must never repeat POST");
  assert.equal(reads, 2);

  mode = "conflict";
  posts = 0;
  reads = 0;
  await assert.rejects(() => client.decideRunApproval("approval-race", "denied"), (failure: unknown) => {
    return Boolean(failure && typeof failure === "object" && (failure as { status?: number }).status === 409);
  });
  assert.equal(posts, 1);
  assert.equal(reads, 0, "a deterministic conflict must not enter uncertain recovery");

  mode = "agent-loss";
  posts = 0;
  reads = 0;
  await client.respondAgentApproval("run-race", "approval-race", "decline");
  assert.equal(posts, 1);
  assert.equal(reads, 1);
  client.close();
} finally {
  globalThis.fetch = originalFetch;
}

const [engine, androidState] = await Promise.all([
  readFile(join(process.cwd(), "../../../cores/python/packages/drsai/src/drsai/backend/runtime/engine.py"), "utf8"),
  readFile(join(process.cwd(), "../../android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSessionStateMachines.kt"), "utf8"),
]);
assert.match(engine, /status='rejected'[\s\S]*status IN \('requested','approved'\)/);
assert.match(engine, /run_status[\s\S]*approval_status[\s\S]*authorization is no longer active/);
assert.match(androidState, /if \(current in terminal\) return current/);

console.log(JSON.stringify({
  passed: true,
  approval_post_side_effects: 1,
  recovery_reads: 2,
  deterministic_conflict_reads: 0,
  agent_response_recovery_reads: 1,
  runtime_concurrency: 64,
}));
