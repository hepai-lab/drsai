import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createHash, randomUUID } from "crypto";
import { dirname, join } from "path";
import { is } from "@electron-toolkit/utils";
import type {
  AuthSession,
  DesktopSsoPollResult,
  DesktopSsoStartResult,
  LoginRequest,
  LoginResult,
  LogoutOptions,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { saveApiKey } from "./settings";

const AUTH_SESSION_FILE = join(DRSAI_HOME, "auth", "session.json");
const SESSION_DAYS = 30;
const MAX_EMAIL_CHARS = 254;
const MAX_PASSWORD_CHARS = 1024;
const MAX_API_KEY_CHARS = 4096;
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DESKTOP_AUTH_BASE_URL =
  process.env.OPENDRSAI_AUTH_BASE_URL?.replace(/\/+$/, "") ||
  "https://opendrsai.ihep.ac.cn";

interface StoredAuthSession extends AuthSession {
  sessionId: string;
  createdAt: string;
  accessToken?: string;
  refreshToken?: string;
}

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
  if (refreshedSso.authMode === "sso") {
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

export function login(rawRequest: unknown): LoginResult {
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

  if (request.apiKey) {
    const saveResult = saveApiKey(request.apiKey);
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

export function logout(rawOptions?: unknown): { ok: boolean; message: string } {
  const options = normalizeLogoutOptions(rawOptions);
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

  return { email, password, apiKey, developerBypass, rememberMe };
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
    authProvider?: "ihep" | "wechat" | "local" | null;
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
  if (!existsSync(AUTH_SESSION_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(AUTH_SESSION_FILE, "utf8")) as StoredAuthSession;
    if (!parsed.authenticated || !parsed.user || !parsed.expiresAt || !parsed.sessionId) {
      return null;
    }
    return parsed;
  } catch {
    clearStoredSession(false);
    return null;
  }
}

function writeStoredSession(session: StoredAuthSession): void {
  mkdirSync(dirname(AUTH_SESSION_FILE), { recursive: true });
  writeFileSync(AUTH_SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
}

function clearStoredSession(clearLocalData: boolean): void {
  try {
    if (clearLocalData) {
      rmSync(dirname(AUTH_SESSION_FILE), { recursive: true, force: true });
    } else if (existsSync(AUTH_SESSION_FILE)) {
      rmSync(AUTH_SESSION_FILE, { force: true });
    }
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

function readPayloadMessage(payload: { message?: string; detail?: string }, fallback: string): string {
  return payload.detail || payload.message || fallback;
}

function formatPollState(state: "pending" | "expired" | "cancelled"): string {
  if (state === "pending") return "Waiting for browser sign-in...";
  if (state === "expired") return "Desktop sign-in expired.";
  return "Desktop sign-in cancelled.";
}

function getJwtExpiry(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { exp?: number };
    return typeof parsed.exp === "number" ? new Date(parsed.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

async function refreshSsoSessionIfNeeded(
  stored: StoredAuthSession,
  force: boolean,
): Promise<StoredAuthSession | null> {
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
