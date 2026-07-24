import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installer = await readFile(new URL("../../macos/src/main/runtimeInstaller.ts", import.meta.url), "utf8");
const virtualEnvironment = await readFile(new URL("../../macos/src/main/runtimeVirtualEnvironment.ts", import.meta.url), "utf8");
const runtimeImplementation = `${installer}\n${virtualEnvironment}`;
const builder = await readFile(new URL("../../macos/scripts/build-runtime-artifact.sh", import.meta.url), "utf8");
const lifecycle = await readFile(new URL("../../macos/src/main/desktopLifecycle.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../../macos/src/main/index.ts", import.meta.url), "utf8");
const platformIpc = await readFile(new URL("../../macos/src/main/ipc/registerPlatformIpc.ts", import.meta.url), "utf8");
const lock = await readFile(new URL("../../macos/resources/runtime/runtime-requirements.lock", import.meta.url), "utf8");
const workflow = await readFile(new URL("../../../../.github/workflows/macos-desktop.yml", import.meta.url), "utf8");
const inventoryBuilder = await readFile(new URL("../../macos/scripts/generate-runtime-file-inventory.mjs", import.meta.url), "utf8");

for (const field of ["schemaVersion: 2", "pythonVersion", "archiveSize", "sbom", "provenance", "files: RuntimeFile[]"]) {
  assert.ok(installer.includes(field), `Runtime schema must require ${field}.`);
}
for (const guard of ["statfs(DRSAI_HOME)", "Runtime installation is already running", "AbortController", "verifyRuntimeContents", "relocateRuntimeVirtualEnvironments", "verifyRelocatedVirtualEnvironmentConfig", ".previous", "Activating Runtime atomically", "platform.machine()", ".opendrsai-runtime.json"]) {
  assert.ok(runtimeImplementation.includes(guard), `Runtime installer is missing guard: ${guard}.`);
}
assert.match(installer, /assertRuntimeSymlinkStaysInsideRoot/, "Extracted symlinks must be constrained to the Runtime root.");
assert.match(installer, /archiveStat\.size !== manifest\.archiveSize/, "Archive size must be checked.");
assert.match(installer, /runtimeExtractionTimeoutMs\(manifest\.archiveSize\)/, "Runtime extraction timeout must scale with the archive size.");
assert.match(installer, /MIN_ARCHIVE_BYTES_PER_SECOND[\s\S]*MAX_EXTRACTION_TIMEOUT_MS/, "Runtime extraction timeout must have throughput and upper bounds.");
assert.match(installer, /Verifying extracted Runtime inventory/, "Long Runtime verification must expose a distinct progress phase.");
assert.match(platformIpc, /desktop:cancel-install[\s\S]{0,100}cancelBundledRuntimeInstall/, "Cancel IPC must abort the active install.");
assert.match(platformIpc, /desktop:install-progress/, "Runtime install progress must be sent to the renderer.");
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
for (const portabilityControl of ["python-runtime", "sys.base_prefix", "../../python-runtime/bin/python3.11"]) {
  assert.ok(builder.includes(portabilityControl), `Runtime builder is missing portable Python control: ${portabilityControl}.`);
}
for (const immutableControl of ["__pycache__", "PYTHONDONTWRITEBYTECODE"]) assert.ok(builder.includes(immutableControl) || installer.includes(immutableControl), `Runtime immutable inventory is missing: ${immutableControl}.`);
assert.match(builder, /generate-runtime-file-inventory\.mjs/, "Runtime inventory must be generated without executing archived Python.");
assert.match(inventoryBuilder, /lstatSync\(path\)/, "Runtime inventory must inspect links without following them.");
const pinnedRequirements = lock.match(/^[a-zA-Z0-9_.-]+==[^\\\s]+/gm) ?? [];
assert.ok(pinnedRequirements.length >= 50, "Runtime lock must contain the complete transitive dependency graph.");
assert.equal((lock.match(/--hash=sha256:/g) ?? []).length >= pinnedRequirements.length, true, "Every locked dependency must be hash protected.");
for (const gate of ['python-version: "3.11.9"', "Build Runtime twice and record reproducibility evidence", "npm run verify:runtime-reproducibility --workspace opendrsai-macos-desktop"]) {
  assert.ok(workflow.includes(gate), `macOS CI is missing Runtime gate: ${gate}.`);
}

console.log("macOS Runtime contract verification passed.");
