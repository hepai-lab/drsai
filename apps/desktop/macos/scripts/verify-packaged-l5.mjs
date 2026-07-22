import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Packaged L5 must run on Apple Silicon macOS.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = join(root, "release", "mac-arm64", "OpenDrSai.app", "Contents", "MacOS", "OpenDrSai");
const acceptance = join(root, "build", "acceptance");
const temp = mkdtempSync(join(tmpdir(), "opendrsai-macos-l5-"));
const home = join(temp, "home");
const workspacePath = join(temp, "workspace");
mkdirSync(workspacePath, { recursive: true });
mkdirSync(join(workspacePath, ".drsai"), { recursive: true });
writeFileSync(join(workspacePath, "journey.txt"), "before L5 checkpoint\n", "utf8");
writeFileSync(join(workspacePath, "reusable-input.csv"), "name,value\npackaged,5\n", "utf8");
writeFileSync(join(workspacePath, "reusable-output.md"), "# Packaged reusable result\n", "utf8");
writeFileSync(join(workspacePath, "handoff-source.ts"), "export const packagedHandoff = true;\n", "utf8");
writeFileSync(join(workspacePath, ".drsai", "ide-context.json"), `${JSON.stringify({ source: "vscode", capturedAt: "2026-07-22T00:00:00.000Z", currentFile: { relativePath: "handoff-source.ts", language: "typescript", line: 1, column: 14 }, currentSelection: { relativePath: "handoff-source.ts", text: "packagedHandoff", language: "typescript", startLine: 1, endLine: 1 } }, null, 2)}\n`, "utf8");
writeFileSync(join(workspacePath, "handoff.pdf"), minimalPdf());
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

