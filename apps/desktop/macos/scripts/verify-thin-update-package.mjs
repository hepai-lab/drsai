import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Thin update package verification requires Apple Silicon macOS.");
const app = resolve(valueAfter("--app") || "release-unsigned-update/mac-arm64/OpenDrSai.app");
const runtime = join(app, "Contents", "Resources", "runtime");
const manifestPath = join(runtime, "runtime-manifest.json");
assert.ok(existsSync(app), `Missing update App: ${app}`);
assert.ok(existsSync(manifestPath), "Thin update package must retain Runtime compatibility metadata.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.platform, "darwin");
assert.equal(manifest.arch, "arm64");
assert.ok(typeof manifest.archive === "string" && manifest.archive.endsWith(".tar.gz"));
assert.equal(existsSync(join(runtime, manifest.archive)), false, "Thin update package must not duplicate the persisted Runtime archive.");
assert.equal(readdirSync(runtime).some((name) => name.endsWith(".tar.gz")), false);
for (const name of [manifest.sbom, manifest.provenance]) assert.ok(existsSync(join(runtime, name)), `Thin update package omits ${name}`);
const runtimeBytes = directorySize(runtime);
assert.ok(runtimeBytes < 64 * 1024 * 1024, `Thin update Runtime metadata is unexpectedly large: ${runtimeBytes}`);
console.log(`macOS thin update package passed: Runtime metadata=${runtimeBytes} bytes; bundled archive absent by design.`);

function directorySize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directorySize(child) : entry.isFile() ? statSync(child).size : 0;
  }
  return total;
}
function valueAfter(flag) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : null; }
