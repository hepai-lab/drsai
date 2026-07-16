import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceRoot = join(root, "release", "product-evidence", "f1-low-risk-approvals");
mkdirSync(evidenceRoot, { recursive: true });
const rounds = [];
for (let index = 1; index <= 20; index += 1) {
  const runId = `stability-${String(index).padStart(2, "0")}`;
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(root, "scripts", "verify-f1-low-risk-approvals.mjs")], { cwd: root, env: { ...process.env, OPENDRSAI_F1_RUN_ID: runId }, encoding: "utf8", timeout: 180_000, windowsHide: true });
  if (run.status !== 0) throw new Error(`F1 stability ${runId} failed.\n${run.stdout}\n${run.stderr}`);
  const summaryPath = join(evidenceRoot, runId, "packaged-f1-low-risk-summary.json");
  if (!existsSync(summaryPath)) throw new Error(`F1 stability ${runId} did not write its summary.`);
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  rounds.push({ runId, elapsedMs: Date.now() - started, totalChecks: summary.totalChecks, lowRiskOperationCount: summary.lowRiskOperationCount, maximumDesktopApprovalsDuringLowRisk: summary.maximumDesktopApprovalsDuringLowRisk, maximumBrowserApprovalsDuringLowRisk: summary.maximumBrowserApprovalsDuringLowRisk, approvalWaitMs: summary.approvalWaitMs, generatedDraftSha256: summary.generatedDraft.sha256 });
}
const aggregate = { ok: rounds.length === 20 && rounds.every((round) => round.totalChecks === 32 && round.lowRiskOperationCount === 5 && round.maximumDesktopApprovalsDuringLowRisk === 0 && round.maximumBrowserApprovalsDuringLowRisk === 0 && round.approvalWaitMs === 0), rounds: rounds.length, totalChecks: rounds.reduce((sum, round) => sum + round.totalChecks, 0), maximumDesktopApprovalsDuringLowRisk: Math.max(...rounds.map((round) => round.maximumDesktopApprovalsDuringLowRisk)), maximumBrowserApprovalsDuringLowRisk: Math.max(...rounds.map((round) => round.maximumBrowserApprovalsDuringLowRisk)), maximumApprovalWaitMs: Math.max(...rounds.map((round) => round.approvalWaitMs)), roundsDetail: rounds };
if (!aggregate.ok) throw new Error(`F1 stability aggregate failed: ${JSON.stringify(aggregate, null, 2)}`);
writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
console.log(`F1 low-risk approval stability passed 20/20 rounds and ${aggregate.totalChecks} checks; approval wait remained 0 ms.`);
