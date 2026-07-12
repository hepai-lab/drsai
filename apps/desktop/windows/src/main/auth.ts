import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
  randomUUID,
  type JsonWebKey,
} from "crypto";
import { createServer, type Server } from "http";
import { dirname, join } from "path";
import { safeStorage, shell } from "electron";
import { is } from "@electron-toolkit/utils";
import type {
  AuthSession,
  DesktopSsoPollResult,
  DesktopSsoStartResult,
  LoginRequest,
  LoginResult,
  LogoutOptions,
  OidcLoginDebugEvent,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { normalizeModelAlias } from "./modelDefaults";
import { saveApiKeyAndDefaultModel } from "./settings";

const AUTH_SESSION_FILE = join(DRSAI_HOME, "auth", "auth.json");
const LEGACY_AUTH_SESSION_FILE = join(DRSAI_HOME, "auth", "session.json");
const SESSION_DAYS = 30;
const MAX_EMAIL_CHARS = 254;
const MAX_PASSWORD_CHARS = 1024;
const MAX_API_KEY_CHARS = 4096;
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DESKTOP_AUTH_BASE_URL =
  process.env.OPENDRSAI_AUTH_BASE_URL?.replace(/\/+$/, "") ||
  "https://opendrsai.ihep.ac.cn";
const CONFIGURED_OIDC_ISSUER =
  process.env.OPENDRSAI_OIDC_ISSUER?.replace(/\/+$/, "") ||
  process.env.HAI_OIDC_ISSUER?.replace(/\/+$/, "");
const DEFAULT_OIDC_ORIGIN = is.dev
  ? "https://ai-dev.ihep.ac.cn"
  : "https://ai.ihep.ac.cn";
const OIDC_ISSUER = CONFIGURED_OIDC_ISSUER || `${DEFAULT_OIDC_ORIGIN}/api`;
const OIDC_DISCOVERY_URL =
  process.env.OPENDRSAI_OIDC_DISCOVERY_URL?.trim() ||
  `${OIDC_ISSUER}/.well-known/openid-configuration`;
const OIDC_CLIENT_ID = process.env.OPENDRSAI_OIDC_CLIENT_ID || "opendrsai-desktop";
const OIDC_BASE_SCOPE = "openid email profile roles groups hai_api";
const OIDC_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const OIDC_FETCH_TIMEOUT_MS = Number(process.env.OPENDRSAI_OIDC_FETCH_TIMEOUT_MS || "10000");
const OIDC_AUTH_COMPLETE_DEEP_LINK = "opendrsai://auth-complete";

interface StoredAuthSession extends AuthSession {
  sessionId: string;
  createdAt: string;
  issuer?: string;
  clientId?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface SerializedStoredAuthSession extends Omit<StoredAuthSession, "accessToken" | "refreshToken" | "idToken"> {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  encryptedIdToken?: string;
}

let pendingOidcLogin: Awaited<ReturnType<typeof createLoopbackCallback>> | null = null;
let pendingOidcLoginDebug: OidcLoginDebugSink | null = null;
let oidcJwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
let oidcMetadataCache: { metadata: OidcProviderMetadata; fetchedAt: number } | null = null;
let oidcRefreshPromise: Promise<StoredAuthSession | null> | null = null;

type OidcLoginDebugSink = (event: OidcLoginDebugEvent) => void;

export interface AuthContext {
  session: AuthSession;
  userId: string;
  accessToken?: string;
  authMode: NonNullable<AuthSession["authMode"]>;
}

export async function getAuthSession(): Promise<AuthSession> {
  const stored = readStoredSession();
  if (!stored) return anonymousSession();
  if (isExpired(stored)) {
    clearStoredSession(false);
    return anonymousSession();
  }
  const refreshed = await refreshSsoSessionIfNeeded(stored, false);
  if (!refreshed) return anonymousSession();
  return toPublicSession(refreshed);
}

export async function refreshAuthSession(): Promise<AuthSession> {
  const stored = readStoredSession();
  if (!stored || isExpired(stored)) {
    clearStoredSession(false);
    return anonymousSession();
  }
  const refreshedSso = await refreshSsoSessionIfNeeded(stored, true);
  if (!refreshedSso) return anonymousSession();
  if (refreshedSso.authMode === "sso" || refreshedSso.authMode === "oidc") {
    return toPublicSession(refreshedSso);
  }
  const refreshed = {
    ...refreshedSso,
    expiresAt: getExpiryDate(refreshedSso.authMode === "offline" ? 1 : SESSION_DAYS),
  };
  writeStoredSession(refreshed);
  return toPublicSession(refreshed);
}

export async function requireAuthContext(): Promise<AuthContext> {
  const stored = readStoredSession();
  if (!stored || isExpired(stored)) {
    clearStoredSession(false);
    throw new Error("Sign in before sending a request to DrSai Agent.");
  }
  const refreshed = await refreshSsoSessionIfNeeded(stored, true);
  if (!refreshed || !refreshed.user || !refreshed.authMode) {
    throw new Error("Sign in before sending a request to DrSai Agent.");
  }
  return {
    session: toPublicSession(refreshed),
    userId: refreshed.user.id || refreshed.user.email,
    accessToken: refreshed.accessToken,
    authMode: refreshed.authMode,
  };
}

export async function login(rawRequest: unknown): Promise<LoginResult> {
  const request = normalizeLoginRequest(rawRequest);
  if ("message" in request) {
    return { ok: false, session: null, message: request.message };
  }

  if (request.developerBypass) {
    if (!isDeveloperBypassAllowed()) {
      return { ok: false, session: null, message: "Developer sign-in is disabled." };
    }
    const session = createDeveloperSession(request.rememberMe);
    writeStoredSession(session);
    return {
      ok: true,
      session: toPublicSession(session),
      message: "Developer workspace unlocked.",
    };
  }

  if (!is.dev) {
    return {
      ok: false,
      session: null,
      message: "This build only supports HepAI OIDC sign-in.",
    };
  }

  if (request.apiKey) {
    const saveResult = await saveApiKeyAndDefaultModel(request.apiKey, request.defaultModel);
    if (!saveResult.ok) {
      return { ok: false, session: null, message: saveResult.message };
    }
    const session = createApiKeySession(request.apiKey, request.rememberMe);
    writeStoredSession(session);
    return {
      ok: true,
      session: toPublicSession(session),
      message: "Signed in with API key.",
    };
  }

  if (request.email && request.password) {
    const session = createPasswordPlaceholderSession(request.email, request.rememberMe);
    writeStoredSession(session);
    return {
      ok: true,
      session: toPublicSession(session),
      message: "Signed in locally. Remote password verification is not connected yet.",
    };
  }

  return {
    ok: false,
    session: null,
    message: "Enter an API key, or an email and password.",
  };
}

export async function startOidcLogin(
  rawRequest?: unknown,
  debug?: OidcLoginDebugSink,
): Promise<LoginResult> {
  const rememberMe = normalizeRememberMe(rawRequest);
  const verifier = generateTokenPart(64);
  const challenge = createPkceChallenge(verifier);
  const state = generateTokenPart(32);
  const nonce = generateTokenPart(32);
  let callback: Awaited<ReturnType<typeof createLoopbackCallback>> | null = null;
  const emitDebug = (event: Omit<OidcLoginDebugEvent, "at">): void => {
    debug?.({ ...event, at: new Date().toISOString() });
  };

  try {
    emitDebug({
      stage: "started",
      status: "info",
      message: "Starting HepAI OIDC login.",
    });
    pendingOidcLogin?.cancel("A new browser sign-in was started.");
    pendingOidcLoginDebug?.({
      stage: "cancelled",
      status: "info",
      message: "Previous browser sign-in was cancelled because a new login started.",
      at: new Date().toISOString(),
    });
    callback = await createLoopbackCallback(state);
    pendingOidcLogin = callback;
    pendingOidcLoginDebug = debug ?? null;
    emitDebug({
      stage: "callback-listening",
      status: "info",
      message: `Loopback callback server is listening at ${callback.redirectUri}.`,
      url: callback.redirectUri,
    });
    emitDebug({
      stage: "discovery",
      status: "info",
      message: `Loading OIDC discovery from ${OIDC_DISCOVERY_URL}.`,
      url: OIDC_DISCOVERY_URL,
    });
    const metadata = await getOidcMetadata();
    emitDebug({
      stage: "discovery",
      status: "success",
      message: `Loaded OIDC discovery from ${OIDC_DISCOVERY_URL}.`,
      url: OIDC_DISCOVERY_URL,
    });
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("client_id", OIDC_CLIENT_ID);
    url.searchParams.set("redirect_uri", callback.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", rememberMe ? `${OIDC_BASE_SCOPE} offline_access` : OIDC_BASE_SCOPE);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);

    emitDebug({
      stage: "authorize-url",
      status: "info",
      message: `Opening authorization endpoint: ${metadata.authorization_endpoint}.`,
      url: metadata.authorization_endpoint,
    });
    await openOidcAuthorizeUrl(url.toString());
    emitDebug({
      stage: "browser-opened",
      status: "success",
      message: "Browser open request was sent. Continue login in the browser.",
      url: url.toString(),
    });
    emitDebug({
      stage: "waiting-callback",
      status: "info",
      message: `Waiting for the browser to return to ${callback.redirectUri}.`,
      url: callback.redirectUri,
    });
    const code = await callback.waitForCode();
    emitDebug({
      stage: "callback-received",
      status: "success",
      message: "Received authorization callback from browser.",
      url: callback.redirectUri,
    });
    emitDebug({
      stage: "token-exchange",
      status: "info",
      message: `Exchanging authorization code at ${metadata.token_endpoint}.`,
      url: metadata.token_endpoint,
    });
    const token = await exchangeOidcAuthorizationCode(code, callback.redirectUri, verifier);
    const session = await createOidcSession(token, rememberMe, { nonce });
    emitDebug({
      stage: "token-verified",
      status: "success",
      message: "OIDC tokens were verified with JWKS, issuer, audience, expiry, and nonce checks.",
      url: metadata.jwks_uri,
    });
    writeStoredSession(session);
    emitDebug({
      stage: "session-created",
      status: "success",
      message: "HepAI session was created and stored securely.",
    });
    return {
      ok: true,
      session: toPublicSession(session),
      message: "Signed in with HAI OIDC.",
    };
  } catch (error) {
    callback?.close();
    const cancelled = isOidcLoginCancelled(error);
    emitDebug({
      stage: cancelled ? "cancelled" : "failed",
      status: cancelled ? "info" : "error",
      message: error instanceof Error ? error.message : "OIDC sign-in failed.",
    });
    return {
      ok: false,
      session: null,
      message: error instanceof Error ? error.message : "OIDC sign-in failed.",
    };
  } finally {
    if (pendingOidcLogin === callback) {
      pendingOidcLogin = null;
      pendingOidcLoginDebug = null;
    }
  }
}

function isOidcLoginCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === "Browser sign-in cancelled.";
}

export function cancelOidcLogin(): boolean {
  if (!pendingOidcLogin) return false;
  pendingOidcLogin.cancel("Browser sign-in cancelled.");
  pendingOidcLoginDebug?.({
    stage: "cancelled",
    status: "info",
    message: "Browser sign-in was cancelled by the user.",
    at: new Date().toISOString(),
  });
  pendingOidcLogin = null;
  pendingOidcLoginDebug = null;
  return true;
}

export async function startDesktopSsoLogin(): Promise<DesktopSsoStartResult> {
  return startDesktopTicketLogin(
    "/api/desktop-auth/start",
    "Open the browser to finish IHEP SSO.",
    "IHEP SSO",
  );
}

export async function startWechatDesktopLogin(): Promise<DesktopSsoStartResult> {
  return startDesktopTicketLogin(
    "/api/desktop-auth/wechat/start",
    "Open the browser to scan with WeChat.",
    "WeChat login",
  );
}

async function startDesktopTicketLogin(
  path: string,
  successMessage: string,
  providerLabel: string,
): Promise<DesktopSsoStartResult> {
  try {
    const response = await fetch(`${DESKTOP_AUTH_BASE_URL}${path}`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json() as DesktopAuthStartPayload;
    if (!response.ok || !payload.status || !payload.data?.device_code || !payload.data.login_url) {
      return {
        ok: false,
        message: `${readPayloadMessage(payload, `Failed to start ${providerLabel}.`)} Auth service: ${DESKTOP_AUTH_BASE_URL}`,
      };
    }
    return {
      ok: true,
      message: successMessage,
      deviceCode: payload.data.device_code,
      loginUrl: payload.data.login_url,
      expiresAt: payload.data.expires_at
        ? new Date(payload.data.expires_at * 1000).toISOString()
        : undefined,
      intervalSeconds: payload.data.interval ?? 2,
    };
  } catch (error) {
    return {
      ok: false,
      message: `${error instanceof Error ? error.message : `Failed to start ${providerLabel}.`} Auth service: ${DESKTOP_AUTH_BASE_URL}`,
    };
  }
}

export async function pollDesktopSsoLogin(deviceCode: unknown): Promise<DesktopSsoPollResult> {
  if (typeof deviceCode !== "string" || !deviceCode.trim()) {
    return { ok: false, state: "error", message: "Missing desktop login code." };
  }
  try {
    const response = await fetch(
      `${DESKTOP_AUTH_BASE_URL}/api/desktop-auth/poll/${encodeURIComponent(deviceCode.trim())}`,
      { headers: { Accept: "application/json" } },
    );
    const payload = await response.json() as DesktopAuthPollPayload;
    if (!response.ok || !payload.status || !payload.data?.state) {
      return { ok: false, state: "error", message: readPayloadMessage(payload, "SSO polling failed.") };
    }
    if (payload.data.state !== "authorized") {
      return {
        ok: true,
        state: payload.data.state,
        message: formatPollState(payload.data.state),
      };
    }
    if (!payload.data.user_id || !payload.data.access_token) {
      return { ok: false, state: "error", message: "Desktop login response is missing tokens." };
    }
    const session = createSsoSession(
      payload.data.user_id,
      payload.data.access_token,
      payload.data.refresh_token,
      {
        authProvider: payload.data.auth_provider,
        name: payload.data.user_name,
        avatarUrl: payload.data.avatar_url,
      },
    );
    writeStoredSession(session);
    return {
      ok: true,
      state: "authorized",
      message: payload.data.auth_provider === "wechat"
        ? "Signed in with WeChat."
        : "Signed in with IHEP SSO.",
      session: toPublicSession(session),
    };
  } catch (error) {
    return {
      ok: false,
      state: "error",
      message: error instanceof Error ? error.message : "SSO polling failed.",
    };
  }
}

export async function cancelDesktopSsoLogin(deviceCode: unknown): Promise<boolean> {
  if (typeof deviceCode !== "string" || !deviceCode.trim()) return false;
  try {
    await fetch(
      `${DESKTOP_AUTH_BASE_URL}/api/desktop-auth/cancel/${encodeURIComponent(deviceCode.trim())}`,
      { method: "POST" },
    );
    return true;
  } catch {
    return false;
  }
}

export async function logout(rawOptions?: unknown): Promise<{ ok: boolean; message: string }> {
  const options = normalizeLogoutOptions(rawOptions);
  const stored = readStoredSession();
  if (stored?.authMode === "oidc" && stored.refreshToken) {
    await revokeOidcRefreshToken(stored.refreshToken);
  }
  clearStoredSession(Boolean(options.clearLocalData));
  return {
    ok: true,
    message: options.clearLocalData ? "Signed out and cleared local auth data." : "Signed out.",
  };
}

function normalizeLoginRequest(rawRequest: unknown): LoginRequest | { message: string } {
  if (!rawRequest || typeof rawRequest !== "object") {
    return { message: "Login request is invalid." };
  }
  const value = rawRequest as Record<string, unknown>;
  const email = typeof value.email === "string" ? value.email.trim() : undefined;
  const password = typeof value.password === "string" ? value.password : undefined;
  const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : undefined;
  let defaultModel: string | undefined;
  try {
    defaultModel = normalizeModelAlias(value.defaultModel);
  } catch {
    return { message: "Default model is invalid." };
  }
  const developerBypass = value.developerBypass === true;
  const rememberMe = value.rememberMe !== false;

  if (email && email.length > MAX_EMAIL_CHARS) {
    return { message: `Email cannot exceed ${MAX_EMAIL_CHARS} characters.` };
  }
  if (password && password.length > MAX_PASSWORD_CHARS) {
    return { message: `Password cannot exceed ${MAX_PASSWORD_CHARS} characters.` };
  }
  if (apiKey && apiKey.length > MAX_API_KEY_CHARS) {
    return { message: `API key cannot exceed ${MAX_API_KEY_CHARS} characters.` };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { message: "Enter a valid email address." };
  }
  if (apiKey && /[\r\n]/.test(apiKey)) {
    return { message: "API key must be a single line." };
  }

  return { email, password, apiKey, defaultModel, developerBypass, rememberMe };
}

function normalizeLogoutOptions(rawOptions: unknown): LogoutOptions {
  if (!rawOptions || typeof rawOptions !== "object") return {};
  return {
    clearLocalData: Boolean((rawOptions as Record<string, unknown>).clearLocalData),
  };
}

function createApiKeySession(apiKey: string, rememberMe = true): StoredAuthSession {
  const fingerprint = createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
  const now = new Date().toISOString();
  return {
    authenticated: true,
    sessionId: randomUUID(),
    createdAt: now,
    expiresAt: getExpiryDate(rememberMe ? SESSION_DAYS : 1),
    authMode: "api_key",
    user: {
      id: `local-api-${fingerprint}`,
      email: "local@opendrsai.desktop",
      name: "Local API Key User",
      role: "user",
    },
  };
}

function createPasswordPlaceholderSession(email: string, rememberMe = true): StoredAuthSession {
  const now = new Date().toISOString();
  const id = createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 12);
  return {
    authenticated: true,
    sessionId: randomUUID(),
    createdAt: now,
    expiresAt: getExpiryDate(rememberMe ? SESSION_DAYS : 1),
    authMode: "password",
    user: {
      id: `local-user-${id}`,
      email,
      name: email.split("@")[0] || "OpenDrSai User",
      role: "user",
    },
  };
}

function createSsoSession(
  userId: string,
  accessToken: string,
  refreshToken?: string | null,
  options: {
    authProvider?: AuthSession["authProvider"];
    name?: string | null;
    avatarUrl?: string | null;
  } = {},
): StoredAuthSession {
  const now = new Date().toISOString();
  const tokenExpiry = getJwtExpiry(accessToken);
  const refreshExpiry = refreshToken ? getJwtExpiry(refreshToken) : null;
  return {
    authenticated: true,
    sessionId: randomUUID(),
    createdAt: now,
    expiresAt: refreshExpiry || getExpiryDate(SESSION_DAYS),
    accessTokenExpiresAt: tokenExpiry,
    refreshable: Boolean(refreshToken),
    authMode: "sso",
    authProvider: options.authProvider ?? "ihep",
    accessToken,
    refreshToken: refreshToken ?? undefined,
    user: {
      id: userId,
      email: userId,
      name: options.name || userId,
      avatarUrl: options.avatarUrl || undefined,
      role: "user",
    },
  };
}

async function createOidcSession(
  token: OidcTokenResponse,
  rememberMe = true,
  validation: { nonce?: string } = {},
): Promise<StoredAuthSession> {
  await verifyOidcTokenSignature(token.id_token);
  await verifyOidcTokenSignature(token.access_token);
  const idClaims = decodeJwtPayload<OidcIdTokenClaims>(token.id_token);
  const accessClaims = decodeJwtPayload<OidcAccessTokenClaims>(token.access_token);
  validateOidcClaims(idClaims, accessClaims, validation);
  const userId = idClaims?.sub || accessClaims?.sub;
  if (!userId) {
    throw new Error("OIDC token response is missing a user subject.");
  }
  const now = new Date().toISOString();
  const accessTokenExpiresAt = getJwtExpiry(token.access_token);
  return {
    authenticated: true,
    sessionId: randomUUID(),
    createdAt: now,
    expiresAt: token.refresh_token && rememberMe
      ? getExpiryDate(SESSION_DAYS)
      : accessTokenExpiresAt || getExpiryDate(1),
    issuer: OIDC_ISSUER,
    clientId: OIDC_CLIENT_ID,
    accessToken: token.access_token,
    idToken: token.id_token,
    refreshToken: rememberMe ? token.refresh_token : undefined,
    accessTokenExpiresAt,
    refreshable: Boolean(rememberMe && token.refresh_token),
    authMode: "oidc",
    authProvider: "hai",
    user: {
      id: userId,
      email: idClaims?.email || userId,
      name: idClaims?.name || idClaims?.email || userId,
      avatarUrl: idClaims?.picture || undefined,
      role: Array.isArray(accessClaims?.roles) && accessClaims.roles.includes("admin") ? "admin" : "user",
      roles: Array.isArray(accessClaims?.roles) ? accessClaims.roles : undefined,
      groups: Array.isArray(accessClaims?.groups) ? accessClaims.groups : undefined,
    },
  };
}

function createDeveloperSession(rememberMe = true): StoredAuthSession {
  const now = new Date().toISOString();
  return {
    authenticated: true,
    sessionId: randomUUID(),
    createdAt: now,
    expiresAt: getExpiryDate(rememberMe ? 7 : 1),
    authMode: "offline",
    user: {
      id: "developer-local",
      email: "developer@opendrsai.local",
      name: "Developer",
      role: "admin",
    },
  };
}

function isDeveloperBypassAllowed(): boolean {
  return is.dev || process.env.OPENDRSAI_DEV_AUTH_BYPASS === "1";
}

function getExpiryDate(days: number): string {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt.toISOString();
}

function readStoredSession(): StoredAuthSession | null {
  const sourceFile = existsSync(AUTH_SESSION_FILE)
    ? AUTH_SESSION_FILE
    : existsSync(LEGACY_AUTH_SESSION_FILE)
      ? LEGACY_AUTH_SESSION_FILE
      : null;
  if (!sourceFile) return null;
  try {
    const parsed = deserializeStoredSession(
      JSON.parse(readFileSync(sourceFile, "utf8")) as SerializedStoredAuthSession,
    );
    if (!parsed.authenticated || !parsed.user || !parsed.expiresAt || !parsed.sessionId) {
      return null;
    }
    if ((parsed.authMode === "oidc" || parsed.authMode === "sso") && !parsed.accessToken) {
      return null;
    }
    if (sourceFile === LEGACY_AUTH_SESSION_FILE) {
      writeStoredSession(parsed);
      rmSync(LEGACY_AUTH_SESSION_FILE, { force: true });
    }
    return parsed;
  } catch {
    clearStoredSession(false);
    return null;
  }
}

function writeStoredSession(session: StoredAuthSession): void {
  mkdirSync(dirname(AUTH_SESSION_FILE), { recursive: true });
  const temporaryFile = `${AUTH_SESSION_FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporaryFile,
      `${JSON.stringify(serializeStoredSession(session), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryFile, AUTH_SESSION_FILE);
    try {
      chmodSync(AUTH_SESSION_FILE, 0o600);
    } catch {
      // Windows ACLs are enforced by the user's profile; chmod is best effort.
    }
  } finally {
    rmSync(temporaryFile, { force: true });
  }
}

function serializeStoredSession(session: StoredAuthSession): SerializedStoredAuthSession {
  const serialized: SerializedStoredAuthSession = { ...session };
  if (session.accessToken) {
    const encrypted = encryptSecret(session.accessToken);
    if (encrypted) {
      serialized.encryptedAccessToken = encrypted;
      delete serialized.accessToken;
    }
  }
  if (session.refreshToken) {
    const encrypted = encryptSecret(session.refreshToken);
    if (encrypted) {
      serialized.encryptedRefreshToken = encrypted;
      delete serialized.refreshToken;
    }
  }
  if (session.idToken) {
    const encrypted = encryptSecret(session.idToken);
    if (encrypted) {
      serialized.encryptedIdToken = encrypted;
      delete serialized.idToken;
    }
  }
  return serialized;
}

function deserializeStoredSession(serialized: SerializedStoredAuthSession): StoredAuthSession {
  return {
    ...serialized,
    accessToken: serialized.accessToken ?? decryptSecret(serialized.encryptedAccessToken),
    refreshToken: serialized.refreshToken ?? decryptSecret(serialized.encryptedRefreshToken),
    idToken: serialized.idToken ?? decryptSecret(serialized.encryptedIdToken),
  };
}

function encryptSecret(secret: string): string | undefined {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.encryptString(secret).toString("base64");
  } catch {
    return undefined;
  }
}

function decryptSecret(encrypted: string | undefined): string | undefined {
  if (!encrypted) return undefined;
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return undefined;
  }
}

