import type {
  DesktopBootstrapBlocker,
  DesktopBootstrapResult,
} from "../shared/desktopApi";
import { requireAuthContext } from "./auth";
import { getGatewayModels, startGateway, syncAuthIdentityToGateway } from "./gateway";
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

  // The Gateway process may have started but its HTTP endpoints (especially
  // /v1/models which requires DB migration + auth warm-up) are not yet ready.
  // Retry a few times to avoid a transient empty response being mistaken for
  // a permanent permission denial.
  const { models, dataLength } = await getGatewayModels(auth.accessToken);
  if (models.length === 0) {
    if (dataLength > 0) {
      // data 非空但 flatMap 全过滤 — API 返回了模型对象但格式异常
      return result(
        false,
        "The model service returned a list that could not be parsed. Check the Gateway logs.",
        auth.session.user!,
        [],
        {
          kind: "service_unavailable",
          title: "Model list format error",
          message: "The model service returned data that could not be parsed. Please check the Gateway logs or restart OpenDrSai.",
          retryable: false,
          canRepairRuntime: false,
          canSignInAgain: false,
          diagnosticCode: "model-list-invalid",
        },
      );
    }
    // data 为空 — 账号确实没有可用模型
    return result(
      false,
      "No model service is available for this account. Check the service configuration.",
      auth.session.user!,
      [],
      {
        kind: "permission_denied",
        title: "No model service available",
        message: "No model service is available for this account. Please check the HepAI service configuration.",
        retryable: false,
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
