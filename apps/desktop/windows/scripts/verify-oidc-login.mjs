import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const haiRoot = resolve(process.env.HAI_BACKEND_ROOT || "C:\\Users\\win11\\VSProjects\\hai\\hai-ai-platform-backend");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readHai(relativePath) {
  return readFileSync(join(haiRoot, relativePath), "utf8");
}

const auth = read("../shared/main/auth.ts");
const desktopRuntimeMode = read("../shared/main/desktopRuntimeMode.ts");
const platformConfig = read("../shared/main/platformConfig.ts");
const platformCredentials = read("src/main/platformCredentials.ts");
const chat = read("../shared/main/chat.ts");
const agentRuns = read("../shared/main/agentRuns.ts");
const bootstrap = read("src/main/bootstrap.ts");
const gateway = read("../shared/main/gateway.ts");
const mainProcess = read("src/main/index.ts");
const api = read("../shared/api/desktopApi.ts");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");
const provider = read("../shared/renderer/src/auth/AuthProvider.tsx");
const login = read("../shared/renderer/src/auth/LoginScreen.tsx");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const plan = read("docs/login_plan/oidc-login-plan.md");
const e2eSmoke = read("src/main/e2eSmoke.ts");
const e2eOidc = read("scripts/verify-e2e-oidc-login.mjs");
const e2eHaiOidc = read("scripts/verify-e2e-oidc-hai.mjs");
const devEnvVerifier = read("scripts/verify-oidc-dev-env.mjs");
const packageJson = read("package.json");
const publicSessionBody = /function toPublicSession\(session: StoredAuthSession\): AuthSession \{([\s\S]*?)\n\}/.exec(auth)?.[1] || "";

const haiMainPath = join(haiRoot, "backend", "webui", "main.py");
const haiServicePath = join(haiRoot, "backend", "webui", "oidc", "service.py");
const haiSettingsPath = join(haiRoot, "backend", "webui", "oidc", "settings.py");
const haiTestPath = join(haiRoot, "backend", "webui", "test", "apps", "webui", "oidc", "test_oidc_unit.py");
const haiBackendAvailable = [haiMainPath, haiServicePath, haiSettingsPath, haiTestPath].every(existsSync);
const haiMain = existsSync(haiMainPath) ? readHai("backend/webui/main.py") : "";
const haiService = existsSync(haiServicePath) ? readHai("backend/webui/oidc/service.py") : "";
const haiSettings = existsSync(haiSettingsPath) ? readHai("backend/webui/oidc/settings.py") : "";
const haiTest = existsSync(haiTestPath) ? readHai("backend/webui/test/apps/webui/oidc/test_oidc_unit.py") : "";

