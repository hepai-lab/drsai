import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installer = await readFile(new URL("../../macos/src/main/runtimeInstaller.ts", import.meta.url), "utf8");
const builder = await readFile(new URL("../../macos/scripts/build-runtime-artifact.sh", import.meta.url), "utf8");
const lifecycle = await readFile(new URL("../../macos/src/main/desktopLifecycle.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../../macos/src/main/index.ts", import.meta.url), "utf8");
const lock = await readFile(new URL("../../macos/resources/runtime/runtime-requirements.lock", import.meta.url), "utf8");
const workflow = await readFile(new URL("../../../../.github/workflows/macos-desktop.yml", import.meta.url), "utf8");

for (const field of ["schemaVersion: 2", "pythonVersion", "archiveSize", "sbom", "provenance", "files: RuntimeFile[]"]) {
  assert.ok(installer.includes(field), `Runtime schema must require ${field}.`);
}
for (const guard of ["statfs(DRSAI_HOME)", "Runtime installation is already running", "AbortController", "verifyRuntimeContents", ".previous", "Activating Runtime atomically", "platform.machine()", ".opendrsai-runtime.json"]) {
  assert.ok(installer.includes(guard), `Runtime installer is missing guard: ${guard}.`);
}
assert.match(installer, /entry\.isSymbolicLink\(\)/, "Extracted symlinks must be rejected.");
assert.match(installer, /archiveStat\.size !== manifest\.archiveSize/, "Archive size must be checked.");
assert.match(main, /desktop:cancel-install[\s\S]{0,100}cancelBundledRuntimeInstall/, "Cancel IPC must abort the active install.");
assert.match(main, /desktop:install-progress/, "Runtime install progress must be sent to the renderer.");
assert.match(lifecycle, /backendNeedsRepair: missing\.length === 0 && !runtime\.healthy/, "Corrupt installed runtimes must request repair.");

for (const reproducibilityControl of ["SOURCE_DATE_EPOCH", "LC_ALL=C sort", "COPYFILE_DISABLE=1", "gzip -n"]) {
  assert.ok(builder.includes(reproducibilityControl), `Runtime builder is missing reproducibility control: ${reproducibilityControl}.`);
}
for (const evidence of ["pip inspect", "runtime-sbom-", "runtime-provenance-", "gitCommit", "runtime-manifest.json", "schemaVersion:2"]) {
  assert.ok(builder.includes(evidence), `Runtime builder is missing release evidence: ${evidence}.`);
}
for (const lockedInstall of ["--require-hashes", "--no-deps", "EXPECTED_PYTHON=\"3.11.9\"", "dependencyLockSha256"]) {
  assert.ok(builder.includes(lockedInstall), `Runtime builder is missing locked-install control: ${lockedInstall}.`);
}
const pinnedRequirements = lock.match(/^[a-zA-Z0-9_.-]+==[^\\\s]+/gm) ?? [];
assert.ok(pinnedRequirements.length >= 50, "Runtime lock must contain the complete transitive dependency graph.");
assert.equal((lock.match(/--hash=sha256:/g) ?? []).length >= pinnedRequirements.length, true, "Every locked dependency must be hash protected.");
for (const gate of ['python-version: "3.11.9"', "Build Runtime twice and record reproducibility evidence", "npm run verify:runtime-reproducibility --workspace opendrsai-macos-desktop"]) {
  assert.ok(workflow.includes(gate), `macOS CI is missing Runtime gate: ${gate}.`);
}

console.log("macOS Runtime contract verification passed.");