function clearStoredSession(clearLocalData: boolean): void {
  try {
    rmSync(AUTH_SESSION_FILE, { force: true });
    rmSync(LEGACY_AUTH_SESSION_FILE, { force: true });
    if (clearLocalData) oidcMetadataCache = null;
  } catch {
    // Best-effort cleanup; logout should still clear renderer state.
  }
}

function isExpired(session: AuthSession): boolean {
  if (!session.expiresAt) return true;
  return new Date(session.expiresAt).getTime() <= Date.now();
}

function toPublicSession(session: StoredAuthSession): AuthSession {
  return {
    authenticated: session.authenticated,
    user: session.user,
    expiresAt: session.expiresAt,
    authMode: session.authMode,
    authProvider: session.authProvider,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshable: session.refreshable,
  };
}

function anonymousSession(): AuthSession {
  return {
    authenticated: false,
    user: null,
    expiresAt: null,
    authMode: null,
  };
}

interface DesktopAuthStartPayload {
  status?: boolean;
  message?: string;
  detail?: string;
  data?: {
    device_code?: string;
    login_url?: string;
    expires_at?: number;
    interval?: number;
  };
}

interface DesktopAuthPollPayload {
  status?: boolean;
  message?: string;
  detail?: string;
  data?: {
    state?: "pending" | "authorized" | "expired" | "cancelled";
    user_id?: string;
    user_name?: string;
    avatar_url?: string;
    auth_provider?: "ihep" | "wechat" | "local";
    access_token?: string;
    refresh_token?: string;
  };
}

