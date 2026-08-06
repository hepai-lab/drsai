import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const ledgerPath = resolve(root, "docs/remote_workespace/codex-adapter-p10-feature-ledger.json");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
assert.equal(ledger.total, 60); assert.equal(Object.keys(ledger.features).length, 60);
const sourceEntries = p10SourceEntries();
const currentSource = sha(`${digestFiles(sourceEntries.map((entry) => resolve(root, entry)))}\0${JSON.stringify(p10PackageProjection())}\0${p10ElectronSmokeProjection()}`);
const dirty = spawnSync("git", ["diff", "--binary", "--", ...sourceEntries],
  { cwd: root, encoding: "utf8", windowsHide: true }).stdout;
const dirtyDigest = sha(dirty);
const contract = JSON.parse(readFileSync(resolve(root, "cores/protocol/codex-app-server-stable-contract.json"), "utf8"));
const codexVersion = String(contract.generatedBaseline?.codexVersion ?? "unknown");
const schemaDigest = String(contract.reviewedSchemaSha256?.[codexVersion] ?? "unknown");
const now = Date.now();
for (const [id, feature] of Object.entries(ledger.features)) {
  assert.match(id, /^M(?:0[1-9]|10)-F0[1-6]$/);
  if (feature.status !== "passed") continue;
  const artifact = resolve(root, feature.artifact);
  assert(existsSync(artifact), `${id} evidence is missing`);
  const bytes = readFileSync(artifact);
  assert.equal(sha(bytes), feature.artifactDigest, `${id} evidence digest changed`);
  const result = JSON.parse(bytes);
  assert.equal(result.status, 0); assert.equal(result.executed, true);
  assert(result.features.includes(id), `${id} is not asserted by its evidence`);
  const assertions = Array.isArray(result.assertions) ? result.assertions : [];
  const featureAssertions = assertions.filter((assertion) => assertion?.feature === id);
  assert(featureAssertions.length > 0, `${id} has no feature-specific assertions`);
  assert(featureAssertions.every((assertion) => assertion.passed === true && typeof assertion.id === "string" && assertion.id),
    `${id} has a failed or invalid assertion`);
  assert.equal(feature.sourceDigest, currentSource, `${id} source digest is stale`);
  assert.equal(feature.dirtyDigest, dirtyDigest, `${id} dirty digest is stale`);
  assert.equal(feature.hostDigest, sha(hostname()).slice(0, 16), `${id} host identity changed`);
  assert.equal(feature.codexVersion, codexVersion, `${id} Codex identity changed`);
  assert.equal(feature.schemaDigest, schemaDigest, `${id} Schema identity changed`);
  assert.equal(feature.testDigest, sha(JSON.stringify({
    commands: result.commands ?? [], assertions: result.assertions ?? [],
  })), `${id} test digest changed`);
  const observedAt = Date.parse(feature.observedAt);
  assert(!Number.isNaN(observedAt) && observedAt <= now + 5 * 60_000, `${id} observedAt is invalid`);
}
const runner = JSON.parse(readFileSync(resolve(root, ".artifacts/codex-p10/results/p10-runner.json"), "utf8"));
assert.equal(runner.buildDigest, digestFiles([resolve(root, "apps/desktop/windows/out")], true), "Current build digest differs from release evidence");
if (process.argv.includes("--release")) {
  const unresolved = Object.entries(ledger.features).filter(([, value]) => value.status !== "passed");
  assert.deepEqual(unresolved, [], `P10 release is incomplete: ${unresolved.map(([id, row]) => `${id}=${row.status}`).join(", ")}`);
}
console.log(JSON.stringify({ passed: true, totals: ledger.totals, sourceDigest: currentSource }));
function sha(value) { return createHash("sha256").update(value || "").digest("hex"); }
function p10SourceEntries() { return [
  "cores/protocol/codex-app-server-stable-contract.json", "cores/protocol/oaep/oaep.schema.json",
  "cores/python/packages/drsai/scripts/generate_codex_stable_contract.py",
  "cores/python/packages/drsai/src/drsai/backend/codex_adapter",
  ...["agent.py", "agent_bindings.py", "engine.py", "error_contract.py", "evidence.py", "history.py", "input_resources.py", "normalized_events.py", "oaep.py", "security.py", "turn_coordinator.py"].map((name) => `cores/python/packages/drsai/src/drsai/backend/runtime/${name}`),
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel_factory.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core",
  ...["desktopApi.ts", "structuredConversation.ts"].map((name) => `apps/desktop/shared/api/${name}`),
  ...["chat.ts", "errorEnvelope.ts", "oaepPresentationProjector.ts", "runtimeClient.ts", "sessionConversationSubscription.ts", "sessionHistorySync.ts", "sessionSyncState.ts", "sessionViewStore.ts", "threads.ts", "threadRuntimeSubscription.ts", "threadSnapshotEnvelopeCache.ts"].map((name) => `apps/desktop/shared/main/${name}`),
  ...["userFacingErrors.ts", "threadPatchFrameBatcher.ts", "threadSnapshotPatch.ts", "threadSnapshotStore.ts", "threadSyncMetrics.ts", "adapters/useDesktopChatAdapter.ts", "components/ChatWorkspace.tsx", "components/StructuredMessageParts.tsx"].map((name) => `apps/desktop/shared/renderer/src/${name}`),
  "scripts/verify-codex-runtime-online.py",
  "scripts/verify-codex-p10-ssh-bridge.py", "apps/desktop/windows/tests/remote-ssh/Dockerfile.codex-p10",
  "apps/desktop/windows/tests/remote-ssh/fake_codex_app_server.py",
  ...["verify-codex-adapter.mjs", "generate-codex-p10-ledger.mjs", "verify-codex-p10-ledger.mjs", "verify-p10-error-contract.mts",
    "verify-p10-snapshot-waterline.mts", "verify-p10-resource-governance.mts", "verify-p10-architecture-boundary.mjs",
    "verify-p10-turn-queue-ux.mts", "verify-thread-patch-frame-batcher.mts", "run-codex-p9-live.mjs", "verify-p8-electron-ipc.mjs", "verify-structured-visual.mjs",
    "verify-codex-p10-user-journey.mjs", "verify-codex-desktop-integration.mjs", "verify-session-sync-state.mts",
    "verify-session-conversation-subscription.mts", "verify-codex-session-resume-policy.mts", "verify-codex-p7-attachments.mts", "verify-thread-archive.mts"
  ].map((name) => `apps/desktop/windows/scripts/${name}`),
  "apps/desktop/windows/src/main/threadArchive.ts",
  ...["test_codex_stable_contract.py", "test_codex_native_decoder.py", "test_codex_event_mapper.py", "test_codex_diagnostics.py",
    "test_codex_jsonl_frames.py", "test_codex_jsonrpc_client.py", "test_codex_backend_client.py", "test_turn_coordinator.py",
    "test_input_resources.py", "test_codex_run_finalizer.py", "test_codex_delta_coalescer.py", "test_error_contract.py",
    "test_codex_security.py", "test_gateway_opendrsai_approval.py", "test_agent_backend_contract.py",
    "test_runtime_conversation_journal.py", "test_codex_release_stress.py", "test_codex_app_server_process.py",
    "test_codex_bridge_transport.py", "test_codex_binary_provider.py"
  ].map((name) => `cores/python/packages/drsai/tests/${name}`),
]; }
function p10PackageProjection() {
  const value = JSON.parse(readFileSync(resolve(root, "apps/desktop/windows/package.json"), "utf8"));
  const scripts = Object.fromEntries(Object.entries(value.scripts ?? {}).filter(([name]) =>
    /(?:codex|oaep|structured-visual|thread-patch-frame-batcher|thread-archive|session-|p7-|p8-|p9-|p10-)/.test(name)));
  const dependencyNames = ["electron", "electron-vite", "vite", "react", "react-dom", "playwright", "typescript"];
  const dependencies = Object.fromEntries(dependencyNames.flatMap((name) => {
    const version = value.dependencies?.[name] ?? value.devDependencies?.[name];
    return version === undefined ? [] : [[name, version]];
  }));
  return { name: value.name, version: value.version, main: value.main, scripts, dependencies };
}
function p10ElectronSmokeProjection() {
  const source = readFileSync(resolve(root, "apps/desktop/windows/src/main/e2eSmoke.ts"), "utf8");
  const start = source.indexOf("async function runP8IpcSmoke");
  const end = source.indexOf("\nasync function runChatSmoke", start);
  assert(start >= 0 && end >= 0, "P10 Electron smoke source boundary is missing");
  return source.slice(start, end);
}
function digestFiles(entries, includeDerived = false) { const hash = createHash("sha256"); for (const file of entries.flatMap((entry) => walk(entry, includeDerived)).sort()) { try { hash.update(relative(root, file)).update("\0").update(readFileSync(file)); } catch (error) { if (!includeDerived || error?.code !== "ENOENT") throw error; } } return hash.digest("hex"); }
function walk(entry, includeDerived = false) { if (!existsSync(entry) || (!includeDerived && /[\\/](?:node_modules|out|\.artifacts|__pycache__)(?:[\\/]|$)/.test(entry))) return []; return statSync(entry).isFile() ? [entry] : readdirSync(entry).flatMap((name) => walk(join(entry, name), includeDerived)); }