const checks = [
  [
    "shared/preload/main expose browser OIDC IPC",
    api.includes('authMode: "password" | "api_key" | "sso" | "oidc" | "offline" | null') &&
      api.includes('"hai"') &&
      api.includes("startOidcLogin(request?: { rememberMe?: boolean }): Promise<LoginResult>") &&
      api.includes("cancelOidcLogin(): Promise<boolean>") &&
      preload.includes("desktop:start-oidc-login") &&
      preload.includes("desktop:cancel-oidc-login") &&
      main.includes('secureHandle("desktop:start-oidc-login"') &&
      main.includes('secureHandle("desktop:cancel-oidc-login"'),
  ],
  [
    "main process implements Authorization Code + PKCE over loopback",
    auth.includes("getOidcMetadata") &&
      auth.includes("getActivePlatformConfig") &&
      auth.includes("ACTIVE_PLATFORM.oidcIssuer") &&
      auth.includes("isDesktopDevelopment") &&
      desktopRuntimeMode.includes('process.env.OPENDRSAI_DESKTOP_DEV === "1"') &&
      platformConfig.includes('development ? "config-dev.toml" : "config.toml"') &&
      auth.includes('`${OIDC_ISSUER}/.well-known/openid-configuration`') &&
      auth.includes("OPENDRSAI_OIDC_DISCOVERY_URL") &&
      auth.includes("Loading OIDC discovery") &&
      auth.includes("metadata.authorization_endpoint") &&
      auth.includes("metadata.token_endpoint") &&
      auth.includes("metadata.jwks_uri") &&
      auth.includes("fetchOidcEndpoint") &&
      auth.includes("OIDC_FETCH_TIMEOUT_MS") &&
    auth.includes("createPkceChallenge") &&
      auth.includes('code_challenge_method", "S256"') &&
      auth.includes("createLoopbackCallback(state)") &&
      auth.includes('server.listen(0, "127.0.0.1")') &&
      auth.includes("openExternalUrl(url)") &&
      auth.includes("OPENDRSAI_E2E_OIDC_AUTO_CALLBACK") &&
      auth.includes('"opendrsai-dev://auth-complete"') &&
      auth.includes('"opendrsai://auth-complete"') &&
      auth.includes('id="open-app"') &&
      auth.includes("window.location.href = openAppLink.href") &&
      auth.includes('window.addEventListener("blur", closePage') &&
      auth.includes("if (document.hidden) closePage()") &&
      !auth.includes('removeAttribute("href")') &&
      main.includes("setAsDefaultProtocolClient") &&
      main.includes("Boolean(process.env.ELECTRON_RENDERER_URL) || is.dev || !app.isPackaged") &&
      main.includes("app.getAppPath()") &&
      main.includes("registerDevelopmentDeepLinkCommand") &&
      main.includes('"%1"') &&
      main.includes('"ApplicationName"') &&
      main.includes('"OpenDrSai"') &&
      main.includes("requestSingleInstanceLock") &&
      main.includes("const singleInstanceLock = isE2eSmokeProcess && !shouldExerciseSingleInstanceLifecycle") &&
      !main.includes("const singleInstanceLock = is.dev ||") &&
      main.includes("handleDeepLinkArgv") &&
      auth.includes('stage: "browser-opened"') &&
      auth.includes('stage: "waiting-callback"') &&
      auth.includes('stage: "cancelled"') &&
      auth.includes("waitForCode.catch") &&
      auth.includes("isOidcLoginCancelled") &&
      main.includes('"desktop:oidc-login-debug"') &&
      main.includes("if (result.ok) focusMainWindow()") &&
      preload.includes('"desktop:oidc-login-debug"') &&
      auth.includes('response_type", "code"') &&
      auth.includes("exchangeOidcAuthorizationCode"),
  ],
  [
    "main process binds request and callback with state and nonce",
    auth.includes("const state = generateTokenPart") &&
      auth.includes("const nonce = generateTokenPart") &&
      auth.includes('url.searchParams.set("state", state)') &&
      auth.includes('url.searchParams.set("nonce", nonce)') &&
      auth.includes("state !== expectedState") &&
      auth.includes("createOidcSession(token, rememberMe, { nonce })") &&
      auth.includes("idClaims.nonce !== validation.nonce"),
  ],
  [
    "main process validates returned token signatures and claims",
    auth.includes("verifyOidcTokenSignature") &&
      auth.includes("metadata.jwks_uri") &&
      auth.includes('header.alg !== "RS256"') &&
      auth.includes('createVerify("RSA-SHA256")') &&
      auth.includes('createPublicKey({ key: jwk, format: "jwk" })') &&
      auth.includes("fetchOidcJwks") &&
      auth.includes("findOidcJwk") &&
      auth.includes("validateOidcClaims") &&
      auth.includes("idClaims.iss !== OIDC_ISSUER") &&
      auth.includes("accessClaims.iss !== OIDC_ISSUER") &&
      auth.includes('audienceIncludes(idClaims.aud, OIDC_CLIENT_ID)') &&
      auth.includes('audienceIncludes(accessClaims.aud, "hai-api")') &&
      auth.includes("idClaims.exp <= nowSeconds") &&
      auth.includes("accessClaims.exp <= nowSeconds"),
  ],
  [
    "OIDC public user is built from ID and access token claims",
    auth.includes("email: idClaims?.email || userId") &&
      auth.includes("name: idClaims?.name || idClaims?.email || userId") &&
      auth.includes("avatarUrl: idClaims?.picture || undefined") &&
      auth.includes("roles: Array.isArray(accessClaims?.roles) ? accessClaims.roles : undefined") &&
      auth.includes("groups: Array.isArray(accessClaims?.groups) ? accessClaims.groups : undefined") &&
      api.includes("roles?: string[]") &&
      api.includes("groups?: string[]") &&
      e2eSmoke.includes('session.user.roles.includes("user")') &&
      e2eSmoke.includes('session.user.groups.includes("desktop-e2e")'),
  ],
  [
    "main process requests refresh only for remember-me and refreshes before expiry",
    auth.includes("rememberMe ? `${OIDC_BASE_SCOPE} offline_access` : OIDC_BASE_SCOPE") &&
      auth.includes("refreshOidcSessionIfNeeded") &&
      auth.includes("if (oidcRefreshPromise) return oidcRefreshPromise") &&
      auth.includes("ACCESS_TOKEN_REFRESH_WINDOW_MS") &&
      auth.includes('grant_type: "refresh_token"') &&
      auth.includes("refresh_token: token.refresh_token || refreshToken"),
  ],
  [
    "logout revokes OIDC refresh tokens before local cleanup",
    auth.includes("export async function logout") &&
      auth.includes("revokeOidcRefreshToken(stored.refreshToken)") &&
      auth.includes("metadata.revocation_endpoint") &&
      auth.includes('token_type_hint: "refresh_token"') &&
      auth.includes("Sign-out must still clear local credentials"),
  ],
  [
    "tokens stay in main process storage and public session omits raw tokens",
    auth.includes('join(DRSAI_HOME, "auth", "auth.json")') &&
      auth.includes('join(DRSAI_HOME, "auth", "session.json")') &&
      auth.includes("renameSync(temporaryFile, AUTH_SESSION_FILE)") &&
      auth.includes("mode: 0o600") &&
      auth.includes("credentialService?.protect") &&
      platformCredentials.includes("safeStorage.encryptString") &&
      platformCredentials.includes("safeStorage.decryptString") &&
      auth.includes("encryptedAccessToken") &&
      auth.includes("encryptedRefreshToken") &&
      auth.includes("encryptedIdToken") &&
      auth.includes("function toPublicSession") &&
      !publicSessionBody.includes("accessToken:") &&
      !publicSessionBody.includes("refreshToken:") &&
      !publicSessionBody.includes("idToken:") &&
      !api.includes("accessToken: string"),
  ],
  [
    "OIDC bearer tokens are available to authenticated gateway requests",
    auth.includes("export async function requireAuthContext") &&
      auth.includes("accessToken: refreshed.accessToken") &&
      chat.includes("requireAuthContext") &&
      chat.includes("Authorization: `Bearer ${authContext.accessToken}`") &&
      chat.includes("getPlatformAgentChatUrl") &&
      agentRuns.includes("requireAuthContext") &&
      agentRuns.includes("Authorization: `Bearer ${authContext.accessToken}`") &&
      agentRuns.includes('"X-OpenDrSai-Auth-Mode": authContext.authMode') &&
      agentRuns.includes("auth_mode: authContext.authMode") &&
      gateway.includes("getGatewayRequestHeaders") &&
      gateway.includes("OPENDRSAI_GATEWAY_INSTANCE_TOKEN"),
  ],
  [
    "OIDC login performs zero-configuration desktop bootstrap",
    bootstrap.includes("requireAuthContext") &&
      bootstrap.includes('auth.authMode !== "oidc"') &&
      bootstrap.includes("startGateway()") &&
      bootstrap.includes("discoverModelsWithRecovery(auth.accessToken)") &&
      bootstrap.includes('tools: ["files", "shell", "git"]') &&
      gateway.includes('Authorization: `Bearer ${accessToken}`') &&
      gateway.includes('"X-OpenDrSai-Auth-Mode": "oidc"') &&
      provider.includes("desktopApi.bootstrapDesktop()") &&
      provider.includes("serviceReady") &&
      login.includes("ServiceUnavailableScreen") &&
      login.includes("auth.retryBootstrap()"),
  ],
  [
    "renderer presents OIDC as the only production login",
      login.includes("login-debug-panel") &&
      !login.includes("if (!import.meta.env.DEV) return") &&
      login.includes("{debugOpen &&") &&
      login.includes('event.key !== "F12"') &&
      login.includes('data-testid="login-error-message"') &&
      login.includes("登录失败，按F12调试。") &&
      provider.includes("loginFailed") &&
      login.includes("onOidcLoginDebug") &&
      login.includes("auth.startOidcLogin({ rememberMe })") &&
      login.includes("auth.cancelOidcLogin()") &&
      login.includes("Sign in with HepAI") &&
      !login.includes("Use API key instead") &&
      !login.includes("DEFAULT_MODEL_OPTIONS") &&
      !login.includes('type="email"') &&
      auth.includes("This build only supports HepAI OIDC sign-in.") &&
      provider.includes("startOidcLogin") &&
      provider.includes("Opening browser for HepAI sign-in") &&
      provider.includes("Cancelling browser sign-in") &&
      provider.includes("setLoginBusy(false)") &&
      provider.includes("cancelOidcLogin") &&
      mock.includes('authMode: "oidc"') &&
      mock.includes('authProvider: "hai"') &&
      mock.includes("oidcLoginDebugListeners") &&
      mock.includes('"cancelled"'),
  ],
  [
    "production IPC rejects API key configuration",
    mainProcess.includes('secureHandle("desktop:save-api-key"') &&
      mainProcess.includes("if (!is.dev)") &&
      mainProcess.includes("receives service authorization through HepAI OIDC") &&
      e2eSmoke.includes("productionApiKeyRejected") &&
      e2eSmoke.includes("apiKeyStatusUnchanged"),
  ],
  [
    "plan documents implemented OIDC constraints",
    plan.includes("Authorization Code Flow with PKCE") &&
      plan.includes("Validate token RS256 signatures through JWKS") &&
      plan.includes("and the original `nonce` after token exchange") &&
      plan.includes("Electron `safeStorage`") &&
      plan.includes("http://127.0.0.1:{port}/callback") &&
      plan.includes("offline_access"),
  ],
  [
    "HAI OIDC upstream login preserves backend root path",
    !haiBackendAvailable ||
      (haiService.includes("from webui.oidc.settings import (") &&
      haiService.includes("OIDC_ISSUER") &&
      haiService.includes('f"{OIDC_ISSUER}/oauth2/upstream/ihep/login?request_id={auth_request.id}"') &&
      haiSettings.includes('"http://localhost:8081"') &&
      haiSettings.includes('"api"') &&
      haiMain.includes('app.include_router(oidc_router, prefix="/api", tags=["oidc"])') &&
      haiTest.includes("test_authorize_uses_issuer_for_upstream_login") &&
      haiTest.includes("http://localhost:8081/api/oauth2/upstream/ihep/login")),
  ],
  [
    "Electron OIDC E2E smoke exercises the real main-process login path",
    e2eSmoke.includes("OPENDRSAI_E2E_OIDC") &&
      e2eSmoke.includes("runOidcSmoke") &&
      e2eSmoke.includes("api.startOidcLogin({ rememberMe: true })") &&
      e2eSmoke.includes("api.bootstrapDesktop()") &&
      e2eSmoke.includes("oidcBootstrapReady") &&
      e2eSmoke.includes("publicSessionLooksOidc") &&
      mainProcess.includes("authContextHasBearerToken") &&
      mainProcess.includes("requireAuthContext()") &&
      mainProcess.includes("waitForHeadlessGatewayTerminal") &&
      mainProcess.includes("summarizeHeadlessGatewayEvents") &&
      mainProcess.includes("oidc chat bearer check") &&
      mainProcess.includes("oidc agent bearer check") &&
      e2eSmoke.includes("oidc chat bearer check") &&
      e2eSmoke.includes("oidc agent bearer check") &&
      e2eSmoke.includes("oidcChatDone") &&
      e2eSmoke.includes("oidcAgentDone") &&
      e2eSmoke.includes("sessionUsesEncryptedTokens") &&
      e2eSmoke.includes("logoutClearsSessionFile") &&
      e2eOidc.includes("startFakeOidcIssuer") &&
      e2eOidc.includes("startFakeGateway") &&
      e2eOidc.includes("assertGatewayHits") &&
      e2eOidc.includes("modelAuth.authMode !== \"oidc\"") &&
      e2eOidc.includes("DRSAI_GATEWAY_DEV_MANAGED") &&
      e2eOidc.includes("generateKeyPairSync") &&
      e2eOidc.includes("RS256") &&
      e2eOidc.includes("/.well-known/jwks.json") &&
      e2eOidc.includes("assertIssuerHits") &&
      e2eOidc.includes("revocation_endpoint") &&
      e2eOidc.includes("hits.revoke !== 1") &&
      e2eOidc.includes("resolveElectronRuntime") &&
      e2eOidc.includes("OPENDRSAI_E2E_OIDC_AUTO_CALLBACK") &&
      e2eOidc.includes("OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER") &&
      e2eOidc.includes("OPENDRSAI_E2E_OIDC_USE_SOURCE") &&
      e2eHaiOidc.includes('OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER ||= "https://ai-dev.ihep.ac.cn/api"') &&
      e2eHaiOidc.includes('OPENDRSAI_OIDC_DISCOVERY_URL ||= "https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration"') &&
      e2eHaiOidc.includes('OPENDRSAI_E2E_OIDC_USE_SOURCE ||= "1"') &&
      e2eHaiOidc.includes('await import("./verify-e2e-oidc-login.mjs")') &&
      packageJson.includes('"verify:oidc-dev-env": "node scripts/verify-oidc-dev-env.mjs"') &&
      devEnvVerifier.includes('"http://localhost:3000"') &&
      devEnvVerifier.includes('"https://ai-dev.ihep.ac.cn/api"') &&
      devEnvVerifier.includes("/.well-known/openid-configuration") &&
      devEnvVerifier.includes("/.well-known/jwks.json") &&
      devEnvVerifier.includes("code_challenge_method") &&
      devEnvVerifier.includes("authorize redirect must preserve state") &&
      e2eOidc.includes("E2E OIDC login passed with Electron main process + fake OIDC issuer"),
  ],
];

if (!haiBackendAvailable) {
  console.warn(`HAI backend cross-repository OIDC check skipped; repository not found at ${haiRoot}.`);
}

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error("OIDC login verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`OIDC login verification passed (${checks.length} checks).`);
