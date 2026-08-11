import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const ledgerPath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase3-acceptance-ledger.json");
const e2ePath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase3-windows-e2e-result.json");
const preflightPath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase3-pre-release-result.json");
const attestationPath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase3-release-attestation.json");
const liveVerifierPath = resolve(repoRoot, "apps/desktop/windows/scripts/verify-run-traceability-phase3-live-model.mjs");
const acceptedStatuses = new Set(["passed", "passed_fail_closed"]);
const expectedIds = Object.entries({ M32:4, M33:5, M34:5, M35:4, M36:5, M37:5, M38:7, M39:6 })
  .flatMap(([moduleId, count]) => Array.from({ length:count }, (_, index) => `${moduleId}-${String(index + 1).padStart(2, "0")}`));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const currentCommit = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd:repoRoot, encoding:"utf8", windowsHide:true }).trim();
const python = resolve(repoRoot, ".venv/Scripts/python.exe");
const pythonEnv = { PYTHONPATH:[resolve(repoRoot, "cores/python/packages/drsai/src"), resolve(repoRoot, "eval/regression/src"), process.env.PYTHONPATH].filter(Boolean).join(";") };
const npmStep = (script) => ({ executable:process.env.ComSpec || "cmd.exe", args:["/d", "/s", "/c", `npm run ${script}`] });
const pythonStep = (...args) => ({ executable:python, args, env:pythonEnv });