try {
  const gatewayPort = await freePort();
  const core = await runScenario("core", { workspacePath }, { DRSAI_API_PORT: String(gatewayPort) }, 120_000);
  assert.equal(core.result.ok, true);
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

  const product = await runScenario("product-state", { workspacePath }, {}, 120_000);
  assert.equal(product.result.ok, true);
  for (const check of ["threadLifecycle", "chatAbortRecoveryLifecycle", "chatNetworkRecoveryLifecycle", "agentCatalogAbortRecoveryLifecycle", "gitApprovalExecution", "workspaceGitReviewLifecycle", "checkpointLifecycle", "worktreeQueueLifecycle", "desktopHandoffLifecycle", "customCommandCrud", "projectMemoryCrud", "projectSkillApprovalInstall", "workflowLifecycle", "reusableAndScheduledLifecycle", "diagnosticsRoundtrip", "backgroundTaskLifecycle", "interactiveDebuggerRoundtrip"]) assert.equal(product.result[check], true, `product-state missing ${check}`);
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
    journeys: ["thread-crud-snapshot-search-archive-binding", "chat-start-abort-journal-late-input", "chat-incomplete-sse-resume-cursor-replay-dedup", "agent-catalog-default-usage-start-abort-recovery", "git-approval-execute-and-replay", "workspace-git-diff-stage-ref-revert-stale-review", "checkpoint-create-preview-approved-restore-accept", "worktree-create-event-queue-dispatch-abort-discard", "ide-context-native-icon-edit-command-pdf-launchservices", "custom-command-crud", "project-memory-crud", "project-skill-draft-approval-install", "workflow-marketplace-strict-completion-history", "reusable-task-fresh-input-and-scheduled-safe-due", "diagnostic-record-snapshot", "background-task-idempotency-cancel-retry", "debug-policy-attach-detach"],
    checks: 17,
    unexpectedSideEffects: 0,
  });

  const iterations = boundedInteger(process.env.OPENDRSAI_MACOS_L5_RESTART_ITERATIONS, 100, 1, 100);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const restart = await runScenario("restart", { threadId: core.result.thread.id }, {}, 30_000);
    assert.equal(restart.result.ok, true, `restart iteration ${iteration + 1}`);
    assert.equal(restart.result.threadRecovered, true);
    assert.equal(restart.result.preferenceRecovered, true);
    assertNoRuntimeErrors(`${restart.stdout}\n${restart.stderr}`, `restart iteration ${iteration + 1}`);
  }

  writeFileSync(join(workspacePath, "rejected-after-crash.txt"), "must remain staged after rejection\n", "utf8");
  const stagedForCrash = spawnSync("/usr/bin/git", ["-C", workspacePath, "add", "rejected-after-crash.txt"], { encoding: "utf8" });
  assert.equal(stagedForCrash.status, 0, stagedForCrash.stderr);
  const crash = await runScenario("crash-ready", { workspacePath }, {}, 30_000, true);
  assert.equal(crash.result.readyForForcedCrash, true);
  assert.match(crash.result.approvalId, /^approval:/);
  crash.child.kill("SIGKILL");
  await waitForExit(crash.child, 15_000);
  const recovery = await runScenario("recovery", { threadId: core.result.thread.id, approvalId: crash.result.approvalId }, {}, 30_000);
  assert.equal(recovery.result.ok, true);
  assert.equal(recovery.result.threadRecovered, true);
  assert.equal(recovery.result.approvalRecoveredRejected, true);
  assertNoRuntimeErrors(`${recovery.stdout}\n${recovery.stderr}`, "post-crash recovery");
  const postRecoveryCount = spawnSync("/usr/bin/git", ["-C", workspacePath, "rev-list", "--count", "HEAD"], { encoding: "utf8" });
  assert.equal(postRecoveryCount.status, 0, postRecoveryCount.stderr);
  assert.equal(Number(postRecoveryCount.stdout.trim()), 1, "rejected recovered approval created a commit");
  const stagedAfterRejection = spawnSync("/usr/bin/git", ["-C", workspacePath, "diff", "--cached", "--name-only"], { encoding: "utf8" });
  assert.equal(stagedAfterRejection.status, 0, stagedAfterRejection.stderr);
  assert.match(stagedAfterRejection.stdout, /^rejected-after-crash\.txt$/m, "rejected approval consumed the staged change");

  const stabilityDurationMs = boundedInteger(process.env.OPENDRSAI_MACOS_L5_STABILITY_MS, 7_200_000, 60_000, 7_300_000);
  const stability = await runScenario("stability", { durationMs: stabilityDurationMs, intervalMs: 30_000 }, {}, stabilityDurationMs + 90_000);
  assert.equal(stability.result.ok, true);
  assert.ok(stability.result.durationMs >= stabilityDurationMs);
  assert.ok(stability.result.heartbeats >= Math.floor(stabilityDurationMs / 30_000));
  assertNoRuntimeErrors(`${stability.stdout}\n${stability.stderr}`, "stability soak");
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
  assert.equal(fault.result.ok, true);
  assert.deepEqual(fault.result.rejected.sort(), ["unregistered-workspace", "unsafe-url", "workspace-traversal"]);
  assertNoRuntimeErrors(`${fault.stdout}\n${fault.stderr}`, "fault injection");
  writeReceipt("fault-injection", {
    featureIds: ["F02.6", "F07.1", "F08.1"],
    injections: fault.result.rejected,
    expectedRejections: 3,
    unexpectedSideEffects: 0,
  });
  console.log(`macOS packaged L5 passed (${iterations} restarts, one forced crash, ${stability.result.durationMs}ms stability).`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

async function runScenario(scenario, config, extraEnv, timeoutMs, keepRunning = false) {
  const resultPath = join(temp, `${scenario}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      ...extraEnv,
      DRSAI_HOME: home,
      OPENDRSAI_RUNTIME_PERSIST: "0",
      OPENDRSAI_DEV_AUTH_BYPASS: "1",
      OPENDRSAI_E2E_AUTH_USER_ID: "packaged-l5-user",
      OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0",
      OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE: "1",
      OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath,
      OPENDRSAI_MACOS_PACKAGED_SCENARIO: scenario,
      OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG: JSON.stringify(config),
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const result = await waitForResult(resultPath, child, timeoutMs, () => stderr);
  if (!keepRunning) {
    const exit = await waitForExit(child, 30_000);
    assert.equal(exit.code, result.ok ? 0 : 1, `${scenario} exit mismatch\n${stderr}`);
  }
  return { child, result, stdout, stderr };
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

async function waitForResult(path, child, timeoutMs, stderr) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { /* wait */ }
    if (child.exitCode !== null) throw new Error(`App exited before ${path} was written (${child.exitCode}).\n${stderr()}`);
    await delay(100);
  }
  child.kill("SIGKILL");
  throw new Error(`Packaged scenario timed out after ${timeoutMs}ms.\n${stderr()}`);
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
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
