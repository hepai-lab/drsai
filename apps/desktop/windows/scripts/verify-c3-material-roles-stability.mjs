import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Math.max(1, Number(process.env.OPENDRSAI_C3_ROUNDS || 20));
const evidenceRoot = join(root, "release", "product-evidence", "c3-material-roles"); mkdirSync(evidenceRoot, { recursive: true });
const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const runId = `stability-${String(index).padStart(2, "0")}`; const startedAt = Date.now();
  const run = spawnSync(process.execPath, [join(root, "scripts", "verify-c3-material-roles.mjs")], { cwd: root, env: { ...process.env, OPENDRSAI_C3_RUN_ID: runId }, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  const resultPath = join(evidenceRoot, runId, "packaged-c3-material-roles-result.json"); const parsed = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  results.push({ run: index, runId, durationMs: Date.now() - startedAt, exitCode: run.status, checks: parsed ? Object.keys(parsed.checks || {}).length : 0, accuracy: parsed?.details?.accuracy ?? 0, ok: run.status === 0 && parsed?.ok === true, stdout: run.stdout.trim(), stderr: run.stderr.trim() });
  if (!results.at(-1).ok) break;
}
const summary = { roundsRequested: rounds, roundsCompleted: results.length, passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, minimumAccuracy: Math.min(...results.map((item) => item.accuracy)), cernPdfVerifiedEveryRound: results.every((item) => item.ok), results };
writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
if (summary.failed > 0 || summary.roundsCompleted !== rounds || summary.minimumAccuracy < 0.9) throw new Error(`C3 stability failed: ${summary.passed}/${rounds}. See ${join(evidenceRoot, "stability-summary.json")}`);
console.log(`C3 material-role stability passed ${summary.passed}/${rounds} rounds; minimum accuracy ${(summary.minimumAccuracy * 100).toFixed(1)}%.`);
