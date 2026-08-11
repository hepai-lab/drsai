import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Packaged L5 must run on Apple Silicon macOS.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let releaseMount;
let appBundle = resolve(process.env.OPENDRSAI_MACOS_APP_PATH || join(root, "release", "mac-arm64", "OpenDrSai.app"));
if (!process.env.OPENDRSAI_MACOS_APP_PATH && !hasRuntimeArchive(appBundle)) {
  const dmg = join(root, "release", `OpenDrSai-macOS-v${packageJson.version}-arm64.dmg`);
  assert.ok(existsSync(dmg), `Packaged L5 full Runtime DMG is missing: ${dmg}`);
  releaseMount = mkdtempSync(join(tmpdir(), "opendrsai-macos-l5-dmg-"));
  const attached = spawnSync("/usr/bin/hdiutil", ["attach", dmg, "-readonly", "-nobrowse", "-mountpoint", releaseMount], { encoding: "utf8" });
  assert.equal(attached.status, 0, `Packaged L5 could not mount ${dmg}.\n${attached.stderr}`);
  appBundle = join(releaseMount, "OpenDrSai.app");
}
process.once("exit", cleanupReleaseMount);
const executable = join(appBundle, "Contents", "MacOS", "OpenDrSai");
const signature = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appBundle], { encoding: "utf8" });
assert.equal(signature.status, 0, `Packaged L5 requires a valid sealed App bundle. Build unsigned development packages with npm run build:mac:dir:unsigned.\n${signature.stderr}`);
const runtimeRoot = join(appBundle, "Contents", "Resources", "runtime");
const runtimeManifest = JSON.parse(readFileSync(join(runtimeRoot, "runtime-manifest.json"), "utf8"));
const runtimeArchive = statSync(join(runtimeRoot, runtimeManifest.archive));
const runtimeGiB = Math.ceil(runtimeArchive.size / (1024 ** 3));
const coreTimeoutMs = Math.min(900_000, 180_000 + runtimeGiB * 180_000);
console.log(`L5 driver initialized (${runtimeGiB}GiB Runtime, ${coreTimeoutMs}ms core budget).`);
const acceptance = join(root, "build", "acceptance");
const temp = mkdtempSync(join(tmpdir(), "opendrsai-macos-l5-"));
const keepTempOnFailure = process.env.OPENDRSAI_MACOS_L5_KEEP_TEMP_ON_FAILURE === "1";
const powerAssertion = spawn("/usr/bin/caffeinate", ["-dimsu", "-w", String(process.pid)], {
  stdio: "ignore",
});
let suitePassed = false;
let suiteGatewayPort;
const home = join(temp, "home");
const userData = join(temp, "electron-user-data");
const workspacePath = join(temp, "workspace");
mkdirSync(workspacePath, { recursive: true });
mkdirSync(join(workspacePath, ".drsai"), { recursive: true });
writeFileSync(join(workspacePath, "journey.txt"), "before L5 checkpoint\n", "utf8");
writeFileSync(join(workspacePath, "reusable-input.csv"), "name,value\npackaged,5\n", "utf8");
writeFileSync(join(workspacePath, "reusable-output.md"), "# Packaged reusable result\n", "utf8");
writeFileSync(join(workspacePath, "handoff-source.ts"), "export const packagedHandoff = true;\n", "utf8");
writeFileSync(join(workspacePath, "debug-target.py"), "import time\nsecret_token = 'must-be-redacted'\nvalue = 41\nresult = value + 1\ntime.sleep(0.2)\n", "utf8");
writeFileSync(join(workspacePath, "debug-error.py"), "raise RuntimeError('packaged debug failure')\n", "utf8");
writeFileSync(join(workspacePath, ".drsai", "ide-context.json"), `${JSON.stringify({ source: "vscode", capturedAt: "2026-07-22T00:00:00.000Z", currentFile: { relativePath: "handoff-source.ts", language: "typescript", line: 1, column: 14 }, currentSelection: { relativePath: "handoff-source.ts", text: "packagedHandoff", language: "typescript", startLine: 1, endLine: 1 } }, null, 2)}\n`, "utf8");
writeFileSync(join(workspacePath, "handoff.pdf"), minimalPdf());
writeFileSync(join(workspacePath, "presentation-source.pdf"), presentationPdf());
const git = spawnSync("/usr/bin/git", ["init", "-q", workspacePath], { encoding: "utf8" });
assert.equal(git.status, 0, git.stderr);
for (const args of [["-C", workspacePath, "config", "user.name", "OpenDrSai L5"], ["-C", workspacePath, "config", "user.email", "l5@localhost"]]) {
  const configured = spawnSync("/usr/bin/git", args, { encoding: "utf8" });
  assert.equal(configured.status, 0, configured.stderr);
}
writeFileSync(join(workspacePath, "approval-change.txt"), "packaged git approval\n", "utf8");
writeFileSync(join(workspacePath, "git-action.txt"), "version one\n", "utf8");
const staged = spawnSync("/usr/bin/git", ["-C", workspacePath, "add", "approval-change.txt", "git-action.txt"], { encoding: "utf8" });
assert.equal(staged.status, 0, staged.stderr);
mkdirSync(acceptance, { recursive: true });
console.log("L5 fixture workspace and Git repository are ready.");

