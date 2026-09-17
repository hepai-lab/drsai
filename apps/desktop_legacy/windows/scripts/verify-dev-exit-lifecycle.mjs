import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src/main/index.ts"), "utf8");
const brandedRunner = readFileSync(resolve(root, "scripts/run-branded-electron-vite.mjs"), "utf8");
const outputRunner = readFileSync(resolve(root, "scripts/run-dev-with-filter.mjs"), "utf8");
const launcher = readFileSync(resolve(root, "scripts/dev.ps1"), "utf8");

const shutdownHandler = main.match(/app\.on\("before-quit"[\s\S]*?\n\}\);/)?.[0] ?? "";
assert.match(shutdownHandler, /event\.preventDefault\(\)/, "normal quit must wait for asynchronous Runtime cleanup");
assert.match(shutdownHandler, /closeMobilePairingControllers\(\)[\s\S]*shutdownGateway\(true\)/, "normal quit must finish auxiliary and Runtime cleanup");
assert.match(shutdownHandler, /gatewayShutdownComplete = true;[\s\S]{0,500}app\.exit\(0\)/, "completed cleanup must terminate Electron with an explicit success code");
const completedCleanup = shutdownHandler.slice(shutdownHandler.indexOf("gatewayShutdownComplete = true;"));
assert.doesNotMatch(completedCleanup, /^\s*app\.quit\(\);?\s*$/m, "completed cleanup must not recursively re-enter app.quit()");

// Do not globally rewrite failures to success: only the Electron main process
// knows that the user-close cleanup boundary completed successfully.
assert.match(brandedRunner, /process\.exitCode = code \?\? 1/);
assert.match(outputRunner, /resolve\(code \?\? 1\)/);
assert.match(launcher, /\$devExitCode = \$LASTEXITCODE[\s\S]{0,100}exit \$devExitCode/);

console.log("Windows development exit lifecycle verified (graceful close exits 0; real child failures remain non-zero).");
