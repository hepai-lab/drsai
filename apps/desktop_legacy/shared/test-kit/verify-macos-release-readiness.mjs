import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const unsigned = read("electron-builder.unsigned.yml");
const vite = read("electron.vite.config.ts");
const bootstrap = read("src/main/bootstrapEntry.ts");
const preflight = read("scripts/preflight-release.mjs");
const decision = read("../shared/test-kit/decide-macos-release.mjs");

assert.match(unsigned, /appId: com\.hepai\.opendrsai\.macos\.development/);
assert.match(unsigned, /^\s*identity: null$/m, "unsigned builder stage must not discover a release identity");
assert.match(unsigned, /notarize: false/);
assert.match(unsigned, /publish: null/);
assert.ok(pkg.scripts["build:mac:dir:unsigned"].includes("OPENDRSAI_BUILD_CHANNEL=development"));
assert.ok(pkg.scripts["build:mac:dir:unsigned"].includes("electron-builder.unsigned.yml"));
assert.ok(pkg.scripts["build:mac:dir:unsigned"].includes("seal-unsigned-development.mjs"));
assert.match(vite, /__OPENDRSAI_BUILD_CHANNEL__/);
assert.match(bootstrap, /OpenDrSai Development/);
for (const token of ["Developer ID Application:", "blocked-on-signing", "signingGraph", "inside-out"]) assert.ok(preflight.includes(token));
for (const token of ['"releasable"', '"unsigned-validated"', '"blocked-on-signing"', "sourceBound", "levelBound", "acceptance", "defects"]) assert.ok(decision.includes(token));
console.log("macOS release readiness passed (development isolation, signing preflight, fail-closed decision)." );
