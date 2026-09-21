import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import os from "node:os";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const fixture = resolve(desktop, "tests/remote-ssh/fixture.ps1");
const container = "opendrsai-workspace-resources-test";

try {
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Up"], desktop);
  run("docker", ["build", "-f", "apps/desktop/windows/tests/remote-ssh/Dockerfile.real", "-t", "opendrsai-real-remote-gateway:local", "."], repo);
  run("docker", ["rm", "-f", container], repo, true);
  run("docker", ["run", "-d", "--name", container, "opendrsai-real-remote-gateway:local"], repo);
  run("docker", ["cp", "apps/desktop/windows/tests/remote-ssh/verify_workspace_resources_api.py", `${container}:/tmp/verify_workspace_resources_api.py`], repo);
  const output = run("docker", ["exec", "-u", "vscode", container, "python3", "/tmp/verify_workspace_resources_api.py"], repo);
  const evidence = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  if (evidence.marker !== "Real Workspace Resources API verification passed.") throw new Error("Workspace Resources result marker is missing");
  if (evidence.remote_hostname === os.hostname()) throw new Error("Workspace Resources unexpectedly executed on the Desktop host");
  console.log(`Real Workspace Resources verification passed on ${evidence.remote_hostname}.`);
} finally {
  run("docker", ["rm", "-f", container], repo, true);
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Down"], desktop, true);
}

function run(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} failed (${result.status}): ${result.stdout || ""}\n${result.stderr || ""}`);
  return result.stdout || "";
}
