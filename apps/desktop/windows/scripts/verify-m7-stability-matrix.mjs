import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runs = Number(process.env.OPENDRSAI_M7_STABILITY_RUNS || "20");
if (!Number.isInteger(runs) || runs < 20 || runs > 50) throw new Error("OPENDRSAI_M7_STABILITY_RUNS must be an integer from 20 to 50.");
const evidenceRoot = join(root, "release", "product-evidence", "m7-stability");
mkdirSync(evidenceRoot, { recursive: true });
const results = [];

for (let index = 1; index <= runs; index += 1) {
  const runId = `run-${String(index).padStart(2, "0")}`;
  const completed = spawnSync(process.execPath, [join(root, "scripts", "verify-m7-stability.mjs")], { cwd: root, env: { ...process.env, OPENDRSAI_M7_RUN_ID: runId }, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  const resultPath = join(evidenceRoot, runId, "packaged-m7-stability-result.json");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  const checks = result?.checks || {};
  const critical = {
    processExitClean: completed.status === 0,
    sessionsPreserved: checks.sessionsPersistedAfterTask === true,
    artifactIntact: checks.pptxNotCorrupt === true && checks.provenanceMatchesFixedCernPdf === true,
    noUnauthorizedOperation: checks.noUnauthorizedApprovalOrBrowserAction === true,
  };
  results.push({ run: index, runId, exitCode: completed.status, taskSucceeded: result?.ok === true, critical, passedChecks: Object.values(checks).filter(Boolean).length, totalChecks: Object.keys(checks).length, outputBytes: result?.details?.outputBytes ?? null, outputSha256: result?.details?.outputSha256 ?? null, evidencePath: resultPath, stderr: completed.stderr.trim() });
  process.stdout.write(`M7 ${runId}: ${results.at(-1).taskSucceeded ? "PASS" : "FAIL"} ${results.at(-1).passedChecks}/${results.at(-1).totalChecks}\n`);
}

const successfulRuns = results.filter((result) => result.taskSucceeded).length;
const successRate = successfulRuns / runs;
const criticalFailures = results.filter((result) => !Object.values(result.critical).every(Boolean));
const ok = successRate >= 0.95 && criticalFailures.length === 0;
writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ok, requiredRuns: runs, successfulRuns, successRate, threshold: 0.95, crashCount: results.filter((result) => !result.critical.processExitClean).length, sessionLossCount: results.filter((result) => !result.critical.sessionsPreserved).length, artifactCorruptionCount: results.filter((result) => !result.critical.artifactIntact).length, unauthorizedOperationCount: results.filter((result) => !result.critical.noUnauthorizedOperation).length, fixture: { filename: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf", sizeBytes: 7_664_262, sha256: "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E" }, scenario: ["switch session A→B", "start CERN PDF manager-report task", "minimize native window", "restore native window", "switch session A→B again", "verify completed PPTX and provenance"], results }, null, 2)}\n`);
if (!ok) throw new Error(`M7 stability failed: success ${successfulRuns}/${runs}, critical failures ${criticalFailures.length}.`);
console.log(`M7 stability passed (${successfulRuns}/${runs}, ${(successRate * 100).toFixed(1)}%; crashes/session loss/corruption/unauthorized = 0/0/0/0).`);
