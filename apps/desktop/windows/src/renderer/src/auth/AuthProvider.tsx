import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AuthSession, DesktopSsoPollResult, DesktopSsoStartResult, LoginRequest } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";

interface AuthContextValue {
  loading: boolean;
  loginBusy: boolean;
  logoutBusy: boolean;
  message: string | null;
  session: AuthSession;
  login: (request: LoginRequest) => Promise<boolean>;
  startOidcLogin: (request?: { rememberMe?: boolean }) => Promise<boolean>;
  cancelOidcLogin: () => Promise<void>;
  startDesktopSsoLogin: () => Promise<DesktopSsoStartResult>;
  startWechatDesktopLogin: () => Promise<DesktopSsoStartResult>;
  pollDesktopSsoLogin: (deviceCode: string) => Promise<DesktopSsoPollResult>;
  cancelDesktopSsoLogin: (deviceCode: string) => Promise<void>;
  logout: (clearLocalData?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  clearMessage: () => void;
}

const anonymousSession: AuthSession = {
  authenticated: false,
  user: null,
  expiresAt: null,
  authMode: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<AuthSession>(anonymousSession);
  const [loading, setLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const next = await desktopApi.getAuthSession();
    setSession(next);
  }

  useEffect(() => {
    refresh()
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Could not read sign-in state.");
        setSession(anonymousSession);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(request: LoginRequest): Promise<boolean> {
    setLoginBusy(true);
    setMessage(null);
    try {
      const result = await desktopApi.login(request);
      setMessage(result.message);
      if (result.ok && result.session) {
        setSession(result.session);
        return true;
      }
      return false;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function startOidcLogin(request?: { rememberMe?: boolean }): Promise<boolean> {
    setLoginBusy(true);
    setMessage(null);
    try {
      const result = await desktopApi.startOidcLogin(request);
      setMessage(result.message);
      if (result.ok && result.session) {
        setSession(result.session);
        return true;
      }
      return false;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OIDC sign-in failed.");
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function cancelOidcLogin(): Promise<void> {
    try {
      const cancelled = await desktopApi.cancelOidcLogin();
      if (cancelled) {
        setMessage("Browser sign-in cancelled.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel browser sign-in.");
    }
  }

  async function startDesktopSsoLogin(): Promise<DesktopSsoStartResult> {
    return startDesktopLogin(() => desktopApi.startDesktopSsoLogin(), "Failed to start SSO login.");
  }

  async function startWechatDesktopLogin(): Promise<DesktopSsoStartResult> {
    return startDesktopLogin(() => desktopApi.startWechatDesktopLogin(), "Failed to start WeChat login.");
  }

  async function startDesktopLogin(
    start: () => Promise<DesktopSsoStartResult>,
    fallback: string,
  ): Promise<DesktopSsoStartResult> {
    setLoginBusy(true);
    setMessage(null);
    try {
      const result = await start();
      setMessage(result.message);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : fallback;
      setMessage(message);
      return { ok: false, message };
    } finally {
      setLoginBusy(false);
    }
  }

  async function pollDesktopSsoLogin(deviceCode: string): Promise<DesktopSsoPollResult> {
    try {
      const result = await desktopApi.pollDesktopSsoLogin(deviceCode);
      setMessage(result.message);
      if (result.ok && result.state === "authorized" && result.session) {
        setSession(result.session);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "SSO login failed.";
      setMessage(message);
      return { ok: false, state: "error", message };
    }
  }

  async function cancelDesktopSsoLogin(deviceCode: string): Promise<void> {
    try {
      await desktopApi.cancelDesktopSsoLogin(deviceCode);
    } catch {
      // Best effort; the ticket will expire server-side.
    }
  }

  async function logout(clearLocalData = false): Promise<void> {
    setLogoutBusy(true);
    setMessage(null);
    try {
      const result = await desktopApi.logout({ clearLocalData });
      setMessage(result.message);
      setSession(anonymousSession);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-out failed.");
    } finally {
      setLogoutBusy(false);
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      loginBusy,
      logoutBusy,
      message,
      session,
      login,
      startOidcLogin,
      cancelOidcLogin,
      startDesktopSsoLogin,
      startWechatDesktopLogin,
      pollDesktopSsoLogin,
      cancelDesktopSsoLogin,
      logout,
      refresh,
      clearMessage: () => setMessage(null),
    }),
    [loading, loginBusy, logoutBusy, message, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}
