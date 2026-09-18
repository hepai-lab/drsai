import { posix, win32 } from "node:path";
import type { DesktopPathLayout, DesktopPathService, DesktopPlatformId } from "../api";

export interface CreateDesktopPathServiceOptions {
  platform: DesktopPlatformId;
  userHome: string;
  resourcesPath?: string;
  defaultApp?: boolean;
  environment?: Readonly<Record<string, string | undefined>>;
  /**
   * Reads the installer-owned `install-state.json` for the given directory and
   * returns its parsed `agentPath`, or null when the file is absent or
   * unreadable. Injected so this module keeps no filesystem dependency.
   */
  readManagedAgentPath?: (stateDirectory: string) => string | null;
}

export function createDesktopPathService(options: CreateDesktopPathServiceOptions): DesktopPathService {
  const environment = options.environment ?? {};
  const windows = options.platform === "windows";
  const path = windows ? win32 : posix;
  const { dirname, join } = path;
  const home = environment.DRSAI_HOME?.trim() || join(options.userHome, ".drsai");
  // Windows install layout (see installer/contract/docs/install-contract.md):
  //   <installRoot>/app/          <- electron-builder output, holds OpenDrSai.exe
  //   <installRoot>/app/resources <- Electron resourcesPath
  //   <installRoot>/drsai-agent   <- managed Runtime
  //   <installRoot>/install-state.json
  // So resourcesPath is two levels below the install root, and `drsai-agent` is
  // a sibling of `app/`, not of `resources/`.
  const packagedInstallRoot = options.resourcesPath
    ? dirname(dirname(options.resourcesPath))
    : "";
  // `install-state.json` is written by the installer after a successful
  // install and records the resolved `agentPath`, which stays correct for
  // custom installation directories. Prefer it over path re-derivation.
  const managedAgentPath = packagedInstallRoot
    ? options.readManagedAgentPath?.(packagedInstallRoot)?.trim() || ""
    : "";
  const packagedRepository = managedAgentPath
    || (packagedInstallRoot ? join(packagedInstallRoot, "drsai-agent") : "");
  const usePackagedRepository = windows && !options.defaultApp && Boolean(packagedRepository);
  const repository = environment.DRSAI_REPO?.trim()
    || (usePackagedRepository ? packagedRepository : join(home, "drsai-agent"));
  const runtimeRoot = environment.OPENDRSAI_RUNTIME_ROOT?.trim() || repository;
  const virtualEnvironment = join(runtimeRoot, "venv");
  const pythonExecutable = join(virtualEnvironment, windows ? "Scripts/python.exe" : "bin/python");
  const cliExecutable = join(virtualEnvironment, windows ? "Scripts/drsai.exe" : "drsai");
  const commandExecutable = windows ? join(virtualEnvironment, "Scripts/drsai.cmd") : cliExecutable;
  const enhancedPathEntries = windows
    ? [join(virtualEnvironment, "Scripts"), join(home, "git", "cmd"), join(home, "node")]
    : [join(virtualEnvironment, "bin"), "/usr/local/bin", "/opt/homebrew/bin"];
  const layout: DesktopPathLayout = {
    home,
    repository,
    virtualEnvironment,
    pythonExecutable,
    cliExecutable,
    commandExecutable,
    environmentFile: join(home, ".env"),
    configurationFile: join(home, "config.yaml"),
    enhancedPathEntries,
  };
  return {
    layout,
    enhancedPath(currentPath = environment.PATH || "") {
      return [...enhancedPathEntries, currentPath].filter(Boolean).join(path.delimiter);
    },
  };
}
