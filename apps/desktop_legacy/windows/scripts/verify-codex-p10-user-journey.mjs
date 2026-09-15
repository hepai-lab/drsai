import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const artifactRoot = resolve(root, ".artifacts/codex-p10");
const readJson = (path) => {
  assert(existsSync(path), `P10 user-journey evidence is missing: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
};
const result = (name) => readJson(resolve(artifactRoot, "results", `${name}.json`));
const requireSuite = (name) => {
  const value = result(name);
  assert.equal(value.executed, true, `${name} was not executed`);
  assert.equal(value.status, 0, `${name} did not pass`);
  assert(value.commands?.every((command) => command.status === 0), `${name} contains a failed command`);
  return value;
};

const inputSession = requireSuite("p10-input-session");
const errors = requireSuite("p10-errors");
const approval = requireSuite("p10-approval");
const history = requireSuite("p10-history");
const electron = requireSuite("p10-electron");
const liveResult = requireSuite("p10-live");
const bridgeResult = requireSuite("p10-bridge-equivalence");
const live = readJson(resolve(artifactRoot, "live-evidence.json"));
const bridge = readJson(resolve(artifactRoot, "ssh-bridge.json"));
const visual = readJson(resolve(root, "apps/desktop/windows/out/verification/structured-visual/report.json"));
const ipc = readJson(resolve(root, ".artifacts/codex-p8-electron-ipc.json"));

const checkpoints = {
  workspaceAndSessionImport: {
    passed: history.status === 0 && inputSession.status === 0,
    evidence: ["verify:codex-desktop-integration", "verify:session-sync-state", "verify:session-conversation-subscription"],
  },
  openOrderedHistory: {
    passed: history.status === 0 && live.passed === true,
    evidence: ["p10-history", "live-evidence.json"],
  },
  continuousMultiTurn: {
    passed: live.multiTurn?.turnCount >= 30 && live.multiTurn?.threadIdStable === true
      && live.multiTurn?.turnIdsUnique === true && live.multiTurn?.contextRetained === true,
    evidence: ["live-evidence.json#multiTurn"],
  },
  queuedAndCancelledTurns: {
    passed: inputSession.status === 0 && live.cancellation?.verified === true,
    evidence: ["verify:codex-p10-turn-queue-ux", "live-evidence.json#cancellation"],
  },
  attachmentsAndInputResources: {
    passed: ["file", "folder", "selection", "terminal", "browser"]
      .every((kind) => live.inputResources?.kinds?.includes(kind)) && live.inputResources?.allMarkersObserved === true,
    evidence: ["verify:codex-p7-attachments", "live-evidence.json#inputResources"],
  },
  processingAndFinalAnswer: {
    passed: visual.ok === true && live.processingOrder?.ordered === true && live.streaming?.firstContentBeforeTerminal === true,
    evidence: ["structured-visual/report.json", "live-evidence.json#processingOrder"],
  },
  keyboardAndAccessibility: {
    passed: visual.accessibility?.keyboardDisclosureVerified === true
      && visual.accessibility?.unnamedInteractive?.length === 0
      && visual.accessibility?.duplicateIds?.length === 0
      && visual.accessibility?.imagesMissingAlt === 0,
    evidence: ["structured-visual/report.json#accessibility"],
  },
  approvalTerminal: {
    passed: approval.status === 0 && live.approval?.count >= 1,
    evidence: ["p10-approval", "live-evidence.json#approval"],
  },
  explainableErrorRecovery: {
    passed: errors.status === 0 && bridge.errorObserved === true,
    evidence: ["p10-errors", "ssh-bridge.json#errorObserved"],
  },
  archiveRestore: {
    passed: live.archive?.roundTrip === true,
    evidence: ["verify:thread-archive", "live-evidence.json#archive"],
  },
  restartContinuation: {
    passed: live.runtime?.restartVerified === true && live.multiTurn?.threadIdStable === true,
    evidence: ["verify:codex-session-resume-policy", "live-evidence.json#runtime"],
  },
  remoteTransportEquivalence: {
    passed: bridgeResult.status === 0 && bridge.passed === true && bridge.sshTunnel === true
      && bridge.oaepSemanticDigest === bridge.localSemanticDigest,
    evidence: ["p10-bridge-equivalence", "ssh-bridge.json"],
  },
  responsiveLargeConversation: {
    passed: electron.status === 0 && ipc.ok === true && ipc.checks?.orderedTerminalState === true
      && ipc.checks?.reducerAppliedAllDeltas === true && ipc.checks?.renderP95UnderBudget === true
      && ipc.checks?.memoryBounded === true,
    evidence: ["p10-electron", "codex-p8-electron-ipc.json"],
  },
};
for (const [name, checkpoint] of Object.entries(checkpoints)) assert.equal(checkpoint.passed, true, `${name} did not pass`);
assert.equal(liveResult.status, 0);

const report = {
  schema: "opendrsai.codex-adapter-p10.user-journey.v1",
  ok: true,
  observedAt: new Date().toISOString(),
  checkpointCount: Object.keys(checkpoints).length,
  checkpoints,
  screenshots: visual.results?.flatMap((row) => [row.screenshotPath, row.tableScreenshotPath,
    row.codeScreenshotPath, row.imageScreenshotPath, row.processScreenshotPath]).filter(Boolean) ?? [],
};
mkdirSync(artifactRoot, { recursive: true });
writeFileSync(resolve(artifactRoot, "user-journey.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: true, checkpoints: report.checkpointCount, screenshots: report.screenshots.length }));
