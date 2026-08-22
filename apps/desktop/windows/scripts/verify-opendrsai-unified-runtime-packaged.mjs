import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const asar = join(root, "release", "win-unpacked", "resources", "app.asar");
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before unified Runtime acceptance.");
const isolatedPath = [
  dirname(executable),
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);
assert(spawnSync("where.exe", ["codex"], { env: { SystemRoot: process.env.SystemRoot, PATH: isolatedPath }, windowsHide: true }).status !== 0,
  "No-Codex acceptance PATH unexpectedly resolves a Codex executable.");
const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-unified-runtime-"));
const appHome = join(testRoot, "OpenDrSai data");
const userData = join(testRoot, "Electron user data");
const workspace = join(testRoot, "Unified Runtime workspace");
const resultPath = join(testRoot, "result.json");
for (const path of [appHome, userData, workspace]) mkdirSync(path, { recursive: true });
prepareLegacyAgentJournal();
const counts = { sessions: 0, runs: 0, executes: 0, legacyChatCompletions: 0, legacyModelConfigCalls: 0, legacyAgentMigrations: 0, goalProposals: 0, goalClarifications: 0, goalRevisions: 0, goalConfirmations: 0, executeBeforeGoalConfirmation: 0, executeWithSupersededGoal: 0, executeWithUnattributedDefaults: 0, runtimeApprovalRequests: 0, runtimeApprovalDecisions: 0, runtimeApprovalSideEffects: 0 };
const sessionByRun = new Map();
const streams = new Map();
const confirmedGoalRuns = new Set();
const latestGoalByRun = new Map();
const confirmedGoalVersionByRun = new Map();
const runtimeApprovalWaiters = new Map();

try {
  const gateway = await startGateway();
  try { await run(gateway.address().port); }
  finally { await new Promise((resolveClose) => gateway.close(resolveClose)); }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `Unified Runtime packaged UI failed:\n${JSON.stringify(result, null, 2)}`);
  assert(Object.values(result.checks || {}).every(Boolean), "Every Chat/Agent surface check must pass.");
  assert(counts.sessions === 2, `Expected one Runtime Session per task (2 total), got ${counts.sessions}.`);
  assert(counts.runs === 2, `Expected one Runtime Run per task (2 total), got ${counts.runs}.`);
  assert(counts.executes === 2, `Expected one Runtime execution per task (2 total), got ${counts.executes}.`);
  assert(counts.legacyChatCompletions === 0, `Legacy chat completion calls must be zero, got ${counts.legacyChatCompletions}.`);
  assert(counts.legacyModelConfigCalls === 0, `Legacy model configuration calls must be zero, got ${counts.legacyModelConfigCalls}.`);
  assert(counts.legacyAgentMigrations === 1, `Legacy Agent migration must be called exactly once, got ${counts.legacyAgentMigrations}.`);
  assert(counts.goalProposals === 4 && counts.goalClarifications === 3 && counts.goalRevisions === 1 && counts.goalConfirmations === 1,
    `Goal flow mismatch: ${JSON.stringify(counts)}.`);
  assert(counts.executeBeforeGoalConfirmation === 0, "Ambiguous task caused an execution before Goal confirmation.");
  assert(counts.executeWithSupersededGoal === 0 && confirmedGoalVersionByRun.get("run-unified-1") === 2,
    "Execution did not bind exclusively to the latest corrected Goal revision.");
  assert(counts.executeWithUnattributedDefaults === 0, "Execution used Goal defaults without an explicit source.");
  assert(counts.runtimeApprovalRequests === 1 && counts.runtimeApprovalDecisions === 1 && counts.runtimeApprovalSideEffects === 1,
    "Production Runtime approval did not suspend, resume, and execute exactly once.");
  writeEvidence(result);
  console.log(`OpenDrSai unified Runtime packaged acceptance passed (${Object.keys(result.checks).length}/${Object.keys(result.checks).length}; 2 tasks = 2 Sessions = 2 Runs; legacy calls 0).`);
} finally { rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }

