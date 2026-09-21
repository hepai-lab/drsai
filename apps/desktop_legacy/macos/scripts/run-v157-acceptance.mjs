import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scope = process.argv[2];
const stages = {
  source: ["verify:source-snapshot", "verify:v1.5.7-parity", "verify:contract", "verify:security-p2", "verify:defects", "verify:acceptance"],
  electron: ["build", "verify:macos-ux", "verify:coverage"],
  packaged: ["verify:build-output", "verify:packaged", "verify:model-provider-release-gate", "verify:packaged:l5"],
  device: ["verify:keychain-lock:device", "verify:sleep-wake:device", "verify:tcc:l6", "record:l4-evidence"],
  update: ["stage:update-lab-feed", "verify:online-update:l6", "record:signed-update-evidence"],
  release: ["preflight:release", "record:l5-evidence", "verify:model-provider-real", "record:stability-matrix", "verify:release:l6-auto", "record:l6-evidence", "verify:platform-evidence", "decide:release:required", "verify:oss-release-permissions", "verify:update-publish-plan"],
};
assert.ok(scope === "all" || stages[scope], `Unknown v1.5.7 scope: ${scope ?? "<missing>"}`);
assert.equal(Number(process.versions.node.split(".")[0]), 22, `macOS v1.5.7 acceptance requires Node 22; received ${process.version}`);
const selected = scope === "all" ? Object.keys(stages) : [scope];
for (const stage of selected) {
  for (const script of stages[stage]) await runIsolated(script, stage === "device" && script === "verify:tcc:l6" ? { OPENDRSAI_MACOS_TCC_REAL_DEVICE: "1" } : {});
  await runRecorder(stage);
}
if (scope === "all") await runRecorder("all");

function runIsolated(script, extraEnv) {
  return new Promise((resolveRun, reject) => {
    const npmExec = process.env.npm_execpath;
    const child = spawn(npmExec ? process.execPath : "npm", npmExec ? [npmExec, "run", script] : ["run", script], { cwd: root, env: { ...process.env, ...extraEnv }, stdio: "inherit", detached: true });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`npm run ${script} failed (${signal || code})`)));
  });
}
function runRecorder(stage) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve(root, "scripts/record-v157-acceptance.mjs"), stage], { cwd: root, env: process.env, stdio: "inherit", detached: true });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`v1.5.7 ${stage} recorder failed (${signal || code})`)));
  });
}
