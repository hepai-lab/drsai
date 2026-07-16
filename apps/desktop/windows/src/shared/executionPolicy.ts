export type ExecutionPolicyMode = "read_only" | "confirm_each" | "auto_execute";

export type ExecutionActionKind =
  | "chat.model_call"
  | "browser.read"
  | "browser.interact"
  | "browser.sensitive_interact"
  | "workspace.read"
  | "workspace.diff"
  | "workspace.stage"
  | "workspace.revert"
  | "workspace.checkpoint"
  | "terminal.create"
  | "terminal.write"
  | "shell.command"
  | "git.commit"
  | "fork.lifecycle"
  | "fork.queue_start"
  | "workflow.run"
  | "network.request"
  | "external.service";

export interface ExecutionPolicyConfig {
  mode: ExecutionPolicyMode;
  workspaceTrusted: boolean;
  networkEnabled: boolean;
  shellEnabled: boolean;
  externalServicesEnabled: boolean;
  commitEnabled: boolean;
  dangerousAllowed: boolean;
  toolAllowlist: string[];
  toolDenylist: string[];
}

export interface ExecutionPermissionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  mode: ExecutionPolicyMode;
  reason: string;
}

export interface ExecutionPolicySourceConfig {
  mode?: ExecutionPolicyMode;
  plan_mode?: boolean;
  workspace_enabled?: boolean;
  dangerous_allowed?: boolean;
}

export type ExecutionActionRisk = "low" | "medium" | "high";

const EXECUTION_ACTION_RISKS: Record<ExecutionActionKind, ExecutionActionRisk> = {
  "chat.model_call": "low",
  "browser.read": "low",
  "browser.interact": "medium",
  "browser.sensitive_interact": "high",
  "workspace.read": "low",
  "workspace.diff": "low",
  "workspace.stage": "medium",
  "workspace.revert": "high",
  "workspace.checkpoint": "low",
  "terminal.create": "medium",
  "terminal.write": "medium",
  "shell.command": "high",
  "git.commit": "high",
  "fork.lifecycle": "high",
  "fork.queue_start": "high",
  "workflow.run": "high",
  "network.request": "medium",
  "external.service": "high",
};

const READ_ONLY_ACTIONS = new Set<ExecutionActionKind>([
  "chat.model_call",
  "browser.read",
  "workspace.read",
  "workspace.diff",
  "workspace.checkpoint",
]);

const NETWORK_ACTIONS = new Set<ExecutionActionKind>([
  "chat.model_call",
  "browser.read",
  "browser.interact",
  "browser.sensitive_interact",
  "network.request",
  "external.service",
]);

const SHELL_ACTIONS = new Set<ExecutionActionKind>([
  "terminal.create",
  "terminal.write",
  "shell.command",
]);

const COMMIT_ACTIONS = new Set<ExecutionActionKind>(["git.commit"]);

const DANGEROUS_ACTIONS = new Set<ExecutionActionKind>([
  "browser.sensitive_interact",
  "workspace.revert",
  "shell.command",
  "git.commit",
  "fork.lifecycle",
  "fork.queue_start",
  "workflow.run",
  "external.service",
]);

export function createExecutionPolicy(
  source: ExecutionPolicySourceConfig = {},
): ExecutionPolicyConfig {
  const workspaceTrusted = source.workspace_enabled !== false;
  const dangerousAllowed = source.dangerous_allowed === true;
  return {
    mode: source.mode ?? (source.plan_mode ? "read_only" : "confirm_each"),
    workspaceTrusted,
    networkEnabled: true,
    shellEnabled: workspaceTrusted,
    externalServicesEnabled: dangerousAllowed,
    commitEnabled: dangerousAllowed,
    dangerousAllowed,
    toolAllowlist: [],
    toolDenylist: [],
  };
}

export function evaluateExecutionPermission(
  action: ExecutionActionKind,
  policy: ExecutionPolicyConfig = createExecutionPolicy(),
): ExecutionPermissionDecision {
  if (policy.toolDenylist.includes(action)) {
    return deny(policy, "Action is denied by the tool denylist.");
  }
  if (policy.toolAllowlist.length > 0 && !policy.toolAllowlist.includes(action)) {
    return deny(policy, "Action is not present in the tool allowlist.");
  }
  if (!policy.workspaceTrusted && action.startsWith("workspace.")) {
    return deny(policy, "Workspace actions require a trusted workspace.");
  }
  if (NETWORK_ACTIONS.has(action) && !policy.networkEnabled) {
    return deny(policy, "Network access is disabled by the execution policy.");
  }
  if (SHELL_ACTIONS.has(action) && !policy.shellEnabled) {
    return deny(policy, "Shell and terminal access are disabled by the execution policy.");
  }
  if (COMMIT_ACTIONS.has(action) && !policy.commitEnabled) {
    return deny(policy, "Git commit actions require commit authorization.");
  }
  if (action === "external.service" && !policy.externalServicesEnabled) {
    return deny(policy, "External service calls require service authorization.");
  }
  if (policy.mode === "read_only" && !READ_ONLY_ACTIONS.has(action)) {
    return deny(policy, "Read-only mode blocks actions with side effects.");
  }

  const sensitive = DANGEROUS_ACTIONS.has(action);
  if (sensitive && !policy.dangerousAllowed) {
    return approve(policy, true, "Sensitive actions require explicit approval.");
  }
  if (policy.mode === "confirm_each" && getExecutionActionRisk(action) !== "low") {
    return approve(policy, true, "Confirm-each mode requires approval for side effects.");
  }
  return approve(policy, false, "Action is allowed by the current execution policy.");
}

export function getExecutionActionRisk(action: ExecutionActionKind): ExecutionActionRisk {
  return EXECUTION_ACTION_RISKS[action];
}

export function describeExecutionPolicyMode(policy: ExecutionPolicyConfig): string {
  const boundaries = [
    `mode=${policy.mode}`,
    `workspace=${policy.workspaceTrusted ? "trusted" : "untrusted"}`,
    `network=${policy.networkEnabled ? "enabled" : "disabled"}`,
    `shell=${policy.shellEnabled ? "enabled" : "disabled"}`,
    `external=${policy.externalServicesEnabled ? "enabled" : "confirm/disabled"}`,
    `commit=${policy.commitEnabled ? "enabled" : "confirm/disabled"}`,
  ];
  return boundaries.join(", ");
}

function deny(
  policy: ExecutionPolicyConfig,
  reason: string,
): ExecutionPermissionDecision {
  return {
    allowed: false,
    requiresApproval: false,
    mode: policy.mode,
    reason,
  };
}

function approve(
  policy: ExecutionPolicyConfig,
  requiresApproval: boolean,
  reason: string,
): ExecutionPermissionDecision {
  return {
    allowed: true,
    requiresApproval,
    mode: policy.mode,
    reason,
  };
}
