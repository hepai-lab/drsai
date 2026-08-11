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
  await build({ entryPoints: [join(root, "../shared/api/agentBackendPresentation.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
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

  const app = await readFile(join(root, "../shared/renderer/src/App.tsx"), "utf8");
  const windowsMain = await readFile(join(root, "src/main/index.ts"), "utf8");
  for (const phase of ["discovered", "read", "projected", "persisted", "cancelled"]) {
    assert(windowsMain.includes(`emit(\"${phase}\"`), `Workspace sync must report the ${phase} phase`);
  }
  assert(windowsMain.includes("controller.signal.throwIfAborted()"));
  assert(windowsMain.includes('secureHandle("desktop:cancel-codex-workspace-session-sync"'));
  assert(app.includes("cancelCodexWorkspaceSessionSync(requestId)"), "Cancel must reach Main instead of only hiding a late result");
  for (const command of [
    'action === "resync_workspace"', 'syncWorkspaceSessions(activeWorkspace)',
    'action === "repair_codex"', 'desktopApi.restartCodexBackend()',
    'action === "new_task"', 'await handleNewChat()',
    'action === "diagnostics"', 'setActiveRightTab("debug")',
  ]) assert(app.includes(command), `Recovery UI is missing command routing: ${command}`);
  const chatWorkspace = await readFile(join(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
  assert(chatWorkspace.includes('className="chat-recovery-actions"') && chatWorkspace.includes("onRecoveryAction(message.id, action.id)"));
  assert(app.includes("health?.update.currentVersion"), "About must show the Electron Desktop version, not the Runtime version");
  const locationStart = app.indexOf('data-testid="workspace-type-local"');
  const locationBlock = app.slice(locationStart, app.indexOf('workspaceLocationChoice === "local" ?', locationStart));
  assert(locationStart >= 0 && locationBlock.includes('"本地" : "Local"') && locationBlock.includes('data-testid="workspace-type-remote"') && locationBlock.includes('"远程" : "Remote"'));
  assert(!/Codex Workspace|Codex 工作区/.test(locationBlock), "Codex must not become a third Workspace location");
  const statusBundle = join(temp, "status.mjs");
  await build({ entryPoints: [join(root, "src/main/codexBackendStatus.ts")], outfile: statusBundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { presentCodexBackendStatus } = await import(pathToFileURL(statusBundle).href);
  const readiness = (installed, contract) => ({
    refreshed_at: "2026-08-05T00:00:00Z",
    transport: { state: installed === "ready" ? "ready" : "fault" }, installed: { state: installed },
    contract: { state: contract }, account: { state: "unknown", reason: "not_probed" },
    models: { state: "ready" }, executable: { state: "unknown", reason: "account_not_probed" },
  });
  const states = [
    presentCodexBackendStatus({ backend_id: "codex", available: true, version: "0.142.5", readiness: readiness("ready", "ready") }, { state: "signed_in", logged_in: true, auth_mode: "chatgpt", email: "user@example.test", plan_type: "plus", credential_source: null, requires_openai_auth: true }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "opaque", readiness: readiness("missing", "unknown") }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "opaque", readiness: readiness("ready", "blocked") }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: true, readiness: readiness("ready", "ready") }, { state: "signed_out", logged_in: false, auth_mode: null, email: null, plan_type: null, credential_source: null, requires_openai_auth: true }).state,
    presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "opaque", readiness: readiness("unknown", "unknown") }).state,
  ];
  assert.deepEqual(states, ["available", "not_installed", "version_incompatible", "not_logged_in", "fault"]);
  const detailedStatus = presentCodexBackendStatus({
    backend_id: "codex", available: true, version: "0.142.5", connection_state: "ready",
    app_server_state: "running", transport: "local-process", adapter_version: "oaep-codex/2.0",
  }, { state: "signed_in", logged_in: true, auth_mode: "chatgpt", email: "user@example.test", plan_type: "plus", credential_source: null, requires_openai_auth: true });
  assert.equal(detailedStatus.appServerState, "running");
  assert.equal(detailedStatus.transport, "local-process");
  assert.equal(detailedStatus.adapterVersion, "oaep-codex/2.0");
  assert(app.includes("codex-backend-status") && app.includes("codex-login") && app.includes("codex-logout"));
  assert(app.includes("conversationHistory=") && app.includes("continuesExistingTask="), "Codex history trust and continuation state must reach the chat UI");
  const errorsBundle = join(temp, "user-facing-errors.mjs");
  await build({ entryPoints: [join(root, "../shared/renderer/src/userFacingErrors.ts")], outfile: errorsBundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { describeUserFacingError } = await import(pathToFileURL(errorsBundle).href);
  const connectionError = describeUserFacingError({ code: "codex_connection_eof", retryable: true, message: "token=secret" }, "zh");
  assert.equal(connectionError.title, "OpenDrSai 暂时无法连接后端。");
  assert(!connectionError.title.includes("codex_connection_eof") && !connectionError.action.includes("secret"));
  const resumeError = describeUserFacingError({ code: "codex_session_recovery_required", retryable: false, message: "internal developer text" }, "zh");
  assert.deepEqual(resumeError.actions.map((action) => action.id), ["resync_workspace", "new_task", "diagnostics"]);
  assert(!resumeError.title.includes("codex_session_recovery_required") && !resumeError.action.includes("internal developer text"));

  const gateway = await readFile(join(root, "../shared/main/gateway.ts"), "utf8");
  assert(gateway.includes("getLocalCodexDevelopmentEnv") && gateway.includes('DRSAI_CODEX_DEVELOPMENT: "1"'));
  assert(gateway.includes("desktopAppRuntime.isPackaged") && gateway.includes("return {}"), "packaged releases must leave Codex discovery and signature verification to the product Runtime provider");
  assert(gateway.includes('"node_modules", ".bin", "codex.cmd"'), "development must prefer the project-owned standalone CLI");
  assert(gateway.includes('/\\\\WindowsApps\\\\/i'), "inaccessible Windows Store package members must not be advertised as available");

  const runtimeClient = await readFile(join(root, "../shared/main/runtimeClient.ts"), "utf8");
  for (const method of ["createSession", "updateSession", "getAgentRun", "createAgentRun", "executeAgentRun", "cancelAgentRun", "listAgentRunEvents", "respondAgentApproval"]) assert(runtimeClient.includes(method));
  for (const forbidden of ["thread/start", "turn/start", "account/read", "turn/interrupt"]) assert(!runtimeClient.includes(forbidden), `Desktop leaked Codex JSON-RPC ${forbidden}`);
  const chat = await readFile(join(root, "../shared/main/chat.ts"), "utf8");
  const oaepProjector = await readFile(join(root, "../shared/main/oaepPresentationProjector.ts"), "utf8");
  assert(chat.includes('request.agentId === "my-codex"'));
  assert(chat.includes("createAgentRun(") && chat.includes("runtimeSessionId,") && chat.includes("agentDefinition,"));
  assert(chat.includes("existingThread?.runtimeSessionId"), "Codex follow-up turns must reuse the mapped Runtime Session");
  assert(chat.includes("codex_session_recovery_required"), "A missing Codex binding must never silently create a replacement task");
  assert(chat.includes("client.getBackendSessionBinding(existingThread.id)") && chat.includes("codexContinuationAction(binding)"), "Codex continuation must use the authoritative Runtime binding state");
  assert(chat.includes('syncBackendSessions(resolved.workspaceId, "codex", controller.signal)'), "Imported Codex tasks must auto-sync before recovery is required");
  assert(chat.includes("projectOaepEventForPresentation") && chat.includes('type: "structured"'));
  assert(chat.includes("cancelAgentRun") && chat.includes("respondAgentApproval"));
  assert(chat.includes("export async function recoverChatRun"), "Codex Run output must be recoverable after an Electron restart");
  assert(oaepProjector.includes('event.type === "event.item.delta"') && oaepProjector.includes('kind: "markdown.append"'), "Codex deltas must reach the StructuredConversation event stream");
  assert(oaepProjector.includes('kind: "reasoning.append"'), "Codex reasoning must use the structured reasoning part");
  assert(oaepProjector.includes("projectOaepAssistantItem"), "Codex tools and file changes must share the history/live OAEP Item projection");
  const recoveryBlock = chat.slice(chat.indexOf("export async function recoverChatRun"), chat.indexOf("export async function respondChatInput"));
  assert(recoveryBlock.includes("mapRuntimeOaepEvent") && recoveryBlock.includes("hasOaepTerminal"), "Recovered Codex runs must settle through the shared OAEP projector");
  assert(!recoveryBlock.includes('push({ type: "done"') && !recoveryBlock.includes('push({ type: "error"'), "Recovery must not synthesize a second legacy terminal");
  const adapter = await readFile(join(root, "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
  assert(adapter.includes("desktopApi.recoverChatRun"), "Renderer must request Codex Run replay for an interrupted turn");
  assert(adapter.includes("structuredRequests.current.delete(requestId)"), "Recovered plain-text deltas must not be suppressed as structured events");
  assert(app.includes("archived-threads-settings"), "Settings must expose the archived-session center");
  const threads = await readFile(join(root, "../shared/main/threads.ts"), "utf8");
  assert(threads.includes("archivedAt") && threads.includes("archiveSource"), "Archive state must retain its timestamp and source");
  assert(threads.includes("writeAtomicJson") && threads.includes("parseStoredJson"), "Thread storage must survive interrupted writes without discarding a reusable Codex Session");
  const archive = await readFile(join(root, "src/main/threadArchive.ts"), "utf8");
  assert(archive.includes("updateSession") && archive.includes("getAgentRun"), "Archive actions must go through Runtime and recover legacy Session bindings");
  const devScript = await readFile(join(root, "scripts/dev.ps1"), "utf8");
  assert(
    devScript.includes("Restarting the source Gateway to load current Python code")
      && !devScript.includes("OK Source Gateway already ready"),
    "Windows development startup must restart a dev-managed Gateway so Codex Adapter changes take effect",
  );
  assert(
    devScript.includes("Get-GatewayInstanceToken")
      && devScript.includes("X-OpenDrSai-Gateway-Token")
      && devScript.includes("$env:OPENDRSAI_GATEWAY_INSTANCE_TOKEN = $instanceToken")
      && devScript.includes('"-InstanceTokenPath"')
      && devScript.includes("-Headers $gatewayHeaders -Method Post"),
    "Source Gateway startup, readiness probes, and shutdown must share the Desktop instance token",
  );
  const gatewayWatcher = await readFile(join(root, "scripts/watch-gateway.ps1"), "utf8");
  assert(
    gatewayWatcher.includes("[string]$InstanceTokenPath")
      && gatewayWatcher.includes("Set-GatewayChildToken")
      && gatewayWatcher.includes("$env:OPENDRSAI_GATEWAY_INSTANCE_TOKEN = $token")
      && gatewayWatcher.includes("^[A-Za-z0-9_-]{32,128}$")
      && !gatewayWatcher.includes("[string]$InstanceToken,"),
    "The source watcher must reload the bounded token file for every child without exposing the token on its command line",
  );
  const desktopDevEntry = await readFile(join(root, "../windows-desktop-dev.cmd"), "utf8");
  assert(
    desktopDevEntry.includes("-LaunchMode Development") && !desktopDevEntry.includes("-HotLoad"),
    "The canonical apps/desktop development entry must leave Gateway hot-load opt-in",
  );
  console.log("Codex Desktop product integration verification passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
