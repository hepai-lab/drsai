import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_C5_STABILITY_ROUNDS || "20");
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error("OPENDRSAI_C5_STABILITY_ROUNDS must be between 1 and 100.");
const evidenceRoot = join(root, "release", "product-evidence", "c5-material-consistency");
mkdirSync(evidenceRoot, { recursive: true });
const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const runId = `stability-${String(index).padStart(2, "0")}`;
  const started = Date.now();
  const completed = spawnSync(process.execPath, [join(root, "scripts", "verify-c5-material-consistency.mjs")], {
    cwd: root,
    env: { ...process.env, OPENDRSAI_C5_RUN_ID: runId },
    encoding: "utf8",
    timeout: 240_000,
    windowsHide: true,
  });
  const summaryPath = join(evidenceRoot, runId, "packaged-c5-material-consistency-summary.json");
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
  const item = { run: index, runId, durationMs: Date.now() - started, exitCode: completed.status, scenarios: summary?.scenarios?.length || 0, goldenFindingKinds: summary?.goldenFindingKinds || 0, ok: completed.status === 0 && summary?.ok === true };
  results.push(item);
  if (!item.ok) {
    writeSummary(false);
    throw new Error(`C5 stability failed at ${runId}.\n${completed.stdout || ""}\n${completed.stderr || ""}\n${summary ? JSON.stringify(summary, null, 2) : "No summary JSON"}`);
  }
}
writeSummary(true);
console.log(`C5 material-consistency stability passed ${rounds}/${rounds} rounds; ${rounds * 2} scenario runs and ${rounds * 6} golden finding-kind checks.`);

function writeSummary(ok) {
  writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify({ roundsRequested: rounds, roundsCompleted: results.length, passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, scenarioRuns: results.reduce((sum, item) => sum + item.scenarios, 0), goldenFindingKindChecks: results.reduce((sum, item) => sum + item.goldenFindingKinds, 0), cernPdfVerifiedEveryRound: results.every((item) => item.ok), ok, results }, null, 2)}\n`);
}
