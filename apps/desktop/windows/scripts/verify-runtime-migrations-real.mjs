import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const container = "opendrsai-runtime-migrations-test";
const fixture = resolve(desktop, "tests/remote-ssh/fixture.ps1");

try {
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Up"], desktop);
  run("docker", ["build", "-f", "apps/desktop/windows/tests/remote-ssh/Dockerfile.real", "-t", "opendrsai-real-remote-gateway:local", "."], repo);
  run("docker", ["rm", "-f", container], repo, true);
  run("docker", ["run", "-d", "--name", container, "opendrsai-real-remote-gateway:local"], repo);
  run("docker", ["cp", "cores/python/packages/drsai/tests/test_runtime_migrations.py", `${container}:/tmp/test_runtime_migrations.py`], repo);
  const program = "import importlib.util,tempfile; from pathlib import Path; s=importlib.util.spec_from_file_location('test_runtime_migrations','/tmp/test_runtime_migrations.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.test_workdir_migration_is_runtime_scoped_idempotent_and_retains_pending(Path(tempfile.mkdtemp())); print('migration-test-passed')";
  const output = run("docker", ["exec", "-u", "vscode", container, "python3", "-c", program], repo);
  if (!/migration-test-passed/.test(output)) throw new Error(`Runtime migration result is incomplete: ${output}`);
  console.log("Real Runtime legacy Session migration verification passed.");
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
