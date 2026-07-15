import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runs = Number(process.env.OPENDRSAI_M3_STABILITY_RUNS || "20");
if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error("OPENDRSAI_M3_STABILITY_RUNS must be an integer from 1 to 50.");
const evidenceRoot = join(root, "release", "product-evidence", "m3-window-scaling");
mkdirSync(evidenceRoot, { recursive: true });
const results = [];

for (let index = 1; index <= runs; index += 1) {
  const runId = `run-${String(index).padStart(2, "0")}`;
  const completed = spawnSync(process.execPath, [join(root, "scripts", "verify-m3-window-scaling.mjs")], {
    cwd: root,
    env: { ...process.env, OPENDRSAI_M3_RUN_ID: runId },
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  });
  const resultPath = join(evidenceRoot, runId, "packaged-m3-window-scaling-result.json");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  results.push({
    run: index,
    runId,
    exitCode: completed.status,
    ok: completed.status === 0 && result?.ok === true,
    passedChecks: result ? Object.values(result.checks || {}).filter(Boolean).length : 0,
    totalChecks: result ? Object.keys(result.checks || {}).length : 0,
    evidencePath: resultPath,
    stderr: completed.stderr.trim(),
  });
  if (!results.at(-1).ok) {
    writeSummary(false);
    throw new Error(`M3 stability failed at ${runId}.\n${completed.stdout}\n${completed.stderr}\n${result ? JSON.stringify(result, null, 2) : "No result JSON"}`);
  }
  process.stdout.write(`M3 ${runId}: ${results.at(-1).passedChecks}/${results.at(-1).totalChecks}\n`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
}

writeSummary(true);
console.log(`M3 window/scaling stability passed (${runs}/${runs} isolated packaged runs).`);

function writeSummary(ok) {
  writeFileSync(join(evidenceRoot, "stability-summary.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ok,
    requiredRuns: runs,
    passedRuns: results.filter((result) => result.ok).length,
    fixture: {
      filename: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf",
      sizeBytes: 7_664_262,
      sha256: "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E",
    },
    profilesPerRun: 4,
    pagesPerProfile: ["chat", "results", "approvals"],
    results,
  }, null, 2)}\n`);
}
