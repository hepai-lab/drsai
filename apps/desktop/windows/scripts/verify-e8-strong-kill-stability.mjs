import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const iterations = Number(process.env.OPENDRSAI_E8_ITERATIONS || "20");
const evidenceDir = join(root, "release", "product-evidence", "cern-manager-deck");
const resultPath = join(evidenceDir, "packaged-presentation-action-strong-kill-abandon-result.json");
const summaryPath = join(evidenceDir, "packaged-e8-strong-kill-stability-summary.json");
const runs = [];
mkdirSync(evidenceDir, { recursive: true });

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, ["scripts/verify-packaged-presentation-pdf-action.mjs", "--scenario", "strong-kill-abandon"], {
    cwd: root,
    env: { ...process.env, OPENDRSAI_E2E_TIMEOUT_MS: "60000" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 90_000,
  });
  const result = child.status === 0 ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  const passed = Boolean(result?.ok
    && result.checks?.recoveryVisible
    && result.checks?.continueChoiceVisible
    && result.checks?.restartChoiceVisible
    && result.checks?.abandonChoiceVisible
    && result.checks?.abandonClearedRecoveryRecord
    && result.checks?.sourceMaterialPreservedAfterAbandon);
  runs.push({ iteration, passed, durationMs: Date.now() - startedAt, interruptedRequestId: result?.details?.recoveryRequestId || null });
  if (!passed) {
    writeFileSync(summaryPath, `${JSON.stringify({ ok: false, iterations, runs, stderr: child.stderr }, null, 2)}\n`, "utf8");
    throw new Error(`E8 strong-kill stability failed at iteration ${iteration}: ${child.stderr || child.stdout}`);
  }
}

writeFileSync(summaryPath, `${JSON.stringify({ ok: true, iterations, passed: runs.length, runs }, null, 2)}\n`, "utf8");
console.log(`E8 strong-kill stability passed ${runs.length}/${iterations} iterations.`);
