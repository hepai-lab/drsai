import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const haiRoot = resolve(process.env.HAI_BACKEND_ROOT || "C:\\Users\\win11\\VSProjects\\hai-ai-platform-backend");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readHai(relativePath) {
  return readFileSync(join(haiRoot, relativePath), "utf8");
}

const auth = read("src/main/auth.ts");
const chat = read("src/main/chat.ts");
const agentRuns = read("src/main/agentRuns.ts");
const mainProcess = read("src/main/index.ts");
const api = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const main = read("src/main/index.ts");
const provider = read("src/renderer/src/auth/AuthProvider.tsx");
const login = read("src/renderer/src/auth/LoginScreen.tsx");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const plan = read("docs/login_plan/oidc-login-plan.md");
const e2eSmoke = read("src/main/e2eSmoke.ts");
const e2eOidc = read("scripts/verify-e2e-oidc-login.mjs");
const publicSessionBody = /function toPublicSession\(session: StoredAuthSession\): AuthSession \{([\s\S]*?)\n\}/.exec(auth)?.[1] || "";

const haiServicePath = join(haiRoot, "backend", "webui", "oidc", "service.py");
const haiTestPath = join(haiRoot, "backend", "webui", "test", "apps", "webui", "oidc", "test_oidc_unit.py");
const haiService = existsSync(haiServicePath) ? readHai("backend/webui/oidc/service.py") : "";
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
      auth.includes("/.well-known/openid-configuration") &&
      auth.includes("metadata.authorization_endpoint") &&
      auth.includes("metadata.token_endpoint") &&
      auth.includes("metadata.jwks_uri") &&
    auth.includes("createPkceChallenge") &&
      auth.includes('code_challenge_method", "S256"') &&
      auth.includes("createLoopbackCallback(state)") &&
      auth.includes('server.listen(0, "127.0.0.1")') &&
      auth.includes("shell.openExternal(url)") &&
      auth.includes("OPENDRSAI_E2E_OIDC_AUTO_CALLBACK") &&
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
      auth.includes("ACCESS_TOKEN_REFRESH_WINDOW_MS") &&
      auth.includes('grant_type: "refresh_token"') &&
      auth.includes("refresh_token: token.refresh_token || stored.refreshToken"),
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
    auth.includes("safeStorage.encryptString") &&
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
      chat.includes("Authorization: `Bearer ${auth.accessToken}`") &&
      chat.includes('"X-OpenDrSai-Auth-Mode": auth.authMode') &&
      chat.includes("auth_mode: auth.authMode") &&
      agentRuns.includes("requireAuthContext") &&
      agentRuns.includes("Authorization: `Bearer ${auth.accessToken}`") &&
      agentRuns.includes('"X-OpenDrSai-Auth-Mode": auth.authMode') &&
      agentRuns.includes("auth_mode: auth.authMode"),
  ],
  [
    "renderer presents OIDC as primary login with cancel and fallbacks",
    login.includes('type LoginMode = "oidc" | "api_key" | "password"') &&
      login.includes('useState<LoginMode>("oidc")') &&
      login.includes("auth.startOidcLogin({ rememberMe })") &&
      login.includes("auth.cancelOidcLogin()") &&
      login.includes("Continue with IHEP SSO") &&
      login.includes("Use API key instead") &&
      provider.includes("startOidcLogin") &&
      provider.includes("cancelOidcLogin") &&
      mock.includes('authMode: "oidc"') &&
      mock.includes('authProvider: "hai"'),
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
    haiService.includes("from webui.oidc.settings import (") &&
      haiService.includes("OIDC_ISSUER") &&
      haiService.includes('f"{OIDC_ISSUER}/oauth2/upstream/ihep/login?request_id={auth_request.id}"') &&
      haiTest.includes("test_authorize_uses_issuer_for_upstream_login") &&
      haiTest.includes("https://aidev.ihep.ac.cn/backend/oauth2/upstream/ihep/login"),
  ],
  [
    "Electron OIDC E2E smoke exercises the real main-process login path",
    e2eSmoke.includes("OPENDRSAI_E2E_OIDC") &&
      e2eSmoke.includes("runOidcSmoke") &&
      e2eSmoke.includes("api.startOidcLogin({ rememberMe: true })") &&
      e2eSmoke.includes("publicSessionLooksOidc") &&
      mainProcess.includes("authContextHasBearerToken") &&
      mainProcess.includes("requireAuthContext()") &&
      e2eSmoke.includes("sessionUsesEncryptedTokens") &&
      e2eSmoke.includes("logoutClearsSessionFile") &&
      e2eOidc.includes("startFakeOidcIssuer") &&
      e2eOidc.includes("generateKeyPairSync") &&
      e2eOidc.includes("RS256") &&
      e2eOidc.includes("/.well-known/jwks.json") &&
      e2eOidc.includes("assertIssuerHits") &&
      e2eOidc.includes("revocation_endpoint") &&
      e2eOidc.includes("hits.revoke !== 1") &&
      e2eOidc.includes("resolveElectronRuntime") &&
      e2eOidc.includes("OPENDRSAI_E2E_OIDC_AUTO_CALLBACK") &&
      e2eOidc.includes("E2E OIDC login passed with Electron main process + fake OIDC issuer"),
  ],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error("OIDC login verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`OIDC login verification passed (${checks.length} checks).`);
