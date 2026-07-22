import { copyFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { createDesktopPathService } from "./desktopPaths";

const PACKAGED_INSTALL_ROOT = process.resourcesPath
  ? dirname(dirname(process.resourcesPath))
  : "";
const PACKAGED_DRSAI_REPO = PACKAGED_INSTALL_ROOT
  ? join(PACKAGED_INSTALL_ROOT, "drsai-agent")
  : "";
export const DESKTOP_PATH_SERVICE = createDesktopPathService({
  platform: process.platform === "darwin" ? "macos" : "windows",
  userHome: homedir(),
  resourcesPath: process.resourcesPath,
  defaultApp: process.defaultApp,
  environment: process.env,
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
  return DESKTOP_PATH_SERVICE.enhancedPath(process.env.PATH);
}
