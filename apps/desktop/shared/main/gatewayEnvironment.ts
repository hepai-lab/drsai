export const DEVELOPMENT_GATEWAY_PORT = "28642";
export const PRODUCTION_GATEWAY_PORT = "18642";

type GatewayEnvironment = Readonly<Record<string, string | undefined>>;

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
  const fallback = isDevelopmentGatewayRuntime(environment, electronDefaultApp)
    ? DEVELOPMENT_GATEWAY_PORT
    : PRODUCTION_GATEWAY_PORT;
  const rawPort = environment.OPENDRSAI_GATEWAY_PORT || environment.DRSAI_API_PORT || fallback;
  const parsed = Number(rawPort);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? String(parsed) : fallback;
}
