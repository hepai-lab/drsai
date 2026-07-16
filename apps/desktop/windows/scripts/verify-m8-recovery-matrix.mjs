import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scenarios = ["service_unavailable", "disk_full", "permission_denied", "file_busy", "model_timeout"];
const rounds = Number(process.env.OPENDRSAI_M8_MATRIX_ROUNDS || "4");
if (!Number.isInteger(rounds) || rounds < 4 || rounds > 10) throw new Error("OPENDRSAI_M8_MATRIX_ROUNDS must be an integer from 4 to 10.");
const evidenceRoot = join(root, "release", "product-evidence", "m8-recovery");
mkdirSync(evidenceRoot, { recursive: true });
const results = [];

for (let round = 1; round <= rounds; round += 1) {
  for (const scenario of scenarios) {
    const runId = `run-${String(round).padStart(2, "0")}`;
    const completed = spawnSync(process.execPath, [join(root, "scripts", "verify-m8-recovery.mjs"), "--scenario", scenario], { cwd: root, env: { ...process.env, OPENDRSAI_M8_RUN_ID: runId }, encoding: "utf8", windowsHide: true, timeout: 120_000 });
    const resultPath = join(evidenceRoot, scenario, runId, "packaged-m8-recovery-result.json");
    const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
    results.push({ round, scenario, exitCode: completed.status, ok: completed.status === 0 && result?.ok === true, passedChecks: result ? Object.values(result.checks || {}).filter(Boolean).length : 0, totalChecks: result ? Object.keys(result.checks || {}).length : 0, failureTerminalMs: result?.details?.failureTerminalMs ?? null, recoveryCompletedMs: result?.details?.recoveryCompletedMs ?? null, classifiedAs: result?.details?.card?.kind ?? null, outputBytes: result?.details?.outputBytes ?? null, evidencePath: resultPath, stderr: completed.stderr.trim() });
    process.stdout.write(`M8 ${scenario} ${runId}: ${results.at(-1).ok ? "PASS" : "FAIL"} ${results.at(-1).passedChecks}/${results.at(-1).totalChecks}\n`);
  }
}

const passed = results.filter((result) => result.ok).length;
const ok = passed === results.length;
writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ok, rounds, scenarios, totalRuns: results.length, passedRuns: passed, maximumFailureTerminalMs: Math.max(...results.map((result) => Number(result.failureTerminalMs) || 0)), timeoutThresholdMs: 5000, fixture: { filename: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf", sizeBytes: 7_664_262, sha256: "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E" }, results }, null, 2)}\n`);
if (!ok) throw new Error(`M8 recovery matrix failed: ${passed}/${results.length}.`);
console.log(`M8 recovery matrix passed (${passed}/${results.length}; five fault classes × ${rounds} rounds).`);
