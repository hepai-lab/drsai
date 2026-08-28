import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const container = "opendrsai-agent-runtime-test";
const forbiddenLocalMarker = join(repo, ".opendrsai-m07-remote-marker");

try {
  run("docker", ["build", "-f", "apps/desktop/windows/tests/remote-ssh/Dockerfile.agent-runtime", "-t", "opendrsai-agent-runtime:local", "."], repo);
  run("docker", ["rm", "-f", container], repo, true);
  run("docker", ["run", "-d", "--name", container, "opendrsai-agent-runtime:local"], repo);
  run("docker", ["cp", "apps/desktop/windows/tests/remote-ssh/verify_agent_runtime_api.py", `${container}:/tmp/verify_agent_runtime_api.py`], repo);
  const output = run("docker", ["exec", "-u", "vscode", container, "python3", "/tmp/verify_agent_runtime_api.py"], repo);
  const line = output.trim().split(/\r?\n/).at(-1);
  const evidence = JSON.parse(line);
  if (evidence.marker !== "Real Agent Runtime API verification passed.") throw new Error("Agent Runtime result marker is missing");
  if (evidence.remote_hostname === os.hostname()) throw new Error("Agent probe unexpectedly executed on the Desktop host");
  if (evidence.remote_cwd !== "/home/vscode/workspace") throw new Error(`Unexpected remote cwd: ${evidence.remote_cwd}`);
  if (existsSync(forbiddenLocalMarker)) throw new Error("Remote marker was created in the Desktop repository");
  console.log(`Real Agent Runtime verification passed on ${evidence.remote_hostname}.`);
} finally {
  run("docker", ["rm", "-f", container], repo, true);
}

function run(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout || "";
}
