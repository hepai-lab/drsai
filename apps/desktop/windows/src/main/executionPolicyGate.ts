import {
  createExecutionPolicy,
  evaluateExecutionPermission,
  type ExecutionActionKind,
  type ExecutionPolicyConfig,
} from "../../../shared/api/executionPolicy";
import { getMyDrSaiConfig } from "../../../shared/main/myDrSaiConfig";

export interface ExecutionGateOptions {
  approved?: boolean;
  policy?: ExecutionPolicyConfig;
}

export async function getDesktopExecutionPolicy(): Promise<ExecutionPolicyConfig> {
  const config = await getMyDrSaiConfig();
  return createExecutionPolicy(config.config);
}

export async function assertExecutionAllowed(
  action: ExecutionActionKind,
  options: ExecutionGateOptions = {},
): Promise<void> {
  const policy = options.policy ?? (await getDesktopExecutionPolicy());
  const decision = evaluateExecutionPermission(action, policy);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  if (decision.requiresApproval && options.approved !== true) {
    throw new Error(decision.reason);
  }
}
