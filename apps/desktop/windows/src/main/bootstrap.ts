import type {
  DesktopBootstrapBlocker,
  DesktopBootstrapResult,
} from "../shared/desktopApi";
import { requireAuthContext } from "./auth";
import { getGatewayModels, startGateway } from "./gateway";
import { getInstallStatus } from "./status";

export async function bootstrapDesktop(): Promise<DesktopBootstrapResult> {
  const auth = await requireAuthContext();
  if (auth.authMode !== "oidc" || !auth.accessToken) {
    throw new Error("HepAI OIDC sign-in is required before preparing OpenDrSai.");
  }

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

  const models = await getGatewayModels(auth.accessToken);
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
        retryable: true,
        canRepairRuntime: false,
        canSignInAgain: true,
        diagnosticCode: "account-no-model-service",
      },
    );
  }
  return result(true, "OpenDrSai is ready.", auth.session.user!, models);
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
