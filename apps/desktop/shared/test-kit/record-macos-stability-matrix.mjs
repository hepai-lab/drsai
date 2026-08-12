import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit } from "./acceptanceEvidence.mjs";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("The v1.5.7 stability matrix must be recorded on Apple Silicon macOS.");
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(desktopRoot, "../..");
const acceptance = resolve(desktopRoot, "macos/build/acceptance");
const snapshot = read("source-snapshot");
assert.equal(snapshot.clean, true, "Stability matrix requires a clean source snapshot");
assert.equal(snapshot.commit, currentCommit(repoRoot));
const core = read("packaged-core-journeys");
const auth = read("packaged-auth-cycles");
const product = read("packaged-product-journeys");
const crashes = read("managed-process-crash-recovery");
const system = read("packaged-system-events");
const restart = read("restart-stability");
const keychain = read("keychain-lock-cycle");
const sleepWake = read("sleep-wake-real-device");
const renderer = read("l3-renderer");
const cleanInstall = read("clean-install");
const update = read("signed-update-rollback");
assert.equal(renderer.commit, snapshot.commit, "Renderer evidence is stale for the current source commit");

const requirements = {
  coreGoldenTasks20: core.passed === true && core.consecutiveIterations >= 20 && core.formalTwentyRoundRequirementSatisfied === true,
  loginLogout20: auth.passed === true && auth.loginLogoutIterations >= 20 && auth.failedIterations === 0,
  appRestart20: restart.passed === true && restart.restartIterations >= 20,
  runtimeCrashRecovery20: crashes.passed === true && crashes.gatewayForcedCrashes >= 20 && crashes.nativeHelperForcedCrashes >= 20 && crashes.residualProcessCount === 0,
  approvalRejectNoSideEffectsAndApproveExactlyOnce: product.passed === true && product.unexpectedSideEffects === 0 && restart.rejectedApprovalCommits === 0 && restart.rejectedChangeRemainedStaged === true,
  normalSlowOfflineNetwork: includesAll(product.networkConditions, ["normal", "slow", "interrupted-response-recovery"]) && includesAll(system.networkConditions, ["offline", "online-recovery"]),
  cleanAndUpgradeUsers: cleanInstall.passed === true && cleanInstall.runtimeInstalled === true && cleanInstall.userDataPreserved === true && update.passed === true && update.onlineUpdateInstalled === true && update.userDataPreserved === true,
  keychainLockUnlock: keychain.passed === true && keychain.lockedSecretRefused === true && keychain.unlockedSecretRecovered === true && keychain.deletedSecretRefused === true,
  displayAndWindowRecovery: system.passed === true && system.journeys?.includes("display-change-window-recovery") && renderer.passed === true && renderer.checks?.includes("responsive-overflow"),
  sleepWake20: sleepWake.passed === true && sleepWake.roundsCompleted >= 20 && sleepWake.formalTwentyRoundRequirementSatisfied === true && sleepWake.residualProcessCount === 0,
  userDataIntegrity: sleepWake.userDataPreserved === true && cleanInstall.userDataPreserved === true && update.userDataPreserved === true,
  visualAccessibilityNoiseFree: renderer.passed === true && renderer.checks?.includes("axe-wcag2a-aa-serious-critical-zero"),
};
for (const [name, passed] of Object.entries(requirements)) assert.equal(passed, true, `v1.5.7 stability matrix requirement failed: ${name}`);
const evidenceFiles = ["packaged-core-journeys", "packaged-auth-cycles", "packaged-product-journeys", "managed-process-crash-recovery", "packaged-system-events", "restart-stability", "keychain-lock-cycle", "sleep-wake-real-device", "l3-renderer", "clean-install", "signed-update-rollback"];
const receipt = {
  schemaVersion: 2,
  testId: "stability-matrix",
  platform: "darwin-arm64",
  passed: true,
  featureIds: ["F03.1", "F03.5", "F06.3", "F06.4", "F06.5", "F08.5", "F10.3"],
  commit: snapshot.commit,
  sourceAggregateSha256: snapshot.aggregateSha256,
  allRequiredConditionsPassed: true,
  requirements,
  evidence: evidenceFiles.map((name) => ({ testId: name, sha256: sha256(resolve(acceptance, `${name}.json`)) })),
  generatedAt: new Date().toISOString(),
};
writeFileSync(resolve(acceptance, "stability-matrix.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`macOS v1.5.7 stability matrix passed (${Object.keys(requirements).length} required conditions).`);

function read(name) { const path = resolve(acceptance, `${name}.json`); assert.ok(existsSync(path), `missing ${name}.json`); return JSON.parse(readFileSync(path, "utf8")); }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function includesAll(actual, expected) { return Array.isArray(actual) && expected.every((value) => actual.includes(value)); }