interface DesktopAuthRefreshPayload {
  status?: boolean;
  message?: string;
  detail?: string;
  data?: {
    user_id?: string;
    access_token?: string;
    refresh_token?: string;
  };
}

interface OidcTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: "Bearer" | string;
  expires_in?: number;
  scope?: string;
}

interface OidcProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}

interface OidcIdTokenClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  email?: string;
  name?: string;
  picture?: string;
}

interface OidcAccessTokenClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  roles?: string[];
  groups?: string[];
}

interface OidcJwtHeader {
  alg?: string;
  kid?: string;
}

function readPayloadMessage(payload: { message?: string; detail?: string }, fallback: string): string {
  return payload.detail || payload.message || fallback;
}

function formatPollState(state: "pending" | "expired" | "cancelled"): string {
  if (state === "pending") return "Waiting for browser sign-in...";
  if (state === "expired") return "Desktop sign-in expired.";
  return "Desktop sign-in cancelled.";
}

function getJwtExpiry(token: string): string | null {
  const parsed = decodeJwtPayload<{ exp?: number }>(token);
  return typeof parsed?.exp === "number" ? new Date(parsed.exp * 1000).toISOString() : null;
}

async function refreshSsoSessionIfNeeded(
  stored: StoredAuthSession,
  force: boolean,
): Promise<StoredAuthSession | null> {
  if (stored.authMode === "oidc") return refreshOidcSessionIfNeeded(stored, force);
  if (stored.authMode !== "sso") return stored;
  if (!stored.refreshToken) return stored;

  const accessExpiryMs = stored.accessTokenExpiresAt
    ? new Date(stored.accessTokenExpiresAt).getTime()
    : 0;
  const shouldRefresh =
    force || !accessExpiryMs || accessExpiryMs <= Date.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS;
  if (!shouldRefresh) return stored;

  try {
    const response = await fetch(`${DESKTOP_AUTH_BASE_URL}/api/desktop-auth/refresh`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: stored.refreshToken }),
    });
    const payload = await response.json() as DesktopAuthRefreshPayload;
    if (!response.ok || !payload.status || !payload.data?.user_id || !payload.data.access_token) {
      if (accessExpiryMs && accessExpiryMs > Date.now()) return stored;
      clearStoredSession(false);
      return null;
    }
    const refreshed = createSsoSession(
      payload.data.user_id,
      payload.data.access_token,
      payload.data.refresh_token || stored.refreshToken,
      {
        authProvider: stored.authProvider,
        name: stored.user?.name,
        avatarUrl: stored.user?.avatarUrl,
      },
    );
    writeStoredSession(refreshed);
    return refreshed;
  } catch {
    if (accessExpiryMs && accessExpiryMs > Date.now()) return stored;
    clearStoredSession(false);
    return null;
  }
}

