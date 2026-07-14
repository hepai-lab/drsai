import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  AuthSession,
  DesktopA5ServiceGuidanceScenario,
  DesktopBootstrapBlocker,
  DesktopSsoPollResult,
  DesktopSsoStartResult,
  LoginRequest,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";

interface AuthContextValue {
  loading: boolean;
  loginBusy: boolean;
  logoutBusy: boolean;
  serviceBusy: boolean;
  serviceReady: boolean;
  serviceBlocker: DesktopBootstrapBlocker | null;
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
  retryBootstrap: () => Promise<boolean>;
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
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceReady, setServiceReady] = useState(false);
  const [serviceBlocker, setServiceBlocker] = useState<DesktopBootstrapBlocker | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function applyA5ServiceGuidanceScenario(scenario: DesktopA5ServiceGuidanceScenario): void {
    setSession(scenario.session);
    setServiceReady(false);
    setServiceBlocker(scenario.blocker);
    setMessage(scenario.message);
  }

  async function loadA5ServiceGuidanceScenario(): Promise<boolean> {
    const scenario = await desktopApi.getA5ServiceGuidanceScenario();
    if (!scenario) return false;
    applyA5ServiceGuidanceScenario(scenario);
    return true;
  }

  async function refresh(): Promise<void> {
    const next = await desktopApi.getAuthSession();
    setSession(next);
    if (next.authenticated) {
      if (next.authMode === "offline") {
        setServiceReady(true);
        setServiceBlocker(null);
        setMessage("Developer workspace unlocked.");
        return;
      }
      await retryBootstrap();
    }
  }

  async function retryBootstrap(): Promise<boolean> {
    setServiceBusy(true);
    try {
      const bootstrap = await desktopApi.bootstrapDesktop();
      setServiceReady(bootstrap.ready);
      setServiceBlocker(bootstrap.ready ? null : bootstrap.blocker ?? classifyBootstrapBlocker(bootstrap.message));
      setMessage(bootstrap.message);
      return bootstrap.ready;
    } catch (error) {
      setServiceReady(false);
      const nextMessage = error instanceof Error ? error.message : "OpenDrSai service preparation failed.";
      setServiceBlocker(classifyBootstrapBlocker(nextMessage));
      setMessage(nextMessage);
      return false;
    } finally {
      setServiceBusy(false);
    }
  }

  useEffect(() => {
    const unsubscribe = desktopApi.onAuthSessionInvalidated(() => {
      setSession(anonymousSession);
      setServiceReady(false);
      setServiceBlocker({
        kind: "auth_required",
        title: "Sign in required",
        message: "Your HepAI session is no longer valid. Sign in again before starting tasks.",
        retryable: false,
        canRepairRuntime: false,
        canSignInAgain: true,
        diagnosticCode: "auth-session-invalidated",
      });
      setMessage("Your HepAI session is no longer valid. Sign in again.");
    });
    loadA5ServiceGuidanceScenario()
      .then((handled) => {
        if (handled) return undefined;
        return refresh();
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Could not read sign-in state.");
        setSession(anonymousSession);
      })
      .finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  async function login(request: LoginRequest): Promise<boolean> {
    setLoginBusy(true);
    setMessage(null);
    try {
      const result = await desktopApi.login(request);
      setMessage(result.message);
      if (result.ok && result.session) {
        setSession(result.session);
        setServiceBlocker(null);
        if (result.session.authMode === "offline") {
          setServiceReady(true);
        }
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
    setMessage("Opening browser for HepAI sign-in...");
    try {
      const result = await desktopApi.startOidcLogin(request);
      if (result.ok && result.session) {
        setSession(result.session);
        return retryBootstrap();
      }
      setMessage(result.message);
      return false;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OIDC sign-in failed.");
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function cancelOidcLogin(): Promise<void> {
    setMessage("Cancelling browser sign-in...");
    try {
      const cancelled = await desktopApi.cancelOidcLogin();
      if (cancelled) {
        setMessage("Browser sign-in cancelled.");
        setLoginBusy(false);
      } else {
        setMessage("No browser sign-in is waiting to be cancelled.");
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
      setServiceReady(false);
      setServiceBlocker(null);
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
      serviceBusy,
      serviceReady,
      serviceBlocker,
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
      retryBootstrap,
      clearMessage: () => setMessage(null),
    }),
    [loading, loginBusy, logoutBusy, serviceBusy, serviceReady, serviceBlocker, message, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function classifyBootstrapBlocker(message: string): DesktopBootstrapBlocker {
  const raw = message.trim();
  if (/sign[- ]?in|oidc|auth|session|token/i.test(raw)) {
    return {
      kind: "auth_required",
      title: "Sign in required",
      message: "OpenDrSai needs a valid HepAI sign-in before it can prepare task services.",
      retryable: false,
      canRepairRuntime: false,
      canSignInAgain: true,
      diagnosticCode: "auth-required",
    };
  }
  if (/no available|permission|forbidden|cannot use|not authorized|unauthorized|account/i.test(raw)) {
    return {
      kind: "permission_denied",
      title: "Account has no available service",
      message: "This account does not currently have permission to use a DrSai model service.",
      retryable: true,
      canRepairRuntime: false,
      canSignInAgain: true,
      diagnosticCode: "account-service-unavailable",
    };
  }
  if (/runtime|install|repair|python|drsai-cli|backend/i.test(raw)) {
    return {
      kind: "runtime_missing",
      title: "Local runtime needs repair",
      message: "The local runtime required to run tasks is missing or needs repair.",
      retryable: true,
      canRepairRuntime: true,
      canSignInAgain: false,
      diagnosticCode: "runtime-check-required",
    };
  }
  return {
    kind: "service_unavailable",
    title: "Local service is not available",
    message: "OpenDrSai could not start or reach the local task service. No task was sent.",
    retryable: true,
    canRepairRuntime: false,
    canSignInAgain: false,
    diagnosticCode: "service-unavailable",
  };
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}
