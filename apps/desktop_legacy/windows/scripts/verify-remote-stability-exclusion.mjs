import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const statePath = resolve(root, "release", "product-evidence", "remote-workspace", "remote-stability-1h.state.json");
if (!existsSync(statePath)) throw new Error("A running stability state is required for the exclusion test.");
const state = JSON.parse(readFileSync(statePath, "utf8"));
try { process.kill(Number(state.pid), 0); }
catch { throw new Error("The stability state process is not running."); }

const before = capture("docker", ["inspect", "opendrsai-real-remote-gateway", "--format", "{{.Id}}"]);
const refusal = spawnSync(process.execPath, ["scripts/verify-real-remote-gateway.mjs"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  timeout: 30_000,
});
const combined = `${refusal.stdout || ""}\n${refusal.stderr || ""}`;
if (refusal.error) throw refusal.error;
if (refusal.status === 0) throw new Error("The regular real-Gateway E2E was allowed during an active stability run.");
if (!/cannot reuse its container and SSH port/i.test(combined)) throw new Error(`The exclusion refusal was not actionable: ${combined}`);
const after = capture("docker", ["inspect", "opendrsai-real-remote-gateway", "--format", "{{.Id}}"]);
if (before !== after) throw new Error("The stability container identity changed during the exclusion test.");
console.log(`Active Remote Workspace stability exclusion verified: ${before}`);

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || result.status}`);
  return String(result.stdout || "").trim();
}
