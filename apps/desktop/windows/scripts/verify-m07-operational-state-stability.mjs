import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifier = join(root, "scripts", "verify-m07-operational-state-packaged.mjs");
const evidenceRoot = join(root, "release", "product-evidence", "m07-operational-state");
const rounds = Number(process.env.OPENDRSAI_M07_STATE_STABILITY_ROUNDS || "20");
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error("Stability rounds must be an integer from 1 through 100.");
const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const runId = `stability-${String(index).padStart(2, "0")}`;
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [verifier], { cwd: root, env: { ...process.env, OPENDRSAI_M07_STATE_RUN_ID: runId }, encoding: "utf8", windowsHide: true, timeout: 90_000 });
  const resultPath = join(evidenceRoot, runId, "packaged-m07-operational-state-result.json");
  const result = child.status === 0 ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  results.push({ round: index, runId, passed: child.status === 0 && result?.ok === true, durationMs: Date.now() - startedAt, checkCount: Object.keys(result?.checks || {}).length, error: child.status === 0 ? null : (child.stderr || child.stdout || `exit ${child.status}`).slice(-4000) });
  if (child.status !== 0 || result?.ok !== true) break;
}
const summary = { generatedAt: new Date().toISOString(), requestedRounds: rounds, completedRounds: results.length, passedRounds: results.filter((item) => item.passed).length, failedRounds: results.filter((item) => !item.passed).length, results };
mkdirSync(evidenceRoot, { recursive: true });
writeFileSync(join(evidenceRoot, "stability-summary.json"), JSON.stringify(summary, null, 2));
if (summary.passedRounds !== rounds) throw new Error(`M07 operational-state stability failed: ${summary.passedRounds}/${rounds}.`);
console.log(`M07 operational-state stability passed (${rounds}/${rounds}; ${results.reduce((sum, item) => sum + item.checkCount, 0)} packaged checks).`);
