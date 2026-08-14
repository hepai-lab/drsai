import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("../../../../", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const venvPython = resolve(repoRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const fallbackVenv = resolve(repoRoot, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.OPENDRSAI_TEST_PYTHON?.trim()
  || (existsSync(venvPython) ? venvPython : existsSync(fallbackVenv) ? fallbackVenv : process.platform === "win32" ? "python" : "python3");
const result = spawnSync(python, [resolve(repoRoot, "apps/desktop/windows/scripts/verify_streaming_voice_gateway.py")], {
  cwd: repoRoot,
  env: { ...process.env, PYTHONPATH: resolve(repoRoot, "cores/python/packages/drsai/src") },
  encoding: "utf8",
});
if (result.status !== 0) throw new Error(`Streaming voice Gateway verification failed:\n${result.stdout}\n${result.stderr}`);
process.stdout.write(result.stdout);
