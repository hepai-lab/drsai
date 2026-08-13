import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const executeWriteProbe = process.argv.includes("--execute-write-probe");
const binary = process.env.OPENDRSAI_OSSUTIL_BIN?.trim() || "ossutil";
const configFile = process.env.OPENDRSAI_OSSUTIL_CONFIG?.trim() || "";
const bucket = process.env.OPENDRSAI_OSS_BUCKET?.trim() || "hepai-release";
const stable = `oss://${bucket}/channels/stable/macos/arm64/latest-mac.yml`;

assert.equal(run(["stat", stable]).status, 0, "OSS release identity cannot read stable macOS metadata.");
if (!executeWriteProbe) {
  console.log("OSS release permission read probe passed; use --execute-write-probe to verify isolated write/delete permissions.");
  process.exit(0);
}

const directory = mkdtempSync(join(tmpdir(), "opendrsai-oss-permission-"));
const local = join(directory, "probe.txt");
const key = `channels/validation/macos/arm64/${Date.now()}-${randomUUID()}.txt`;
const target = `oss://${bucket}/${key}`;
writeFileSync(local, "OpenDrSai OSS release permission probe\n", { encoding: "utf8", mode: 0o600 });
try {
  assert.equal(exists(target), false, "OSS permission probe target unexpectedly exists.");
  assert.equal(run(["cp", local, target, "--meta", "Cache-Control:no-store"]).status, 0, "OSS release identity cannot create an isolated validation object.");
  assert.equal(exists(target), true, "OSS validation object was not readable after upload.");
  assert.equal(run(["rm", target, "--force"]).status, 0, "OSS release identity cannot remove its isolated validation object.");
  assert.equal(exists(target), false, "OSS validation object remained after cleanup.");
  console.log("OSS release permission write/read/delete probe passed in the isolated validation prefix.");
} finally {
  if (exists(target)) run(["rm", target, "--force"]);
  rmSync(directory, { recursive: true, force: true });
}

function exists(target) {
  const result = run(["stat", target]);
  if (result.status === 0) return true;
  return !/(NoSuchKey|ObjectNotExist|StatusCode[=: ]+404|status code[=: ]+404|\b404\b)/i.test(`${result.stdout}\n${result.stderr}`)
    ? assert.fail(`Unable to determine OSS object state: ${target}`)
    : false;
}
function run(args) {
  const actual = configFile ? [...args, "--config-file", configFile] : args;
  return spawnSync(binary, actual, { encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
}
