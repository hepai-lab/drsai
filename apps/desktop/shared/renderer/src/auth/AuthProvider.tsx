import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  AuthSession,
  DesktopA5ServiceGuidanceScenario,
  DesktopBootstrapBlocker,
  LoginRequest,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import { LatestOperationGate } from "./latestOperationGate";

interface AuthContextValue {
  loading: boolean;
  loginBusy: boolean;
  logoutBusy: boolean;
  serviceBusy: boolean;
  serviceReady: boolean;
  serviceBlocker: DesktopBootstrapBlocker | null;
  loginFailed: boolean;
  message: string | null;
  session: AuthSession;
  login: (request: LoginRequest) => Promise<boolean>;
  startOidcLogin: (request?: { rememberMe?: boolean }) => Promise<boolean>;
  cancelOidcLogin: () => Promise<void>;
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

// Backoff for automatic service_unavailable retries. The desktop Gateway may
// need tens of seconds on a cold start (Python imports, model catalog), so a
// bounded exponential schedule replaces the old 2-attempt policy that left
// the UI stuck on "unavailable" while the backend was actually coming up.
const SERVICE_UNAVAILABLE_RETRY_DELAYS_MS = [4_000, 8_000, 15_000, 30_000, 30_000, 60_000];

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<AuthSession>(anonymousSession);
  const [loading, setLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceReady, setServiceReady] = useState(false);
  const [serviceBlocker, setServiceBlocker] = useState<DesktopBootstrapBlocker | null>(null);
  const serviceRetryCountRef = useRef(0);
  const [loginFailed, setLoginFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const bootstrapGateRef = useRef(new LatestOperationGate<boolean>());
  const initialLoadPromiseRef = useRef<Promise<void> | null>(null);

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

  function refresh(): Promise<void> {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const operation = (async () => {
      const next = await desktopApi.getAuthSession();
      setSession(next);
      if (next.authenticated) {
        if (next.authMode === "offline") {
          setServiceReady(true);
          setServiceBlocker(null);
          setMessage("Developer workspace unlocked.");
          return;
        }
        // The main screen performs the real Runtime/service readiness check.
        // Keep this false until bootstrap has reached an explicit terminal state.
        setServiceReady(false);
        setServiceBlocker(null);
      }
    })();
    refreshPromiseRef.current = operation;
    const clear = (): void => {
      if (refreshPromiseRef.current === operation) refreshPromiseRef.current = null;
    };
    void operation.then(clear, clear);
    return operation;
  }

  function retryBootstrap(): Promise<boolean> {
    const gate = bootstrapGateRef.current;
    if (gate.current) return gate.current;
    setServiceBusy(true);
    const ticket = gate.start(async (isCurrent) => {
      try {
        const bootstrap = await desktopApi.bootstrapDesktop();
        if (!isCurrent()) return bootstrap.ready;
        setServiceReady(bootstrap.ready);
        setServiceBlocker(bootstrap.ready ? null : bootstrap.blocker ?? classifyBootstrapBlocker(bootstrap.message));
        setMessage(bootstrap.message);
        if (bootstrap.ready) serviceRetryCountRef.current = 0;
        return bootstrap.ready;
      } catch (error) {
        if (!isCurrent()) return false;
        setServiceReady(false);
        const nextMessage = error instanceof Error ? error.message : "OpenDrSai service preparation failed.";
        setServiceBlocker(classifyBootstrapBlocker(nextMessage));
        setMessage(nextMessage);
        return false;
      }
    });
    const clear = (): void => {
      if (ticket.release()) setServiceBusy(false);
    };
    void ticket.promise.then(clear, clear);
    return ticket.promise;
  }

  function adoptSession(next: AuthSession): void {
    // A session change replaces any bootstrap for the previous identity. The
    // stale operation may still finish in main, but it can no longer publish
    // state or clear the busy flag of the replacement operation.
    bootstrapGateRef.current.invalidate();
    serviceRetryCountRef.current = 0;
    setServiceBusy(false);
    setServiceReady(next.authenticated && next.authMode === "offline");
    setServiceBlocker(null);
    setSession(next);
  }

  function loadInitialSession(): Promise<void> {
    if (initialLoadPromiseRef.current) return initialLoadPromiseRef.current;
    const operation = (async () => {
      const handled = await loadA5ServiceGuidanceScenario();
      if (!handled) await refresh();
    })().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Could not read sign-in state.");
      setSession(anonymousSession);
    });
    const tracked = operation.finally(() => setLoading(false));
    initialLoadPromiseRef.current = tracked;
    return tracked;
  }

  useEffect(() => {
    const unsubscribe = desktopApi.onAuthSessionInvalidated(() => {
      bootstrapGateRef.current.invalidate();
      serviceRetryCountRef.current = 0;
      setServiceBusy(false);
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
    void loadInitialSession();
    return unsubscribe;
  }, []);

  // When the main process signals that the auth session has been restored
  // (e.g. after a deep-link OIDC re-login), reload the session from the main
  // process so that session.authenticated becomes true.  This effect must only
  // synchronize session state: the auto-bootstrap useEffect below already sees
  // the resulting `session.authenticated` change and drives retryBootstrap().
  //
  // The initiating window does not receive this event; it consumes the login
  // IPC result directly. Other windows adopt the restored session as a new
  // generation and replace any bootstrap belonging to the previous identity.
  useEffect(() => {
    const unsubscribe = desktopApi.onAuthSessionRestored(async () => {
      try {
        const next = await desktopApi.getAuthSession();
        adoptSession(next);
      } catch {
        // If session reload fails, the user can still retry manually.
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (
      !session.authenticated ||
      session.authMode === "offline" ||
      serviceReady ||
      serviceBusy ||
      serviceBlocker
    ) {
      return;
    }
    void retryBootstrap();
  }, [
    serviceBlocker,
    serviceBusy,
    serviceReady,
    session.authMode,
    session.authenticated,
  ]);

  useEffect(() => {
    if (
      !session.authenticated ||
      session.authMode === "offline" ||
      serviceReady ||
      serviceBusy ||
      !serviceBlocker ||
      serviceBlocker.kind !== "service_unavailable"
    ) {
      return undefined;
    }
    const count = serviceRetryCountRef.current;
    if (count >= SERVICE_UNAVAILABLE_RETRY_DELAYS_MS.length) {
      // Backoff window exhausted — the blocker stays visible with a manual
      // recovery affordance instead of an endless silent retry loop.
      return undefined;
    }
    const delay = SERVICE_UNAVAILABLE_RETRY_DELAYS_MS[count] ?? 30_000;
    const timer = window.setTimeout(() => {
      serviceRetryCountRef.current = count + 1;
      void retryBootstrap();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    serviceBlocker?.kind,
    serviceBusy,
    serviceReady,
    session.authMode,
    session.authenticated,
  ]);

  async function login(request: LoginRequest): Promise<boolean> {
    setLoginBusy(true);
    setLoginFailed(false);
    setMessage(null);
    try {
      const result = await desktopApi.login(request);
      setMessage(result.message);
      if (result.ok && result.session) {
        setLoginFailed(false);
        adoptSession(result.session);
        return true;
      }
      setLoginFailed(true);
      console.error("[auth] Sign-in failed:", result.message);
      return false;
    } catch (error) {
      setLoginFailed(true);
      console.error("[auth] Sign-in failed:", error);
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function startOidcLogin(request?: { rememberMe?: boolean }): Promise<boolean> {
    setLoginBusy(true);
    setLoginFailed(false);
    setMessage("Opening browser for HepAI sign-in...");
    try {
      const result = await desktopApi.startOidcLogin(request);
      if (result.ok && result.session) {
        setLoginFailed(false);
        adoptSession(result.session);
        return true;
      }
      const cancelled = /cancel/i.test(result.message);
      setLoginFailed(!cancelled);
      if (!cancelled) console.error("[auth] HepAI sign-in failed:", result.message);
      setMessage(result.message);
      return false;
    } catch (error) {
      setLoginFailed(true);
      console.error("[auth] HepAI sign-in failed:", error);
      setMessage(error instanceof Error ? error.message : "OIDC sign-in failed.");
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function cancelOidcLogin(): Promise<void> {
    setLoginFailed(false);
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


  async function logout(clearLocalData = false): Promise<void> {
    setLogoutBusy(true);
    setLoginFailed(false);
    setMessage(null);
    try {
      const result = await desktopApi.logout({ clearLocalData });
      setMessage(result.message);
      adoptSession(anonymousSession);
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
      loginFailed,
      message,
      session,
      login,
      startOidcLogin,
      cancelOidcLogin,
      logout,
      refresh,
      retryBootstrap,
      clearMessage: () => {
        setLoginFailed(false);
        setMessage(null);
      },
    }),
    [loading, loginBusy, logoutBusy, serviceBusy, serviceReady, serviceBlocker, loginFailed, message, session],
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
      message: "This account does not currently have permission to use an OpenDrSai model service.",
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
