import type { RuntimeErrorCategory, RuntimeErrorEnvelope, RuntimeRecoveryAction } from "./desktopApi";

const ACTIONS: Record<RuntimeErrorCategory, RuntimeRecoveryAction[]> = {
  binding: ["sync", "new_task", "diagnostics"],
  auth: ["login", "retry", "diagnostics"],
  transport: ["reconnect", "retry", "diagnostics"],
  contract: ["repair", "diagnostics"],
  model: ["select_model", "new_task", "diagnostics"],
  approval: ["retry", "diagnostics"],
  resource: ["remove_resource", "retry", "diagnostics"],
  history: ["sync", "retry", "diagnostics"],
  runtime: ["retry", "repair", "diagnostics"],
  backend: ["retry", "diagnostics"],
  unknown: ["diagnostics"],
};
const EXPLICIT_ACTIONS = new Set<RuntimeRecoveryAction>([
  ...Object.values(ACTIONS).flat(), "continue", "redo", "abandon",
]);

export function runtimeErrorCategory(code: string): RuntimeErrorCategory {
  const value = code.toLowerCase();
  if (["binding", "resume_required", "session_recovery", "session_model", "session_workspace"].some((part) => value.includes(part))) return "binding";
  if (["auth", "token", "logged_in", "permission_denied"].some((part) => value.includes(part))) return "auth";
  if (value.includes("approval")) return "approval";
  if (["resource", "attachment", "workspace_escape", "disk_", "path_"].some((part) => value.includes(part))) return "resource";
  if (["history", "cursor", "snapshot"].some((part) => value.includes(part))) return "history";
  if (value.includes("model")) return "model";
  if (["connection", "transport", "eof", "timeout", "network", "bridge"].some((part) => value.includes(part))) return "transport";
  if (["contract", "schema", "protocol", "jsonrpc", "jsonl", "response_invalid"].some((part) => value.includes(part))) return "contract";
  if (["runtime", "gateway", "run_"].some((part) => value.includes(part))) return "runtime";
  return code ? "backend" : "unknown";
}

export function normalizeRuntimeErrorEnvelope(error: unknown): RuntimeErrorEnvelope {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const nested = record.envelope && typeof record.envelope === "object"
    ? record.envelope as Record<string, unknown> : record;
  const code = typeof nested.code === "string" ? nested.code
    : typeof record.code === "string" ? record.code : "unexpected_error";
  const candidateCategory = typeof nested.category === "string" ? nested.category : "";
  const category = candidateCategory in ACTIONS ? candidateCategory as RuntimeErrorCategory : runtimeErrorCategory(code);
  const retryable = nested.retryable === true || record.retryable === true;
  const suppliedActions = Array.isArray(nested.recovery_actions)
    ? nested.recovery_actions.filter((value): value is RuntimeRecoveryAction =>
      typeof value === "string" && EXPLICIT_ACTIONS.has(value as RuntimeRecoveryAction))
    : [];
  return {
    code,
    category,
    retryable,
    user_message_key: typeof nested.user_message_key === "string"
      ? nested.user_message_key : `errors.${category}.${code}`,
    recovery_actions: suppliedActions.length ? suppliedActions : ACTIONS[category].filter((value) => retryable || value !== "retry"),
    diagnostic_reference: typeof nested.diagnostic_reference === "string"
      ? nested.diagnostic_reference
      : typeof record.correlationId === "string" ? record.correlationId : "diag-unavailable",
    redacted_details: nested.redacted_details && typeof nested.redacted_details === "object"
      ? nested.redacted_details as Record<string, unknown> : {},
    ...(error instanceof Error ? { message: error.message } : {}),
  };
}
