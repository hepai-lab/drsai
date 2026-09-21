import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const progressPath = join(repo, "docs", "remote_workespace", "ORCA_INSPIRED_开发进度.md");
const fullPath = join(desktop, "release", "product-evidence", "orca-inspired", "orca-inspired-full.json");
const packagedPath = join(desktop, "release", "product-evidence", "orca-inspired", "orca-packaged-runtime.json");
const [progress, fullText, packagedText, compatibilityText] = await Promise.all([
  readFile(progressPath, "utf8"), readFile(fullPath, "utf8"), readFile(packagedPath, "utf8"),
  readFile(join(repo, "protocol", "orca-inspired", "compatibility-gates.json"), "utf8"),
]);
const full = JSON.parse(fullText), packaged = JSON.parse(packagedText), compatibility = JSON.parse(compatibilityText);
assert.equal(full.passed, true); assert.equal(full.checks.length, 22); assert.equal(packaged.passed, true);
assert.match(progress, /\| 已完成 \| 80 \|/); assert.match(progress, /\| 完成率 \| 100\.00% \|/);

const moduleEvidence = {
  OI01: ["domain", "boundaries"], OI02: ["worktree-runtime-tests"], OI03: ["schema-drift", "runtime-client"],
  OI04: ["worktree-ui"], OI05: ["terminal-runtime-tests", "terminal-facade"], OI06: ["terminal-replay", "desktop-restart"],
  OI07: ["host-manager", "real-ssh"], OI08: ["port-forward", "remote-recovery", "real-ssh"],
  OI09: ["security-observability", "migration-fault-tests"],
  OI10: ["performance", "build-unpacked", "packaged-desktop", "packaged-runtime-codex"],
};
const passedChecks = new Set(full.checks.filter((item) => item.passed).map((item) => item.id));
const features = [];
for (let module = 1; module <= 10; module += 1) {
  const moduleId = `OI${String(module).padStart(2, "0")}`;
  assert.match(progress, new RegExp(`\\| ${moduleId} \\|[^\\n]+\\| 8/8 \\| 已完成 \\|`));
  for (const check of moduleEvidence[moduleId]) assert.ok(passedChecks.has(check), `${moduleId} evidence check failed: ${check}`);
  for (let feature = 1; feature <= 8; feature += 1) {
    const id = `${moduleId}-F${String(feature).padStart(2, "0")}`;
    assert.ok(progress.includes(id), `Progress document is missing ${id}`);
    features.push({ id, status: "passed", evidenceChecks: moduleEvidence[moduleId] });
  }
}
for (const entry of compatibility.entries) {
  const removable = entry.stable_releases >= compatibility.policy.minimum_stable_releases
    && entry.legacy_call_count === compatibility.policy.required_legacy_call_count;
  assert.equal(entry.removal_approved, removable, `Compatibility removal gate mismatch: ${entry.id}`);
}
assert.equal(features.length, 80);
const manifest = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), version: full.version,
  architecture: "OpenDrSai Desktop -> RuntimeClient -> Local/SSH Binding -> Full Agent Runtime -> OWOP -> Agent Backend",
  modules: 10, featuresTotal: 80, featuresPassed: 80, passed: true,
  fullGate: { path: fullPath, checks: full.checks.length, startedAt: full.startedAt, completedAt: full.completedAt },
  packagedGate: { path: packagedPath, codexVersion: packaged.codexVersion, asarSha256: packaged.asarSha256 },
  compatibilityRemovalDeferredByPolicy: compatibility.entries.map((entry) => entry.id), features,
};
const evidenceDir = join(desktop, "release", "product-evidence", "orca-inspired");
await mkdir(evidenceDir, { recursive: true });
const output = join(evidenceDir, "orca-inspired-80-feature-audit.json");
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`ORCA_INSPIRED final audit passed: 10 modules, 80/80 features. Evidence: ${output}`);
