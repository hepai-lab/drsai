import { copyFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { delimiter, dirname, join } from "path";

export const DRSAI_HOME =
  process.env.DRSAI_HOME?.trim() || join(homedir(), ".drsai");
const PACKAGED_INSTALL_ROOT = process.resourcesPath
  ? dirname(dirname(process.resourcesPath))
  : "";
const PACKAGED_DRSAI_REPO = PACKAGED_INSTALL_ROOT
  ? join(PACKAGED_INSTALL_ROOT, "drsai-agent")
  : "";
export const DRSAI_REPO =
  process.env.DRSAI_REPO?.trim() ||
  (process.platform === "win32" && !process.defaultApp && PACKAGED_DRSAI_REPO
    ? PACKAGED_DRSAI_REPO
    : join(DRSAI_HOME, "drsai-agent"));
export const DRSAI_VENV = join(DRSAI_REPO, "venv");
export const DRSAI_PYTHON =
  process.platform === "win32"
    ? join(DRSAI_VENV, "Scripts", "python.exe")
    : join(DRSAI_VENV, "bin", "python");
export const DRSAI_SCRIPT =
  process.platform === "win32"
    ? join(DRSAI_VENV, "Scripts", "drsai.exe")
    : join(DRSAI_REPO, "drsai");
export const DRSAI_CMD_SCRIPT =
  process.platform === "win32" ? join(DRSAI_VENV, "Scripts", "drsai.cmd") : DRSAI_SCRIPT;
export const DRSAI_ENV_FILE = join(DRSAI_HOME, ".env");
export const DRSAI_CONFIG_FILE = join(DRSAI_HOME, "config.yaml");

if (PACKAGED_INSTALL_ROOT && DRSAI_REPO === PACKAGED_DRSAI_REPO) {
  const defaultsDir = join(PACKAGED_INSTALL_ROOT, "defaults");
  try {
    mkdirSync(DRSAI_HOME, { recursive: true });
    for (const name of [".env", "config.yaml"]) {
      const source = join(defaultsDir, name);
      const target = join(DRSAI_HOME, name);
      if (existsSync(source) && !existsSync(target)) copyFileSync(source, target);
    }
  } catch {
    // First-run setup can still create missing user configuration interactively.
  }
}

export function getEnhancedPath(): string {
  const windowsPaths =
    process.platform === "win32"
      ? [
          join(DRSAI_VENV, "Scripts"),
          join(DRSAI_HOME, "git", "cmd"),
          join(DRSAI_HOME, "node"),
        ]
      : [join(DRSAI_VENV, "bin"), "/usr/local/bin", "/opt/homebrew/bin"];
  return [...windowsPaths, process.env.PATH || ""].filter(Boolean).join(delimiter);
}
