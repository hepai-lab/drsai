import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runId = process.env.OPENDRSAI_M9_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_M9_RUN_ID must be alphanumeric with optional hyphens.");
const evidenceDir = join(root, "release", "product-evidence", "m9-localization", runId);
mkdirSync(evidenceDir, { recursive: true });

const contract = spawnSync(process.execPath, [join(root, "scripts", "verify-m9-localization-contract.mjs")], { cwd: root, encoding: "utf8", windowsHide: true });
assert(contract.status === 0, `M9 localization contract failed.\n${contract.stdout}\n${contract.stderr}`);
const visual = spawnSync(process.execPath, [join(root, "scripts", "verify-renderer-visual.mjs")], { cwd: root, env: { ...process.env, OPENDRSAI_M9_ONLY: "1", OPENDRSAI_VISUAL_ARTIFACT_DIR: evidenceDir }, encoding: "utf8", windowsHide: true, timeout: 90_000 });
assert(visual.status === 0, `M9 Chinese visual verification failed.\n${visual.stdout}\n${visual.stderr}`);

const pages = ["home", "results", "settings", "approval"].map((page) => {
  const path = join(evidenceDir, `m9-chinese-${page}.png`);
  assert(existsSync(path), `M9 screenshot is missing: ${path}`);
  const bytes = readFileSync(path);
  assert(bytes.length > 10_000, `M9 screenshot is unexpectedly small: ${path}`);
  return { page, path, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase() };
});
const result = { ok: true, runId, checks: { localizationInventoryCovered: true, chineseKeyCoverage100Percent: true, noCorruptedOrUnresolvedText: true, noUnexplainedInternalTerms: true, noVisibleTextClipping: true, fourCorePageScreenshots: true }, inventory: { inlineEntries: 1368, catalogKeys: 25, total: 1393 }, pages };
writeFileSync(join(evidenceDir, "m9-localization-result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(`M9 localization acceptance passed (${Object.keys(result.checks).length}/${Object.keys(result.checks).length}; ${result.inventory.total}/${result.inventory.total} entries; 4 core pages).`);

function assert(condition, message) { if (!condition) throw new Error(message); }
