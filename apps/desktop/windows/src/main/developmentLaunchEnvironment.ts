import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface DevelopmentLaunchInput {
  defaultApp: boolean;
  argv: string[];
  userHome: string;
  environment: Readonly<Record<string, string | undefined>>;
}

export function resolveDevelopmentLaunchEnvironment(input: DevelopmentLaunchInput): Record<string, string> {
  if (!input.defaultApp) return {};
  const explicitHome = input.environment.OPENDRSAI_DEV_HOME?.trim();
  const home = resolve(explicitHome || join(input.userHome, ".drsai-dev"));
  const explicitPort = input.environment.OPENDRSAI_DEV_GATEWAY_PORT?.trim();
  const port = explicitPort && /^\d+$/.test(explicitPort) && Number(explicitPort) >= 1 && Number(explicitPort) <= 65_535
    ? explicitPort
    : "28642";
  const appPath = input.argv[1]?.trim();
  const repositoryCandidate = appPath ? resolve(appPath, "..", "..", "..") : "";
  const repository = repositoryCandidate && existsSync(join(repositoryCandidate, "apps", "desktop", "windows"))
    ? repositoryCandidate
    : input.environment.DRSAI_REPO?.trim() || join(home, "drsai-agent");
  return {
    OPENDRSAI_DESKTOP_DEV: "1",
    DRSAI_HOME: home,
    DRSAI_REPO: repository,
    OPENDRSAI_RUNTIME_ROOT: join(home, "drsai-agent"),
    OPENDRSAI_ELECTRON_USER_DATA: join(home, "electron-user-data"),
    OPENDRSAI_GATEWAY_PORT: port,
    OPENDRSAI_DEEP_LINK_PROTOCOL: "opendrsai-dev",
  };
}

const developmentEnvironment = resolveDevelopmentLaunchEnvironment({
  defaultApp: process.defaultApp === true,
  argv: process.argv,
  userHome: homedir(),
  environment: process.env,
});
for (const [key, value] of Object.entries(developmentEnvironment)) process.env[key] = value;
