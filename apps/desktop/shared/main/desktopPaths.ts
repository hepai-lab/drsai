import { posix, win32 } from "node:path";
import type { DesktopPathLayout, DesktopPathService, DesktopPlatformId } from "../api";

export interface CreateDesktopPathServiceOptions {
  platform: DesktopPlatformId;
  userHome: string;
  resourcesPath?: string;
  defaultApp?: boolean;
  environment?: Readonly<Record<string, string | undefined>>;
}

export function createDesktopPathService(options: CreateDesktopPathServiceOptions): DesktopPathService {
  const environment = options.environment ?? {};
  const windows = options.platform === "windows";
  const path = windows ? win32 : posix;
  const { dirname, join } = path;
  const home = environment.DRSAI_HOME?.trim() || join(options.userHome, ".drsai");
  const packagedInstallRoot = options.resourcesPath ? dirname(dirname(options.resourcesPath)) : "";
  const packagedRepository = packagedInstallRoot ? join(packagedInstallRoot, "drsai-agent") : "";
  const usePackagedRepository = windows && !options.defaultApp && Boolean(packagedRepository);
  const repository = environment.DRSAI_REPO?.trim()
    || (usePackagedRepository ? packagedRepository : join(home, "drsai-agent"));
  const runtimeRoot = environment.OPENDRSAI_RUNTIME_ROOT?.trim() || repository;
  const virtualEnvironment = join(runtimeRoot, "venv");
  const pythonExecutable = join(virtualEnvironment, windows ? "Scripts/python.exe" : "bin/python");
  const cliExecutable = windows ? join(virtualEnvironment, "Scripts/drsai.exe") : join(runtimeRoot, "drsai");
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
