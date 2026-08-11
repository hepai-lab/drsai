import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const pythonSrc = join(repoRoot, "cores", "python", "packages", "drsai", "src");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const gateway = read("cores/python/packages/drsai/src/drsai/backend/gateway.py");
const modelClient = read("cores/python/packages/drsai/src/drsai/modules/components/model_client/LLMClient.py");
const anthropicClient = read("cores/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py");
const chat = read("apps/desktop/windows/../shared/main/chat.ts");
const agentRuns = read("apps/desktop/windows/../shared/main/agentRuns.ts");
const desktopGateway = read("apps/desktop/windows/../shared/main/gateway.ts");
const chatAdapter = read("apps/desktop/windows/../shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const authProvider = read("apps/desktop/windows/../shared/renderer/src/auth/AuthProvider.tsx");
const modelDefaults = read("apps/desktop/windows/../shared/main/modelDefaults.ts");
const myDrSaiConfig = read("apps/desktop/shared/main/myDrSaiConfig.ts");
const modelFactory = read("cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py");
const mainProcess = read("apps/desktop/windows/src/main/index.ts");
const status = read("apps/desktop/windows/src/main/status.ts");
const devLauncher = read("apps/desktop/windows/scripts/dev.ps1");

for (const [name, passed] of [
  ["request-scoped platform auth", gateway.includes("platform_auth_scope(auth_context)")],
  ["OIDC subject binding", gateway.includes("context_from_bearer") && gateway.includes("subject_mismatch")],
  ["model client dynamic token binding", modelClient.includes("self._bind_platform_auth()")],
  ["credential provider abstraction", modelClient.includes("get_model_credential_provider") && anthropicClient.includes("get_model_credential_provider")],
  ["Anthropic client dynamic token binding", anthropicClient.includes("credential.anthropic_base_url") && anthropicClient.includes("self._bind_platform_auth()")],
  ["no OIDC token environment mutation", !gateway.includes('os.environ["HEPAI_API_KEY"] =')],
  ["chat token-expiry retry", chat.includes('error.code === "token_expired"') && chat.includes("!refreshedToken") && chat.includes("await refreshAuthContextAfterUnauthorized()") && chat.includes("await requireAuthContext()")],
  ["agent token-expiry retry", agentRuns.includes('error.code === "token_expired"') && agentRuns.includes("!refreshedToken") && agentRuns.includes("auth = await requireAuthContext()")],
  ["invalid token clears local session", chat.includes("invalidateAuthSession()") && agentRuns.includes("invalidateAuthSession()")],
  ["invalid token returns renderer to login", chat.includes("desktop:auth-session-invalidated") && authProvider.includes("onAuthSessionInvalidated")],
  ["gateway instance secret", desktopGateway.includes("randomBytes(32)") && desktopGateway.includes("X-OpenDrSai-Gateway-Token")],
  ["renderer structured auth errors", ["token_expired", "agent_credentials_unavailable", "agent_credentials_invalid", "model_forbidden", "quota_exceeded", "model_not_found", "upstream_unavailable"].every((code) => chatAdapter.includes(code))],
  ["OIDC install status does not require API key", !status.includes('prerequisites.apiKeyConfigured ? null : "api-key"') && !status.includes('apiKeyConfigured ? null : "HEPAI_API_KEY is not configured."')],
  ["desktop development disables static credential fallback", devLauncher.includes('$env:OPENDRSAI_OIDC_ONLY = "1"') && devLauncher.includes("Env:HEPAI_API_KEY")],
  ["desktop default model alias", modelDefaults.includes('const DEFAULT_MODEL_ALIAS = "deepseek-v4-pro"') && modelDefaults.includes('"deepseek-ai/deepseek-v4-pro": DEFAULT_MODEL_ALIAS')],
  ["desktop model picker uses the authenticated available-model catalog", myDrSaiConfig.includes("getGatewayModels(auth.accessToken)") && myDrSaiConfig.includes("mergeModels") && myDrSaiConfig.includes("availablePromise")],
  ["model discovery preserves failure semantics", desktopGateway.includes("GatewayModelDiscoveryResult") && desktopGateway.includes('state: "forbidden"') && desktopGateway.includes('state: "unavailable"')],
  ["bootstrap retries transient model discovery", mainProcess.includes("bootstrapDesktop") && read("apps/desktop/windows/src/main/bootstrap.ts").includes("discoverModelsWithRecovery") && read("apps/desktop/windows/src/main/bootstrap.ts").includes("[0, 250, 750, 1_500]")],
  ["OIDC model catalog is proxied by the local Gateway", gateway.includes('f"{auth.model_base_url.rstrip(\'/\')}/models"') && gateway.includes('"model_catalog_timeout"')],
  ["default model resolves to DDF canonical id", modelFactory.includes('DEFAULT_CONFIG_NAME = "deepseek-v4-pro"') && modelFactory.includes('entry.model == resolved_config_name')],
  ["chat selection reaches Runtime execution", chatAdapter.includes("model: options?.model?.trim() || undefined") && chat.includes("model: request.model") && gateway.includes("model_override=request.model")],
  ["unregistered workspace falls back to global model catalog", mainProcess.includes("return getMyDrSaiConfig();")],
  ["empty failed assistant messages are excluded", chatAdapter.includes("!message.error && message.content.trim().length > 0")],
]) {
  if (!passed) throw new Error(`Platform auth verification failed: ${name}`);
}
const candidates = [
  process.env.OPENDRSAI_GATEWAY_SMOKE_PYTHON,
  process.env.pythonLocation ? join(process.env.pythonLocation, "python.exe") : null,
  join(repoRoot, "venv", "Scripts", "python.exe"),
  join(repoRoot, ".venv", "Scripts", "python.exe"),
  join(repoRoot, "venv", "bin", "python"),
  join(repoRoot, ".venv", "bin", "python"),
  process.platform === "win32" ? "python.exe" : "python",
].filter(Boolean);
const python = candidates.find((candidate) => candidate.includes("\\") || candidate.includes("/") ? existsSync(candidate) : true);
if (!python) throw new Error("A project Python environment is required for platform auth tests.");

const result = spawnSync(
  python,
  ["-m", "unittest", "cores/python/packages/drsai/tests/test_platform_auth.py", "-v"],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: [pythonSrc, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