function validatePath(path, label) {
  assert.equal(typeof path, "string", `${label}: path must be text`);
  assert.ok(!/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(path), `${label}: path must be repository-relative`);
  assert.ok(existsSync(resolve(repoRoot, path)), `${label}: missing ${path}`);
}
function sourcePaths(ledger) {
  return [...new Set([ledger.plan, ...Object.values(ledger.evidence_profiles).flatMap((profile) => [...profile.implementation, ...profile.tests])])].sort();
}
function digestPaths(paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) { hash.update(path); hash.update("\0"); hash.update(readFileSync(resolve(repoRoot, path))); hash.update("\0"); }
  return hash.digest("hex");
}
function captureSourceState(ledger) {
  return {
    commit:currentCommit(),
    source_digest:digestPaths(sourcePaths(ledger)),
    ledger_digest:sha256(readFileSync(ledgerPath)),
  };
}
function assertSourceStateUnchanged(expected, ledger, phase) {
  assert.deepEqual(captureSourceState(ledger), expected, `${phase}: source state changed while verification was running`);
}
function assertCommandsPassed(results, expectedCount, phase) {
  const failed = results.find((item) => item.exit_code !== 0 || item.error_code);
  if (failed) {
    const step = failed.steps.find((item) => item.exit_code !== 0 || item.error_code);
    assert.fail(`${phase}: ${failed.id} step ${step?.args?.join(" ") || "unknown"} failed (exit=${failed.exit_code}, error=${failed.error_code || "none"})`);
  }
  assert.equal(results.length, expectedCount, `${phase}: stopped before all commands were executed`);
}
function validateLedger(ledger) {
  assert.equal(ledger.schema_version, "opendrsai.agent-runtime-phase3-acceptance-ledger/1");
  assert.equal(ledger.release_gate, "fail_closed");
  validatePath(ledger.plan, "plan");
  assert.equal(ledger.feature_count, 41); assert.equal(ledger.features?.length, 41);
  assert.deepEqual(ledger.features.map((item) => item.id), expectedIds);
  assert.equal(new Set(expectedIds).size, 41);
  for (const feature of ledger.features) {
    assert.ok(acceptedStatuses.has(feature.status) || ["awaiting_live_evidence", "awaiting_release_attestation"].includes(feature.status), `${feature.id}: invalid status`);
    const profile = ledger.evidence_profiles[feature.profile]; assert.ok(profile, `${feature.id}: profile missing`);
    assert.ok(["integration", "real_gui", "real_gateway", "scale", "release"].includes(profile.evidence_tier), `${feature.id}: evidence tier missing`);
    assert.ok(Array.isArray(profile.required_preflight_commands) && profile.required_preflight_commands.length, `${feature.id}: preflight command binding missing`);
    for (const path of [...profile.implementation, ...profile.tests]) validatePath(path, feature.id);
    if (feature.status === "passed_fail_closed") assert.ok(feature.reason, `${feature.id}: fail-closed rationale missing`);
  }
  const accepted = ledger.features.filter((item) => acceptedStatuses.has(item.status)).length;
  assert.equal(ledger.progress.accepted, accepted);
  assert.equal(ledger.progress.percent, Math.floor(accepted * 10000 / 41) / 100);
}
function validateE2e(e2e) {
  assert.equal(e2e.schema_version, "opendrsai.run-traceability-phase3-windows-e2e-result/1");
  assert.equal(e2e.commit, currentCommit(), "GUI evidence commit is stale");
  assert.equal(e2e.real_gateway, true); assert.equal(e2e.real_electron, true);
  assert.ok(Array.isArray(e2e.source_files) && e2e.source_files.length > 20, "GUI evidence has no source inventory");
  for (const path of e2e.source_files) validatePath(path, "GUI source");
  assert.equal(e2e.source_digest, digestPaths(e2e.source_files), "GUI evidence source digest is stale");
  assert.deepEqual(e2e.scenarios, ["O","P","Q","R","S","T","U"]);
  assert.ok(Object.values(e2e.checks || {}).every((value) => value === true));
  assert.equal(e2e.checks.secretCorpus, true);
  assert.equal(e2e.regression?.gate, "passed"); assert.equal(e2e.regression?.case_count, 6);
  assert.ok(Object.values(e2e.regression?.cases || {}).every((value) => value === "passed"));
  for (const field of ["source_digest", "application_build_digest", "desktop_result_digest"]) assert.match(e2e[field], /^[0-9a-f]{64}$/);
}
function validateAttestation(attestation, ledger) {
  assert.equal(attestation.schema_version, "opendrsai.agent-runtime-phase3-release-attestation/1");
  assert.equal(attestation.commit, currentCommit(), "attestation commit is stale");
  assert.equal(attestation.source_digest, digestPaths(sourcePaths(ledger)), "attestation source digest is stale");
  assert.equal(attestation.ledger_digest, sha256(readFileSync(ledgerPath)), "attestation ledger digest is stale");
  const expected = ["backend", "desktop", "regression", "performance", "accessibility", "windows_e2e", "evidence", "live_model"];
  assert.deepEqual(attestation.commands.map((item) => item.id), expected, "attestation command set is incomplete");
  assert.ok(attestation.commands.every((item) => item.exit_code === 0 && !item.error_code), "attestation contains a failed command");
}
function validatePreflight(evidence, ledger) {
  assert.equal(evidence.schema_version, "opendrsai.agent-runtime-phase3-pre-release-result/1");
  assert.equal(evidence.commit, currentCommit(), "pre-release evidence commit is stale");
  assert.equal(evidence.source_digest, digestPaths(sourcePaths(ledger)), "pre-release source digest is stale");
  assert.equal(evidence.ledger_digest, sha256(readFileSync(ledgerPath)), "pre-release ledger digest is stale");
  assert.deepEqual(evidence.commands.map((item) => item.id), preflightCommands.map((item) => item.id), "pre-release command set is incomplete");
  assert.ok(evidence.commands.every((item) => item.exit_code === 0 && !item.error_code), "pre-release evidence contains a failed command");
  assert.equal(evidence.real_gateway, true); assert.equal(evidence.real_electron, true);
  const executed = new Set(evidence.commands.map((item) => item.id));
  for (const [profileId, profile] of Object.entries(ledger.evidence_profiles)) {
    for (const command of profile.required_preflight_commands) assert.ok(executed.has(command), `${profileId}: missing executed command ${command}`);
  }
}
function validateLiveModel(evidence) {
  assert.equal(evidence.schema_version, "opendrsai.agent-runtime-phase3-live-model-result/1");
  const generatedAt = Date.parse(evidence.generated_at);
  assert.ok(Number.isFinite(generatedAt), "live-model evidence timestamp is invalid");
  assert.ok(generatedAt <= Date.now() + 5 * 60 * 1000, "live-model evidence timestamp is in the future");
  assert.ok(Date.now() - generatedAt <= 36 * 60 * 60 * 1000, "live-model nightly evidence is older than 36 hours");
  assert.equal(evidence.commit, currentCommit(), "live-model evidence commit is stale");
  assert.equal(evidence.account_backed, true); assert.equal(evidence.controlled_model, false); assert.equal(evidence.simulated_external_service, false);
  assert.equal(evidence.auth_mode, "oidc", "live-model evidence did not use the App OIDC session");
  assert.match(evidence.oidc_issuer || "", /^https:\/\//, "live-model OIDC issuer identity is missing");
  assert.ok(typeof evidence.app_profile === "string" && evidence.app_profile.length > 0, "live-model App profile identity is missing");
  assert.match(evidence.gateway_origin || "", /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/, "live-model Gateway is not the local App-owned Gateway");
  assert.ok(typeof evidence.workspace_id === "string" && evidence.workspace_id.length > 0, "live-model App Workspace identity is missing");
  assert.match(evidence.agent_definition || "", /@[^@]+$/, "live-model immutable Agent Definition is missing");
  assert.ok(!/(?:controlled|deterministic|fixture|mock)/i.test(`${evidence.backend_id || ""} ${evidence.model || ""}`),
    "live-model evidence identifies a controlled or fixture Backend/model");
  assert.deepEqual(evidence.cases?.map((item) => item.id), ["question_answering", "read_only_tool", "knowledge", "image_input", "image_output"]);
  assert.ok(evidence.cases.every((item) => item.status === "completed" && item.timeline_item_count > 0
    && typeof item.run_id === "string" && item.run_id && typeof item.session_id === "string" && item.session_id
    && /^[0-9a-f]{64}$/.test(item.inspection_digest) && /^[0-9a-f]{64}$/.test(item.manifest_digest)
    && Number.isInteger(item.attempt) && item.attempt >= 1 && item.attempt <= 2),
  "live-model cases are missing the bounded-attempt record");
  assert.equal(new Set(evidence.cases.map((item) => item.run_id)).size, 5, "live-model cases do not have unique Runs");
  assert.equal(new Set(evidence.cases.map((item) => item.session_id)).size, 5, "live-model cases do not have unique Sessions");
  const cases = Object.fromEntries(evidence.cases.map((item) => [item.id, item]));
  assert.ok(cases.question_answering.behavior?.assistant_messages > 0, "live QA response evidence is missing");
  assert.equal(cases.read_only_tool.behavior?.tool_name, "run_glob", "live read-only production Tool identity is incorrect");
  assert.equal(cases.read_only_tool.behavior?.tool_calls, 1, "live exact Tool evidence is missing");
  assert.equal(cases.knowledge.behavior?.tool_name, "retrieve_from_memory", "live configured retrieval Tool identity is incorrect");
  assert.equal(cases.knowledge.behavior?.knowledge_calls, 1, "live Knowledge call evidence is missing");
  assert.ok(cases.knowledge.behavior?.source_attributions > 0, "live Knowledge source attribution evidence is missing");
  assert.ok(cases.image_input.behavior?.attachments > 0 && cases.image_input.behavior?.assistant_messages > 0,
    "live image-input processing evidence is missing");
  assert.ok(typeof cases.image_input.model === "string" && cases.image_input.model.length > 0
    && !/(?:controlled|deterministic|fixture|mock)/i.test(cases.image_input.model),
  "live image-input capability-matched model evidence is missing");
  assert.equal(cases.image_input.behavior?.recognized_error_code, true, "live image-input semantic recognition evidence is missing");
  const artifact = cases.image_output.behavior?.artifact;
  assert.ok(/^image\//.test(artifact?.mime_type || "") && artifact?.size > 0 && /^[0-9a-f]{64}$/.test(artifact?.sha256 || ""),
    "live readable image Artifact evidence is missing");
  assert.deepEqual(evidence.proof_scope, ["real_backend_account","real_model_execute","complete_oaep_inspection","manifest","exact_tool_count","knowledge_result_and_source_attribution","capability_matched_vision_model","image_input_and_response","readable_image_artifact"]);
  assert.ok(Array.isArray(evidence.source_files) && evidence.source_files.length >= 6, "live-model source inventory is incomplete");
  for (const path of evidence.source_files || []) validatePath(path, "live-model source");
  assert.equal(evidence.source_digest, digestPaths(evidence.source_files || []), "live-model evidence source digest is stale");
  const runtimeSources = evidence.source_files.filter((path) => path.startsWith("cores/python/"));
  assert.ok(runtimeSources.includes("cores/python/packages/drsai/src/drsai/backend/runtime/input_resources.py"),
    "live-model runtime input-resource implementation is absent from evidence");
  assert.equal(evidence.runtime_source_digest, digestPaths(runtimeSources), "the live Gateway did not load the evidenced runtime source");
}
function runCommand(spec) {
  const startedAt = new Date().toISOString(); const started = performance.now();
  const outputs = []; let exitCode = 0; let errorCode = null;
  const steps = spec.steps || [];
  for (const step of steps) {
    const stepStarted = performance.now();
    const child = spawnSync(step.executable, step.args, { cwd:resolve(repoRoot, step.cwd || spec.cwd), env:{...process.env, ...(step.env || {})}, shell:false, encoding:"utf8", windowsHide:true, timeout:30*60*1000, maxBuffer:32*1024*1024 });
    outputs.push({ executable:step.executable, args:step.args, duration_ms:Math.round(performance.now()-stepStarted),
      exit_code:typeof child.status === "number" ? child.status : -1, error_code:child.error?.code || null,
      stdout:child.stdout || "", stderr:child.stderr || "" });
    exitCode = typeof child.status === "number" ? child.status : -1; errorCode = child.error?.code || null;
    if (exitCode !== 0 || errorCode) break;
  }
  const stdout = outputs.map((item) => item.stdout).join("\n"); const stderr = outputs.map((item) => item.stderr).join("\n");
  return { id:spec.id, steps:outputs.map((item) => ({ executable:item.executable, args:item.args, duration_ms:item.duration_ms,
    exit_code:item.exit_code, error_code:item.error_code, stdout_sha256:sha256(item.stdout), stderr_sha256:sha256(item.stderr) })),
    cwd:spec.cwd, started_at:startedAt, completed_at:new Date().toISOString(), duration_ms:Math.round(performance.now()-started), exit_code:exitCode, error_code:errorCode, stdout_sha256:sha256(stdout), stderr_sha256:sha256(stderr) };
}

const preflightCommands = [
  { id:"backend", cwd:".", steps:[pythonStep("-m","pytest","cores/python/packages/drsai/tests/test_experiment_overrides.py","cores/python/packages/drsai/tests/test_gateway_experiment_capabilities.py","cores/python/packages/drsai/tests/test_replay_planner.py","cores/python/packages/drsai/tests/test_replay_execution.py","cores/python/packages/drsai/tests/test_agent_runtime.py","cores/python/packages/drsai/tests/test_phase2_controlled_execute_e2e.py","cores/python/packages/drsai/tests/test_runtime_adoptions.py","cores/python/packages/drsai/tests/test_regression_runtime_control.py","cores/python/packages/drsai/tests/test_runtime_engine.py","cores/python/packages/drsai/tests/test_gateway_runtime_identity.py","cores/python/packages/drsai/tests/test_input_resources.py","cores/python/packages/drsai/tests/test_gateway_opendrsai_backend.py","cores/python/packages/drsai/tests/test_agent_kernel_production_parity.py","cores/python/packages/drsai/tests/test_desktop_autogen_ports.py","-q")] },
  { id:"desktop", cwd:"apps/desktop/windows", steps:[npmStep("typecheck:node"),npmStep("typecheck:web"),npmStep("verify:run-inspector-ui")] },
  { id:"regression", cwd:".", steps:[pythonStep("eval/regression/run_regression.py","validate","--suite","phase3-release-smoke"),pythonStep("-m","pytest","eval/regression/tests","-q")] },
  { id:"performance", cwd:".", steps:[
    pythonStep("-m","pytest","cores/python/packages/drsai/tests/test_run_inspection.py::test_session_run_cursor_covers_5000_rows_with_concurrent_append","-q"),
    pythonStep("-m","pytest","cores/python/packages/drsai/tests/test_run_inspection.py::test_inspection_uses_run_index_and_bounds_a_10k_timeline","-q"),
    pythonStep("-m","pytest","cores/python/packages/drsai/tests/test_run_inspection.py::test_inspection_100k_timeline_keeps_first_page_and_locator_bounded","-q"),
    pythonStep("-m","pytest","cores/python/packages/drsai/tests/test_run_inspection.py::test_inspection_truncates_a_10mb_tool_output_before_serialization","-q"),
    pythonStep("-m","pytest","cores/python/packages/drsai/tests/test_run_comparison.py::test_comparison_pages_file_changes_beyond_first_500_items","-q"),
  ] },
  { id:"accessibility", cwd:"apps/desktop/windows", steps:[npmStep("verify:m5-accessibility")] },
  { id:"windows_e2e", cwd:"apps/desktop/windows", steps:[npmStep("verify:run-traceability-phase3-windows-e2e")] },
  { id:"evidence", cwd:".", steps:[{ executable:process.execPath, args:[resolve(repoRoot, "apps/desktop/windows/scripts/verify-run-traceability-phase3-release.mjs"), "--self-test"] }] },
];

const ledger = readJson(ledgerPath); validateLedger(ledger);
if (process.argv.includes("--self-test")) {
  execFileSync(process.execPath, [liveVerifierPath, "--self-test"], { cwd:repoRoot, stdio:"pipe", windowsHide:true });
  const e2e = readJson(e2ePath); validateE2e(e2e);
  assert.throws(() => validateE2e({ ...e2e, commit:"stale" }), /stale/);
  assert.throws(() => validateE2e({ ...e2e, real_gateway:false }));
  const mock = { schema_version:"opendrsai.agent-runtime-phase3-release-attestation/1", commit:currentCommit(), source_digest:digestPaths(sourcePaths(ledger)), ledger_digest:sha256(readFileSync(ledgerPath)), commands:[] };
  assert.throws(() => validateAttestation(mock, ledger), /command set is incomplete/);
  assert.throws(() => validateAttestation({ ...mock, source_digest:"0".repeat(64), commands:[...preflightCommands.map(({id}) => ({id})),{id:"live_model"}] }, ledger), /source digest is stale/);
  const fakePreflight = { schema_version:"opendrsai.agent-runtime-phase3-pre-release-result/1", commit:currentCommit(), source_digest:digestPaths(sourcePaths(ledger)), ledger_digest:sha256(readFileSync(ledgerPath)), commands:preflightCommands.map(({id}) => ({id, exit_code:0, error_code:null})), real_gateway:true, real_electron:true };
  validatePreflight(fakePreflight, ledger);
  assert.throws(() => validatePreflight({ ...fakePreflight, source_digest:"0".repeat(64) }, ledger), /source digest is stale/);
  assert.throws(() => validatePreflight({ ...fakePreflight, commands:fakePreflight.commands.slice(1) }, ledger), /command set is incomplete/);
  assert.throws(() => validatePreflight({ ...fakePreflight, real_gateway:false }, ledger));
  const liveSources = [
    "apps/desktop/windows/scripts/verify-run-traceability-phase3-live-model.cjs",
    "apps/desktop/windows/scripts/verify-run-traceability-phase3-live-model.mjs",
    "apps/desktop/windows/src/main/index.ts",
    "cores/python/packages/drsai/src/drsai/backend/gateway.py",
    "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py",
    "cores/python/packages/drsai/src/drsai/config/model_registry.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/artifacts.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/input_resources.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/oaep.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_autogen_ports.py",
    "cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py",
  ];
  const baseCase = { status:"completed", timeline_item_count:1, inspection_digest:"a".repeat(64), manifest_digest:"b".repeat(64), attempt:1 };
  const liveMock = {
    schema_version:"opendrsai.agent-runtime-phase3-live-model-result/1", generated_at:new Date().toISOString(), commit:currentCommit(), backend_id:"opendrsai", model:"gpt-live",
    app_profile:".drsai-dev", gateway_origin:"http://127.0.0.1:28642", workspace_id:"workspace-live", agent_definition:"opendrsai@1",
    account_backed:true, auth_mode:"oidc", oidc_issuer:"https://identity.example.test", controlled_model:false, simulated_external_service:false,
    source_files:liveSources, source_digest:digestPaths(liveSources), runtime_source_digest:digestPaths(liveSources.filter((path) => path.startsWith("cores/python/"))),
    proof_scope:["real_backend_account","real_model_execute","complete_oaep_inspection","manifest","exact_tool_count","knowledge_result_and_source_attribution","capability_matched_vision_model","image_input_and_response","readable_image_artifact"],
    cases:[
      { id:"question_answering", ...baseCase, run_id:"run-1", session_id:"session-1", behavior:{ assistant_messages:1 } },
      { id:"read_only_tool", ...baseCase, run_id:"run-2", session_id:"session-2", behavior:{ tool_name:"run_glob", tool_calls:1, assistant_messages:1 } },
      { id:"knowledge", ...baseCase, run_id:"run-3", session_id:"session-3", behavior:{ tool_name:"retrieve_from_memory", knowledge_calls:1, source_attributions:1, assistant_messages:1 } },
      { id:"image_input", ...baseCase, model:"anthropic/claude-sonnet-4-6", run_id:"run-4", session_id:"session-4", behavior:{ attachments:1, assistant_messages:1, recognized_error_code:true } },
      { id:"image_output", ...baseCase, run_id:"run-5", session_id:"session-5", behavior:{ assistant_messages:1, artifact:{ mime_type:"image/png", size:8, sha256:"c".repeat(64) } } },
    ],
  };
  validateLiveModel(liveMock);
  assert.throws(() => validateLiveModel({ ...liveMock, cases:liveMock.cases.map((item, index) => index === 0 ? { ...item, attempt:3 } : item) }), /bounded-attempt/);
  assert.throws(() => validateLiveModel({ ...liveMock, cases:liveMock.cases.map((item) => item.id === "knowledge" ? { ...item, behavior:{ ...item.behavior, source_attributions:0 } } : item) }), /source attribution evidence is missing/);
  assert.throws(() => validateLiveModel({ ...liveMock, generated_at:"2020-01-01T00:00:00.000Z" }), /older than 36 hours/);
  assert.throws(() => validateLiveModel({ ...liveMock, backend_id:"controlled" }), /controlled or fixture/);
  assert.throws(() => validateLiveModel({ ...liveMock, account_backed:false }));
  console.log("Phase 3 evidence-tier and tamper fail-closed self-test passed.\n"); process.exit(0);
}
if (process.argv.includes("--preflight")) {
  const initialSourceState = captureSourceState(ledger);
  const results = [];
  for (const command of preflightCommands) { const result = runCommand(command); results.push(result); if (result.exit_code !== 0 || result.error_code) break; }
  assertCommandsPassed(results, preflightCommands.length, "pre-release verification");
  assertSourceStateUnchanged(initialSourceState, ledger, "pre-release verification");
  const e2e = readJson(e2ePath); validateE2e(e2e);
  const evidence = { schema_version:"opendrsai.agent-runtime-phase3-pre-release-result/1", generated_at:new Date().toISOString(), ...initialSourceState, commands:results, real_gateway:e2e.real_gateway, real_electron:e2e.real_electron, artifact_digests:{ windows_e2e:sha256(readFileSync(e2ePath)), regression_results:e2e.regression.results_digest, application_build:e2e.application_build_digest } };
  writeFileSync(preflightPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8"); validatePreflight(evidence, ledger);
  console.log(`Phase 3 pre-release verification passed: ${preflightPath}\n`); process.exit(0);
}
assert.ok(existsSync(preflightPath), "Phase 3 release blocked: current pre-release evidence is missing");
validatePreflight(readJson(preflightPath), ledger);
const unresolved = ledger.features.filter((item) => !acceptedStatuses.has(item.status));
assert.deepEqual(unresolved.map((item) => item.id), ["M39-04", "M39-06"], `Phase 3 release has unexpected blockers: ${unresolved.map((item) => `${item.id}=${item.status}`).join(", ")}`);
const liveEvidencePath = resolve(repoRoot, ledger.live_model_evidence);
assert.ok(existsSync(liveEvidencePath), "Phase 3 release blocked: real-model nightly evidence is missing");
validateLiveModel(readJson(liveEvidencePath));
const initialSourceState = captureSourceState(ledger);
const commands = [...preflightCommands, { id:"live_model", cwd:"apps/desktop/windows", steps:[npmStep("verify:run-traceability-phase3-live-model")] }];
const results = [];
for (const command of commands) { const result = runCommand(command); results.push(result); if (result.exit_code !== 0 || result.error_code) break; }
assertCommandsPassed(results, commands.length, "release verification");
assertSourceStateUnchanged(initialSourceState, ledger, "release verification");
const e2e = readJson(e2ePath); validateE2e(e2e);
const currentLive = readJson(liveEvidencePath); validateLiveModel(currentLive);
const completedLedger = structuredClone(ledger);
for (const item of completedLedger.features) if (item.id === "M39-04" || item.id === "M39-06") item.status = "passed";
completedLedger.progress = { accepted:41, percent:100 };
const completedLedgerBytes = Buffer.from(`${JSON.stringify(completedLedger, null, 2)}\n`, "utf8");
const attestation = { schema_version:"opendrsai.agent-runtime-phase3-release-attestation/1", generated_at:new Date().toISOString(), commit:currentCommit(), source_digest:digestPaths(sourcePaths(completedLedger)), ledger_digest:sha256(completedLedgerBytes), artifact_digests:{ windows_e2e:sha256(readFileSync(e2ePath)), application_build:e2e.application_build_digest, live_model:sha256(readFileSync(liveEvidencePath)) }, commands:results };
writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
writeFileSync(ledgerPath, completedLedgerBytes);
validateAttestation(attestation, completedLedger);
console.log(`Phase 3 release gate passed: ${attestationPath}\n`);
