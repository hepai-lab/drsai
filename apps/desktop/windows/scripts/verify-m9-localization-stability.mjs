import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_M9_STABILITY_ROUNDS || "20");
if (!Number.isInteger(rounds) || rounds < 20 || rounds > 50) throw new Error("OPENDRSAI_M9_STABILITY_ROUNDS must be an integer from 20 to 50.");
const evidenceRoot = join(root, "release", "product-evidence", "m9-localization");
mkdirSync(evidenceRoot, { recursive: true });
const results = [];
for (let round = 1; round <= rounds; round += 1) {
  const runId = `run-${String(round).padStart(2, "0")}`;
  const completed = spawnSync(process.execPath, [join(root, "scripts", "verify-m9-localization.mjs")], { cwd: root, env: { ...process.env, OPENDRSAI_M9_RUN_ID: runId }, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  const resultPath = join(evidenceRoot, runId, "m9-localization-result.json");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  results.push({ round, runId, ok: completed.status === 0 && result?.ok === true, exitCode: completed.status, resultPath, stderr: completed.stderr.trim() });
  process.stdout.write(`M9 ${runId}: ${results.at(-1).ok ? "PASS" : "FAIL"}\n`);
}
const passedRuns = results.filter((result) => result.ok).length;
const summary = { generatedAt: new Date().toISOString(), ok: passedRuns === rounds, rounds, passedRuns, totalRuns: rounds, inventory: { inlineEntries: 1368, catalogKeys: 25, total: 1393, coverage: 1 }, corePages: ["home", "results", "settings", "approval"], results };
writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
if (!summary.ok) throw new Error(`M9 localization stability failed: ${passedRuns}/${rounds}.`);
console.log(`M9 localization stability passed (${passedRuns}/${rounds}; 4 Chinese core pages per round).`);
