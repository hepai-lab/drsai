import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_C7_STABILITY_ROUNDS || "20");
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error("OPENDRSAI_C7_STABILITY_ROUNDS must be between 1 and 100.");
const evidenceRoot = join(root, "release", "product-evidence", "c7-abnormal-files");
mkdirSync(evidenceRoot, { recursive: true });
const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const runId = `stability-${String(index).padStart(2, "0")}`;
  const started = Date.now();
  const completed = spawnSync(process.execPath, [join(root, "scripts", "verify-c7-abnormal-files.mjs")], { cwd: root, encoding: "utf8", env: { ...process.env, OPENDRSAI_C7_RUN_ID: runId }, timeout: 150_000, windowsHide: true });
  const summaryPath = join(evidenceRoot, runId, "packaged-c7-abnormal-files-summary.json");
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
  const item = { run: index, runId, durationMs: Date.now() - started, exitCode: completed.status, checks: summary?.checks || 0, importFeedbackMs: summary?.importFeedbackMs ?? null, ok: completed.status === 0 && summary?.ok === true };
  results.push(item);
  if (!item.ok) throw new Error(`C7 stability failed at ${runId}.\n${completed.stdout || ""}\n${completed.stderr || ""}\n${summary ? JSON.stringify(summary, null, 2) : "No summary JSON"}`);
}
const ok = results.length === rounds && results.every((item) => item.ok && item.importFeedbackMs < 60_000);
writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify({ roundsRequested: rounds, roundsCompleted: results.length, passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, totalPackagedChecks: results.reduce((sum, item) => sum + item.checks, 0), maximumImportFeedbackMs: Math.max(...results.map((item) => item.importFeedbackMs || 0)), cernPdfVerifiedEveryRound: ok, ok, results }, null, 2)}\n`);
if (!ok) throw new Error("C7 abnormal-file stability did not complete every requested round.");
console.log(`C7 abnormal-file stability passed ${rounds}/${rounds} rounds and ${results.reduce((sum, item) => sum + item.checks, 0)} packaged checks.`);
