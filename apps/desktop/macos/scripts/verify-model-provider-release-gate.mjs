import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const macRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(macRoot, "../../..");
const contractOnly = process.argv.includes("--contract-only");
const packageJson = JSON.parse(readFileSync(join(macRoot, "package.json"), "utf8"));
const builder = readFileSync(join(macRoot, "electron-builder.yml"), "utf8");
const credentials = readFileSync(join(repoRoot, "cores/python/packages/drsai/src/drsai/config/credentials.py"), "utf8");
const catalogIpc = readFileSync(join(macRoot, "src/main/ipc/registerCatalogIpc.ts"), "utf8");
const keychainGate = join(macRoot, "scripts", "verify-model-provider-keychain.py");

assert.match(builder, /hardenedRuntime:\s*true/);
assert.match(builder, /notarize:\s*true/);
assert.match(builder, /onlyLoadAppFromAsar:\s*true/);
assert.ok(credentials.includes("SecKeychainAddGenericPassword"));
assert.ok(credentials.includes("Security.framework/Security"));
assert.ok(!credentials.includes('"-w", secret') && !credentials.includes("'-w', secret"));
assert.ok(catalogIpc.includes("desktop:test-my-drsai-model-draft"));
assert.ok(catalogIpc.includes("desktop:delete-my-drsai-model-provider"));
assert.ok(existsSync(keychainGate));
assert.ok(packageJson.scripts["verify:model-provider-keychain"]);
assert.ok(packageJson.scripts["verify:model-provider-release-gate"]);

if (contractOnly) {
  console.log("macOS model Provider release contract passed (signing/notarization policy, IPC, packaged gate, and native Keychain boundary)." );
  process.exit(0);
}

assert.equal(process.platform, "darwin", "Signed model Provider release gate must run on macOS.");
assert.equal(process.arch, "arm64", "Signed model Provider release gate must run on Apple Silicon.");

const appPath = resolve(process.env.OPENDRSAI_MACOS_APP_PATH || join(macRoot, "release", "mac-arm64", "OpenDrSai.app"));
const contents = join(appPath, "Contents");
assert.ok(existsSync(join(contents, "MacOS", "OpenDrSai")), `Signed application executable is missing: ${appPath}`);
assert.ok(existsSync(join(contents, "Resources", "app.asar")), "Packaged app.asar is missing.");
assert.ok(existsSync(join(contents, "Resources", "runtime", "runtime-manifest.json")), "Packaged Runtime manifest is missing.");

run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);
run("/usr/bin/xcrun", ["stapler", "validate", appPath]);

const python = process.env.OPENDRSAI_MODEL_PROVIDER_TEST_PYTHON || join(repoRoot, ".venv", "bin", "python");
assert.ok(existsSync(python), `Python for Keychain gate is missing: ${python}`);
run(python, [keychainGate], { OPENDRSAI_MACOS_APP_PATH: appPath });
run(process.execPath, [join(macRoot, "scripts", "verify-packaged-smoke.mjs")]);

const executable = join(contents, "MacOS", "OpenDrSai");
const evidencePath = resolve(process.env.OPENDRSAI_MODEL_PROVIDER_MACOS_EVIDENCE || join(macRoot, "build", "acceptance", "model-provider-release-gate.json"));
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  testId: "model-provider-signed-release-gate",
  platform: `${process.platform}-${process.arch}`,
  passed: true,
  appPath,
  executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
  checks: {
    strictCodesign: true,
    gatekeeperAccepted: true,
    notarizationStapled: true,
    appAsarPresent: true,
    runtimeManifestPresent: true,
    keychainStoreResolveReplaceDelete: true,
    processArgumentSecretScan: true,
    packagedRendererPreloadIpcGateway: true,
  },
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");

console.log(`Signed macOS model Provider release gate passed: ${appPath}; evidence: ${evidencePath}`);

function run(command, args, extraEnv = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    timeout: 180_000,
  });
}
