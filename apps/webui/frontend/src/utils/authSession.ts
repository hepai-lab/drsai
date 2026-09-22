import { apiFetch, getServerUrl } from "../components/utils";

const TOKEN_KEY = "token";
const USER_EMAIL_KEY = "user_email";
const LEGACY_KEYS = ["username", "user_name"] as const;

export type AuthVerifyResult =
  | { ok: true; userEmail: string; accessToken: string; displayName?: string }
  | { ok: false };

/** Refresh access token this many ms before JWT exp (production SSO). */
const REFRESH_BUFFER_MS = 2 * 60 * 1000;
/** Fallback interval when JWT exp cannot be parsed (30 min access token − buffer). */
const FALLBACK_REFRESH_MS = 28 * 60 * 1000;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshLoopStarted = false;
let verifyInFlight: Promise<AuthVerifyResult> | null = null;
let refreshInFlight: Promise<AuthVerifyResult> | null = null;

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(USER_EMAIL_KEY);
}

function cancelAuthRefreshSchedule(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function decodeTokenExpiryMs(token: string): number | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const payload = JSON.parse(
      atob(segment.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Schedule silent refresh via httpOnly cookie before access token expires. */
export function scheduleAuthRefresh(accessToken: string): void {
  if (typeof window === "undefined") return;

  cancelAuthRefreshSchedule();
  const expMs = decodeTokenExpiryMs(accessToken);
  const delay =
    expMs != null
      ? Math.max(expMs - Date.now() - REFRESH_BUFFER_MS, 30_000)
      : FALLBACK_REFRESH_MS;

  refreshTimer = setTimeout(() => {
    void refreshAccessToken().then((result) => {
      if (result.ok) {
        scheduleAuthRefresh(result.accessToken);
      }
    });
  }, delay);
}

export function saveAuthSession(accessToken: string, userEmail: string): void {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(USER_EMAIL_KEY, userEmail);
  for (const key of LEGACY_KEYS) {
    window.localStorage.removeItem(key);
  }
  scheduleAuthRefresh(accessToken);
}

export function clearAuthSession(): void {
  cancelAuthRefreshSchedule();
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_EMAIL_KEY);
  for (const key of LEGACY_KEYS) {
    window.localStorage.removeItem(key);
  }
}

const DEFAULT_IHEP_LOGOUT_URL = "https://newlogin.ihep.ac.cn/logout/";

/** IHEP UMT logout. The browser must open this URL so the 10-day SSO cookie is sent and cleared. */
export function buildIhepLogoutUrl(returnTo?: string): string {
  const dest = returnTo ?? `${window.location.origin}/login?logout=1`;
  const configured = process.env.GATSBY_OIDC_IDP_LOGOUT_URL?.trim();
  const base = (configured || DEFAULT_IHEP_LOGOUT_URL).replace(/\/?$/, "/");
  const url = new URL(base);
  url.searchParams.set("WebServerURL", dest);
  return url.toString();
}

/**
 * Clear the local/app session, then send the browser to IHEP logout.
 * Navigate immediately so Gatsby cannot steal the route; fire-and-forget
 * the API call with keepalive so the refresh cookie is still cleared.
 */
export function logoutToIhepSso(): void {
  clearAuthSession();
  const dest = buildIhepLogoutUrl();
  void fetch(`${getServerUrl()}/auth/logout`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);
  window.location.replace(dest);
}

async function refreshAccessTokenOnce(): Promise<AuthVerifyResult> {
  try {
    const response = await apiFetch(`${getServerUrl()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      return { ok: false };
    }

    const payload = await response.json();
    const accessToken = payload?.data?.access_token as string | undefined;
    const userEmail = payload?.data?.user_id as string | undefined;
    if (!accessToken || !userEmail) {
      return { ok: false };
    }

    saveAuthSession(accessToken, userEmail);
    return { ok: true, userEmail, accessToken };
  } catch (err) {
    console.warn("refreshAccessToken: network error, skipping refresh", err);
    return { ok: false };
  }
}

/** Use httpOnly refresh-token cookie to obtain a new access token (SSO production). */
export async function refreshAccessToken(): Promise<AuthVerifyResult> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = refreshAccessTokenOnce().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Call the server to clear the httpOnly refresh-token cookie. */
export async function logoutRequest(): Promise<void> {
  try {
    await apiFetch(`${getServerUrl()}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Best-effort: even if the network call fails, localStorage is cleared
    // and the user is redirected away.
  }
}

function parseMePayload(payload: any, fallbackToken: string): AuthVerifyResult {
  const userEmail =
    (payload?.email as string | undefined) ||
    (payload?.sub as string | undefined) ||
    (payload?.data?.user_id as string | undefined) ||
    getUserEmail() ||
    undefined;
  if (!userEmail) {
    return { ok: false };
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(USER_EMAIL_KEY, userEmail);
  }
  return {
    ok: true,
    userEmail,
    accessToken: fallbackToken,
    displayName:
      (payload?.name as string | undefined) ||
      (payload?.data?.display_name as string | undefined) ||
      "",
  };
}

async function verifyAuthSessionOnce(): Promise<AuthVerifyResult> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let meResponse: Response;
  try {
    meResponse = await apiFetch(`${getServerUrl()}/auth/me`, {
      headers,
      credentials: "include",
    });
  } catch {
    if (!token) {
      return { ok: false };
    }
    const refreshed = await refreshAccessToken();
    return refreshed.ok ? refreshed : { ok: false };
  }

  if (meResponse.ok) {
    const payload = await meResponse.json();
    const parsed = parseMePayload(payload, token || "");
    if (!parsed.ok) {
      if (token) {
        clearAuthSession();
      }
      return { ok: false };
    }
    if (token) {
      saveAuthSession(token, parsed.userEmail);
    }
    return parsed;
  }

  if (meResponse.status === 401 && token) {
    const refreshed = await refreshAccessToken();
    if (refreshed.ok) {
      return refreshed;
    }
    clearAuthSession();
    return { ok: false };
  }

  return { ok: false };
}

/** Validate OIDC session cookie, then optional local JWT. Do not probe refresh without a token. */
export async function verifyAuthSession(): Promise<AuthVerifyResult> {
  if (verifyInFlight) {
    return verifyInFlight;
  }
  verifyInFlight = verifyAuthSessionOnce().finally(() => {
    verifyInFlight = null;
  });
  return verifyInFlight;
}

/**
 * Background SSO session maintenance: proactive refresh before expiry,
 * and re-validation when the tab becomes visible again.
 */
export function startAuthRefreshLoop(): void {
  if (typeof window === "undefined" || refreshLoopStarted) {
    return;
  }
  refreshLoopStarted = true;

  const token = getAuthToken();
  if (token) {
    scheduleAuthRefresh(token);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    void verifyAuthSession();
  });
}

export function stopAuthRefreshLoop(): void {
  cancelAuthRefreshSchedule();
  refreshLoopStarted = false;
}
