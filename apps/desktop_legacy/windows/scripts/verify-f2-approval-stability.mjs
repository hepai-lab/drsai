import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_F2_STABILITY_ROUNDS || "20");
const evidenceRoot = resolve(
  process.env.OPENDRSAI_F2_STABILITY_EVIDENCE_DIR ||
  join(root, "release", "f2-approval-stability-evidence", timestampForPath(new Date())),
);

mkdirSync(evidenceRoot, { recursive: true });

const summary = {
  ok: true,
  startedAt: new Date().toISOString(),
  evidenceRoot,
  rounds,
  scenariosPerRound: 6,
  expectedRejectScenarios: rounds * 6,
  unauthorizedExecutions: 0,
  configuredRetries: 0,
  actualRetries: 0,
  roundResults: [],
};

for (let round = 1; round <= rounds; round += 1) {
  const roundDir = join(evidenceRoot, `round-${String(round).padStart(2, "0")}`);
  const result = spawnSync("node", ["scripts/verify-packaged-f2-approvals.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENDRSAI_F2_EVIDENCE_DIR: roundDir,
    },
    windowsHide: true,
  });
  const roundSummaryPath = join(roundDir, "summary.json");
  const roundSummary = existsSync(roundSummaryPath)
    ? JSON.parse(readFileSync(roundSummaryPath, "utf8"))
    : null;
  const roundResult = {
    round,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    evidenceRoot: roundDir,
    ok: Boolean(result.status === 0 && roundSummary?.ok),
    unauthorizedExecutions: Number(roundSummary?.unauthorizedExecutions || 0),
    configuredRetries: Number(roundSummary?.configuredRetries || 0),
    actualRetries: Number(roundSummary?.actualRetries || 0),
    checkCount: Object.keys(roundSummary?.scenarios?.[0]?.checks || {}).length,
    passedChecks: Object.values(roundSummary?.scenarios?.[0]?.checks || {}).filter(Boolean).length,
    effectCount: Array.isArray(roundSummary?.scenarios?.[0]?.effectDiagnostics) ? roundSummary.scenarios[0].effectDiagnostics.length : 0,
    cernSha256: roundSummary?.scenarios?.[0]?.cernPdf?.sha256 || null,
    artifactHash: roundSummary?.artifactHash || null,
  };
  summary.roundResults.push(roundResult);
  summary.unauthorizedExecutions += roundResult.unauthorizedExecutions;
  summary.configuredRetries += roundResult.configuredRetries;
  summary.actualRetries += roundResult.actualRetries;
  if (!roundResult.ok || roundResult.unauthorizedExecutions !== 0) {
    summary.ok = false;
    break;
  }
}

summary.finishedAt = new Date().toISOString();
summary.completedRounds = summary.roundResults.length;
summary.passedRejectScenarios = summary.roundResults
  .filter((round) => round.ok)
  .length * summary.scenariosPerRound;
summary.totalChecks = summary.roundResults.reduce((sum, round) => sum + round.checkCount, 0);
summary.passedChecks = summary.roundResults.reduce((sum, round) => sum + round.passedChecks, 0);
summary.authorizedControlExecutions = summary.roundResults.reduce((sum, round) => sum + round.effectCount, 0);
summary.cernHashes = [...new Set(summary.roundResults.map((round) => round.cernSha256).filter(Boolean))];
summary.exitCode =
  summary.ok &&
  summary.completedRounds === rounds &&
  summary.passedRejectScenarios === summary.expectedRejectScenarios &&
  summary.unauthorizedExecutions === 0 &&
  summary.totalChecks === rounds * 60 &&
  summary.passedChecks === summary.totalChecks &&
  summary.authorizedControlExecutions === rounds * 6 &&
  summary.cernHashes.length === 1 &&
  summary.cernHashes[0] === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E" &&
  summary.configuredRetries === 0 &&
  summary.actualRetries === 0
    ? 0
    : 1;
summary.artifactHash = hashObject({ ...summary, artifactHash: undefined });
writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (summary.exitCode !== 0) {
  throw new Error(`F2 approval stability failed. Evidence: ${evidenceRoot}`);
}

console.log(`F2 approval stability passed. Evidence: ${evidenceRoot}`);

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
