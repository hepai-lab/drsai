import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Runtime reproducibility must run on Apple Silicon macOS.");
const root = resolve(new URL("..", import.meta.url).pathname);
const desktopRoot = resolve(root, "..");
const output = join(root, "build/acceptance/runtime-reproducibility.json");
const first = join(root, "build/acceptance/runtime-first.tar.gz");
mkdirSync(dirname(output), { recursive: true });
rmSync(first, { force: true });
await build();
let manifest = JSON.parse(readFileSync(join(root, "resources/runtime/runtime-manifest.json"), "utf8"));
const archive = join(root, "resources/runtime", manifest.archive);
copyFileSync(archive, first);
const firstHash = sha256(first);
await build();
const secondHash = sha256(archive);
assert.equal(secondHash, firstHash, "Runtime archives differ across identical builds");
manifest = JSON.parse(readFileSync(join(root, "resources/runtime/runtime-manifest.json"), "utf8"));
assert.equal(manifest.sha256, secondHash);
writeFileSync(output, `${JSON.stringify({ schemaVersion: 2, testId: "runtime-reproducibility", platform: "darwin-arm64", passed: true, featureIds: ["F04.1", "F04.3", "F12.1"], firstSha256: firstHash, secondSha256: secondHash, archive: manifest.archive, manifestSha256: createHash("sha256").update(readFileSync(join(root, "resources/runtime/runtime-manifest.json"))).digest("hex"), generatedAt: new Date().toISOString() }, null, 2)}\n`);
rmSync(first, { force: true });
console.log(`macOS Runtime reproducibility passed: ${firstHash}`);

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function build() {
  return new Promise((resolveBuild, reject) => {
    const child = spawn("npm", ["run", "prepare:runtime:macos", "--workspace", "opendrsai-macos-desktop"], { cwd: desktopRoot, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolveBuild() : reject(new Error(`Runtime build failed (${signal || code}).`)));
  });
}
