import type { DesktopMcpToolExecutionApprovalRequest, DesktopPendingApproval } from "../../../shared/api/desktopApi";

export type McpAtMostOnceDecision = "execute" | "reject" | "acknowledge" | "keep";

export function decideMcpAtMostOnce(executed: boolean, approved: boolean): McpAtMostOnceDecision {
  if (executed) return approved ? "acknowledge" : "keep";
  return approved ? "execute" : "reject";
}

export function recoverAmbiguousMcpApproval(approval: DesktopPendingApproval, request: DesktopMcpToolExecutionApprovalRequest): DesktopPendingApproval {
  return {
    ...approval,
    executionState: "ambiguous",
    title: `Review ambiguous MCP outcome: ${request.tool}`,
    detail: "The desktop stopped after persisting the executing intent but before recording a terminal MCP receipt. The tool call will not run again automatically. Review the provider-side effect, then acknowledge this item to close it.",
  };
}
