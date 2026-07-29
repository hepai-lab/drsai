import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const temp = mkdtempSync(join(tmpdir(), "opendrsai-update-plan-"));
const version = "1.5.2";
const zip = `OpenDrSai-macOS-v${version}-arm64.zip`;
mkdirSync(temp, { recursive: true });
const zipBytes = Buffer.from("zip-fixture", "utf8");
writeFileSync(join(temp, zip), zipBytes);
writeFileSync(join(temp, `OpenDrSai-macOS-v${version}-arm64.dmg`), "dmg-fixture", "utf8");
const sha512 = createHash("sha512").update(zipBytes).digest("base64");
writeFileSync(join(temp, "latest-mac.yml"), `version: ${version}\nfiles:\n  - url: ${zip}\n    sha512: ${sha512}\n    size: ${zipBytes.length}\npath: ${zip}\nsha512: ${sha512}\nopendrsaiRuntimeVersion: ${version}\nopendrsaiRuntimeSha256: ${"a".repeat(64)}\n`, "utf8");
const annotation = spawnSync(process.execPath, [new URL("./annotate-update-metadata.mjs", import.meta.url).pathname, "--release-dir", temp], { encoding: "utf8" });
assert.equal(annotation.status, 0, annotation.stderr);
const result = spawnSync(process.execPath, [new URL("./publish-update-to-oss.mjs", import.meta.url).pathname, "--release-dir", temp], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const plan = JSON.parse(result.stdout);
assert.equal(plan.execute, false);
assert.equal(plan.metadataLast, true);
assert.equal(plan.commands.length, 5);
assert.match(plan.commands[0].target, /releases\/v1\.5\.2\/macos\/.*-arm64\.dmg$/);
assert.match(plan.commands[1].target, /releases\/v1\.5\.2\/macos\/.*-arm64\.zip$/);
assert.match(plan.commands[2].target, /channels\/stable\/macos\/arm64\/.*\.zip$/);
assert.match(plan.commands[3].target, /channels\/history\/macos\/arm64\/v1\.5\.2\/latest-mac\.yml$/);
assert.match(plan.commands[4].target, /channels\/stable\/macos\/arm64\/latest-mac\.yml$/);
assert.equal(plan.commands[4].forbidOverwrite, false);
for (const command of plan.commands.slice(0, -1)) assert.equal(command.forbidOverwrite, true);
assert.match(plan.commands[4].cacheControl, /max-age=30/);
for (const [phase, expected] of [["--assets-only", 4], ["--promote-metadata", 1]]) {
  const phased = spawnSync(process.execPath, [new URL("./publish-update-to-oss.mjs", import.meta.url).pathname, "--release-dir", temp, phase], { encoding: "utf8" });
  assert.equal(phased.status, 0, phased.stderr);
  assert.equal(JSON.parse(phased.stdout).commands.length, expected);
}
for (const phase of ["--snapshot-stable", "--rollback-metadata"]) {
  const recoveryPlan = spawnSync(process.execPath, [new URL("./publish-update-to-oss.mjs", import.meta.url).pathname, "--release-dir", temp, phase, "--state-file", join(temp, "stable-state.json")], { encoding: "utf8" });
  assert.equal(recoveryPlan.status, 0, recoveryPlan.stderr);
  assert.match(JSON.parse(recoveryPlan.stdout).phase, /stable/);
}
const assetReceipt = join(temp, "asset-receipt.json");
const assetCheck = spawnSync(process.execPath, [new URL("./verify-update-assets.mjs", import.meta.url).pathname, "--release-dir", temp, "--output", assetReceipt], { encoding: "utf8" });
assert.equal(assetCheck.status, 0, assetCheck.stderr);
assert.equal(JSON.parse(await import("node:fs").then(({ readFileSync }) => readFileSync(assetReceipt, "utf8"))).installVerified, false);
console.log("macOS OSS update publish plan passed; stable metadata is last and the only replaceable object.");