async function refreshOidcSessionIfNeeded(
  stored: StoredAuthSession,
  force: boolean,
): Promise<StoredAuthSession | null> {
  if (!stored.refreshToken) return stored;

  const accessExpiryMs = stored.accessTokenExpiresAt
    ? new Date(stored.accessTokenExpiresAt).getTime()
    : 0;
  const shouldRefresh =
    force || !accessExpiryMs || accessExpiryMs <= Date.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS;
  if (!shouldRefresh) return stored;

  if (oidcRefreshPromise) return oidcRefreshPromise;
  oidcRefreshPromise = refreshOidcSession(stored, stored.refreshToken, accessExpiryMs);
  try {
    return await oidcRefreshPromise;
  } finally {
    oidcRefreshPromise = null;
  }
}

export function invalidateAuthSession(): void {
  clearStoredSession(false);
}

async function refreshOidcSession(
  stored: StoredAuthSession,
  refreshToken: string,
  accessExpiryMs: number,
): Promise<StoredAuthSession | null> {
  try {
    const token = await exchangeOidcRefreshToken(refreshToken);
    const refreshed = await createOidcSession(
      {
        ...token,
        refresh_token: token.refresh_token || refreshToken,
      },
      true,
    );
    writeStoredSession(refreshed);
    return refreshed;
  } catch {
    if (accessExpiryMs && accessExpiryMs > Date.now()) return stored;
    clearStoredSession(false);
    return null;
  }
}

