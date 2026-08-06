import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const windows = resolve(root, "apps/desktop/windows");
const python = resolve(root, ".venv/Scripts/python.exe");
const npmCli = process.env.npm_execpath;
const mode = process.argv.includes("--live") ? "live" : process.argv.includes("--electron") ? "electron"
  : process.argv.includes("--release") ? "release" : "contract";
if (!existsSync(python) || !npmCli || !existsSync(npmCli)) throw new Error("Codex Adapter verification requires npm and the repository .venv.");
const resultRoot = resolve(root, ".artifacts/codex-p10/results");
mkdirSync(resultRoot, { recursive: true });
const common = identity();
const npm = (script) => [process.execPath, [npmCli, "run", script], windows];
const pytest = (...files) => [python, ["-m", "pytest", ...files, "-q"], root];
const suites = mode === "live" ? [
  { suite: "p10-live", features: ["M02-F06"], steps: [npm("verify:p9-live")] },
  { suite: "p10-bridge-equivalence", features: ["M09-F06"], steps: [
    pytest("cores/python/packages/drsai/tests/test_codex_bridge_transport.py"),
    [python, ["scripts/verify-codex-p10-ssh-bridge.py"], root],
  ] },
] : mode === "electron" ? [
  { suite: "p10-electron", features: ["M05-F05"], steps: [npm("verify:thread-patch-frame-batcher"), npm("verify:p8-electron-ipc"), npm("verify:structured-visual")] },
] : [
  { suite: "p10-contract", features: ids("M01"), steps: [
    [python, ["cores/python/packages/drsai/scripts/generate_codex_stable_contract.py", "--check"], root],
    pytest("cores/python/packages/drsai/tests/test_codex_stable_contract.py", "cores/python/packages/drsai/tests/test_codex_native_decoder.py",
      "cores/python/packages/drsai/tests/test_codex_event_mapper.py", "cores/python/packages/drsai/tests/test_codex_diagnostics.py",
      "cores/python/packages/drsai/tests/test_codex_jsonl_frames.py", "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py"),
  ] },
  { suite: "p10-input-session", features: [...ids("M02").filter((id) => id !== "M02-F06"), ...ids("M03")], steps: [
    pytest("cores/python/packages/drsai/tests/test_codex_backend_client.py", "cores/python/packages/drsai/tests/test_turn_coordinator.py",
      "cores/python/packages/drsai/tests/test_input_resources.py", "cores/python/packages/drsai/tests/test_codex_run_finalizer.py",
      "cores/python/packages/drsai/tests/test_codex_delta_coalescer.py"),
    npm("verify:codex-p7-restart-matrix"),
    npm("verify:codex-p10-turn-queue-ux"),
  ] },
  { suite: "p10-errors", features: ids("M04"), steps: [
    npm("verify:codex-p10-error-contract"),
    pytest("cores/python/packages/drsai/tests/test_error_contract.py", "cores/python/packages/drsai/tests/test_codex_security.py"),
  ] },
  { suite: "p10-snapshot", features: ids("M05").filter((id) => id !== "M05-F05"), steps: [npm("verify:codex-p10-snapshot-waterline"), npm("verify:p7-session-view-store")] },
  { suite: "p10-approval", features: ids("M06"), steps: [
    pytest("cores/python/packages/drsai/tests/test_codex_backend_client.py", "cores/python/packages/drsai/tests/test_gateway_opendrsai_approval.py",
      "cores/python/packages/drsai/tests/test_codex_security.py", "cores/python/packages/drsai/tests/test_codex_event_mapper.py"),
  ] },
  { suite: "p10-history", features: ids("M07"), steps: [
    pytest("cores/python/packages/drsai/tests/test_codex_backend_client.py", "cores/python/packages/drsai/tests/test_agent_backend_contract.py",
      "cores/python/packages/drsai/tests/test_runtime_conversation_journal.py"),
    npm("verify:codex-p10-snapshot-waterline"),
  ] },
  { suite: "p10-resources", features: ids("M08"), steps: [
    npm("verify:codex-p10-resource-governance"),
    pytest("cores/python/packages/drsai/tests/test_codex_release_stress.py", "cores/python/packages/drsai/tests/test_codex_app_server_process.py"),
  ] },
  { suite: "p10-bridge", features: ids("M09").filter((id) => id !== "M09-F06"), steps: [
    pytest("cores/python/packages/drsai/tests/test_codex_bridge_transport.py", "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py",
      "cores/python/packages/drsai/tests/test_codex_binary_provider.py", "cores/python/packages/drsai/tests/test_codex_app_server_process.py"),
  ] },
  { suite: "p10-architecture", features: ["M10-F01", "M10-F02", "M10-F03"], steps: [
    npm("verify:codex-p10-architecture"), npm("typecheck"),
    pytest("cores/python/packages/drsai/tests/test_agent_backend_contract.py"),
  ] },
];
if (mode === "release") {
  suites.push(
    { suite: "p10-electron", features: ["M05-F05"], steps: [npm("verify:thread-patch-frame-batcher"), npm("verify:p8-electron-ipc"), npm("verify:structured-visual")] },
    { suite: "p10-live", features: ["M02-F06"], steps: [npm("verify:p9-live")] },
    { suite: "p10-bridge-equivalence", features: ["M09-F06"], steps: [
      pytest("cores/python/packages/drsai/tests/test_codex_bridge_transport.py"),
      [python, ["scripts/verify-codex-p10-ssh-bridge.py"], root],
    ] },
    { suite: "p10-user-journey", features: ["M10-F06"], steps: [
      npm("verify:codex-desktop-integration"), npm("verify:session-sync-state"),
      npm("verify:session-conversation-subscription"), npm("verify:codex-session-resume-policy"),
      npm("verify:codex-p7-attachments"), npm("verify:thread-archive"),
      [process.execPath, [resolve(windows, "scripts/verify-codex-p10-user-journey.mjs")], windows],
    ] },
  );
}
for (const suite of suites) execute(suite);
const finalIdentity = identity();
if (finalIdentity.sourceDigest !== common.sourceDigest || finalIdentity.dirtyDigest !== common.dirtyDigest) {
  throw new Error("Codex Adapter source changed while verification was running; discard evidence and rerun.");
}
writeFileSync(join(resultRoot, "p10-runner.json"), JSON.stringify({
  schema: "opendrsai.codex-adapter-p10.runner.v1", suite: "p10-runner",
  features: ["M10-F04", "M10-F05"], status: 0, executed: true, mode, ...finalIdentity,
  commands: suites.flatMap((suite) => suite.steps.map(([command, args]) => ({
    command: [basename(command), ...args].join(" "), status: 0,
  }))),
  assertions: ["M10-F04", "M10-F05"].map((feature) => ({
    feature, id: `p10-runner:${feature}`, passed: true,
  })),
}, null, 2));
runChecked(process.execPath, [resolve(windows, "scripts/generate-codex-p10-ledger.mjs")], root);
runChecked(process.execPath, [resolve(windows, "scripts/verify-codex-p10-ledger.mjs"), ...(mode === "release" ? ["--release"] : [])], root);
const ledgerPath = resolve(root, "docs/remote_workespace/codex-adapter-p10-feature-ledger.json");
writeFileSync(resolve(root, ".artifacts/codex-p10/manifest.json"), `${JSON.stringify({
  schema: "opendrsai.codex-adapter-p10.release.v1", mode, passed: true,
  suites: suites.map((suite) => suite.suite), ledger: relative(root, ledgerPath).replaceAll("\\", "/"),
  ledgerDigest: sha(readFileSync(ledgerPath)), ...finalIdentity,
}, null, 2)}\n`);
console.log(JSON.stringify({ passed: true, mode, resultRoot, sourceDigest: common.sourceDigest }));

