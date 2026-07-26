import { getServerUrl } from "../components/utils";

const TOKEN_KEY = "token";
const USER_EMAIL_KEY = "user_email";
const LEGACY_KEYS = ["username", "user_name"] as const;

/** Refresh access token this many ms before JWT exp (production SSO). */
const REFRESH_BUFFER_MS = 2 * 60 * 1000;
/** Fallback interval when JWT exp cannot be parsed (30 min access token − buffer). */
const FALLBACK_REFRESH_MS = 28 * 60 * 1000;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshLoopStarted = false;

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

export type AuthVerifyResult =
  | { ok: true; userEmail: string; accessToken: string }
  | { ok: false };

/** Use httpOnly refresh-token cookie to obtain a new access token (SSO production). */
export async function refreshAccessToken(): Promise<AuthVerifyResult> {
  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    return { ok: false };
  }

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
}

/** Validate Bearer token; refresh via cookie when expired or missing access token. */
export async function verifyAuthSession(): Promise<AuthVerifyResult> {
  const token = getAuthToken();
  if (!token) {
    const refreshed = await refreshAccessToken();
    return refreshed.ok ? refreshed : { ok: false };
  }

  let meResponse: Response;
  try {
    meResponse = await fetch(`${getServerUrl()}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
  } catch {
    clearAuthSession();
    return { ok: false };
  }

  if (meResponse.ok) {
    const payload = await meResponse.json();
    const userEmail =
      (payload?.data?.user_id as string | undefined) || getUserEmail();
    if (!userEmail) {
      clearAuthSession();
      return { ok: false };
    }
    saveAuthSession(token, userEmail);
    return { ok: true, userEmail, accessToken: token };
  }

  if (meResponse.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed.ok) {
      return refreshed;
    }
  }

  clearAuthSession();
  return { ok: false };
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
