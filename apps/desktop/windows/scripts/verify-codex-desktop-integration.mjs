import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const temp = await mkdtemp(join(tmpdir(), "opendrsai-codex-desktop-"));
try {
  const bundle = join(temp, "integration.mjs");
  await build({ entryPoints: [join(root, "src/shared/agentBackendPresentation.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const presentation = await import(pathToFileURL(bundle).href);
  const context = { requestId: "request-1", sessionId: "session-1", runId: "run-1" };
  const event = (type, data = {}) => ({ event_id: `event-${type}`, run_id: "run-1", sequence: 1, type, data, created_at: "2026-01-01T00:00:00Z" });
  assert.equal(presentation.projectBackendEvent(event("agent.message.delta", { content: "hello" }), context)[0].type, "chunk");
  assert.equal(presentation.projectBackendEvent(event("item.file_change", { path: "owned.txt" }), context)[0].type, "file_event");
  assert.equal(presentation.projectBackendEvent(event("item.command", { operation: "git status" }), context)[0].type, "status");
  assert.equal(presentation.projectBackendEvent(event("run.completed"), context)[0].type, "done");
  assert.equal(presentation.projectBackendEvent(event("run.cancelled"), context)[0].type, "aborted");

  const commandApproval = presentation.projectBackendApproval(event("audit.codex.approval.requested", {
    approval_id: "approval-1", workspace_id: "workspace-1", run_id: "run-1", turn_id: "turn-1",
    operation: "item/commandExecution/requestApproval", request: { command: "npm test", reason: "Run tests" },
  }));
  assert.equal(commandApproval.source, "shell");
  assert.equal(commandApproval.target, "npm test");
  assert.match(commandApproval.scope, /workspace-1 \/ run-1/);
  const fileApproval = presentation.projectBackendApproval(event("audit.codex.approval.requested", {
    operation: "item/fileChange/requestApproval", request: { path: "src/app.ts", reason: "Apply patch" },
  }));
  assert.equal(fileApproval.source, "workspace");
  assert.equal(fileApproval.target, "src/app.ts");

  assert.equal(presentation.backendFailureRecovery("not_logged_in").kind, "permission_denied");
  assert.equal(presentation.backendFailureRecovery("codex_version_incompatible").retryable, false);
  assert.equal(presentation.backendFailureRecovery("codex_connection_eof").retryable, true);
  assert.deepEqual(presentation.backendRetryIdentity("unknown", "old-key"), { reuseKey: false, idempotencyKey: null });
  assert.deepEqual(presentation.backendRetryIdentity("pending", "safe-key"), { reuseKey: true, idempotencyKey: "safe-key" });

  const app = await readFile(join(root, "src/renderer/src/App.tsx"), "utf8");
  const locationBlock = app.slice(app.indexOf("workspaceLocationChoice === null"), app.indexOf("workspaceLocationChoice === \"remote\""));
  assert(locationBlock.includes('"本地" : "Local"') && locationBlock.includes('"远程" : "Remote"'));
  assert(!/Codex Workspace|Codex 工作区/.test(locationBlock), "Codex must not become a third Workspace location");
  const statusBundle = join(temp, "status.mjs");
  await build({ entryPoints: [join(root, "src/main/codexBackendStatus.ts")], outfile: statusBundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { presentCodexBackendStatus } = await import(pathToFileURL(statusBundle).href);
  const states = [
    presentCodexBackendStatus({ backend_id: "codex", available: true, version: "0.142.5" }, { logged_in: true, auth_mode: "chatgpt", email: "user@example.test", plan_type: "plus", credential_source: null, requires_openai_auth: true }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "codex_artifact_not_installed" }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "codex_version_incompatible" }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: true }, { logged_in: false, auth_mode: null, email: null, plan_type: null, credential_source: null, requires_openai_auth: true }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "codex_connection_eof" }).state,
  ];
  assert.deepEqual(states, ["available", "not_installed", "version_incompatible", "not_logged_in", "fault"]);
  assert(app.includes("codex-backend-status") && app.includes("codex-login") && app.includes("codex-logout"));

  const runtimeClient = await readFile(join(root, "src/main/runtimeClient.ts"), "utf8");
  for (const method of ["createSession", "createAgentRun", "executeAgentRun", "cancelAgentRun", "listAgentRunEvents", "respondAgentApproval"]) assert(runtimeClient.includes(method));
  for (const forbidden of ["thread/start", "turn/start", "account/read", "turn/interrupt"]) assert(!runtimeClient.includes(forbidden), `Desktop leaked Codex JSON-RPC ${forbidden}`);
  const chat = await readFile(join(root, "src/main/chat.ts"), "utf8");
  assert(chat.includes('request.agentId === "my-codex"'));
  assert(chat.includes('createAgentRun(session.session_id, "codex@1"'));
  assert(chat.includes('type: "chunk"') && chat.includes('type: "tool_timeline"') && chat.includes('inputType: "approval"'));
  assert(chat.includes("cancelAgentRun") && chat.includes("respondAgentApproval"));
  console.log("Codex Desktop product integration verification passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
