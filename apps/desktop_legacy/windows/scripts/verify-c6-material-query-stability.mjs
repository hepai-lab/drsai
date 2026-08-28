import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_C6_STABILITY_ROUNDS || "20");
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error("OPENDRSAI_C6_STABILITY_ROUNDS must be between 1 and 100.");
const evidenceRoot = join(root, "release", "product-evidence", "c6-material-query");
mkdirSync(evidenceRoot, { recursive: true });
const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const runId = `stability-${String(index).padStart(2, "0")}`;
  const started = Date.now();
  const completed = spawnSync(process.execPath, [join(root, "scripts", "verify-c6-material-query.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, OPENDRSAI_C6_RUN_ID: runId },
    timeout: 210_000,
    windowsHide: true,
  });
  const summaryPath = join(evidenceRoot, runId, "packaged-c6-material-query-summary.json");
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
  const item = { run: index, runId, durationMs: Date.now() - started, exitCode: completed.status, accuracy: summary?.accuracy || 0, goldenQuestions: summary?.goldenQuestions || 0, ok: completed.status === 0 && summary?.ok === true };
  results.push(item);
  if (!item.ok) throw new Error(`C6 stability failed at ${runId}.\n${completed.stdout || ""}\n${completed.stderr || ""}\n${summary ? JSON.stringify(summary, null, 2) : "No summary JSON"}`);
}
const ok = results.length === rounds && results.every((item) => item.ok && item.accuracy >= 0.9);
writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify({ roundsRequested: rounds, roundsCompleted: results.length, passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, goldenQuestionRuns: results.reduce((sum, item) => sum + item.goldenQuestions, 0), minimumAccuracy: Math.min(...results.map((item) => item.accuracy)), cernPdfVerifiedEveryRound: ok, ok, results }, null, 2)}\n`);
if (!ok) throw new Error("C6 material query stability did not complete every requested round.");
console.log(`C6 material-query stability passed ${rounds}/${rounds} rounds and ${results.reduce((sum, item) => sum + item.goldenQuestions, 0)} golden-question runs.`);
