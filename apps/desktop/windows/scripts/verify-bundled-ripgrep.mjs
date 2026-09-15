// Guards the bundled ripgrep contract: the vendored binary is the pinned
// release, it actually runs, the Electron payload ships it, and every consumer
// (Electron main, Python agent tool) still points at the same place.
//
// Run: node scripts/verify-bundled-ripgrep.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  BUNDLE_DIR,
  BUNDLE_RG,
  RIPGREP_RG_SHA256,
  RIPGREP_VERSION,
  describeBundleProblem,
} from "./fetch-ripgrep.mjs";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const desktopRoot = resolve(windowsRoot, "..");
const repositoryRoot = resolve(windowsRoot, "..", "..", "..");
const OPERATER_FUNS = join(
  repositoryRoot,
  "cores",
  "python",
  "packages",
  "drsai",
  "src",
  "drsai",
  "modules",
  "agents",
  "skills_agent",
  "managers",
  "operater_funs.py",
);

function read(absolutePath, label) {
  assert.ok(existsSync(absolutePath), `${label} is missing: ${absolutePath}`);
  return readFileSync(absolutePath, "utf8");
}

function assertContains(haystack, needle, label) {
  assert.ok(
    haystack.includes(needle),
    `${label} must contain ${JSON.stringify(needle)}`,
  );
}

// ── 1. Vendored binary is the pinned release ────────────────────────────────
const problem = describeBundleProblem();
assert.equal(problem, null, `vendored ripgrep is not the pinned release: ${problem}`);
assert.ok(existsSync(BUNDLE_RG), `vendored ripgrep is missing: ${BUNDLE_RG}`);

// ── 2. The binary runs and reports the pinned version ──────────────────────
const probe = spawnSync(BUNDLE_RG, ["--version"], { encoding: "utf8", windowsHide: true });
assert.equal(probe.status, 0, `rg --version failed: ${(probe.stderr || probe.stdout || "").trim()}`);
const versionLine = (probe.stdout || "").split(/\r?\n/)[0].trim();
assert.ok(
  versionLine.startsWith(`ripgrep ${RIPGREP_VERSION}`),
  `bundled rg reports ${JSON.stringify(versionLine)}, expected ripgrep ${RIPGREP_VERSION}`,
);

// ── 3. The Electron payload ships resources/** unpacked ────────────────────
const builderConfig = read(join(windowsRoot, "electron-builder.yml"), "electron-builder.yml");
assert.match(
  builderConfig,
  /files:[\s\S]*?-\s*resources\/\*\*/,
  "electron-builder.yml must keep resources/** in `files`",
);
assert.match(
  builderConfig,
  /asarUnpack:[\s\S]*?-\s*resources\/\*\*/,
  "electron-builder.yml must keep resources/** in `asarUnpack` so rg.exe stays executable",
);

// ── 4. Electron main resolves it and hands it to the Python gateway ────────
const bundledTools = read(join(desktopRoot, "shared", "main", "bundledTools.ts"), "shared/main/bundledTools.ts");
for (const token of ["ripgrep", "rg.exe", "app.asar.unpacked", "RIPGREP_ENV_VAR", '"DRSAI_RG_PATH"']) {
  assertContains(bundledTools, token, "shared/main/bundledTools.ts");
}
// The resolver must be routed into the child environment, keyed by the single
// exported constant so the name can only drift in one place.
const gateway = read(join(desktopRoot, "shared", "main", "gateway.ts"), "shared/main/gateway.ts");
for (const token of ["resolveBundledRipgrep()", "RIPGREP_ENV_VAR"]) {
  assertContains(gateway, token, "shared/main/gateway.ts");
}

// ── 5. The Python agent tool resolves the same locations ───────────────────
const operaterFuns = read(OPERATER_FUNS, "operater_funs.py");
for (const token of ["DRSAI_RG_PATH", "_detect_ripgrep_executable", "ripgrep", "rg.exe"]) {
  assertContains(operaterFuns, token, "operater_funs.py");
}

// ── 6. The Runtime packager pins the same version and digest ───────────────
const packager = read(
  join(windowsRoot, "installer", "create-opendrsai-runtime.ps1"),
  "installer/create-opendrsai-runtime.ps1",
);
for (const token of [RIPGREP_VERSION, RIPGREP_RG_SHA256, "Add-BundledRipgrep"]) {
  assertContains(packager, token, "installer/create-opendrsai-runtime.ps1");
}

console.log(
  `✅ verify-bundled-ripgrep: rg ${RIPGREP_VERSION} vendored at ${BUNDLE_DIR}, digest pinned, all consumers wired`,
);
