import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Runtime reproducibility must run on Apple Silicon macOS.");
const root = resolve(new URL("..", import.meta.url).pathname);
const output = join(root, "build/acceptance/runtime-reproducibility.json");
const first = join(root, "build/acceptance/runtime-first.tar.gz");
const manifestPath = join(root, "resources/runtime/runtime-manifest.json");
mkdirSync(dirname(output), { recursive: true });
rmSync(first, { force: true });
removeGeneratedRuntime();
await build();
let manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const archive = join(root, "resources/runtime", manifest.archive);
assert.ok(existsSync(archive), "first Runtime build did not produce its declared archive");
copyFileSync(archive, first);
const firstHash = await sha256(first);
removeGeneratedRuntime();
await build();
assert.ok(existsSync(archive), "second Runtime build did not produce its declared archive");
const secondHash = await sha256(archive);
assert.equal(secondHash, firstHash, "Runtime archives differ across identical builds");
manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.sha256, secondHash);
const provenance = JSON.parse(readFileSync(join(root, "resources/runtime", manifest.provenance), "utf8"));
assert.equal(provenance.gitCommit, process.env.GITHUB_SHA || runGitHead(), "Runtime provenance is not bound to the current commit");
writeFileSync(output, `${JSON.stringify({ schemaVersion: 2, testId: "runtime-reproducibility", platform: "darwin-arm64", passed: true, featureIds: ["F04.1", "F04.3", "F12.1"], firstSha256: firstHash, secondSha256: secondHash, archive: manifest.archive, manifestSha256: createHash("sha256").update(readFileSync(join(root, "resources/runtime/runtime-manifest.json"))).digest("hex"), generatedAt: new Date().toISOString() }, null, 2)}\n`);
rmSync(first, { force: true });
console.log(`macOS Runtime reproducibility passed: ${firstHash}`);

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}
function build() {
  return new Promise((resolveBuild, reject) => {
    const child = spawn("bash", [join(root, "scripts/build-runtime-artifact.sh")], { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolveBuild() : reject(new Error(`Runtime build failed (${signal || code}).`)));
  });
}

function removeGeneratedRuntime() {
  const outputRoot = join(root, "resources/runtime");
  for (const name of ["runtime-manifest.json", "runtime-sbom-1.5.1.json", "runtime-provenance-1.5.1.json", "opendrsai-runtime-macos-arm64-1.5.1.tar.gz"]) rmSync(join(outputRoot, name), { force: true });
}

function runGitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: resolve(root, "../../.."), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`git rev-parse failed (${result.status})`);
  return result.stdout.trim();
}
