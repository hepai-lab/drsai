import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.npm_package_version;
assert.match(version || "", /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const app = resolve(process.argv[2] || join(root, "release", "mac-arm64", "OpenDrSai.app"));
const output = resolve(process.argv[3] || join(root, "release", `OpenDrSai-macOS-v${version}-arm64.zip`));
assert.ok(existsSync(app), `Missing signed app: ${app}`);

rmSync(output, { force: true });
const result = spawnSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, output], { stdio: "inherit" });
assert.equal(result.status, 0, "ditto failed to create the signed update ZIP.");
console.log(`Created signed macOS update ZIP: ${output}`);
