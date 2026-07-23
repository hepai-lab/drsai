import type { AgentRunEvent, DesktopFailureRecovery, DesktopPendingApproval } from "./desktopApi";

export interface BackendRuntimeEvent {
  event_id: string;
  run_id: string;
  sequence: number;
  type: string;
  created_at?: string;
  data: Record<string, unknown>;
}

export interface AgentRunPresentationContext {
  requestId: string;
  sessionId: string;
  runId: string;
}

/** Projects every Backend into the existing Agent Run event model. */
export function projectBackendEvent(event: BackendRuntimeEvent, context: AgentRunPresentationContext): AgentRunEvent[] {
  const base = { requestId: context.requestId, sessionId: context.sessionId, runId: context.runId };
  const content = typeof event.data.content === "string" ? event.data.content : "";
  if (event.type === "agent.message.delta") return [{ ...base, type: "chunk", content }];
  if (event.type === "agent.completed" || event.type === "run.completed") return [{ ...base, type: "done", content }];
  if (event.type === "run.cancelled") return [{ ...base, type: "aborted" }];
  if (event.type === "agent.failed" || event.type === "run.failed") {
    const error = asRecord(event.data.error);
    return [{ ...base, type: "error", error: String(error?.message ?? event.data.message ?? "Agent Backend failed."),
      failureRecovery: backendFailureRecovery(String(error?.code ?? event.data.code ?? "backend_fault")) }];
  }
  if (event.type === "item.file_change" || event.type === "item.patch") {
    const path = String(event.data.path ?? event.data.target ?? "unknown");
    return [{ ...base, type: "file_event", fileEvent: { action: event.type === "item.patch" ? "patch" : "modify", path,
      diff: typeof event.data.diff === "string" ? event.data.diff : undefined, source: "agent_backend" } }];
  }
  if (event.type.startsWith("item.") || event.type.startsWith("tool.")) {
    return [{ ...base, type: "status", content: String(event.data.summary ?? event.data.operation ?? event.type) }];
  }
  return [];
}

/** Reuses Approval Center; no Codex-specific approval collection exists. */
export function projectBackendApproval(event: BackendRuntimeEvent): DesktopPendingApproval | null {
  if (event.type !== "audit.codex.approval.requested") return null;
  const operation = String(event.data.operation ?? "Agent Backend operation");
  const request = asRecord(event.data.request) ?? {};
  const path = String(request.path ?? request.cwd ?? request.itemId ?? "current workspace");
  const command = typeof request.command === "string" ? request.command : undefined;
  const isCommand = operation.includes("commandExecution");
  return {
    id: String(event.data.approval_id ?? event.event_id), source: isCommand ? "shell" : "workspace",
    actionKind: isCommand ? "shell.command" : "workspace.revert",
    title: isCommand ? "Codex command approval" : "Codex workspace change approval",
    detail: String(request.reason ?? `${operation} requires review.`),
    businessAction: operation, businessObject: path, target: command ?? path,
    scope: `${event.data.workspace_id ?? "workspace"} / ${event.data.run_id ?? event.run_id}`,
    impact: isCommand ? "May execute a process in this Workspace." : "May modify files in this Workspace.",
    createdAt: event.created_at ?? new Date(0).toISOString(), risk: isCommand ? "high" : "medium",
    taskId: String(event.data.run_id ?? event.run_id), actionId: String(event.data.turn_id ?? ""),
  };
}

export function backendFailureRecovery(code: string): DesktopFailureRecovery {
  const auth = ["token_expired", "not_logged_in", "codex_not_logged_in"].includes(code);
  const incompatible = code.includes("incompatible") || code.includes("version") || code.includes("schema");
  const crashed = code.includes("connection") || code.includes("app_server") || code.includes("backend_fault");
  const kind = auth ? "permission_denied" : incompatible || crashed ? "external_service" : "unexpected";
  const message = auth ? "Sign in to Codex, then start a new Run."
      : incompatible ? "Install a compatible managed Codex version."
      : crashed ? "Restart the Codex Backend and retry from durable Runtime Events."
      : "Review the Runtime diagnostic and retry if safe.";
  return {
    kind,
    attempts: 1,
    retryLimit: crashed || auth ? 3 : 1,
    retryable: auth || crashed,
    exhausted: !auth && !crashed,
    escalationLevel: incompatible ? "administrator" : "user_action",
    reason: code,
    affectedObject: "Codex Agent Backend Run",
    suggestedAction: message,
    recoveryAction: "retry",
    message,
  };
}

export function backendRetryIdentity(operationState: "pending" | "response_received" | "unknown" | "bound", priorKey: string): { reuseKey: boolean; idempotencyKey: string | null } {
  if (operationState === "unknown") return { reuseKey: false, idempotencyKey: null };
  return { reuseKey: true, idempotencyKey: priorKey };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