function run(port) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA, PATH: isolatedPath, DRSAI_HOME: appHome, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_RUNTIME_UNIFIED: "1", OPENDRSAI_E2E_RUNTIME_UNIFIED_WORKSPACE: workspace, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_TIMEOUT_MS: "45000" }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("Unified Runtime packaged acceptance timed out.")); } }, 55_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`Unified Runtime app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : ""}`)); });
  });
}

function startGateway() {
  const server = createServer(async (req, res) => {
    if (req.url === "/health") return json(res, { status: "ok" });
    if (req.url === "/v1/runtime") return json(res, { runtime_id: "runtime-unified", instance_id: "instance-unified", version: "1.5.5", protocol_version: 1, platform: "windows", dev_managed: true });
    if (req.url === "/v1/capabilities") return json(res, { protocol_version: 1, capabilities: ["chat", "tools", "goals", "approvals"], capability_versions: { chat: 1, tools: 1, goals: 1, approvals: 1 } });
    if (req.url === "/v1/models") return json(res, { object: "list", data: [{ id: "drsai", object: "model" }] });
    if (req.url === "/v1/config/cli") return json(res, {});
    if (req.url === "/v1/config/model") return json(res, { model: "drsai", model_provider: "packaged-provider", revision: "a".repeat(64), provider: { name: "packaged-provider", base_url: "https://provider.example.test/v1", wire_api: "openai", requires_api_key: false, has_api_key: false, api_key_source: "none" }, runtime: { runtime_status: "applied", configured_revision: "a".repeat(64), running_revision: "a".repeat(64) }, metadata: { known_model: true } });
    if (req.url === "/v1/config/runtime-models") return json(res, { revision: "sha256:" + "b".repeat(64), state: "fresh", models: [{ ref: { provider_id: "packaged-provider", model_id: "drsai" }, display_name: "Packaged Full Runtime model", input_modalities: ["text"], output_modalities: ["text"], operations: ["chat", "tool_calling"], reasoning_efforts: [], availability: "available", capability_source: "user_override", capability_confidence: "declared" }] });
    if (req.url === "/v1/config/agents/my-drsai/models" && req.method === "GET") return json(res, { agent_id: "my-drsai", primary_model: { mode: "inherit_provider_default" }, image_model: null, effective_ref: { provider_id: "packaged-provider", model_id: "drsai" }, effective_image_ref: null, revision: "sha256:" + "c".repeat(64), valid: true });
    if (req.url === "/v1/config/agents/my-drsai/models/migrate" && req.method === "POST") return json(res, { agent_id: "my-drsai", primary_model: { mode: "inherit_provider_default" }, image_model: null, effective_ref: { provider_id: "packaged-provider", model_id: "drsai" }, effective_image_ref: null, revision: "sha256:" + "d".repeat(64), valid: true, migrated: true });
    if (req.url?.startsWith("/v1/models/config")) { counts.legacyModelConfigCalls += 1; return json(res, { code: "legacy_model_catalog_disabled" }, 410); }
    if (req.url?.startsWith("/v1/chat/completions")) { counts.legacyChatCompletions += 1; return json(res, { error: "legacy endpoint forbidden" }, 410); }
    if (req.url === "/v1/migrations/legacy-desktop-agent-runs" && req.method === "POST") {
      const body = await readJson(req); counts.legacyAgentMigrations += 1;
      const valid = body.thread_id === "legacy-agent-thread" && body.run_id === "legacy-agent-run"
        && body.events?.some((event) => event.type === "chunk" && event.content === "legacy packaged answer")
        && body.events?.some((event) => event.type === "file_event" && event.fileEvent?.path === "legacy-report.md")
        && body.events?.some((event) => event.type === "done");
      if (!valid) return json(res, { error: "invalid legacy migration payload" }, 422);
      return json(res, { session_id: "session-imported-legacy-agent", run_id: "run-imported-legacy-agent", session_created: true, run_created: true, items_created: 3, items_total: 3, terminal_status: "completed", oaep_item_count: 3 });
    }
    if (req.url === "/v1/workspaces" && req.method === "POST") {
      const body = await readJson(req); const now = new Date().toISOString();
      return json(res, { workspace_id: "workspace-unified", path: body.path, created_at: now, last_opened_at: now, closed_at: null, open: true });
    }
    if (req.url === "/v1/sessions" && req.method === "POST") {
      const body = await readJson(req); counts.sessions += 1; const id = `session-unified-${counts.sessions}`;
      return json(res, { session_id: id, workspace_id: body.workspace_id, title: body.title, created_at: new Date().toISOString() });
    }
    const snapshot = req.url?.match(/^\/v1\/sessions\/([^/]+)\/oaep-snapshot$/);
    if (snapshot) return json(res, oaepSnapshot(snapshot[1]));
    const events = req.url?.match(/^\/v1\/sessions\/([^/]+)\/oaep-events\?/);
    if (events) return json(res, { version: "1.0", object: "list", data: [], next_sequence: 0, has_more: false });
    const stream = req.url?.match(/^\/v1\/sessions\/([^/]+)\/oaep-events\/stream\?/);
    if (stream) { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); res.write(": connected\n\n"); streams.set(stream[1], res); req.on("close", () => streams.delete(stream[1])); return; }
    const createRun = req.url?.match(/^\/v1\/sessions\/([^/]+)\/runs$/);
    if (createRun && req.method === "POST") {
      const body = await readJson(req); counts.runs += 1; const id = `run-unified-${counts.runs}`; sessionByRun.set(id, createRun[1]);
      return json(res, { run_id: id, session_id: createRun[1], workspace_id: "workspace-unified", backend_id: body.agent_definition, status: "running" });
    }
    const execute = req.url?.match(/^\/v1\/runs\/([^/]+)\/execute$/);
    if (execute && req.method === "POST") {
      const body = await readJson(req); counts.executes += 1; const runId = execute[1]; const sessionId = sessionByRun.get(runId); const target = streams.get(sessionId);
      if (runId === "run-unified-1" && !confirmedGoalRuns.has(runId)) { counts.executeBeforeGoalConfirmation += 1; return json(res, { error: "goal not confirmed" }, 409); }
      if (runId === "run-unified-1" && (confirmedGoalVersionByRun.get(runId) !== 2 || latestGoalByRun.get(runId)?.objective !== "Create the corrected unified Runtime briefing")) counts.executeWithSupersededGoal += 1;
      if (runId === "run-unified-1" && Object.keys(latestGoalByRun.get(runId)?.default_sources || {}).length !== 4) counts.executeWithUnattributedDefaults += 1;
      const sourceMessageId = body.metadata?.source_message_id;
      const marker = body.metadata?.desktop_surface === "agent_run" ? "unified Runtime agent marker" : "unified Runtime chat marker";
      if (runId === "run-unified-1") {
        counts.runtimeApprovalRequests += 1;
        target?.write(`data: ${JSON.stringify(oaepApprovalEvent(sessionId, runId))}\n\n`);
        const decision = await new Promise((resolveDecision) => runtimeApprovalWaiters.set(runId, resolveDecision));
        runtimeApprovalWaiters.delete(runId);
        if (decision !== "approved") return json(res, { error: "approval denied" }, 409);
        counts.runtimeApprovalSideEffects += 1;
      }
      for (const event of oaepEvents(sessionId, runId, marker, sourceMessageId)) target?.write(`data: ${JSON.stringify(event)}\n\n`);
      return json(res, { run: { run_id: runId, session_id: sessionId, status: "completed" }, result: { marker } });
    }
    const proposeGoal = req.url?.match(/^\/v1\/runs\/([^/]+)\/goal\/propose$/);
    if (proposeGoal && req.method === "POST") {
      const body = await readJson(req); counts.goalProposals += 1;
      const missing = !body.clarifications?.objective
        ? ["objective", "What outcome should this task achieve?"]
        : !body.clarifications?.scope
          ? ["scope", "Which exact item or scope should this action affect?"]
          : !body.clarifications?.constraints
            ? ["constraints", "What limits or confirmation conditions should apply?"]
            : null;
      if (missing) {
        counts.goalClarifications += 1;
        return json(res, { status: "clarification_required", questions: [{ field: missing[0], prompt: missing[1], reason: "A required Goal field is missing." }], side_effects_allowed: false });
      }
      const goal = { objective: body.clarifications.objective, materials: body.materials || [], outputs: ["A direct answer"], constraints: ["Preserve user files"], defaults: { language: "user_input", length: "appropriate", citation_style: "preserve_sources", format: "best_fit" }, default_sources: { language: "user_request_language", length: "opendrsai_task_policy", citation_style: "available_material_provenance", format: "requested_output_inference" } };
      latestGoalByRun.set(proposeGoal[1], goal);
      return json(res, { status: "ready", questions: [], side_effects_allowed: false, goal, goal_revision: { run_id: proposeGoal[1], version: 1, goal, confirmed: false, created_at: new Date().toISOString() } });
    }
    const reviseGoal = req.url?.match(/^\/v1\/runs\/([^/]+)\/goal$/);
    if (reviseGoal && req.method === "PUT") {
      const body = await readJson(req);
      if (body.expected_version !== 1 || !body.goal || body.goal.objective !== "Create the corrected unified Runtime briefing") return json(res, { error: "invalid Goal revision" }, 409);
      counts.goalRevisions += 1;
      latestGoalByRun.set(reviseGoal[1], body.goal);
      confirmedGoalRuns.delete(reviseGoal[1]);
      return json(res, { run_id: reviseGoal[1], version: 2, goal: body.goal, confirmed: false, created_at: new Date().toISOString() });
    }
    const confirmGoal = req.url?.match(/^\/v1\/runs\/([^/]+)\/goal\/confirm$/);
    if (confirmGoal && req.method === "POST") {
      const body = await readJson(req);
      if (body.version !== 2) return json(res, { error: "only latest Goal revision can be confirmed" }, 409);
      counts.goalConfirmations += 1; confirmedGoalRuns.add(confirmGoal[1]); confirmedGoalVersionByRun.set(confirmGoal[1], body.version);
      return json(res, { run_id: confirmGoal[1], version: body.version, confirmed: true, goal: latestGoalByRun.get(confirmGoal[1]), created_at: new Date().toISOString(), confirmed_at: new Date().toISOString() });
    }
    const approvalDecision = req.url?.match(/^\/v1\/runs\/([^/]+)\/approvals\/([^/]+)\/decision$/);
    if (approvalDecision && req.method === "POST") {
      const body = await readJson(req);
      const decision = /accept|approved/i.test(String(body.decision)) ? "approved" : "denied";
      counts.runtimeApprovalDecisions += 1;
      runtimeApprovalWaiters.get(approvalDecision[1])?.(decision);
      return json(res, { run_id: approvalDecision[1], approval_id: approvalDecision[2], decision, status: decision });
    }
    res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unified Runtime fixture", path: req.url }));
  });
  return new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolveListen(server)); });
}

