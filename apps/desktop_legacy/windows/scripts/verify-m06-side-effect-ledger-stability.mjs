import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rounds = Number(process.env.OPENDRSAI_M06_STABILITY_ROUNDS || "20");
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error("OPENDRSAI_M06_STABILITY_ROUNDS must be between 1 and 100.");
const evidenceDir = join(root, "release/product-evidence/m06-side-effect-ledger");
mkdirSync(evidenceDir, { recursive: true });
const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const started = Date.now();
  const completed = spawnSync(process.execPath, [join(root, "scripts/verify-packaged-m06-side-effect-ledger.mjs")], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000,
  });
  const resultPath = join(evidenceDir, "packaged-m06-side-effect-ledger-result.json");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  const item = {
    round: index, durationMs: Date.now() - started, exitCode: completed.status,
    checks: result?.checkCount || 0, effectCount: result?.checks?.effectWrittenExactlyOnce === true ? 1 : 0,
    duplicateBlocked: result?.checks?.duplicateBlocked === true,
    unauthorizedEffects: result?.checks?.mismatchedApprovalBlocked === true && result?.checks?.unknownOutcomeBlocked === true ? 0 : 1,
    ok: completed.status === 0 && result?.ok === true,
  };
  results.push(item);
  if (!item.ok) throw new Error(`M06-F03 stability failed at round ${index}.\n${completed.stdout}\n${completed.stderr}`);
}
const summary = {
  roundsRequested: rounds, roundsCompleted: results.length, passed: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length, configuredRetries: 0, actualRetries: 0,
  totalChecks: results.reduce((sum, item) => sum + item.checks, 0),
  totalEffects: results.reduce((sum, item) => sum + item.effectCount, 0),
  unauthorizedEffects: results.reduce((sum, item) => sum + item.unauthorizedEffects, 0),
  duplicates: results.some((item) => !item.duplicateBlocked) ? 1 : 0,
  ok: results.length === rounds && results.every((item) => item.ok && item.effectCount === 1 && item.unauthorizedEffects === 0 && item.duplicateBlocked),
  results,
};
writeFileSync(join(evidenceDir, "stability-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
if (!summary.ok) throw new Error("M06-F03 side-effect ledger stability failed.");
console.log(`M06-F03 side-effect ledger stability passed ${rounds}/${rounds} rounds and ${summary.totalChecks}/${summary.totalChecks} checks without retries.`);