try {
  const coldPerformance = await runScenario("performance-ready", {}, {}, 120_000);
  assert.equal(coldPerformance.result.ok, true, coldPerformance.result.error);
  assert.equal(coldPerformance.result.interactive, true);
  console.log("L5 reserving an isolated Gateway port...");
  suiteGatewayPort = await freePort();
  const gatewayPort = suiteGatewayPort;
  console.log(`L5 starting core scenario on Gateway port ${gatewayPort}...`);
  const core = await runScenario("core", { workspacePath }, { DRSAI_API_PORT: String(gatewayPort) }, coreTimeoutMs);
  assert.equal(core.result.ok, true, core.result.error);
  assert.equal(core.result.persistenceChecks, 2);
  assert.match(core.result.terminalOutput, /OPENDRSAI_MACOS_PTY_OK/);
  assert.equal(isAlive(core.result.terminal.pid), false, "core PTY survived graceful App exit");
  assert.equal(isAlive(core.result.gateway.pid), false, "core Gateway survived graceful App exit");
  assertNoRuntimeErrors(`${core.stdout}\n${core.stderr}`, "core journeys");
  writeReceipt("packaged-core-journeys", {
    featureIds: ["F04.4", "F06.4", "F07.6", "F10.1"],
    journeys: ["runtime-gateway", "workspace-thread-persistence", "preference-persistence", "zsh-pty-resize-roundtrip"],
    checks: 4,
    gatewayOrphans: 0,
    ptyOrphans: 0,
  });

  const product = await runScenario("product-state", { workspacePath, workspaceId: core.result.workspace.id }, {}, 300_000);
  assert.equal(product.result.ok, true, product.result.error);
  for (const check of ["threadLifecycle", "chatAbortRecoveryLifecycle", "chatNetworkRecoveryLifecycle", "agentCatalogAbortRecoveryLifecycle", "gitApprovalExecution", "workspaceGitReviewLifecycle", "checkpointLifecycle", "worktreeQueueLifecycle", "desktopHandoffLifecycle", "customCommandCrud", "projectMemoryCrud", "projectSkillApprovalInstall", "workflowLifecycle", "reusableAndScheduledLifecycle", "managerPresentationLifecycle", "diagnosticsRoundtrip", "diagnosticSourceAndPackage", "backgroundTaskLifecycle", "resultShareVersionLifecycle", "interactiveDebuggerRoundtrip", "pythonDebuggerRoundtrip", "nativeKeychainLifecycle", "notificationClickLifecycle"]) assert.equal(product.result[check], true, `product-state missing ${check}`);
  assertNoRuntimeErrors(`${product.stdout}\n${product.stderr}`, "product-state journeys");
  const gitLog = spawnSync("/usr/bin/git", ["-C", workspacePath, "log", "-1", "--format=%B"], { encoding: "utf8" });
  assert.equal(gitLog.status, 0, gitLog.stderr);
  assert.match(gitLog.stdout, /Packaged L5 approved commit/);
  assert.match(gitLog.stdout, new RegExp(`^OpenDrSai-Approval: ${escapeRegExp(product.result.gitApprovalId)}$`, "m"));
  const commitCount = spawnSync("/usr/bin/git", ["-C", workspacePath, "rev-list", "--count", "HEAD"], { encoding: "utf8" });
  assert.equal(commitCount.status, 0, commitCount.stderr);
  assert.equal(Number(commitCount.stdout.trim()), 1, "packaged approval replay created a duplicate commit");
  writeReceipt("packaged-product-journeys", {
    featureIds: ["F06.1", "F06.2", "F06.3", "F06.4", "F06.5", "F07.2", "F07.3", "F07.4", "F07.5", "F08.3", "F08.5", "F10.1", "F10.2", "F10.3", "F10.4", "F10.5", "F10.6"],
    journeys: ["thread-crud-snapshot-search-archive-binding", "chat-start-abort-journal-late-input", "chat-runtime-event-poll-recovery-journal-dedup", "agent-catalog-default-usage-start-abort-recovery", "git-approval-execute-and-replay", "workspace-git-diff-stage-ref-revert-stale-review", "checkpoint-create-preview-approved-restore-accept", "worktree-create-event-queue-dispatch-abort-discard", "ide-context-native-icon-edit-command-pdf-launchservices", "custom-command-crud", "project-memory-crud", "project-skill-draft-approval-install", "workflow-marketplace-strict-completion-history", "reusable-task-fresh-input-and-scheduled-safe-due-restart-recovery", "manager-presentation-pause-resume-cancel-failure-retry", "diagnostic-record-source-encrypted-package", "background-task-idempotency-cancel-retry-complete", "result-share-owner-isolation-version-revoke", "debug-policy-attach-detach", "debugpy-dap-breakpoint-scopes-redaction-evaluate-terminate-abnormal-exit", "native-helper-keychain-crud-idempotent-delete", "completion-notification-native-click"],
    checks: 22,
    unexpectedSideEffects: 0,
  });

  const warmPerformance = [];
  for (let iteration = 0; iteration < 5; iteration += 1) warmPerformance.push(await runScenario("performance-ready", {}, {}, 120_000));
  for (const run of warmPerformance) assert.equal(run.result.ok, true, run.result.error);

  const managedCrash = await runScenario("managed-process-crash", {}, {}, 60_000);
  assert.equal(managedCrash.result.ok, true, managedCrash.result.error);
  assert.equal(managedCrash.result.helperBefore.status, "ready");
  assert.equal(managedCrash.result.helperAfter.status, "ready");
  assert.equal(managedCrash.result.helperAfter.pong, true);
  assert.notEqual(managedCrash.result.helperAfter.pid, managedCrash.result.helperBefore.pid, "Native Helper SIGKILL did not create a new process");
  assert.notEqual(managedCrash.result.gatewayAfter.pid, managedCrash.result.gateway.pid, "Gateway SIGKILL did not create a new process");
  assert.equal(managedCrash.result.gatewayAfter.ready, true);

  const systemEvents = await runScenario("system-events", {}, {}, 90_000);
  assert.equal(systemEvents.result.ok, true, systemEvents.result.error);
  assert.equal(systemEvents.result.displayRecovered, true);
  assert.equal(systemEvents.result.networkRecovered, true);
  assert.ok(systemEvents.result.events.some((event) => event.reason === "display-change"));
  assert.ok(systemEvents.result.events.some((event) => event.reason === "network-online" && event.recoveredGateway === true));
  assertNoRuntimeErrors(`${systemEvents.stdout}\n${systemEvents.stderr}`, "system event recovery");
  writeReceipt("packaged-system-events", {
    featureIds: ["F06.4", "F08.5", "F10.3"],
    journeys: ["display-change-window-recovery", "network-offline-online-gateway-recovery"],
    checks: 2,
    unexpectedSideEffects: 0,
  });
  assertNoRuntimeErrors(`${managedCrash.stdout}\n${managedCrash.stderr}`, "managed process crash recovery");
  writeReceipt("managed-process-crash-recovery", { featureIds: ["F06.3"], nativeHelperForcedCrashes: 1, nativeHelperRecovered: true, gatewayForcedCrashes: 1, gatewayRecovered: true, residualProcessCount: managedCrash.resources.residualPids.length });

  const iterations = boundedInteger(process.env.OPENDRSAI_MACOS_L5_RESTART_ITERATIONS, 100, 1, 100);
  const restartResources = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const restart = await runScenario("restart", { threadId: core.result.thread.id, workspacePath: core.result.workspace.path, scheduledTaskId: product.result.scheduledTaskId, scheduledRunId: product.result.scheduledRunId }, {}, 30_000);
    assert.equal(restart.result.ok, true, `restart iteration ${iteration + 1}: ${restart.result.error ?? "unknown error"}`);
    assert.equal(restart.result.threadRecovered, true);
    assert.equal(restart.result.preferenceRecovered, true);
    assert.equal(restart.result.scheduledTaskRecovered, true);
    restartResources.push(restart.resources);
    assertNoRuntimeErrors(`${restart.stdout}\n${restart.stderr}`, `restart iteration ${iteration + 1}`);
  }

  writeFileSync(join(workspacePath, "rejected-after-crash.txt"), "must remain staged after rejection\n", "utf8");
  const stagedForCrash = spawnSync("/usr/bin/git", ["-C", workspacePath, "add", "rejected-after-crash.txt"], { encoding: "utf8" });
  assert.equal(stagedForCrash.status, 0, stagedForCrash.stderr);
  const crash = await runScenario("crash-ready", { workspacePath }, {}, 30_000, true);
  assert.equal(crash.result.readyForForcedCrash, true);
  assert.equal(crash.result.managedChildrenActive, true);
  assert.match(crash.result.approvalId, /^approval:/);
  sampleProcessTree(crash.child.pid, crash.resources, Date.now());
  killObservedProcessTree(crash.child.pid, crash.resources);
  await waitForExit(crash.child, 15_000);
  await assertNoObservedResiduals(crash.resources, "forced-crash App tree");
  const recovery = await runScenario("recovery", { threadId: core.result.thread.id, approvalId: crash.result.approvalId, activeChatRequestId: crash.result.activeChatRequestId, activeChatThreadId: crash.result.activeChatThreadId, activeAgentThreadId: crash.result.activeAgentThreadId }, {}, 30_000);
  assert.equal(recovery.result.ok, true, recovery.result.error);
  assert.equal(recovery.result.threadRecovered, true);
  assert.equal(recovery.result.approvalRecoveredRejected, true);
  assert.equal(recovery.result.activeRunsRecovered, true);
  assertNoRuntimeErrors(`${recovery.stdout}\n${recovery.stderr}`, "post-crash recovery");
  const postRecoveryCount = spawnSync("/usr/bin/git", ["-C", workspacePath, "rev-list", "--count", "HEAD"], { encoding: "utf8" });
  assert.equal(postRecoveryCount.status, 0, postRecoveryCount.stderr);
  assert.equal(Number(postRecoveryCount.stdout.trim()), 1, "rejected recovered approval created a commit");
  const stagedAfterRejection = spawnSync("/usr/bin/git", ["-C", workspacePath, "diff", "--cached", "--name-only"], { encoding: "utf8" });
  assert.equal(stagedAfterRejection.status, 0, stagedAfterRejection.stderr);
  assert.match(stagedAfterRejection.stdout, /^rejected-after-crash\.txt$/m, "rejected approval consumed the staged change");

  const stabilityDurationMs = boundedInteger(process.env.OPENDRSAI_MACOS_L5_STABILITY_MS, 7_200_000, 60_000, 7_300_000);
  const stability = await runScenario("stability", { durationMs: stabilityDurationMs, intervalMs: 30_000, warmupMs: 30_000 }, {}, stabilityDurationMs + 120_000);
  assert.equal(stability.result.ok, true, stability.result.error);
  assert.ok(stability.result.durationMs >= stabilityDurationMs);
  assert.equal(stability.result.gatewayReadyBeforeIdle, true);
  assert.equal(stability.result.warmupMs, 30_000);
  assert.ok(stability.result.heartbeats >= Math.floor(stabilityDurationMs / 30_000));
  stability.resources.idleWindowStartedAtMs = Math.max(0, stability.resources.durationMs - stability.result.durationMs);
  assertNoRuntimeErrors(`${stability.stdout}\n${stability.stderr}`, "stability soak");
  const resourceSummary = summarizeResources([coldPerformance.resources, core.resources, product.resources, ...warmPerformance.map((run) => run.resources), managedCrash.resources, ...restartResources, crash.resources, recovery.resources, stability.resources]);
  const restartGrowth = summarizeRestartGrowth(restartResources);
  assert.ok(resourceSummary.sampleCount >= 6, "packaged L5 did not collect enough process resource samples");
  assert.equal(resourceSummary.residualProcessCount, 0, "packaged L5 left an observed App descendant alive");
  if (iterations === 100) assert.equal(restartGrowth.withinBudget, true, `100-restart resource growth exceeded budget: ${JSON.stringify(restartGrowth)}`);
  writeReceipt("packaged-resource-sampling", {
    featureIds: ["F06.5", "F08.5", "F10.3"],
    restartIterations: iterations,
    formalHundredRestartBudgetSatisfied: iterations === 100 && restartGrowth.withinBudget,
    restartGrowth,
    ...resourceSummary,
  });
  const performance = summarizePerformance(coldPerformance.resources, warmPerformance.map((run) => run.resources), stability.resources);
  assert.equal(performance.withinBudget, true, `Packaged performance exceeded budget: ${JSON.stringify(performance)}`);
  writeReceipt("packaged-performance-budget", { featureIds: ["F01.1", "F08.5", "F10.3"], ...performance });
  writeReceipt("restart-stability", {
    featureIds: ["F03.4", "F03.5", "F04.5", "F06.4", "F06.6", "F10.1"],
    restartIterations: iterations,
    forcedCrashes: 1,
    recoveredCrashes: 1,
    approvalRecoveredAfterCrash: true,
    recoveredApprovalRejected: true,
    rejectedApprovalCommits: 0,
    rejectedChangeRemainedStaged: true,
    stabilityDurationMs: stability.result.durationMs,
    heartbeats: stability.result.heartbeats,
    unhandledErrors: 0,
  });

  const fault = await runScenario("fault", { workspacePath }, {}, 30_000);
  assert.equal(fault.result.ok, true, fault.result.error);
  assert.deepEqual(fault.result.rejected.sort(), ["unregistered-workspace", "unsafe-url", "workspace-traversal"]);
  assertNoRuntimeErrors(`${fault.stdout}\n${fault.stderr}`, "fault injection");
  writeReceipt("fault-injection", {
    featureIds: ["F02.6", "F07.1", "F08.1"],
    injections: fault.result.rejected,
    expectedRejections: 3,
    unexpectedSideEffects: 0,
  });
  suitePassed = true;
  console.log(`macOS packaged L5 passed (${iterations} restarts, one forced crash, ${stability.result.durationMs}ms stability).`);
} finally {
  if (powerAssertion.exitCode === null && powerAssertion.signalCode === null) powerAssertion.kill("SIGTERM");
  if (!suitePassed && keepTempOnFailure) console.error(`L5 preserved failed fixture at ${temp}`);
  else rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  cleanupReleaseMount();
}

