export type MobileRemoteDiagnosticState = "ok" | "failed" | "unknown";
export type MobileRemoteRepairAction =
  | "none"
  | "start_runtime"
  | "sign_in"
  | "retry_relay"
  | "reconnect_runtime"
  | "update_runtime";

export interface MobileRemoteDiagnosticInput {
  runtime: MobileRemoteDiagnosticState;
  relay: MobileRemoteDiagnosticState;
  oidc: MobileRemoteDiagnosticState;
  wss: MobileRemoteDiagnosticState;
  heartbeat: MobileRemoteDiagnosticState;
  protocol: MobileRemoteDiagnosticState;
}

export interface MobileRemoteDiagnosticResult {
  status: "healthy" | "action_required";
  action: MobileRemoteRepairAction;
  checks: MobileRemoteDiagnosticInput;
}

/** Returns exactly one user action, ordered by the first boundary to repair. */
export function classifyMobileRemoteDiagnostics(
  checks: MobileRemoteDiagnosticInput,
): MobileRemoteDiagnosticResult {
  const action: MobileRemoteRepairAction = checks.runtime !== "ok" ? "start_runtime"
    : checks.oidc !== "ok" ? "sign_in"
      : checks.relay !== "ok" ? "retry_relay"
        : checks.protocol !== "ok" ? "update_runtime"
          : checks.wss !== "ok" || checks.heartbeat !== "ok" ? "reconnect_runtime"
            : "none";
  return { status: action === "none" ? "healthy" : "action_required", action, checks: { ...checks } };
}
