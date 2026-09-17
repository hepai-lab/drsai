import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_F3_STABILITY_ROUNDS || "20");
const evidenceRoot = resolve(process.env.OPENDRSAI_F3_STABILITY_EVIDENCE_DIR || join(root, "release", "f3-approval-stability-evidence", timestamp(new Date())));
mkdirSync(evidenceRoot, { recursive: true });
const summary = { ok: true, startedAt: new Date().toISOString(), evidenceRoot, rounds, businessCategoriesPerRound: 5, configuredRetries: 0, actualRetries: 0, roundResults: [] };

for (let round = 1; round <= rounds; round += 1) {
  const roundDir = join(evidenceRoot, `round-${String(round).padStart(2, "0")}`);
  const run = spawnSync("node", ["scripts/verify-packaged-f3-approvals.mjs"], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, OPENDRSAI_F3_EVIDENCE_DIR: roundDir } });
  const path = join(roundDir, "summary.json");
  const item = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const result = { round, ok: Boolean(run.status === 0 && item?.ok), exitCode: run.status, stdout: run.stdout, stderr: run.stderr, evidenceRoot: roundDir, checkCount: Number(item?.checkCount || 0), passedChecks: Number(item?.passedChecks || 0), unauthorizedExecutions: Number(item?.unauthorizedExecutions || 0), authorizedExecutions: Number(item?.authorizedExecutions || 0), configuredRetries: Number(item?.configuredRetries || 0), actualRetries: Number(item?.actualRetries || 0), cernSha256: item?.cernPdf?.sha256 || null, artifactHash: item?.artifactHash || null };
  summary.roundResults.push(result);
  summary.configuredRetries += result.configuredRetries;
  summary.actualRetries += result.actualRetries;
  if (!result.ok) { summary.ok = false; break; }
}
summary.finishedAt = new Date().toISOString();
summary.completedRounds = summary.roundResults.length;
summary.totalChecks = summary.roundResults.reduce((sum, item) => sum + item.checkCount, 0);
summary.passedChecks = summary.roundResults.reduce((sum, item) => sum + item.passedChecks, 0);
summary.unauthorizedExecutions = summary.roundResults.reduce((sum, item) => sum + item.unauthorizedExecutions, 0);
summary.authorizedExecutions = summary.roundResults.reduce((sum, item) => sum + item.authorizedExecutions, 0);
summary.cernHashes = [...new Set(summary.roundResults.map((item) => item.cernSha256).filter(Boolean))];
summary.exitCode = summary.ok && summary.completedRounds === rounds && summary.totalChecks === rounds * 71 && summary.passedChecks === summary.totalChecks && summary.unauthorizedExecutions === 0 && summary.authorizedExecutions === rounds * 5 && summary.configuredRetries === 0 && summary.actualRetries === 0 && summary.cernHashes.length === 1 && summary.cernHashes[0] === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E" ? 0 : 1;
summary.artifactHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
if (summary.exitCode !== 0) throw new Error(`F3 approval stability failed. Evidence: ${evidenceRoot}`);
console.log(`F3 approval stability passed ${rounds}/${rounds}, ${summary.passedChecks}/${summary.totalChecks}. Evidence: ${evidenceRoot}`);

function timestamp(date) { return date.toISOString().replace(/[:.]/g, "-"); }
