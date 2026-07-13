import type { DesktopBootstrapResult } from "../shared/desktopApi";
import { requireAuthContext } from "./auth";
import { getGatewayModels, startGateway } from "./gateway";

export async function bootstrapDesktop(): Promise<DesktopBootstrapResult> {
  const auth = await requireAuthContext();
  if (auth.authMode !== "oidc" || !auth.accessToken) {
    throw new Error("HepAI OIDC sign-in is required before preparing OpenDrSai.");
  }

  const gatewayReady = await startGateway();
  if (!gatewayReady) {
    return result(false, "OpenDrSai signed in, but the local service could not be started.", auth.session.user!, []);
  }

  const models = await getGatewayModels(auth.accessToken);
  if (models.length === 0) {
    return result(false, "This account has no available DrSai service. Retry or sign in again.", auth.session.user!, []);
  }
  return result(true, "OpenDrSai is ready.", auth.session.user!, models);
}

function result(
  ready: boolean,
  message: string,
  user: NonNullable<Awaited<ReturnType<typeof requireAuthContext>>["session"]["user"]>,
  models: Array<{ id: string; name: string }>,
): DesktopBootstrapResult {
  return {
    ready,
    message,
    user,
    capabilities: { chat: ready, agent: ready, tools: ["files", "shell", "git"] },
    defaults: { agentId: "drsai", modelAlias: models[0]?.id ?? null },
    models,
    limits: { maxConcurrentRuns: 1 },
  };
}
