import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = resolve(valueAfter("--release-dir") || join(root, "release"));
const metadataPath = join(release, "latest-mac.yml");
const runtimeManifest = JSON.parse(readFileSync(join(root, "resources", "runtime", "runtime-manifest.json"), "utf8"));
assert.match(runtimeManifest.version, /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/);
assert.match(runtimeManifest.sha256, /^[a-f0-9]{64}$/);
let metadata = readFileSync(metadataPath, "utf8");
metadata = metadata.replace(/^opendrsaiRuntimeVersion:.*\n?/m, "").replace(/^opendrsaiRuntimeSha256:.*\n?/m, "");
metadata += `opendrsaiRuntimeVersion: ${runtimeManifest.version}\nopendrsaiRuntimeSha256: ${runtimeManifest.sha256}\n`;
writeFileSync(metadataPath, metadata, "utf8");
console.log(`Annotated latest-mac.yml with Runtime ${runtimeManifest.version} compatibility.`);

function valueAfter(flag) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : null; }
