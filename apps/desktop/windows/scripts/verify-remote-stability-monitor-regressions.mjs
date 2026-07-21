import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const evidenceDir = join(root, "release", "product-evidence", "remote-workspace");
const state = JSON.parse(readFileSync(join(evidenceDir, "remote-stability-1h.state.json"), "utf8"));
const evidence = JSON.parse(readFileSync(join(evidenceDir, "remote-stability-1h.json"), "utf8"));
if (evidence.completed) throw new Error("Monitor regressions require an active stability window.");
for (const sample of evidence.samples || []) sample.ptyProcessCount = 0;
const temporaryRoot = mkdtempSync(join(tmpdir(), "opendrsai-stability-monitor-regression-"));

try {
  verify(state, evidence, true);

  const missingContainer = structuredClone(state);
  delete missingContainer.containerId;
  verify(missingContainer, evidence, false, /not bound to a Docker container ID/);

  const missingWatchdog = structuredClone(state);
  delete missingWatchdog.watchdogPid;
  verify(missingWatchdog, evidence, false, /cleanup watchdog is not active or recorded/);

  const replacedContainer = structuredClone(state);
  replacedContainer.containerId = "0".repeat(64);
  verify(replacedContainer, evidence, false, /Docker container changed from/);

  const invalidTunnelSample = structuredClone(evidence);
  invalidTunnelSample.samples[0].tunnelCount = 0;
  verify(state, invalidTunnelSample, false, /sample 1 has 0 SSH tunnels instead of 1/);

  const orphanPtySample = structuredClone(evidence);
  orphanPtySample.samples[0].ptyProcessCount = 1;
  verify(state, orphanPtySample, false, /sample 1 has 1 orphan PTY processes instead of 0/);

  const changedRuntime = structuredClone(evidence);
  changedRuntime.samples.push({
    ...changedRuntime.samples[0],
    at: new Date().toISOString(),
    elapsedSeconds: Number(changedRuntime.samples[0].elapsedSeconds) + Number(changedRuntime.intervalSeconds),
    runtimeId: "runtime-00000000-0000-4000-8000-000000000000",
  });
  verify(state, changedRuntime, false, /sample 2 changed runtimeId/);

  console.log("Remote stability live-monitor regressions passed (valid + watchdog + unbound + replaced + tunnel drift + PTY drift + Runtime drift).");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function verify(candidateState, candidateEvidence, shouldPass, expectedFailure) {
  const id = crypto.randomUUID();
  const statePath = join(temporaryRoot, `${id}.state.json`);
  const evidencePath = join(temporaryRoot, `${id}.evidence.json`);
  writeFileSync(statePath, `${JSON.stringify(candidateState, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(candidateEvidence, null, 2)}\n`, "utf8");
  const result = spawnSync(process.execPath, ["scripts/verify-remote-stability-evidence.mjs", "--allow-running"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: {
      ...process.env,
      OPENDRSAI_REMOTE_STABILITY_STATE: statePath,
      OPENDRSAI_REMOTE_STABILITY_EVIDENCE: evidencePath,
    },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error) throw result.error;
  if (shouldPass && result.status !== 0) throw new Error(`Valid live stability evidence was rejected: ${output}`);
  if (!shouldPass && (result.status === 0 || !expectedFailure.test(output))) {
    throw new Error(`Invalid live stability evidence was not rejected as expected: ${output}`);
  }
}
