export type MobileRemoteDiagnosticState = "ok" | "failed" | "unknown";
export type MobileRemoteRepairAction =
  | "none"
  | "start_runtime"
  | "sign_in"
  | "retry_relay"
  | "repair_device_identity"
  | "reconnect_runtime"
  | "update_runtime"
  | "enable_notifications";

export interface MobileRemoteDiagnosticInput {
  runtime: MobileRemoteDiagnosticState;
  relay: MobileRemoteDiagnosticState;
  oidc: MobileRemoteDiagnosticState;
  device_proof: MobileRemoteDiagnosticState;
  wss: MobileRemoteDiagnosticState;
  heartbeat: MobileRemoteDiagnosticState;
  protocol: MobileRemoteDiagnosticState;
  push: MobileRemoteDiagnosticState;
}

export interface MobileRemoteDiagnosticResult {
  status: "healthy" | "action_required";
  action: MobileRemoteRepairAction;
  checks: MobileRemoteDiagnosticInput;
}

export interface MobileRemoteDiagnosticPackage {
  schema_version: "opendrsai.mobile-remote-diagnostic/1";
  status: MobileRemoteDiagnosticResult["status"];
  action: MobileRemoteRepairAction;
  checks: MobileRemoteDiagnosticInput;
}

/** Returns exactly one user action, ordered by the first boundary to repair. */
export function classifyMobileRemoteDiagnostics(
  checks: MobileRemoteDiagnosticInput,
): MobileRemoteDiagnosticResult {
  const action: MobileRemoteRepairAction = checks.runtime === "failed" ? "start_runtime"
    : checks.oidc === "failed" ? "sign_in"
      : checks.device_proof === "failed" ? "repair_device_identity"
        : checks.relay === "failed" ? "retry_relay"
          : checks.protocol === "failed" ? "update_runtime"
            : checks.wss === "failed" || checks.heartbeat === "failed" ? "reconnect_runtime"
              : checks.push === "failed" ? "enable_notifications"
                : "none";
  return { status: action === "none" ? "healthy" : "action_required", action, checks: { ...checks } };
}

/** A deliberately content-free package safe to copy into a support request. */
export function buildMobileRemoteDiagnosticPackage(
  result: MobileRemoteDiagnosticResult,
): MobileRemoteDiagnosticPackage {
  return {
    schema_version: "opendrsai.mobile-remote-diagnostic/1",
    status: result.status,
    action: result.action,
    checks: { ...result.checks },
  };
}
