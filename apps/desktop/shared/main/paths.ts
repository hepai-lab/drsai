import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { createDesktopPathService } from "./desktopPaths";

const PACKAGED_INSTALL_ROOT = process.resourcesPath
  ? dirname(dirname(process.resourcesPath))
  : "";
const PACKAGED_DRSAI_REPO = PACKAGED_INSTALL_ROOT
  ? join(PACKAGED_INSTALL_ROOT, "drsai-agent")
  : "";

function readManagedAgentPath(stateDirectory: string): string | null {
  try {
    const statePath = join(stateDirectory, "install-state.json");
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { agentPath?: unknown };
    const value = typeof state.agentPath === "string" ? state.agentPath.trim() : "";
    return value || null;
  } catch {
    // A malformed or unreadable state file must not break startup; fall back to
    // the derived sibling path so repair can still run.
    return null;
  }
}
export const DESKTOP_PATH_SERVICE = createDesktopPathService({
  platform: process.platform === "darwin" ? "macos" : "windows",
  userHome: homedir(),
  resourcesPath: process.resourcesPath,
  defaultApp: process.defaultApp,
  environment: process.env,
  readManagedAgentPath,
});
export const WINDOWS_PATH_SERVICE = DESKTOP_PATH_SERVICE;
export const DRSAI_HOME = DESKTOP_PATH_SERVICE.layout.home;
export const DRSAI_REPO = DESKTOP_PATH_SERVICE.layout.repository;
export const DRSAI_VENV = DESKTOP_PATH_SERVICE.layout.virtualEnvironment;
export const DRSAI_PYTHON = DESKTOP_PATH_SERVICE.layout.pythonExecutable;
export const DRSAI_SCRIPT = DESKTOP_PATH_SERVICE.layout.cliExecutable;
export const DRSAI_CMD_SCRIPT = DESKTOP_PATH_SERVICE.layout.commandExecutable;
export const DRSAI_ENV_FILE = DESKTOP_PATH_SERVICE.layout.environmentFile;
export const DRSAI_CONFIG_FILE = DESKTOP_PATH_SERVICE.layout.configurationFile;

if (PACKAGED_INSTALL_ROOT && DRSAI_REPO === PACKAGED_DRSAI_REPO) {
  const defaultsDir = join(PACKAGED_INSTALL_ROOT, "defaults");
  try {
    mkdirSync(DRSAI_HOME, { recursive: true });
    // The installer ships exactly one default home file: `config.toml`.
    // `configs/**` (Agent, Provider, model catalog) is owned by the Runtime's
    // own bootstrap (`drsai.config.ensure_desktop_runtime_config`, run from the
    // desktop gateway lifespan), which keeps it in step with
    // CURRENT_CONFIG_VERSION. Seeding a `configs/` tree here would shadow that
    // bootstrap, because an existing Agent file is authoritative user config.
    for (const name of ["config.toml"]) {
      const source = join(defaultsDir, name);
      const target = join(DRSAI_HOME, name);
      if (existsSync(source) && !existsSync(target)) copyFileSync(source, target);
    }
  } catch {
    // First-run setup can still create missing user configuration interactively.
  }
}

export function getEnhancedPath(): string {
  return DESKTOP_PATH_SERVICE.enhancedPath(process.env.PATH);
}
