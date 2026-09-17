import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const planPath = resolve(workspaceRoot, "docs/voice/duplex-voice-p2-development-plan.md");
const progressPath = resolve(workspaceRoot, "docs/voice/duplex-voice-p2-progress.md");
const [plan, progress] = await Promise.all([
  readFile(planPath, "utf8"),
  readFile(progressPath, "utf8"),
]);

const featureIdPattern = /\bM\d+-F\d+\b/g;
const expectedIds = [...new Set(plan.match(featureIdPattern) ?? [])];
const rows = [...progress.matchAll(/^\| (M\d+-F\d+) \| (已验收|部分完成|待实施) \|/gm)].map(
  ([, id, status]) => ({ id, status }),
);

assert.equal(expectedIds.length, 52, "P2 plan must define exactly 52 unique feature IDs.");
assert.equal(rows.length, 52, "Progress ledger must contain exactly 52 feature rows.");
assert.equal(new Set(rows.map(({ id }) => id)).size, rows.length, "Progress ledger contains duplicate feature IDs.");
assert.deepEqual(
  rows.map(({ id }) => id).sort(),
  expectedIds.sort(),
  "Progress ledger feature IDs must match the P2 plan.",
);

const counts = Object.fromEntries(
  ["已验收", "部分完成", "待实施"].map((status) => [
    status,
    rows.filter((row) => row.status === status).length,
  ]),
);
for (const [status, count] of Object.entries(counts)) {
  const percentage = ((count / rows.length) * 100).toFixed(2);
  assert.match(
    progress,
    new RegExp(`\\| ${status} \\| ${count} \\| ${percentage.replace(".", "\\.")}% \\|`),
    `Summary row for ${status} is stale.`,
  );
}

const implemented = counts["已验收"] + counts["部分完成"];
assert.match(
  progress,
  new RegExp(`实现进展：${implemented}/52（${((implemented / 52) * 100).toFixed(2).replace(".", "\\.")}%）`),
  "Implementation progress is stale.",
);
assert.match(
  progress,
  new RegExp(`严格验收进展：${counts["已验收"]}/52（${((counts["已验收"] / 52) * 100).toFixed(2).replace(".", "\\.")}%）`),
  "Acceptance progress is stale.",
);

console.log(`Duplex Voice P2 progress verified (${implemented}/52 implemented, ${counts["已验收"]}/52 accepted).`);
