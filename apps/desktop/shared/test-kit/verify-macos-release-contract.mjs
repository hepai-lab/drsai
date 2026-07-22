import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), "utf8");
const builder = read("electron-builder.yml");
const packageJson = JSON.parse(read("package.json"));
const updater = read("src/main/updater.ts");
const runtimeInstaller = read("src/main/runtimeInstaller.ts");
const runtimeBuilder = read("scripts/build-runtime-artifact.sh");
const packagedSmoke = read("scripts/verify-packaged-smoke.mjs");
const updateWatchdog = read("resources/update/update-watchdog.sh");

for (const path of ["build/entitlements.mac.plist", "build/entitlements.mac.inherit.plist"]) {
  assert.ok(existsSync(resolve(root, path)), `missing macOS entitlement file: ${path}`);
  const source = read(path);
  assert.ok(source.includes("com.apple.security.cs.allow-jit"));
  assert.equal(source.includes("com.apple.security.app-sandbox"), false, "sandbox must not be claimed before runtime compatibility is proven");
}
for (const contract of ["hardenedRuntime: true", "notarize: true", "target: dmg", "target: zip", "arch: arm64", "onlyLoadAppFromAsar: true"]) {
  assert.ok(builder.includes(contract), `macOS builder contract omits ${contract}`);
}
assert.ok(packageJson.scripts["build:mac:arm64"]?.includes("electron-builder"));
assert.ok(packageJson.devDependencies["electron-builder"]);
assert.ok(packageJson.dependencies["electron-updater"]);
for (const contract of ["checkForUpdates", "downloadUpdate", "CancellationToken", "quitAndInstall", "update-downloaded", "allowDowngrade = false"]) {
  assert.ok(updater.includes(contract), `macOS updater omits ${contract}`);
}
for (const contract of ["prepareRollback", '"/usr/bin/ditto"', "update-watchdog.sh", "markUpdateHealthy", "expectedVersion"]) {
  assert.ok(updater.includes(contract), `macOS updater rollback omits ${contract}`);
}
for (const contract of ["kill -0", "EXPECTED_VERSION", "failed-update", "/usr/bin/ditto", "/usr/bin/open"]) {
  assert.ok(updateWatchdog.includes(contract), `macOS update watchdog omits ${contract}`);
}
for (const contract of ["sha256", "runtime-manifest.json", '"/usr/bin/tar"', '"import drsai"', ".previous", "rename(candidate, DRSAI_REPO)"]) {
  assert.ok(runtimeInstaller.includes(contract), `macOS Runtime installer omits ${contract}`);
}
for (const contract of ["python3 -m venv", "pip install", "shasum -a 256", 'uname -m']) {
  assert.ok(runtimeBuilder.includes(contract), `macOS Runtime artifact builder omits ${contract}`);
}
for (const contract of ["OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE", "OPENDRSAI_MACOS_PTY_OK", "renderer/preload/IPC", "child.exitCode"]) {
  assert.ok(packagedSmoke.includes(contract), `macOS packaged smoke omits ${contract}`);
}
console.log("macOS release contract passed (arm64 DMG/ZIP, hardened runtime, entitlements, notarization, ASAR-only loading).");
