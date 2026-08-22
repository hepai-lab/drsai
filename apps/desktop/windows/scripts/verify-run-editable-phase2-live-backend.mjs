import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopRoot, "../../..");
const required = ["OPENDRSAI_LIVE_GATEWAY_URL", "OPENDRSAI_LIVE_ACCESS_TOKEN", "OPENDRSAI_LIVE_WORKSPACE_PATH", "OPENDRSAI_LIVE_AGENT_DEFINITION"];
for (const name of required) assert.ok(process.env[name]?.trim(), `${name} is required for the account-backed nightly/RC smoke`);
const baseUrl = process.env.OPENDRSAI_LIVE_GATEWAY_URL.replace(/\/+$/, "");
const accessToken = process.env.OPENDRSAI_LIVE_ACCESS_TOKEN;
const gatewayToken = process.env.OPENDRSAI_LIVE_GATEWAY_TOKEN?.trim();
const workspacePath = process.env.OPENDRSAI_LIVE_WORKSPACE_PATH;
const agentDefinition = process.env.OPENDRSAI_LIVE_AGENT_DEFINITION;
const backendId = process.env.OPENDRSAI_LIVE_BACKEND_ID?.trim() || "codex";
const model = process.env.OPENDRSAI_LIVE_MODEL?.trim();
const principal = process.env.OPENDRSAI_LIVE_PRINCIPAL_ID?.trim() || decodeSubject(accessToken);
const evidencePath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-editable-phase2-live-backend-result.json");
const commonHeaders = { Authorization:`Bearer ${accessToken}`, "X-OpenDrSai-Auth-Mode":"oidc", "X-OpenDrSai-Principal":principal, ...(gatewayToken ? { "X-OpenDrSai-Gateway-Token":gatewayToken } : {}) };
const json = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers:{ ...commonHeaders, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${body?.error?.code || body?.detail?.code || "request_failed"}`);
  return body;
};
const post = (path, body, idempotencyKey) => json(path, { method:"POST", headers:{ "Content-Type":"application/json", ...(idempotencyKey ? { "Idempotency-Key":idempotencyKey } : {}) }, body:JSON.stringify(body) });

const startedAt = new Date().toISOString();
const account = await json(`/v1/agent-backends/${encodeURIComponent(backendId)}/account?refresh=true`);
assert.equal(account.logged_in, true, `real ${backendId} account is not logged in`);
const workspace = await post("/v1/workspaces", { path:workspacePath, display_name:"P2 live backend smoke" });
const session = await post("/v1/sessions", { workspace_id:workspace.workspace_id, title:"P2 live backend smoke", agent_definition:agentDefinition, backend_id:backendId });
const run = await post(`/v1/sessions/${encodeURIComponent(session.session_id)}/runs`, { agent_definition:agentDefinition }, `p2-live-run:${randomUUID()}`);
const prompt = process.env.OPENDRSAI_LIVE_READ_ONLY_PROMPT?.trim() || "Call the Runtime tool workspace.inspect exactly once with empty arguments, then briefly summarize only its returned metadata.";
const execution = await post(`/v1/runs/${encodeURIComponent(run.run_id)}/execute`, { prompt, user_id:principal, ...(model ? { model } : {}), metadata:{ source_client:"windows", source_message_id:`p2-live:${randomUUID()}`, acceptance_scenario:"M31-02" } });
assert.equal(execution.run?.status, "completed", "real Backend run did not complete");
const inspection = await json(`/v1/runs/${encodeURIComponent(run.run_id)}/inspection?limit=500`);
const manifest = await json(`/v1/runs/${encodeURIComponent(run.run_id)}/reproduction-manifest`);
const readOnlyTool = inspection.timeline.find((item) => item.type === "tool_call" && item.content?.tool_name === "workspace.inspect" && item.content?.replay_policy?.classification === "read_only_mutable");
assert.ok(readOnlyTool, "real model did not call the required read-only Runtime tool");
const experiment = await post(`/v1/runs/${encodeURIComponent(run.run_id)}/experiments`, { title:"P2 live replay review", replay_mode:"reuse_recorded_results" }, `p2-live-experiment:${randomUUID()}`);
const plan = await post(`/v1/experiments/${encodeURIComponent(experiment.experiment_id)}/replay-plan`, { expected_draft_version:experiment.draft_version, availability:{ worktree:true } });
assert.ok(plan.steps.some((step) => step.kind === "tool_call" && step.decision === "reexecute" && step.comparison_required === true), "read-only mutable Tool was not planned for fresh read and comparison");
const sourceFiles = ["cores/python/packages/drsai/src/drsai/backend/gateway.py", "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py", "cores/python/packages/drsai/src/drsai/backend/runtime/replay_planner.py", "apps/desktop/windows/scripts/verify-run-editable-phase2-live-backend.mjs"];
const source = createHash("sha256");
for (const path of [...sourceFiles].sort()) { source.update(path); source.update("\0"); source.update(readFileSync(resolve(repoRoot, path))); source.update("\0"); }
const evidence = { schema_version:"opendrsai.run-editable-phase2-live-backend-result/1", generated_at:new Date().toISOString(), started_at:startedAt, commit:execFileSync("git", ["rev-parse","HEAD"], { cwd:repoRoot, encoding:"utf8", windowsHide:true }).trim(), source_digest:source.digest("hex"), backend_id:backendId, model:model || null, account_backed:true, controlled_model:false, simulated_external_service:false, workspace_id:workspace.workspace_id, session_id:session.session_id, run_id:run.run_id, run_status:execution.run.status, manifest_digest:manifest.manifest_digest, tool:{ name:"workspace.inspect", classification:"read_only_mutable", item_id:readOnlyTool.id }, replay_plan:{ plan_id:plan.replay_plan_id, policy_version:plan.policy_version, mutable_decision:"reexecute" }, proof_scope:["real_backend_account","real_model_execute","runtime_read_only_tool","oaep_inspection","manifest","replay_policy"], not_proven:["deterministic_model_output","external_write_tool_execution"] };
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Phase 2 real Backend nightly/RC smoke passed; evidence: ${evidencePath}\n`);

function decodeSubject(token) {
  try { const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); assert.equal(typeof payload.sub, "string"); return payload.sub; }
  catch { throw new Error("OPENDRSAI_LIVE_PRINCIPAL_ID is required when the access token subject cannot be decoded"); }
}