function hasRuntimeArchive(candidateApp) {
  const candidateRuntime = join(candidateApp, "Contents", "Resources", "runtime");
  const manifestPath = join(candidateRuntime, "runtime-manifest.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.archive && existsSync(join(candidateRuntime, manifest.archive)));
  } catch { return false; }
}

function cleanupReleaseMount() {
  if (!releaseMount) return;
  spawnSync("/usr/bin/hdiutil", ["detach", releaseMount, "-force"], { stdio: "ignore" });
  rmSync(releaseMount, { recursive: true, force: true });
  releaseMount = undefined;
}

async function runScenario(scenario, config, extraEnv, timeoutMs, keepRunning = false) {
  const startedAt = Date.now();
  const resultPath = join(temp, `${scenario}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(executable, [`--user-data-dir=${userData}`], {
    env: {
      ...process.env,
      ...(suiteGatewayPort ? { DRSAI_API_PORT: String(suiteGatewayPort) } : {}),
      ...extraEnv,
      DRSAI_HOME: home,
      OPENDRSAI_RUNTIME_PERSIST: "0",
      OPENDRSAI_DEV_AUTH_BYPASS: "1",
      OPENDRSAI_E2E_AUTH_USER_ID: "packaged-l5-user",
      OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0",
      OPENDRSAI_E2E_AGENT_RUN: "1",
      OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE: "1",
      OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath,
      OPENDRSAI_MACOS_PACKAGED_SCENARIO: scenario,
      OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG: JSON.stringify(config),
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(`L5 ${scenario} spawned App PID ${child.pid ?? "pending"}.`);
  let stdout = "";
  let stderr = "";
  const resources = { scenario, samples: [], observedPids: new Set(), observedProcesses: new Map(), cpuBaselines: new Map(), residualPids: [] };
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const result = await waitForResult(resultPath, child, timeoutMs, () => stderr, () => sampleProcessTree(child.pid, resources, startedAt));
  resources.durationMs = Date.now() - startedAt;
  writeFileSync(join(acceptance, "packaged-l5-last-scenario.json"), `${JSON.stringify({ schemaVersion: 1, scenario, result, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  if (!keepRunning) {
    const exit = await waitForExit(child, 30_000);
    assert.equal(exit.code, result.ok ? 0 : 1, `${scenario} exit mismatch\n${stderr}`);
    await assertNoObservedResiduals(resources, `${scenario} App tree${result.ok ? "" : ` (scenario error: ${result.error ?? "unknown"})`}`);
  }
  return { child, result, stdout, stderr, resources };
}

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function minimalPdf() {
  const stream = "BT /F1 18 Tf 72 720 Td (OpenDrSai packaged handoff) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n%OpenDrSai\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function presentationPdf() {
  const pages = [
    "OpenDrSai Research Infrastructure Readiness 2030",
    "Agenda\\nBackground\\nWLCG\\nAsian Networks\\nData Challenges\\nConclusions",
    "Background",
    "HL-LHC starts in 2030\\nData volume grows by 10 times\\nDistributed capacity is required",
    "WLCG",
    "Global sites coordinate compute and storage\\nFlexible model bandwidth requires 9.6 Tbps",
    "Asian Networks",
    "Regional links require 4.8 Tbps minimum bandwidth\\nCross-institution operations reduce risk",
    "Data Challenges",
    "2027 target validates 50% scale\\n2029 target validates 100% scale",
    "Conclusions\\n- Prepare capacity before 2030\\n- Validate 9.6 Tbps flexible bandwidth\\n- Coordinate global operations",
    "Questions and Answers",
  ];
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const fontObjectId = 3 + pages.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  for (const [index, text] of pages.entries()) {
    const contentObjectId = pageObjectIds[index] + 1;
    const commands = text.split("\\n").flatMap((line, lineIndex) => [lineIndex ? "0 -28 Td" : "", `(${line.replace(/[()\\]/g, (value) => `\\${value}`)}) Tj`]).filter(Boolean).join(" ");
    const stream = `BT /F1 20 Tf 72 500 Td ${commands} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n%OpenDrSai\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(body, "ascii")); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

async function waitForResult(path, child, timeoutMs, stderr, sample) {
  const deadline = Date.now() + timeoutMs;
  let nextSampleAt = 0;
  while (Date.now() < deadline) {
    if (Date.now() >= nextSampleAt) { sample?.(); nextSampleAt = Date.now() + 2_000; }
    try { const result = JSON.parse(readFileSync(path, "utf8")); sample?.(); return result; } catch { /* wait */ }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`App exited before ${path} was written (code=${child.exitCode}, signal=${child.signalCode}).\n${stderr()}`);
    await delay(100);
  }
  child.kill("SIGKILL");
  throw new Error(`Packaged scenario timed out after ${timeoutMs}ms.\n${stderr()}`);
}

function sampleProcessTree(rootPid, tracker, startedAt) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return;
  const sampledAt = Date.now();
  const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,rss=,time=,command="], { encoding: "utf8" });
  if (ps.status !== 0) throw new Error(`Unable to sample packaged process tree: ${ps.stderr}`);
  const rows = ps.stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:-]+(?:\.\d+)?)\s+(.+)$/); return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rssKiB: Number(match[3]), cpuSeconds: parseCpuTimeSeconds(match[4]), command: match[5].trim() }] : [];
  });
  const pids = new Set([rootPid]);
  for (let changed = true; changed;) { changed = false; for (const row of rows) if (pids.has(row.ppid) && !pids.has(row.pid)) { pids.add(row.pid); changed = true; } }
  const tree = rows.filter((row) => pids.has(row.pid));
  for (const row of tree) { tracker.observedPids.add(row.pid); tracker.observedProcesses.set(row.pid, row.command); }
  let cpuPercent = 0;
  for (const row of tree) {
    const previous = tracker.cpuBaselines.get(row.pid);
    if (previous && sampledAt > previous.sampledAt && row.cpuSeconds >= previous.cpuSeconds) cpuPercent += ((row.cpuSeconds - previous.cpuSeconds) * 100_000) / (sampledAt - previous.sampledAt);
    tracker.cpuBaselines.set(row.pid, { sampledAt, cpuSeconds: row.cpuSeconds });
  }
  for (const pid of tracker.cpuBaselines.keys()) if (!pids.has(pid)) tracker.cpuBaselines.delete(pid);
  const lsof = tree.length ? spawnSync("/usr/sbin/lsof", ["-nP", "-a", "-p", tree.map((row) => row.pid).join(",")], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }) : null;
  const fdCount = lsof && (lsof.status === 0 || lsof.status === 1) ? Math.max(0, lsof.stdout.split(/\r?\n/).filter(Boolean).length - 1) : 0;
  tracker.samples.push({ at: new Date(sampledAt).toISOString(), elapsedMs: sampledAt - startedAt, processCount: tree.length, rssKiB: tree.reduce((sum, row) => sum + row.rssKiB, 0), cpuPercent: Math.round(cpuPercent * 100) / 100, fdCount });
}

function parseCpuTimeSeconds(value) {
  const [dayPart, clockPart] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const parts = clockPart.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) throw new Error(`Unable to parse ps CPU time: ${value}`);
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return Number(dayPart) * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

function killObservedProcessTree(rootPid, tracker) {
  const descendants = [...tracker.observedPids].filter((pid) => pid !== rootPid).sort((left, right) => right - left);
  for (const pid of descendants) { try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ } }
  try { process.kill(rootPid, "SIGKILL"); } catch { /* already exited */ }
}

async function assertNoObservedResiduals(tracker, phase) {
  const deadline = Date.now() + 5_000;
  let alive = [];
  do { alive = [...tracker.observedPids].filter(isAlive); if (!alive.length) break; await delay(100); } while (Date.now() < deadline);
  tracker.residualPids = alive;
  assert.deepEqual(alive, [], `${phase} left observed process pid(s): ${alive.map((pid) => `${pid} (${tracker.observedProcesses.get(pid) ?? "unknown"})`).join(", ")}`);
}

function summarizeResources(trackers) {
  const samples = trackers.flatMap((tracker) => tracker.samples);
  return {
    sampleCount: samples.length,
    maxProcessCount: Math.max(0, ...samples.map((sample) => sample.processCount)),
    maxRssKiB: Math.max(0, ...samples.map((sample) => sample.rssKiB)),
    maxFdCount: Math.max(0, ...samples.map((sample) => sample.fdCount)),
    residualProcessCount: trackers.reduce((sum, tracker) => sum + tracker.residualPids.length, 0),
  };
}

function summarizeRestartGrowth(trackers) {
  const rss = trackers.map((tracker) => Math.max(0, ...tracker.samples.map((sample) => sample.rssKiB)));
  const fds = trackers.map((tracker) => Math.max(0, ...tracker.samples.map((sample) => sample.fdCount)));
  const windowSize = Math.max(1, Math.min(10, Math.floor(trackers.length / 4) || 1));
  const firstRssAverageKiB = average(rss.slice(0, windowSize)); const lastRssAverageKiB = average(rss.slice(-windowSize));
  const firstFdAverage = average(fds.slice(0, windowSize)); const lastFdAverage = average(fds.slice(-windowSize));
  const rssSlopeKiBPerIteration = linearSlope(rss); const fdSlopePerIteration = linearSlope(fds);
  const rssGrowthBudgetKiB = 64 * 1024; const fdGrowthBudget = 32;
  const withinBudget = lastRssAverageKiB <= firstRssAverageKiB + rssGrowthBudgetKiB
    && lastFdAverage <= firstFdAverage + fdGrowthBudget
    && rssSlopeKiBPerIteration <= 1_024
    && fdSlopePerIteration <= 0.5;
  return { sampleIterations: trackers.length, windowSize, firstRssAverageKiB, lastRssAverageKiB, rssSlopeKiBPerIteration, rssGrowthBudgetKiB, firstFdAverage, lastFdAverage, fdSlopePerIteration, fdGrowthBudget, withinBudget };
}

function summarizePerformance(cold, warm, stability) {
  const warmInteractiveMs = warm.map((tracker) => tracker.durationMs).sort((left, right) => left - right);
  const idle = stability.samples.filter((sample) => sample.elapsedMs >= (stability.idleWindowStartedAtMs ?? 0) + 10_000);
  const idleCpu = idle.map((sample) => sample.cpuPercent).sort((left, right) => left - right);
  const idleRss = idle.map((sample) => sample.rssKiB);
  const coldInteractiveBudgetMs = 45_000; const warmInteractiveP95BudgetMs = 10_000; const idleAverageCpuBudgetPercent = 15; const idleP95CpuBudgetPercent = 40; const idleMaxRssBudgetKiB = 1_258_291;
  const coldInteractiveMs = cold.durationMs; const warmInteractiveP95Ms = percentile(warmInteractiveMs, 0.95); const idleAverageCpuPercent = Math.round((idleCpu.reduce((sum, value) => sum + value, 0) / Math.max(1, idleCpu.length)) * 100) / 100; const idleP95CpuPercent = percentile(idleCpu, 0.95); const idleMaxRssKiB = Math.max(0, ...idleRss);
  const withinBudget = coldInteractiveMs <= coldInteractiveBudgetMs && warmInteractiveP95Ms <= warmInteractiveP95BudgetMs && idle.length >= 2 && idleAverageCpuPercent <= idleAverageCpuBudgetPercent && idleP95CpuPercent <= idleP95CpuBudgetPercent && idleMaxRssKiB <= idleMaxRssBudgetKiB;
  return { coldInteractiveMs, coldInteractiveBudgetMs, warmInteractiveRuns: warmInteractiveMs.length, warmInteractiveP95Ms, warmInteractiveP95BudgetMs, idleSampleCount: idle.length, idleAverageCpuPercent, idleAverageCpuBudgetPercent, idleP95CpuPercent, idleP95CpuBudgetPercent, idleMaxRssKiB, idleMaxRssBudgetKiB, withinBudget };
}

function percentile(values, fraction) { if (!values.length) return 0; return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]; }

function average(values) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
function linearSlope(values) {
  if (values.length < 2) return 0;
  const meanX = (values.length - 1) / 2; const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0; let denominator = 0;
  for (const [index, value] of values.entries()) { numerator += (index - meanX) * (value - meanY); denominator += (index - meanX) ** 2; }
  return Math.round((numerator / denominator) * 1_000) / 1_000;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Packaged App did not exit cleanly.")); }, timeoutMs);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); });
  });
}

function writeReceipt(testId, detail) {
  writeFileSync(join(acceptance, `${testId}.json`), `${JSON.stringify({ schemaVersion: 2, testId, platform: "darwin-arm64", passed: true, ...detail, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function assertNoRuntimeErrors(stderr, phase) {
  assert.doesNotMatch(stderr, /UnhandledPromiseRejection|unhandled rejection|uncaught exception|CONSOLE\(\d+\).*\bERROR\b/i, `${phase} emitted an unhandled runtime error`);
}

function boundedInteger(raw, fallback, min, max) {
  const parsed = Number(raw ?? fallback);
  assert.ok(Number.isInteger(parsed) && parsed >= min && parsed <= max, `Expected integer ${min}..${max}, received ${raw}`);
  return parsed;
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    let settled = false;
    const finish = (error, port = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(listenTimer);
      if (error) reject(error); else resolvePort(port);
    };
    const listenTimer = setTimeout(() => { server.close(); finish(new Error("Timed out while reserving a local Gateway port.")); }, 5_000);
    server.once("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      if (!port) { server.close(); finish(new Error("Local Gateway port reservation returned no port.")); return; }
      clearTimeout(listenTimer);
      const closeTimer = setTimeout(() => finish(undefined, port), 2_000);
      server.once("close", () => { clearTimeout(closeTimer); finish(undefined, port); });
      server.close();
    });
    server.unref();
  });
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
