import assert from "node:assert/strict";
import { DuplexToolBridge, parseToolArguments, requiresApproval, serializeToolResult } from "../../shared/renderer/src/voice/duplex/toolBridge.ts";

assert.deepEqual(parseToolArguments('{"query":"voice","limit":3}'), { query: "voice", limit: 3 });
assert.throws(() => parseToolArguments("[]"), /JSON object/);
assert.throws(() => parseToolArguments(`{"x":"${"a".repeat(32_001)}"}`), /safe limit/);
assert.equal(requiresApproval("search_thread_messages"), false);
assert.equal(requiresApproval("delete_workspace_file"), true);
assert.doesNotMatch(serializeToolResult({ token: "secret", nested: { api_key: "key", value: "ok" } }), /secret|"key"/);

let executions = 0; let approvals = 0; const submitted = []; const statuses = [];
const bridge = new DuplexToolBridge({
  executor: { execute: async ({ arguments: args }) => { executions += 1; return { output: { rows: [args.query], token: "do-not-leak" } }; } },
  approval: { decide: async () => { approvals += 1; return "allow"; } },
  isSessionActive: () => true,
  submitResult: async (callId, output) => { submitted.push({ callId, output }); return true; },
  onStatus: (callId, status) => statuses.push(`${callId}:${status}`),
});
const query = { callId: "c1", itemId: "i1", name: "search_thread_messages", argumentsJson: '{"query":"duplex"}' };
const [first, replay] = await Promise.all([bridge.handle(query), bridge.handle(query)]);
assert.equal(first, "completed"); assert.equal(replay, "completed"); assert.equal(executions, 1); assert.equal(approvals, 0); assert.equal(submitted.length, 1);
assert.match(submitted[0].output, /\[redacted\]/); assert.equal(bridge.callCount, 1);

const mutation = { callId: "c2", itemId: "i2", name: "write_workspace_file", argumentsJson: '{"path":"a.txt"}' };
assert.equal(await bridge.handle(mutation), "completed"); assert.equal(approvals, 1); assert.ok(statuses.includes("c2:waiting_approval"));
let rejectedExecutions = 0; const rejectedResults = [];
const rejected = new DuplexToolBridge({ executor: { execute: async () => { rejectedExecutions += 1; return { output: "bad" }; } }, approval: { decide: async () => "reject" }, isSessionActive: () => true, submitResult: async (_callId, output) => { rejectedResults.push(output); return true; } });
assert.equal(await rejected.handle({ ...mutation, callId: "c3" }), "rejected"); assert.equal(rejectedExecutions, 0); assert.match(rejectedResults[0], /rejected/);

let resolveTool; let active = true; const lateSubmits = [];
const late = new DuplexToolBridge({ executor: { execute: () => new Promise((resolve) => { resolveTool = resolve; }) }, approval: { decide: async () => "allow" }, isSessionActive: () => active, submitResult: async (...args) => { lateSubmits.push(args); return true; } });
const pending = late.handle({ ...mutation, callId: "c4" }); await Promise.resolve(); await Promise.resolve(); late.detach(); active = false; resolveTool({ output: "done", sideEffectCommitted: true });
assert.equal(await pending, "detached"); assert.equal(lateSubmits.length, 0, "late result cannot target an old Session");

console.log("Duplex Voice M8 tools verified (schema, safe reads, approval, call_id idempotency, status, redaction, side-effect truth, and late-session isolation).")