async function exchangeOidcAuthorizationCode(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<OidcTokenResponse> {
  return postOidcToken({
    grant_type: "authorization_code",
    client_id: OIDC_CLIENT_ID,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  });
}

async function exchangeOidcRefreshToken(refreshToken: string): Promise<OidcTokenResponse> {
  return postOidcToken({
    grant_type: "refresh_token",
    client_id: OIDC_CLIENT_ID,
    refresh_token: refreshToken,
  });
}

async function revokeOidcRefreshToken(refreshToken: string): Promise<void> {
  try {
    const metadata = await getOidcMetadata();
    const endpoint = metadata.revocation_endpoint || `${OIDC_ISSUER}/oauth2/revoke`;
    await fetchOidcEndpoint(endpoint, "OIDC token revocation", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: refreshToken,
        token_type_hint: "refresh_token",
      }).toString(),
    });
  } catch {
    // Sign-out must still clear local credentials if the network or server is unavailable.
  }
}

async function postOidcToken(params: Record<string, string>): Promise<OidcTokenResponse> {
  const metadata = await getOidcMetadata();
  const response = await fetchOidcEndpoint(metadata.token_endpoint, "OIDC token request", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const payload = await response.json().catch(() => ({})) as Partial<OidcTokenResponse> & {
    error?: string;
    error_description?: string;
    detail?: unknown;
  };
  if (
    !response.ok ||
    !payload.access_token ||
    !payload.id_token ||
    payload.token_type?.toLowerCase() !== "bearer"
  ) {
    const detail = readOidcErrorMessage(payload);
    throw new Error(`${detail} Auth service: ${OIDC_ISSUER}`);
  }
  return payload as OidcTokenResponse;
}

async function fetchOidcEndpoint(
  url: string,
  label: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OIDC_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out after ${OIDC_FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`${label} failed: ${url}. ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}

function readOidcErrorMessage(payload: {
  error?: string;
  error_description?: string;
  detail?: unknown;
}): string {
  if (typeof payload.detail === "string") return payload.detail;
  if (payload.detail && typeof payload.detail === "object") {
    const detail = payload.detail as { error?: unknown; error_description?: unknown };
    if (typeof detail.error_description === "string") return detail.error_description;
    if (typeof detail.error === "string") return detail.error;
  }
  return payload.error_description || payload.error || "OIDC token request failed.";
}

function normalizeRememberMe(rawRequest: unknown): boolean {
  if (!rawRequest || typeof rawRequest !== "object") return true;
  return (rawRequest as Record<string, unknown>).rememberMe !== false;
}

function generateTokenPart(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function getOidcMetadata(): Promise<OidcProviderMetadata> {
  const cacheMaxAgeMs = 5 * 60 * 1000;
  if (oidcMetadataCache && Date.now() - oidcMetadataCache.fetchedAt <= cacheMaxAgeMs) {
    return oidcMetadataCache.metadata;
  }
  const discoveryUrl = OIDC_DISCOVERY_URL;
  const response = await fetchOidcEndpoint(discoveryUrl, "OIDC discovery", {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as Partial<OidcProviderMetadata>;
  if (!response.ok) {
    throw new Error(`Could not load OIDC discovery from ${discoveryUrl}.`);
  }
  if (payload.issuer !== OIDC_ISSUER) {
    throw new Error(
      `OIDC discovery issuer does not match the configured auth service. Expected ${OIDC_ISSUER}, received ${payload.issuer || "missing issuer"}.`,
    );
  }
  if (
    typeof payload.authorization_endpoint !== "string" ||
    typeof payload.token_endpoint !== "string" ||
    typeof payload.jwks_uri !== "string"
  ) {
    throw new Error("OIDC discovery is missing required endpoints.");
  }
  const metadata = {
    issuer: payload.issuer,
    authorization_endpoint: payload.authorization_endpoint,
    token_endpoint: payload.token_endpoint,
    jwks_uri: payload.jwks_uri,
    revocation_endpoint: typeof payload.revocation_endpoint === "string"
      ? payload.revocation_endpoint
      : undefined,
  };
  oidcMetadataCache = { metadata, fetchedAt: Date.now() };
  return metadata;
}

function decodeJwtPayload<T extends object>(token: string): T | null {
  return decodeJwtPart<T>(token, 1);
}

function decodeJwtHeader(token: string): OidcJwtHeader | null {
  return decodeJwtPart<OidcJwtHeader>(token, 0);
}

function decodeJwtPart<T extends object>(token: string, index: number): T | null {
  try {
    const part = token.split(".")[index];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

async function verifyOidcTokenSignature(token: string): Promise<void> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("OIDC token response contains a malformed JWT.");
  }
  const header = decodeJwtHeader(token);
  if (!header || header.alg !== "RS256") {
    throw new Error("OIDC token response must be signed with RS256.");
  }
  const jwk = await getOidcSigningJwk(header.kid);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const valid = verifier.verify(
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!valid) {
    throw new Error("OIDC token signature verification failed.");
  }
}

async function getOidcSigningJwk(kid: string | undefined): Promise<JsonWebKey> {
  const cacheMaxAgeMs = 5 * 60 * 1000;
  if (!oidcJwksCache || Date.now() - oidcJwksCache.fetchedAt > cacheMaxAgeMs) {
    oidcJwksCache = await fetchOidcJwks();
  }
  let key = findOidcJwk(oidcJwksCache.keys, kid);
  if (!key && kid) {
    oidcJwksCache = await fetchOidcJwks();
    key = findOidcJwk(oidcJwksCache.keys, kid);
  }
  if (!key) {
    throw new Error("OIDC signing key was not found in JWKS.");
  }
  return key;
}

async function fetchOidcJwks(): Promise<{ keys: JsonWebKey[]; fetchedAt: number }> {
  const metadata = await getOidcMetadata();
  const response = await fetchOidcEndpoint(metadata.jwks_uri, "OIDC JWKS request", {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({})) as { keys?: JsonWebKey[] };
  if (!response.ok || !Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new Error(`Could not load OIDC signing keys from ${metadata.jwks_uri}.`);
  }
  return { keys: payload.keys, fetchedAt: Date.now() };
}

function findOidcJwk(keys: JsonWebKey[], kid: string | undefined): JsonWebKey | undefined {
  return kid
    ? keys.find((item) => item.kid === kid)
    : keys.find((item) => item.kty === "RSA");
}

function validateOidcClaims(
  idClaims: OidcIdTokenClaims | null,
  accessClaims: OidcAccessTokenClaims | null,
  validation: { nonce?: string },
): void {
  if (!idClaims) throw new Error("OIDC token response has an invalid ID token.");
  if (!accessClaims) throw new Error("OIDC token response has an invalid access token.");
  if (idClaims.iss !== OIDC_ISSUER || accessClaims.iss !== OIDC_ISSUER) {
    throw new Error("OIDC token issuer does not match the configured auth service.");
  }
  if (!audienceIncludes(idClaims.aud, OIDC_CLIENT_ID)) {
    throw new Error("OIDC ID token was not issued for this desktop client.");
  }
  if (!audienceIncludes(accessClaims.aud, "hai-api")) {
    throw new Error("OIDC access token was not issued for the HAI API.");
  }
  if (validation.nonce && idClaims.nonce !== validation.nonce) {
    throw new Error("OIDC ID token nonce does not match the sign-in request.");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!idClaims.exp || idClaims.exp <= nowSeconds || !accessClaims.exp || accessClaims.exp <= nowSeconds) {
    throw new Error("OIDC token response is already expired.");
  }
}

function audienceIncludes(audience: string | string[] | undefined, expected: string): boolean {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

async function openOidcAuthorizeUrl(url: string): Promise<void> {
  if (
    process.env.OPENDRSAI_E2E_OIDC === "1" &&
    process.env.OPENDRSAI_E2E_OIDC_AUTO_CALLBACK === "1"
  ) {
    await followOidcAuthorizeRedirectForE2e(url);
    return;
  }
  try {
    await shell.openExternal(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Could not open the HepAI sign-in browser. Open this URL manually: ${url}. ${detail}`);
  }
}

