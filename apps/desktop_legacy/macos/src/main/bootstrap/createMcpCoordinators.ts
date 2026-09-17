import { createHash } from "node:crypto";
import type { DesktopMcpLiveEnumerationRequest, DesktopMcpToolExecutionApprovalRequest } from "../../../../shared/api";
import type { PersistentApprovalStore } from "../../../../shared/main/approvalStore";
import { assertAllowedDesktopPath } from "../../../../shared/main/desktopPathPolicy";
import { createMcpEnumerationBlockedResult, createMcpEnumerationQueuedResult, createMcpToolExecutionApprovalResult, enumerateMcpLiveServer, executeMcpToolAfterApproval, inspectMcpLiveServers } from "../../../../shared/main/mcpLiveBridge";

const normalizeEnumeration = (value: unknown): DesktopMcpLiveEnumerationRequest | null => {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim()) return null;
  return { workspacePath: request.workspacePath.trim(), ...(typeof request.server === "string" && request.server.trim() ? { server: request.server.trim().slice(0, 160) } : {}), ...(request.reuseSession === true ? { reuseSession: true } : {}) };
};
const normalizeExecution = (value: unknown): DesktopMcpToolExecutionApprovalRequest | null => {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim() || typeof request.server !== "string" || !request.server.trim() || typeof request.tool !== "string" || !request.tool.trim() || (request.input !== undefined && typeof request.input !== "string")) return null;
  return { workspacePath: request.workspacePath.trim(), server: request.server.trim().slice(0, 160), tool: request.tool.trim().slice(0, 240), ...(typeof request.input === "string" ? { input: request.input.slice(0, 48 * 1024) } : {}), ...(request.reuseSession === true ? { reuseSession: true } : {}) };
};

export function createMacosMcpCoordinators(dependencies: { approvalStore: PersistentApprovalStore; allowedDesktopRoots(): Promise<string[]> }) {
  const requestMcpEnumeration = async (raw: unknown) => {
    const request = normalizeEnumeration(raw);
    if (!request) return createMcpEnumerationBlockedResult({ workspacePath: "" }, "MCP live enumeration request is incomplete.");
    try {
      assertAllowedDesktopPath(request.workspacePath, await dependencies.allowedDesktopRoots(), { directory: true });
      const inspection = inspectMcpLiveServers(request.workspacePath);
      const selected = request.server ? inspection.servers.filter((server) => server.name.toLowerCase().includes(request.server!.toLowerCase())) : inspection.servers;
      if (!selected.length) return createMcpEnumerationBlockedResult(request, "No configured MCP server matched the requested selector.");
      const stableKey = createHash("sha256").update(`${request.workspacePath}\0${request.server ?? "all"}\0${request.reuseSession === true}`).digest("hex");
      const proposal = await dependencies.approvalStore.propose({ source: "network", actionKind: "network.request", title: "Enumerate live MCP server context", detail: `Run bounded MCP resources/list and tools/list for: ${selected.map((server) => server.name).join(", ")}.`, target: request.workspacePath, risk: "medium", idempotencyKey: `mcp-enumerate:${stableKey}` }, async () => { await enumerateMcpLiveServer(request); return true; });
      if (proposal.blocked || !proposal.allowed) return createMcpEnumerationBlockedResult(request, proposal.reason);
      if (proposal.queued && proposal.approval) return createMcpEnumerationQueuedResult(request, proposal.approval.id, proposal.reason);
      return enumerateMcpLiveServer(request);
    } catch (error) { return createMcpEnumerationBlockedResult(request, error instanceof Error ? error.message : "MCP live enumeration preflight failed."); }
  };
  const requestMcpExecution = async (raw: unknown) => {
    const request = normalizeExecution(raw);
    if (!request) return createMcpToolExecutionApprovalResult({ workspacePath: "", server: "", tool: "" }, undefined, "MCP tool execution approval request is incomplete.", false, true);
    try {
      assertAllowedDesktopPath(request.workspacePath, await dependencies.allowedDesktopRoots(), { directory: true });
      if (!inspectMcpLiveServers(request.workspacePath).servers.some((server) => server.name.toLowerCase().includes(request.server.toLowerCase()))) return createMcpToolExecutionApprovalResult(request, undefined, "No configured MCP server matched the tool execution request.", false, true);
      if (request.input) { const parsed = JSON.parse(request.input); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP tool input must be a JSON object."); }
      const stableKey = createHash("sha256").update(`${request.workspacePath}\0${request.server}\0${request.tool}\0${request.input ?? ""}\0${request.reuseSession === true}`).digest("hex");
      let approvalId: string | undefined;
      const proposal = await dependencies.approvalStore.propose({ source: "connector", actionKind: "external.service", title: `Execute MCP tool: ${request.tool}`, detail: `Run one bounded stdio MCP tools/call.\nServer: ${request.server}\nTool: ${request.tool}\nInput: ${request.input?.slice(0, 1_200) ?? "{}"}`, target: request.workspacePath, risk: "high", idempotencyKey: `mcp-tool:${stableKey}` }, async () => { await executeMcpToolAfterApproval(request, approvalId); return true; });
      approvalId = proposal.approval?.id;
      if (proposal.alreadyExecuted) return { ...createMcpToolExecutionApprovalResult(request, approvalId, proposal.reason, false, false), status: "already_executed" as const, message: "This idempotent MCP tool request was already executed and was not replayed." };
      if (!proposal.queued && proposal.allowed && !proposal.blocked) return executeMcpToolAfterApproval(request, approvalId);
      return createMcpToolExecutionApprovalResult(request, approvalId, proposal.reason, proposal.queued, proposal.blocked || !proposal.allowed);
    } catch (error) { return createMcpToolExecutionApprovalResult(request, undefined, error instanceof Error ? error.message : "MCP tool execution preflight failed.", false, true); }
  };
  return { requestMcpEnumeration, requestMcpExecution };
}
