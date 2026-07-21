import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { DevStderrFilter, KNOWN_LIBPNG_WARNING } from "./run-dev-with-filter.mjs";

async function filter(chunks, showLibPngWarnings = false) {
  const output = [];
  const stream = Readable.from(chunks).pipe(new DevStderrFilter({ showLibPngWarnings }));
  for await (const chunk of stream) output.push(Buffer.from(chunk));
  return Buffer.concat(output);
}

const ansiUtf8 = Buffer.from("\u001b[32m✓\u001b[39m 106 modules transformed.\r\n", "utf8");
const startup = Buffer.from("[startup] renderer-loaded: process=1924ms launcher=11449ms\r\n", "utf8");
const warning = Buffer.from(`${KNOWN_LIBPNG_WARNING}\r\n`, "ascii");
const otherError = Buffer.from("real stderr failure\r\n", "utf8");

const filtered = await filter([
  ansiUtf8.subarray(0, 7),
  ansiUtf8.subarray(7),
  warning.subarray(0, 18),
  warning.subarray(18),
  startup,
  otherError,
]);
assert.deepEqual(filtered, Buffer.concat([ansiUtf8, startup, otherError]));

const diagnostic = await filter([ansiUtf8, warning, startup], true);
assert.deepEqual(diagnostic, Buffer.concat([ansiUtf8, warning, startup]));

if (process.platform === "win32") {
  const fixtureDir = mkdtempSync(join(tmpdir(), "OpenDrSai dev output "));
  try {
    const fixtureJs = join(fixtureDir, "fixture.mjs");
    const fixtureCmd = join(fixtureDir, "fake npm.cmd");
    const fixtureNpmCli = join(fixtureDir, "node_modules", "npm", "bin", "npm-cli.js");
    writeFileSync(
      fixtureJs,
      `process.stdout.write(${JSON.stringify(ansiUtf8.toString("utf8") + startup.toString("utf8"))});\n` +
        `process.stderr.write(${JSON.stringify(warning.toString("ascii") + otherError.toString("utf8"))});\n` +
        "process.exitCode = 7;\n",
      "utf8",
    );
    writeFileSync(fixtureCmd, "@echo off\r\n", "ascii");
    mkdirSync(join(fixtureDir, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(fixtureNpmCli, `import ${JSON.stringify(new URL(`file:///${fixtureJs.replace(/\\/g, "/")}`).href)};\n`, "utf8");
    const runner = fileURLToPath(new URL("./run-dev-with-filter.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [runner, "--probe", fixtureCmd], { encoding: null });
    assert.equal(result.status, 7, result.stderr?.toString("utf8"));
    assert.deepEqual(result.stdout, Buffer.concat([ansiUtf8, startup]));
    assert.deepEqual(result.stderr, otherError);
    assert.doesNotMatch(result.stderr.toString("utf8"), /DEP0190|not recognized|C:\\Program/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}
console.log("Dev output filter verification passed: UTF-8/ANSI and startup logs preserved.");
