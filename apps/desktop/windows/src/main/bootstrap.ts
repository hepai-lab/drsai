import type {
  DesktopBootstrapBlocker,
  DesktopBootstrapResult,
} from "../shared/desktopApi";
import { refreshAuthContextAfterUnauthorized, requireAuthContext } from "./auth";
import { discoverGatewayModels, startGateway, syncAuthIdentityToGateway, type GatewayModelDiscoveryResult } from "./gateway";
import { getInstallStatus } from "./status";

export async function bootstrapDesktop(): Promise<DesktopBootstrapResult> {
  const auth = await requireAuthContext();
  if (auth.authMode !== "oidc" || !auth.accessToken) {
    throw new Error("HepAI OIDC sign-in is required before preparing OpenDrSai.");
  }
  await syncAuthIdentityToGateway(auth.userId);

  const install = await getInstallStatus();
  if (!install.installed) {
    return result(
      false,
      "OpenDrSai needs to repair or install the local runtime before tasks can run.",
      auth.session.user!,
      [],
      {
        kind: "runtime_missing",
        title: "Local runtime needs repair",
        message:
          "OpenDrSai is signed in, but the local runtime required to run tasks is missing or out of date.",
        retryable: true,
        canRepairRuntime: true,
        canSignInAgain: false,
        diagnosticCode: install.missing.includes("backend-version")
          ? "runtime-version-mismatch"
          : "runtime-missing",
      },
    );
  }

  const gatewayReady = await startGateway();
  if (!gatewayReady) {
    return result(
      false,
      "OpenDrSai signed in, but the local service could not be started.",
      auth.session.user!,
      [],
      {
        kind: "service_unavailable",
        title: "Local service is not available",
        message:
          "OpenDrSai could not start the local service that runs tasks. No task was sent.",
        retryable: true,
        canRepairRuntime: false,
        canSignInAgain: false,
        diagnosticCode: "gateway-unavailable",
      },
    );
  }

  const discovery = await discoverModelsWithRecovery(auth.accessToken);
  if (discovery.state !== "ready") {
    if (discovery.state === "forbidden") {
      return result(
        false,
        "This account does not currently have permission to use an OpenDrSai model service.",
        auth.session.user!,
        [],
        {
          kind: "permission_denied",
          title: "Account has no available service",
          message: discovery.message,
          retryable: false,
          canRepairRuntime: false,
          canSignInAgain: true,
          diagnosticCode: discovery.diagnosticCode,
        },
      );
    }
    const authFailure = discovery.state === "auth_required" || discovery.state === "auth_expired";
    return result(
      false,
      authFailure
        ? "The HepAI session is not valid. Sign in again."
        : "The HepAI model catalog is temporarily unavailable. OpenDrSai will retry.",
      auth.session.user!,
      [],
      {
        kind: authFailure ? "auth_required" : "service_unavailable",
        title: authFailure ? "Sign in required" : "Model service is temporarily unavailable",
        message: discovery.message,
        retryable: !authFailure,
        canRepairRuntime: false,
        canSignInAgain: authFailure,
        diagnosticCode: discovery.diagnosticCode,
      },
    );
  }
  const models = discovery.models;
  if (models.length === 0) {
    return result(
      false,
      "This account has no available OpenDrSai service. Retry or sign in again.",
      auth.session.user!,
      [],
      {
        kind: "permission_denied",
        title: "Account has no available service",
        message:
          "This HepAI account is signed in, but it does not currently have permission to use an OpenDrSai model service.",
        retryable: false,
        canRepairRuntime: false,
        canSignInAgain: true,
        diagnosticCode: "account-no-model-service",
      },
    );
  }
  return result(true, "OpenDrSai is ready.", auth.session.user!, models);
}

async function discoverModelsWithRecovery(accessToken: string): Promise<GatewayModelDiscoveryResult> {
  let token = accessToken;
  let refreshed = false;
  const retryDelays = [0, 250, 750, 1_500];
  let lastResult: GatewayModelDiscoveryResult | null = null;
  for (const delayMs of retryDelays) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    let discovery = await discoverGatewayModels(token);
    if (discovery.state === "auth_expired" && !refreshed) {
      refreshed = true;
      try {
        const nextAuth = await refreshAuthContextAfterUnauthorized();
        if (!nextAuth.accessToken) return discovery;
        token = nextAuth.accessToken;
        discovery = await discoverGatewayModels(token);
      } catch {
        return {
          state: "auth_required",
          diagnosticCode: "model_catalog_session_refresh_failed",
          message: "The HepAI session could not be refreshed. Sign in again.",
        };
      }
    }
    if (discovery.state !== "unavailable") return discovery;
    lastResult = discovery;
  }
  return lastResult ?? {
    state: "unavailable",
    diagnosticCode: "model_catalog_unavailable",
    message: "The HepAI model catalog is temporarily unavailable.",
  };
}

function result(
  ready: boolean,
  message: string,
  user: NonNullable<Awaited<ReturnType<typeof requireAuthContext>>["session"]["user"]>,
  models: Array<{ id: string; name: string }>,
  blocker: DesktopBootstrapBlocker | null = null,
): DesktopBootstrapResult {
  return {
    ready,
    message,
    user,
    blocker,
    capabilities: { chat: ready, agent: ready, tools: ["files", "shell", "git"] },
    defaults: { agentId: "drsai", modelAlias: models[0]?.id ?? null },
    models,
    limits: { maxConcurrentRuns: 1 },
  };
}
