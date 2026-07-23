import { existsSync } from "node:fs";
import type { DesktopBootstrapResult, DesktopHealth, InstallProgress, InstallStatus, PrerequisiteStatus } from "../../../shared/api/desktopApi";
import { requireAuthContext } from "../../../shared/main/auth";
import { getGatewayModels, getGatewayStatus, startGateway } from "./gateway";
import { DRSAI_CONFIG_FILE, DRSAI_ENV_FILE, DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, DRSAI_SCRIPT } from "../../../shared/main/paths";
import { getUpdateStatus } from "./updater";
import { ensureBundledRuntimeInstalled, hasBundledRuntime, inspectInstalledRuntime } from "./runtimeInstaller";

export async function getInstallStatus(): Promise<InstallStatus> {
  const runtime = await inspectInstalledRuntime();
  const prerequisites: PrerequisiteStatus = {
    pythonOnPath: existsSync(DRSAI_PYTHON),
    pythonVersion: null,
    pythonCommand: existsSync(DRSAI_PYTHON) ? DRSAI_PYTHON : null,
    gitOnPath: true,
    gitVersion: null,
    gitCommand: "git",
    apiKeyConfigured: existsSync(DRSAI_CONFIG_FILE) || existsSync(DRSAI_ENV_FILE),
    problems: [],
  };
  const missing = [
    existsSync(DRSAI_REPO) ? null : "repository",
    existsSync(DRSAI_PYTHON) ? null : "python",
    existsSync(DRSAI_SCRIPT) ? null : "drsai-cli",
  ].filter((item): item is string => Boolean(item));
  return {
    installed: missing.length === 0 && runtime.healthy,
    home: DRSAI_HOME,
    repoPath: DRSAI_REPO,
    pythonPath: DRSAI_PYTHON,
    scriptPath: DRSAI_SCRIPT,
    version: runtime.version,
    expectedVersion: null,
    backendNeedsRepair: missing.length === 0 && !runtime.healthy,
    bundledBackendAvailable: hasBundledRuntime(),
    configExists: existsSync(DRSAI_CONFIG_FILE),
    envExists: existsSync(DRSAI_ENV_FILE),
    apiKeyConfigured: prerequisites.apiKeyConfigured,
    prerequisites,
    missing,
  };
}

export async function getHealth(): Promise<DesktopHealth> {
  const [install, gateway] = await Promise.all([getInstallStatus(), getGatewayStatus()]);
  return { installed: install.installed, gatewayReady: gateway.ready, mode: "local", version: install.version, install, gateway, update: getUpdateStatus() };
}

export async function bootstrapDesktop(): Promise<DesktopBootstrapResult> {
  const auth = await requireAuthContext();
  if (!auth.session.user || auth.authMode !== "oidc" || !auth.accessToken) {
    throw new Error("HepAI OIDC sign-in is required before preparing OpenDrSai.");
  }
  await ensureBundledRuntimeInstalled();
  const ready = await startGateway();
  const models = ready ? await getGatewayModels(auth.accessToken) : [];
  return {
    ready: ready && models.length > 0,
    message: ready ? (models.length ? "OpenDrSai is ready." : "No model service is available for this account.") : "The local runtime could not be started.",
    user: auth.session.user,
    blocker: ready && models.length ? null : {
      kind: ready ? "permission_denied" : "runtime_missing",
      title: ready ? "Account has no available service" : "Local runtime is unavailable",
      message: ready ? "Sign in with an account that has model access." : "Install or repair the local runtime before starting tasks.",
      retryable: true,
      canRepairRuntime: !ready,
      canSignInAgain: ready,
      diagnosticCode: ready ? "account-no-model-service" : "runtime-missing",
    },
    capabilities: { chat: ready && models.length > 0, agent: ready && models.length > 0, tools: ["files", "shell", "git"] },
    defaults: { agentId: "drsai", modelAlias: models[0]?.id ?? null },
    models,
    limits: { maxConcurrentRuns: 1 },
  };
}

export async function installBundledRuntime(onProgress?: (progress: InstallProgress) => void): Promise<void> {
  if (!(await ensureBundledRuntimeInstalled(onProgress, true))) throw new Error("This build does not contain a verified macOS Runtime artifact.");
}
