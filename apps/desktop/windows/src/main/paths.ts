import { homedir } from "os";
import { delimiter, join } from "path";

export const DRSAI_HOME =
  process.env.DRSAI_HOME?.trim() || join(homedir(), ".drsai");
export const DRSAI_REPO = join(DRSAI_HOME, "drsai-agent");
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
