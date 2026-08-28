import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_F4_STABILITY_ROUNDS || "20");
const evidenceRoot = resolve(process.env.OPENDRSAI_F4_STABILITY_EVIDENCE_DIR || join(root, "release", "f4-anomaly-decision-stability-evidence", new Date().toISOString().replace(/[:.]/g, "-")));
mkdirSync(evidenceRoot, { recursive: true });
const results = [];
for (let round = 1; round <= rounds; round += 1) {
  const roundDir = join(evidenceRoot, `round-${String(round).padStart(2, "0")}`);
  const run = spawnSync("node", ["scripts/verify-packaged-f4-anomaly-decision.mjs"], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, OPENDRSAI_F4_EVIDENCE_DIR: roundDir } });
  const summaryPath = join(roundDir, "summary.json");
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
  results.push({ round, exitCode: run.status, ok: Boolean(run.status === 0 && summary?.ok), scenarios: summary?.scenarios || 0, checkCount: summary?.checkCount || 0, passedChecks: summary?.passedChecks || 0, artifactHash: summary?.artifactHash || null, stdout: run.stdout, stderr: run.stderr });
  if (!results.at(-1).ok) break;
}
const summary = { ok: results.length === rounds && results.every((item) => item.ok) && results.reduce((sum, item) => sum + item.scenarios, 0) === rounds * 3, rounds, completedRounds: results.length, scenarios: results.reduce((sum, item) => sum + item.scenarios, 0), checkCount: results.reduce((sum, item) => sum + item.checkCount, 0), passedChecks: results.reduce((sum, item) => sum + item.passedChecks, 0), configuredRetries: 0, actualRetries: 0, results };
writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
if (!summary.ok) throw new Error(`F4 anomaly-decision stability failed. Evidence: ${evidenceRoot}`);
console.log(`F4 anomaly-decision stability passed ${rounds}/${rounds} rounds, ${summary.scenarios}/60 scenarios, ${summary.passedChecks}/${summary.checkCount} checks. Evidence: ${evidenceRoot}`);
