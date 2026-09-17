import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const evidenceDir = join(root, "release", "product-evidence", "remote-workspace");
const state = JSON.parse(readFileSync(join(evidenceDir, "remote-stability-1h.state.json"), "utf8"));
const evidence = JSON.parse(readFileSync(join(evidenceDir, "remote-stability-1h.json"), "utf8"));
if (!evidence.completed || evidence.finalization?.kind !== "requirement-reduced-after-observed-window") throw new Error("Completed policy-change stability evidence is required.");
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-stability-final-regression-"));

try {
  verify("valid", state, evidence, true);

  const short = structuredClone(evidence);
  short.durationSeconds = 3599;
  short.finalization.newRequirementSeconds = 3599;
  verify("short-window", state, short, false, /not a one-hour run/);

  const alteredSample = structuredClone(evidence);
  alteredSample.samples[0].at = new Date(Date.parse(alteredSample.samples[0].at) + 1_000).toISOString();
  verify("altered-sample", state, alteredSample, false, /not byte-equivalent to source evidence/);

  const alteredHash = structuredClone(evidence);
  alteredHash.finalization.sourceSha256 = "0".repeat(64);
  verify("altered-source-hash", state, alteredHash, false, /source evidence hash does not match/);

  const failedWatchdog = { ...JSON.parse(readFileSync(state.watchdogEvidence, "utf8")), cleanupVerified: false };
  const failedWatchdogPath = join(temporary, "failed-watchdog.json");
  writeFileSync(failedWatchdogPath, `${JSON.stringify(failedWatchdog, null, 2)}\n`, "utf8");
  const failedCleanupState = { ...state, watchdogEvidence: failedWatchdogPath };
  verify("failed-cleanup", failedCleanupState, evidence, false, /watchdog cleanup evidence is missing, mismatched or failed/);

  console.log("Remote stability final regressions passed (valid + short window + sample/hash tamper + failed cleanup rejected).");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function verify(name, candidateState, candidateEvidence, shouldPass, expectedFailure) {
  const statePath = join(temporary, `${name}.state.json`);
  const evidencePath = join(temporary, `${name}.evidence.json`);
  writeFileSync(statePath, `${JSON.stringify(candidateState, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(candidateEvidence, null, 2)}\n`, "utf8");
  const result = spawnSync(process.execPath, ["scripts/verify-remote-stability-evidence.mjs"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, OPENDRSAI_REMOTE_STABILITY_STATE: statePath, OPENDRSAI_REMOTE_STABILITY_EVIDENCE: evidencePath },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error) throw result.error;
  if (shouldPass && result.status !== 0) throw new Error(`${name} unexpectedly failed:\n${output}`);
  if (!shouldPass && (result.status === 0 || !expectedFailure.test(output))) throw new Error(`${name} did not fail as expected:\n${output}`);
}
