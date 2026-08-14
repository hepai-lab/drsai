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
  const argvLaunchMode = readLaunchArgument(input.argv, "--opendrsai-launch-mode=");
  const launchMode = argvLaunchMode === "production" || (
    argvLaunchMode !== "development" && input.environment.OPENDRSAI_DESKTOP_LAUNCH_MODE === "production"
  )
    ? "production"
    : "development";
  const production = launchMode === "production";
  const explicitHome = readLaunchArgument(input.argv, "--opendrsai-launch-home=")
    || input.environment.OPENDRSAI_LAUNCH_HOME?.trim()
    || input.environment.OPENDRSAI_DEV_HOME?.trim();
  const home = resolve(explicitHome || join(input.userHome, production ? ".drsai-prod" : ".drsai-dev"));
  const explicitPort = input.environment.OPENDRSAI_LAUNCH_GATEWAY_PORT?.trim()
    || input.environment.OPENDRSAI_DEV_GATEWAY_PORT?.trim();
  const port = explicitPort && /^\d+$/.test(explicitPort) && Number(explicitPort) >= 1 && Number(explicitPort) <= 65_535
    ? explicitPort
    : production ? "18642" : "28642";
  const appPath = input.argv[1]?.trim();
  const repositoryCandidate = appPath ? resolve(appPath, "..", "..", "..") : "";
  const repository = repositoryCandidate && existsSync(join(repositoryCandidate, "apps", "desktop", "windows"))
    ? repositoryCandidate
    : input.environment.DRSAI_REPO?.trim() || join(home, "drsai-agent");
  return {
    OPENDRSAI_DESKTOP_LAUNCH_MODE: launchMode,
    OPENDRSAI_DESKTOP_DEV: production ? "0" : "1",
    DRSAI_HOME: home,
    DRSAI_REPO: repository,
    OPENDRSAI_RUNTIME_ROOT: join(home, "drsai-agent"),
    OPENDRSAI_ELECTRON_USER_DATA: join(home, "electron-user-data"),
    OPENDRSAI_GATEWAY_PORT: port,
    OPENDRSAI_DEEP_LINK_PROTOCOL: production ? "opendrsai" : "opendrsai-dev",
  };
}

function readLaunchArgument(argv: string[], prefix: string): string | undefined {
  const argument = argv.find((value) => value.startsWith(prefix));
  const value = argument?.slice(prefix.length).trim();
  return value || undefined;
}

const developmentEnvironment = resolveDevelopmentLaunchEnvironment({
  defaultApp: process.defaultApp === true,
  argv: process.argv,
  userHome: homedir(),
  environment: process.env,
});
for (const [key, value] of Object.entries(developmentEnvironment)) process.env[key] = value;
