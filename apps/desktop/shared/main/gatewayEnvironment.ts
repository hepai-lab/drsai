// Keep development isolated from packaged Desktop / installer Runtime. A
// separate port prevents a stale production Gateway from being adopted by
// `npm run dev` after an app restart.
export const DEVELOPMENT_GATEWAY_PORT = "28644";
export const PRODUCTION_GATEWAY_PORT = "28643";

type GatewayEnvironment = Readonly<Record<string, string | undefined>>;

export type GatewayProfile = "development" | "production";

/** Resolve well-known Desktop data roots independently from Electron build mode. */
export function gatewayProfileForHome(home: string | undefined): GatewayProfile | null {
  const normalized = home?.trim().replace(/[\\/]+$/, "").replaceAll("\\", "/").toLowerCase();
  if (!normalized) return null;
  const leaf = normalized.split("/").at(-1);
  if (leaf === ".drsai-dev") return "development";
  if (leaf === ".drsai" || leaf === ".drsai-prod") return "production";
  return null;
}

export function isDevelopmentGatewayRuntime(
  environment: GatewayEnvironment = process.env,
  electronDefaultApp = Boolean((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp),
): boolean {
  if (environment.OPENDRSAI_DESKTOP_LAUNCH_MODE === "production" || environment.OPENDRSAI_DESKTOP_DEV === "0") {
    return false;
  }
  return environment.OPENDRSAI_DESKTOP_DEV === "1" || electronDefaultApp;
}

export function resolveGatewayPort(
  environment: GatewayEnvironment = process.env,
  electronDefaultApp?: boolean,
): string {
  const profile = gatewayProfileForHome(environment.DRSAI_HOME);
  const development = profile ? profile === "development" : isDevelopmentGatewayRuntime(environment, electronDefaultApp);
  const fallback = development ? DEVELOPMENT_GATEWAY_PORT : PRODUCTION_GATEWAY_PORT;
  const rawPort = environment.OPENDRSAI_GATEWAY_PORT || environment.DRSAI_API_PORT;
  if (!rawPort) return fallback;
  const parsed = Number(rawPort);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? String(parsed) : fallback;
}
