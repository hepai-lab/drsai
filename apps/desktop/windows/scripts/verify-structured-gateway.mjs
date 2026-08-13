import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(windowsRoot, "..", "..", "..");
const pythonSource = resolve(repoRoot, "cores", "python", "packages", "drsai", "src");
const testPath = resolve(repoRoot, "cores", "python", "packages", "drsai", "tests", "test_structured_conversation.py");
const repositoryPython = resolve(repoRoot, ".venv", "Scripts", "python.exe");
const python = process.env.OPENDRSAI_PYTHON || (existsSync(repositoryPython) ? repositoryPython : "python");
const completed = spawnSync(python, [testPath], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PYTHONPATH: [pythonSource, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  },
  stdio: "inherit",
  windowsHide: true,
});

if (completed.error) throw completed.error;
process.exit(completed.status ?? 1);
