import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, release, type } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runner = join(root, "scripts", "verify-packaged-a5-service-guidance.mjs");
const rounds = Number(process.env.OPENDRSAI_A5_STABILITY_ROUNDS || "20");

if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error("OPENDRSAI_A5_STABILITY_ROUNDS must be a positive integer.");
}

const evidenceRoot = resolve(
  process.env.OPENDRSAI_A5_STABILITY_EVIDENCE_DIR ||
    join(root, "release", "a5-service-guidance-stability-evidence", timestampForPath(new Date())),
);
mkdirSync(evidenceRoot, { recursive: true });

const summary = {
  ok: true,
  startedAt: new Date().toISOString(),
  evidenceRoot,
  requestedRounds: rounds,
  requestedScenariosPerRound: 4,
  requestedScenarioCount: rounds * 4,
  configuredRetries: 0,
  environment: {
    platform: process.platform,
    osType: type(),
    osRelease: release(),
    architecture: arch(),
    displayScale: process.env.OPENDRSAI_E2E_DISPLAY_SCALE || "not-recorded",
    accountType: process.env.OPENDRSAI_E2E_ACCOUNT_TYPE || "not-recorded",
    networkProfile: process.env.OPENDRSAI_E2E_NETWORK_PROFILE || "normal",
  },
  rounds: [],
};

try {
  for (let index = 1; index <= rounds; index += 1) {
    const roundName = `round-${String(index).padStart(2, "0")}`;
    const roundEvidence = join(evidenceRoot, roundName);
    const startedAt = new Date();
    const result = spawnSync(process.execPath, [runner], {
      cwd: root,
      env: {
        ...process.env,
        OPENDRSAI_A5_EVIDENCE_DIR: roundEvidence,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    const childSummaryPath = join(roundEvidence, "summary.json");
    const childSummary = existsSync(childSummaryPath)
      ? JSON.parse(readFileSync(childSummaryPath, "utf8"))
      : null;
    const scenarioCount = childSummary?.scenarios?.length ?? 0;
    const passedScenarioCount = childSummary?.scenarios?.filter((scenario) => scenario.ok).length ?? 0;
    const round = {
      round: index,
      ok: Boolean(result.status === 0 && childSummary?.ok && scenarioCount === 4 && passedScenarioCount === 4),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      exitCode: result.status,
      signal: result.signal,
      retries: 0,
      scenarioCount,
      passedScenarioCount,
      evidencePath: roundEvidence,
      summaryPath: existsSync(childSummaryPath) ? childSummaryPath : null,
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr?.trim() || "",
    };
    summary.rounds.push(round);
    if (!round.ok) summary.ok = false;
    console.log(`${roundName}: ${round.ok ? "passed" : "failed"} (${passedScenarioCount}/4)`);
    if (!round.ok) break;
  }
} finally {
  summary.finishedAt = new Date().toISOString();
  summary.completedRounds = summary.rounds.length;
  summary.completedScenarioCount = summary.rounds.reduce((total, round) => total + round.scenarioCount, 0);
  summary.passedScenarioCount = summary.rounds.reduce((total, round) => total + round.passedScenarioCount, 0);
  summary.exitCode = summary.ok && summary.completedRounds === rounds ? 0 : 1;
  writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

if (summary.exitCode !== 0) {
  throw new Error(`Packaged A5 stability verification failed. Evidence: ${evidenceRoot}`);
}

console.log(`Packaged A5 stability verification passed (${rounds * 4}/${rounds * 4}). Evidence: ${evidenceRoot}`);

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
