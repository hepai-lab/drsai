import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.npm_package_version;
assert.match(version || "", /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const app = resolve(process.argv[2] || join(root, "release", "mac-arm64", "OpenDrSai.app"));
const output = resolve(process.argv[3] || join(root, "release", `OpenDrSai-macOS-v${version}-arm64.zip`));
assert.ok(existsSync(app), `Missing signed app: ${app}`);

verifyApp(app, "source update App");
const staging = mkdtempSync(join(tmpdir(), "opendrsai-signed-update-"));
try {
  rmSync(output, { force: true });
  run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, output], "ditto failed to create the signed update ZIP");
  run("/usr/bin/ditto", ["-x", "-k", output, staging], "ditto failed to expand the signed update ZIP");
  verifyApp(join(staging, "OpenDrSai.app"), "expanded update App");
  console.log(`Created and verified signed macOS update ZIP: ${output}`);
} catch (error) {
  rmSync(output, { force: true });
  throw error;
} finally {
  rmSync(staging, { recursive: true, force: true });
}

function verifyApp(path, label) {
  assert.ok(existsSync(path), `Missing ${label}: ${path}`);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", path], `${label} failed strict code-signing verification`);
}

function run(command, args, message) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  assert.equal(result.status, 0, message);
}
