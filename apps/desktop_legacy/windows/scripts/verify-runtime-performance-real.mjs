import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const fixture = resolve(desktop, "tests/remote-ssh/fixture.ps1");
const container = "opendrsai-runtime-performance-test";
const soakSeconds = Number(process.env.OPENDRSAI_REMOTE_SOAK_SECONDS || 5);
const action = process.env.OPENDRSAI_REMOTE_PERFORMANCE_ACTION || "run";
const detached = process.env.OPENDRSAI_REMOTE_PERFORMANCE_DETACHED === "1";
const evidenceDir = join(desktop, "release", "product-evidence", "remote-workspace");
const mode = soakSeconds >= 86400 ? "24h" : soakSeconds >= 1800 ? "30m" : "preflight";
const evidencePath = join(evidenceDir, `runtime-performance-${mode}.json`);
const statePath = join(evidenceDir, `runtime-performance-${mode}.state.json`);
const containerEvidencePath = `/tmp/runtime-performance-${mode}.json`;

main();

function main() {
try {
  if (action === "collect" || action === "status") {
    const running = run("docker", ["exec", container, "pgrep", "-f", "verify_runtime_performance_api.py"], repo, true, true) === 0;
    const ready = run("docker", ["exec", container, "test", "-s", containerEvidencePath], repo, true, true) === 0;
    if (action === "status") {
      console.log(JSON.stringify({ mode, running, ready, statePath, evidencePath }));
      process.exit(ready ? 0 : running ? 2 : 1);
    }
    if (!ready) throw new Error(`Runtime performance ${mode} evidence is not ready (running=${running})`);
    const temporaryEvidencePath = `${evidencePath}.container`;
    run("docker", ["cp", `${container}:${containerEvidencePath}`, temporaryEvidencePath], repo);
    const evidence = JSON.parse(readFileSync(temporaryEvidencePath, "utf8"));
    validateEvidence(evidence);
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, generatedAt: new Date().toISOString(), mode }, null, 2)}\n`, "utf8");
    console.log(`Real Runtime performance ${mode} collected: ${evidencePath}`);
    return;
  }
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Up"], desktop);
  run("docker", ["build", "-f", "apps/desktop/windows/tests/remote-ssh/Dockerfile.real", "-t", "opendrsai-real-remote-gateway:local", "."], repo);
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Down"], desktop);
  run("docker", ["rm", "-f", container], repo, true);
  run("docker", ["run", "-d", "--name", container, "-e", `OPENDRSAI_REMOTE_SOAK_SECONDS=${soakSeconds}`, "opendrsai-real-remote-gateway:local"], repo);
  run("docker", ["cp", "apps/desktop/windows/tests/remote-ssh/verify_runtime_performance_api.py", `${container}:/tmp/verify_runtime_performance_api.py`], repo);
  const execArgs = ["exec", ...(detached ? ["-d"] : []), "-u", "vscode", "-e", `OPENDRSAI_REMOTE_SOAK_SECONDS=${soakSeconds}`, "-e", `OPENDRSAI_REMOTE_PERFORMANCE_OUTPUT=${containerEvidencePath}`, container, "python3", "/tmp/verify_runtime_performance_api.py"];
  if (detached) {
    run("docker", execArgs, repo);
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(statePath, `${JSON.stringify({ mode, soakSeconds, container, containerEvidencePath, startedAt: new Date().toISOString(), expectedReadyAt: new Date(Date.now() + (soakSeconds + 300) * 1000).toISOString(), credentialLabel: "temporary test credential" }, null, 2)}\n`, "utf8");
    console.log(`Real Runtime performance ${mode} started detached: ${statePath}`);
    process.exit(0);
  }
  const output = run("docker", execArgs, repo);
  const evidence = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  validateEvidence(evidence);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, generatedAt: new Date().toISOString(), mode }, null, 2)}\n`, "utf8");
  console.log(`Real Runtime performance ${mode} passed: ${evidencePath}`);
} finally {
  if (!detached && action !== "status") {
    run("docker", ["rm", "-f", container], repo, true);
    run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Down"], desktop, true);
  }
}
}

function validateEvidence(evidence) {
  if (evidence.marker !== "Real Runtime performance preflight passed.") throw new Error("Runtime performance marker is missing");
  if (evidence.soak_seconds !== soakSeconds) throw new Error(`Expected ${soakSeconds}s soak, received ${evidence.soak_seconds}s`);
}

function run(command, args, cwd, allowFailure = false, returnStatus = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} failed (${result.status}): ${result.stdout || ""}\n${result.stderr || ""}`);
  if (returnStatus) return result.status;
  return result.stdout || "";
}
