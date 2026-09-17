import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const full = process.argv.includes("--full");
const startedAt = new Date().toISOString();
const python = resolve(repo, "venv/Scripts/python.exe");
const checks = [
  ["typecheck", "npm", ["run", "typecheck"]],
  ["schema-drift", "npm", ["run", "verify:owop-schema"]],
  ["domain", "npm", ["run", "verify:workspace-resources"]],
  ["boundaries", "npm", ["run", "verify:orca-inspired-boundaries"]],
  ["security-observability", "npm", ["run", "verify:orca-security-observability"]],
  ["runtime-client", "npm", ["run", "verify:runtime-client-integration"]],
  ["worktree-ui", "npm", ["run", "verify:worktree-ui"]],
  ["terminal-facade", "npm", ["run", "verify:runtime-terminal-facade"]],
  ["terminal-replay", "npm", ["run", "verify:terminal-replay"]],
  ["host-manager", "npm", ["run", "verify:host-connection-manager"]],
  ["port-forward", "npm", ["run", "verify:port-forward-registry"]],
  ["remote-recovery", "npm", ["run", "verify:remote-runtime-recovery"]],
  ["artifact-trust", "npm", ["run", "verify:runtime-artifact-trust"]],
  ["worktree-runtime-tests", python, ["-m", "pytest", "-q", resolve(repo, "cores/python/packages/drsai/tests/test_git_worktree_service.py")]],
  ["terminal-runtime-tests", python, ["-m", "pytest", "-q", resolve(repo, "cores/python/packages/drsai/tests/test_terminal_state_service.py")]],
  ["migration-fault-tests", python, ["-m", "pytest", "-q", resolve(repo, "cores/python/packages/drsai/tests/test_runtime_migrations.py")]],
  ["performance", python, [resolve(repo, "cores/python/packages/drsai/scripts/verify_orca_performance.py")]],
];
if (full) checks.push(
  ["desktop-restart", "npm", ["run", "verify:terminal-desktop-restart"]],
  ["real-ssh", "npm", ["run", "verify:remote-ssh"]],
  ["build-unpacked", "npm", ["run", "build:unpack"]],
  ["packaged-desktop", "npm", ["run", "verify:packaged"]],
  ["packaged-runtime-codex", "npm", ["run", "verify:orca-packaged-runtime"]],
);

const results = [];
for (const [id, command, args] of checks) {
  const began = Date.now();
  const npmInvocation = command === "npm" && process.env.npm_execpath;
  const executable = npmInvocation ? process.execPath : command;
  const invocationArgs = npmInvocation ? [process.env.npm_execpath, ...args] : args;
  const result = spawnSync(executable, invocationArgs, {
    cwd: desktop, encoding: "utf8", windowsHide: true,
    env: { ...process.env, PYTHONPATH: resolve(repo, "cores/python/packages/drsai/src") },
    maxBuffer: 64 * 1024 * 1024,
  });
  const record = { id, passed: result.status === 0, durationMs: Date.now() - began,
    outputTail: `${result.stdout || ""}\n${result.stderr || ""}`.slice(-4000) };
  results.push(record);
  console.log(`[${record.passed ? "PASS" : "FAIL"}] ${id} (${record.durationMs} ms)`);
  if (!record.passed) break;
}
const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(join(desktop, "package.json"), "utf8"));
const evidence = { schemaVersion: 1, profile: full ? "full" : "focused", version: packageJson.version,
  startedAt, completedAt: new Date().toISOString(), hostProfile: full ? "opendrsai-fixture" : "not-required",
  checks: results, passed: results.length === checks.length && results.every((item) => item.passed) };
const evidenceDir = join(desktop, "release", "product-evidence", "orca-inspired");
mkdirSync(evidenceDir, { recursive: true });
const path = join(evidenceDir, `orca-inspired-${evidence.profile}.json`);
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
if (!evidence.passed) throw new Error(`ORCA_INSPIRED ${evidence.profile} release gate failed; evidence: ${path}`);
console.log(`ORCA_INSPIRED ${evidence.profile} release gate passed: ${path}`);