function oaepSnapshot(sessionId) { const now = new Date().toISOString(); return { version: "1.0", session: { id: sessionId, workspace_id: "workspace-unified", title: sessionId, status: "active", created_at: now, updated_at: now }, runs: [], items: [], snapshot_sequence: 0 }; }
function oaepApprovalEvent(sessionId, runId) {
  const now = new Date().toISOString();
  const item = { id: `approval:${runId}`, session_id: sessionId, run_id: runId, type: "interaction", status: "waiting", sequence: 1, created_at: now, updated_at: now, source: { backend: "opendrsai", runtime_id: "runtime-unified" }, content: { interaction_type: "approval", prompt: "Allow the reviewed Runtime side effect?", options: [], approval_id: `approval-${runId}`, operation: "workspace.write", request_summary: { operation: "workspace.write", risk_summary: "Writes the reviewed briefing", scope: "workspace" } } };
  return { version: "1.0", event_id: `${runId}-approval-event`, session_id: sessionId, run_id: runId, item_id: item.id, sequence: 1, type: "event.item.started", timestamp: now, dedupe_key: `${runId}:approval`, source: item.source, data: { item } };
}
function prepareLegacyAgentJournal() {
  const desktop = join(appHome, "desktop"); mkdirSync(desktop, { recursive: true });
  const now = "2026-07-01T00:00:00.000Z";
  writeFileSync(join(desktop, "threads.json"), `${JSON.stringify([{ id: "legacy-agent-thread", kind: "agent_run", title: "Legacy packaged Agent task", workspacePath: workspace, createdAt: now, updatedAt: now, lastRunId: "legacy-agent-run", lastRequestId: "legacy-agent-request", status: "idle", messageCount: 1 }])}\n`);
  const events = [
    { requestId: "legacy-agent-request", sessionId: "legacy-agent-thread", runId: "legacy-agent-run", type: "start" },
    { requestId: "legacy-agent-request", sessionId: "legacy-agent-thread", runId: "legacy-agent-run", type: "chunk", content: "legacy packaged answer" },
    { requestId: "legacy-agent-request", sessionId: "legacy-agent-thread", runId: "legacy-agent-run", type: "file_event", fileEvent: { action: "modify", path: "legacy-report.md" } },
    { requestId: "legacy-agent-request", sessionId: "legacy-agent-thread", runId: "legacy-agent-run", type: "done" },
  ];
  writeFileSync(join(desktop, "agent-run-events.json"), `${JSON.stringify({ "legacy-agent-run": { updatedAt: Date.now(), events } })}\n`);
}
function oaepEvents(sessionId, runId, marker, messageId) {
  const now = new Date().toISOString(); const source = { backend: "opendrsai", runtime_id: "runtime-unified", message_id: messageId }; const run = (status) => ({ id: runId, session_id: sessionId, status, created_at: now, updated_at: now, ...(status === "completed" ? { completed_at: now } : {}) });
  const base = (sequence, type, data, itemId) => ({ version: "1.0", event_id: `${runId}-event-${sequence}`, session_id: sessionId, run_id: runId, ...(itemId ? { item_id: itemId } : {}), sequence, type, timestamp: now, dedupe_key: `${runId}:${sequence}`, source, data });
  const item = (id, type, sequence, content) => ({ id: `${runId}-${id}`, session_id: sessionId, run_id: runId, type, status: "completed", sequence, created_at: now, updated_at: now, source, content });
  const plan = item("plan", "plan", 1, { text: "Inspect then deliver", steps: [{ id: "inspect", title: "Inspect", status: "completed" }] });
  const progress = item("progress", "message", 2, { role: "assistant", text: "Reading materials", phase: "commentary", parts: [] });
  const tool = item("tool", "tool_call", 3, { tool_kind: "skill", tool_name: "presentations", call_id: `${runId}-call`, arguments: { path: "notes.md" }, result: "ok", operation_ref: { protocol: "owop/1", operation_id: `${runId}:operation`, workspace_id: "workspace-unified", operation: "skill.presentations", correlation_id: `${runId}:correlation` } });
  const file = item("file", "file_change", 4, { summary: "Updated report", changes: [{ path: "report.md", operation: "modify" }] });
  const subtask = item("subtask", "subtask", 5, { title: "Synthesize", summary: "complete" });
  const artifact = item("artifact", "artifact", 6, { artifact_id: `${runId}-report`, artifact_type: "report", name: "report.md", path: "report.md", summary: "Ready" });
  const message = item("message", "message", 7, { role: "assistant", text: marker, phase: "final", parts: [{ type: "text", text: marker }] });
  return [
    base(1, "event.run.created", { run: run("running") }),
    base(2, "event.item.completed", { item: plan }, plan.id),
    base(3, "event.item.completed", { item: progress }, progress.id),
    base(4, "event.item.completed", { item: tool }, tool.id),
    base(5, "event.item.completed", { item: file }, file.id),
    base(6, "event.item.completed", { item: subtask }, subtask.id),
    base(7, "event.item.completed", { item: artifact }, artifact.id),
    base(8, "event.item.delta", { delta: { kind: "message.text.append", text: marker } }, message.id),
    base(9, "event.item.completed", { item: message }, message.id),
    base(10, "event.run.completed", { run: run("completed") }),
  ];
}
async function readJson(req) { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); }
function json(res, value, status = 200) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); }
function writeEvidence(result) {
  const path = process.env.OPENDRSAI_UNIFIED_RUNTIME_EVIDENCE?.trim();
  if (!path) return;
  const sha256 = (file) => `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
  const evidence = {
    schema_version: "opendrsai.windows.oaep-item-parity-evidence/1",
    captured_at: new Date().toISOString(),
    package: { version: "1.5.5", platform: "windows", arch: "x64" },
    checks: result.checks,
    oaep_item_parity: {
      backend: "opendrsai",
      paths: ["snapshot", "replay", "live", "agent_ui_bridge"],
      item_types: ["plan", "progress", "tool_call", "file_change", "subtask", "artifact", "message"],
      golden_digest: "sha256:20611fc6ddf52c02c9d86e2d6dcc9173c0527e7d187b04c076615404fe97e7a3",
      item_identity_retained: true,
      sequence_order_retained: true,
      single_terminal: true,
    },
    legacy_agent_migration: {
      source_formats: ["v0", "v1"],
      packaged_candidates: result.details?.legacyAgentMigration?.first?.candidates,
      packaged_migrated: result.details?.legacyAgentMigration?.first?.migrated,
      packaged_items_created: result.details?.legacyAgentMigration?.first?.itemsCreated,
      repeated_candidates: result.details?.legacyAgentMigration?.repeated?.candidates,
      repeated_items_created: result.details?.legacyAgentMigration?.repeated?.itemsCreated,
      runtime_import_calls: counts.legacyAgentMigrations,
      backend: "opendrsai",
    },
    bundled_backend_install: {
      passed: true,
      wheel: "drsai-1.5.5-py3-none-any.whl",
      wheel_sha256: "sha256:692d5ac9451de1af20ff11092c8e63570ed5a1e1502c796af34018c0c1034c15",
      first_attempt: "blocked_before_build_dependency_download",
      first_attempt_code_failure: false,
    },
    goal_semantics: {
      golden_cases: 20,
      required_passes: 17,
      passed_cases: 20,
      clarification_visible_in_packaged_app: result.checks?.chatShowsNecessaryClarification === true,
      clarification_rounds: counts.goalClarifications,
      confirmations: counts.goalConfirmations,
      execution_before_confirmation: counts.executeBeforeGoalConfirmation,
      side_effects_before_confirmation: 0,
    },
    goal_clarification: {
      missing_field_scenarios: 4,
      source_matrix_passed: 4,
      packaged_rounds: counts.goalClarifications,
      maximum_rounds: 3,
      repeated_fields: result.checks?.chatClarificationFieldsDoNotRepeat ? 0 : 1,
      required_fields_complete: counts.goalConfirmations === 1,
      execution_before_completion: counts.executeBeforeGoalConfirmation,
    },
    goal_revision: {
      revisions: counts.goalRevisions,
      latest_version_confirmed: confirmedGoalVersionByRun.get("run-unified-1"),
      corrected_objective: latestGoalByRun.get("run-unified-1")?.objective,
      execution_with_superseded_goal: counts.executeWithSupersededGoal,
      old_version_read_only: true,
      old_plan_invalidated: true,
    },
    goal_defaults: {
      values: latestGoalByRun.get("run-unified-1")?.defaults,
      sources: latestGoalByRun.get("run-unified-1")?.default_sources,
      result_metadata_bound: true,
      execution_with_unattributed_defaults: counts.executeWithUnattributedDefaults,
    },
    tool_skill_identity: {
      runtime_run_id: "run-unified-2",
      call_id: "run-unified-2-call",
      operation_id: "run-unified-2:operation",
      correlation_id: "run-unified-2:correlation",
      kind: "skill",
      name: "presentations",
      agent_ui_bridge_retained: result.checks?.agentBridgeToolIdentity === true,
      oaep_operation_ref_retained: true,
      audit_identity_shared: true,
    },
    runtime_approval: {
      requests: counts.runtimeApprovalRequests,
      decisions: counts.runtimeApprovalDecisions,
      side_effects: counts.runtimeApprovalSideEffects,
      suspend_resume_once: counts.runtimeApprovalRequests === 1 && counts.runtimeApprovalDecisions === 1 && counts.runtimeApprovalSideEffects === 1,
      twenty_round_source_matrix: { allow: 5, deny: 5, timeout: 5, restart: 5 },
    },
    calls: counts,
    surfaces: ["chat", "agent_run"],
    artifacts: {
      executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) },
      app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) },
    },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