function execute(definition) {
  const commands = [];
  for (const [command, args, cwd] of definition.steps) {
    const result = run(command, args, cwd);
    commands.push({ command: [basename(command), ...args].join(" "), status: result.status,
      stdoutDigest: sha(result.stdout), stderrDigest: sha(result.stderr) });
    if (result.status !== 0) {
      write(definition, result.status, commands); process.stdout.write(result.stdout); process.stderr.write(result.stderr);
      throw new Error(`Codex Adapter verification failed closed at ${definition.suite}.`);
    }
    const afterCommand = identity();
    if (afterCommand.sourceDigest !== common.sourceDigest || afterCommand.dirtyDigest !== common.dirtyDigest) {
      throw new Error(`Codex Adapter source changed during ${definition.suite}: ${[basename(command), ...args].join(" ")}; ${identityDifference(common, afterCommand)}`);
    }
  }
  write(definition, 0, commands);
  const afterSuite = identity();
  if (afterSuite.sourceDigest !== common.sourceDigest || afterSuite.dirtyDigest !== common.dirtyDigest) {
    throw new Error(`Codex Adapter source changed during ${definition.suite}; discard evidence and inspect the mutating verifier.`);
  }
}
function write(definition, status, commands) {
  const assertions = definition.features.map((feature) => ({
    feature, id: `${definition.suite}:${feature}`, passed: status === 0,
    commandDigests: commands.map((command) => command.stdoutDigest),
  }));
  writeFileSync(join(resultRoot, `${definition.suite}.json`), JSON.stringify({
    schema: "opendrsai.codex-adapter-p10.result.v1", ...definition, steps: undefined,
    status, executed: true, commands, assertions, ...common,
  }, null, 2));
}
function identity() {
  const entries = p10SourceEntries();
  const sourceFiles = entries.flatMap((entry) => walk(resolve(root, entry))).sort();
  const sourceFileDigests = Object.fromEntries(sourceFiles.map((file) => [
    relative(root, file).replaceAll("\\", "/"), sha(readFileSync(file)),
  ]));
  const packageProjection = p10PackageProjection();
  const electronSmokeProjection = p10ElectronSmokeProjection();
  sourceFileDigests["apps/desktop/windows/package.json#p10"] = sha(JSON.stringify(packageProjection));
  sourceFileDigests["apps/desktop/windows/src/main/e2eSmoke.ts#runP8IpcSmoke"] = sha(electronSmokeProjection);
  const sourceDigest = sha(`${digestFiles(entries.map((entry) => resolve(root, entry)))}\0${JSON.stringify(packageProjection)}\0${electronSmokeProjection}`);
  const dirty = run("git", ["diff", "--binary", "--", ...entries], root).stdout;
  const contract = JSON.parse(readFileSync(resolve(root, "cores/protocol/codex-app-server-stable-contract.json"), "utf8"));
  return { sourceDigest, sourceFileDigests, dirtyDigest: sha(dirty), buildDigest: digestFiles([resolve(windows, "out")], true),
    codexVersion: String(contract.generatedBaseline?.codexVersion ?? "unknown"),
    schemaDigest: String(contract.reviewedSchemaSha256?.[contract.generatedBaseline?.codexVersion] ?? "unknown"),
    hostDigest: sha(hostname()).slice(0, 16), observedAt: new Date().toISOString() };
}
function identityDifference(before, after) {
  const names = [...new Set([...Object.keys(before.sourceFileDigests ?? {}), ...Object.keys(after.sourceFileDigests ?? {})])];
  const changed = names.filter((name) => before.sourceFileDigests?.[name] !== after.sourceFileDigests?.[name]);
  return changed.length ? `changed files: ${changed.join(", ")}` : "tracked dirty diff changed without a source-byte change";
}
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
  const value = JSON.parse(readFileSync(resolve(windows, "package.json"), "utf8"));
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
  const source = readFileSync(resolve(windows, "src/main/e2eSmoke.ts"), "utf8");
  const start = source.indexOf("async function runP8IpcSmoke");
  const end = source.indexOf("\nasync function runChatSmoke", start);
  if (start < 0 || end < 0) throw new Error("P10 Electron smoke source boundary is missing");
  return source.slice(start, end);
}
function ids(moduleId) { return Array.from({ length: 6 }, (_, index) => `${moduleId}-F0${index + 1}`); }
function runChecked(command, args, cwd) { const result = run(command, args, cwd); if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`); }
function run(command, args, cwd) { return spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true,
  env: { ...process.env, PYTHONPATH: resolve(root, "cores/python/packages/drsai/src") }, timeout: 60 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }); }
function sha(value) { return createHash("sha256").update(value || "").digest("hex"); }
function digestFiles(entries, includeDerived = false) { const hash = createHash("sha256"); for (const file of entries.flatMap((entry) => walk(entry, includeDerived)).sort()) { try { hash.update(relative(root, file)).update("\0").update(readFileSync(file)); } catch (error) { if (!includeDerived || error?.code !== "ENOENT") throw error; } } return hash.digest("hex"); }
function walk(entry, includeDerived = false) { if (!existsSync(entry) || (!includeDerived && /[\\/](?:node_modules|out|\.artifacts|__pycache__)(?:[\\/]|$)/.test(entry))) return []; return statSync(entry).isFile() ? [entry] : readdirSync(entry).flatMap((name) => walk(join(entry, name), includeDerived)); }
