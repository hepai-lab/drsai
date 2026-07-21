import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const fixture = join(desktop, "tests", "remote-ssh", "fixture.ps1");
const container = "opendrsai-runtime-engine-test";
try {
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Up"], desktop);
  run("docker", ["build", "-f", "apps/desktop/windows/tests/remote-ssh/Dockerfile.real", "-t", "opendrsai-real-remote-gateway:local", "."], repo);
  run("docker", ["rm", "-f", container], repo, true);
  run("docker", ["run", "-d", "--name", container, "opendrsai-real-remote-gateway:local"], repo);
  run("docker", ["cp", "apps/desktop/windows/tests/remote-ssh/verify_runtime_engine_api.py", `${container}:/tmp/verify_runtime_engine_api.py`], repo);
  const output = run("docker", ["exec", "-u", "vscode", container, "python3", "/tmp/verify_runtime_engine_api.py"], repo);
  if (!output.includes("Real Runtime Engine API verification passed.")) throw new Error("Runtime Engine API result marker is missing");
  console.log("Real Runtime Engine API verification passed.");
} finally {
  run("docker", ["rm", "-f", container], repo, true);
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Down"], desktop, true);
}

function run(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout || "";
}