async function followOidcAuthorizeRedirectForE2e(url: string): Promise<void> {
  const authorize = await fetch(url, { redirect: "manual" });
  const callbackUrl = authorize.headers.get("location");
  if (!callbackUrl) {
    throw new Error("E2E OIDC issuer did not return a callback redirect.");
  }
  const callback = await fetch(callbackUrl, { redirect: "manual" });
  if (!callback.ok) {
    throw new Error(`E2E OIDC callback failed with HTTP ${callback.status}.`);
  }
}

async function createLoopbackCallback(expectedState: string): Promise<{
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
  cancel: (message?: string) => void;
}> {
  let settled = false;
  let timeout: NodeJS.Timeout | null = null;
  let resolveCode: (code: string) => void = () => undefined;
  let rejectCode: (error: Error) => void = () => undefined;

  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  waitForCode.catch(() => {
    // Cancellation can be triggered by a separate IPC call before the login
    // request has attached its await handler. Keep the rejection observable to
    // the caller without letting Electron report it as unhandled.
  });

  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/callback") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description");
      const state = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      if (error) {
        throw new Error(errorDescription || error);
      }
      if (!state || state !== expectedState) {
        throw new Error("OIDC sign-in returned an invalid state.");
      }
      if (!code) {
        throw new Error("OIDC sign-in did not return an authorization code.");
      }
      settled = true;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(successHtml());
      resolveCode(code);
    } catch (error) {
      settled = true;
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(failureHtml(error instanceof Error ? error.message : "OIDC sign-in failed."));
      rejectCode(error instanceof Error ? error : new Error("OIDC sign-in failed."));
    } finally {
      if (timeout) clearTimeout(timeout);
      safeCloseServer(server);
    }
  });

  server.once("error", (error) => rejectCode(error));
  timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    safeCloseServer(server);
    rejectCode(new Error("Browser sign-in timed out. Please try again."));
  }, OIDC_AUTH_TIMEOUT_MS);

  const address = await new Promise<ReturnType<typeof server.address>>((resolve, reject) => {
    server.once("listening", () => resolve(server.address()));
    server.once("error", reject);
    server.listen(0, "127.0.0.1");
  });
  if (!address || typeof address === "string") {
    safeCloseServer(server);
    throw new Error("Could not start desktop sign-in callback server.");
  }

  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    waitForCode: () => waitForCode,
    close: () => {
      if (timeout) clearTimeout(timeout);
      safeCloseServer(server);
    },
    cancel: (message = "Browser sign-in cancelled.") => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      safeCloseServer(server);
      rejectCode(new Error(message));
    },
  };
}

