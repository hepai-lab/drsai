const { strict: assert } = require("node:assert");
const { createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const acceptance = join(root, "build", "acceptance");
const output = join(acceptance, "model-provider-real-opt-in.json");
const temp = mkdtempSync(join(tmpdir(), "opendrsai-hepai-provider-"));
const resultPath = join(temp, "result.json");
const userData = join(temp, "electron-user-data");
let releaseMount;
let appBundle = resolve(process.env.OPENDRSAI_MACOS_APP_PATH || join(root, "release", "mac-arm64", "OpenDrSai.app"));
if (!process.env.OPENDRSAI_MACOS_APP_PATH && !hasRuntimeArchive(appBundle)) {
  const dmg = join(root, "release", "OpenDrSai-macOS-v1.5.7-arm64.dmg");
  assert.ok(existsSync(dmg), `HepAI Provider acceptance requires ${dmg}`);
  releaseMount = mkdtempSync(join(tmpdir(), "opendrsai-hepai-provider-dmg-"));
  const attached = spawnSync("/usr/bin/hdiutil", ["attach", dmg, "-readonly", "-nobrowse", "-mountpoint", releaseMount], { encoding: "utf8" });
  assert.equal(attached.status, 0, attached.stderr);
  appBundle = join(releaseMount, "OpenDrSai.app");
}
const executable = join(appBundle, "Contents", "MacOS", "OpenDrSai");

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(cleanup);

async function main() {
  const signature = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appBundle], { encoding: "utf8" });
  assert.equal(signature.status, 0, `HepAI Provider acceptance requires a sealed App bundle.\n${signature.stderr}`);
  const child = spawn(executable, [`--user-data-dir=${userData}`], {
    env: {
      ...process.env,
      DRSAI_HOME: process.env.DRSAI_HOME || join(require("node:os").homedir(), ".drsai"),
      OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0",
      OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath,
      OPENDRSAI_MACOS_PACKAGED_SCENARIO: "hepai-provider",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (value) => { stdout += value.toString(); });
  child.stderr.on("data", (value) => { stderr += value.toString(); });
  const result = await waitForResult(child, 420_000, () => stdout, () => stderr);
  assert.equal(result.ok, true, result.error || stderr);
  assert.equal(await waitForExit(child, 30_000), 0, stderr);
  const snapshot = JSON.parse(readFileSync(join(acceptance, "source-snapshot.json"), "utf8"));
  const evidence = {
    schemaVersion: 3,
    testId: "model-provider-real-opt-in",
    kind: "hepai-platform",
    platform: "darwin-arm64",
    passed: true,
    featureIds: ["F04.3"],
    commit: snapshot.commit,
    sourceAggregateSha256: snapshot.aggregateSha256,
    appExecutableSha256: sha256(executable),
    providerId: result.providerId,
    authentication: result.authentication,
    endpoint: result.endpoint,
    catalogStatus: result.catalogStatus,
    availableModelCount: result.availableModelCount,
    selectedModelIds: result.selectedModelIds,
    results: result.results,
    secretMaterialRecorded: result.secretMaterialRecorded,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`HepAI real platform Provider matrix passed (${evidence.results.length} models at ${new URL(evidence.endpoint.origin).host}).`);
}

async function waitForResult(child, timeoutMs, stdout, stderr) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(readFileSync(resultPath, "utf8")); } catch {}
    if (child.exitCode !== null) throw new Error(`OpenDrSai exited before writing Provider evidence.\n${stdout()}\n${stderr()}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`HepAI Provider acceptance exceeded ${timeoutMs}ms.\n${stderr()}`);
}
function waitForExit(child, timeoutMs) { if (child.exitCode !== null) return Promise.resolve(child.exitCode); return new Promise((resolveExit, reject) => { const timer = setTimeout(() => reject(new Error("OpenDrSai did not exit after Provider acceptance")), timeoutMs); child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); }); }); }
function hasRuntimeArchive(candidate) { try { const runtime = join(candidate, "Contents", "Resources", "runtime"); const manifest = JSON.parse(readFileSync(join(runtime, "runtime-manifest.json"), "utf8")); return typeof manifest.archive === "string" && existsSync(join(runtime, manifest.archive)); } catch { return false; } }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function cleanup() { if (releaseMount) spawnSync("/usr/bin/hdiutil", ["detach", releaseMount, "-force"], { stdio: "ignore" }); rmSync(temp, { recursive: true, force: true }); if (releaseMount) rmSync(releaseMount, { recursive: true, force: true }); }
