import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const metadata = JSON.parse(readFileSync(resolve(root, "out/build-metadata.json"), "utf8"));

assert.equal(metadata.schemaVersion, 1);
assert.equal(metadata.product, "OpenDrSai");
assert.equal(metadata.platform, "darwin");
assert.equal(metadata.arch, "arm64");
assert.equal(metadata.version, packageJson.version);
assert.match(metadata.commit, /^[a-f0-9]{40}$/);
assert.match(metadata.sourceDate, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(typeof metadata.dirty, "boolean");
assert.equal(metadata.buildId, `${packageJson.version}+${metadata.commit.slice(0, 12)}`);
assert.equal(metadata.changelog.path, "CHANGELOG.md");
assert.match(metadata.changelog.sha256, /^[a-f0-9]{64}$/);
assert.ok(Array.isArray(metadata.artifacts) && metadata.artifacts.length >= 3);
const paths = metadata.artifacts.map((artifact) => artifact.path);
for (const required of ["main/index.js", "preload/index.mjs", "renderer/index.html"]) {
  assert.ok(paths.includes(required), `build metadata omits ${required}`);
}
for (const artifact of metadata.artifacts) {
  const content = readFileSync(resolve(root, "out", artifact.path));
  assert.equal(artifact.bytes, content.length, `${artifact.path} byte count changed`);
  assert.equal(artifact.sha256, createHash("sha256").update(content).digest("hex"), `${artifact.path} hash changed`);
}

console.log(`macOS build metadata contract passed (${metadata.buildId}, ${metadata.artifacts.length} artifacts).`);