function safeCloseServer(server: Server): void {
  try {
    server.close();
  } catch {
    // The callback server may already be closed by the success/error path.
  }
}

function successHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Login successful</title>
    <style>
      body { font: 16px "Segoe UI", "Open Sans", Arial, sans-serif; text-align: center; padding: 48px; color: #172033; }
      p { color: #536074; }
    </style>
  </head>
  <body>
    <h1>&#30331;&#24405;&#25104;&#21151;</h1>
    <p id="message">正在打开 OpenDrSai...</p>
    <p><a id="open-app" href="${OIDC_AUTH_COMPLETE_DEEP_LINK}">打开 OpenDrSai</a></p>
    <script>
      var message = document.getElementById("message");
      var openAppLink = document.getElementById("open-app");
      message.textContent = "正在打开 OpenDrSai，此页面随后会自动关闭。";
      function closePage() {
        window.close();
      }
      window.addEventListener("blur", closePage, { once: true });
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) closePage();
      });
      setTimeout(function () {
        window.location.href = openAppLink.href;
      }, 50);
      setTimeout(function () {
        message.textContent =
          "如果没有自动回到 OpenDrSai，可以点击“打开 OpenDrSai”，或手动关闭此标签页。";
      }, 1500);
    </script>
  </body>
</html>`;
}

function failureHtml(message: string): string {
  const safeMessage = message.replace(/[<>&"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
  })[char] || char);
  return `<!doctype html><title>Sign-in failed</title><body style="font:16px sans-serif;text-align:center;padding:48px"><h1>Sign-in failed</h1><p>${safeMessage}</p></body>`;
}
