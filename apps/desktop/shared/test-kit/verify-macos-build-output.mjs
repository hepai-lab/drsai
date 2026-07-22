import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const macosRoot = resolve(process.cwd());
const requiredOutputs = ["out/main/index.js", "out/preload/index.mjs", "out/renderer/index.html", "out/build-metadata.json"];

for (const output of requiredOutputs) {
  const absolutePath = join(macosRoot, output);
  assert.ok(existsSync(absolutePath), `macOS build output missing: ${output}`);
  assert.ok(readFileSync(absolutePath).length > 0, `macOS build output is empty: ${output}`);
}

console.log(`macOS post-build smoke passed (${requiredOutputs.length} required outputs).`);
