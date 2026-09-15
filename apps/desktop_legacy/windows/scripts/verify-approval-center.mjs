import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Approval center verification failed: ${message}`);
    process.exit(1);
  }
}

const app = read("../shared/renderer/src/App.tsx");
const navigation = read("../shared/renderer/src/navigation.ts");
const view = read("../shared/renderer/src/components/ApprovalCenterView.tsx");
const css = read("../shared/renderer/src/styles.css");
const packageJson = read("package.json");
const roadmap = read("docs/smart-chat-bar-roadmap.md");
const mainSource = read("src/main/index.ts");
const approvalStateSource = read("src/main/desktopApprovalState.ts");
const approvalProtectionSource = read("src/main/desktopApprovalPayloadProtection.ts");
const mcpRecoverySource = read("src/main/mcpApprovalRecovery.ts");

assert(
  mainSource.includes("restoreDesktopApprovalState()") &&
    mainSource.includes("persistDesktopApprovalState()") &&
    mainSource.includes("desktopApprovalDecisionQueue") &&
    mainSource.includes("executedDesktopApprovalIds.delete(typed.id)") &&
    mainSource.includes("restoreDesktopApprovalPayloadOwner(payload)") &&
    mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "git_commit"') &&
    mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "workspace_mutation"') &&
    mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "workspace_checkpoint_restore"') &&
    mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "remote_gateway_install"') &&
    mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "fork_lifecycle"') &&
    mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "fork_queue_start"') &&
    mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "fork_conflict_draft"') &&
    mainSource.includes("deleteDesktopApprovalPayloads(typed.id)") &&
    mainSource.includes("desktopApprovalPayloadKey(approvalId, kind)") &&
    mainSource.includes("migratedLegacyPayload") &&
    mainSource.includes("recoveredAmbiguousMcp") &&
    mainSource.includes('executionState: "executing"') &&
    mcpRecoverySource.includes('executionState: "ambiguous"') &&
    mcpRecoverySource.includes('return approved ? "acknowledge" : "keep"') &&
    mainSource.includes("recordAmbiguousMcpToolExecutionAudit") &&
    mainSource.includes("isProtectedDesktopApprovalEnvelope(payload.value)") &&
    mainSource.includes("setProtectedDesktopApprovalPayload(approvalId, kind, value)") &&
    mainSource.includes('setProtectedDesktopApprovalPayload(approval.id, "approval_review", approval)') &&
    mainSource.includes('payload.kind === "approval_review"') &&
    approvalStateSource.includes("readDurableJson") &&
    approvalStateSource.includes("writeDurableJson") &&
    approvalStateSource.includes('item.source !== "browser_task"') &&
    mainSource.includes("registerProtectedDesktopApprovalPayload") &&
    mainSource.includes("protectDesktopApprovalPayload(WINDOWS_CREDENTIAL_SERVICE, value)") &&
    mainSource.includes("unprotectDesktopApprovalPayload(WINDOWS_CREDENTIAL_SERVICE, value)") &&
    mainSource.includes('registerProtectedDesktopApprovalPayload(proposal.approval.id, "channel_outbound"') &&
    mainSource.includes('registerProtectedDesktopApprovalPayload(proposal.approval.id, "mcp_tool_execution"') &&
    (mainSource.match(/deferPersistence: true/g) || []).length === 3 &&
    mainSource.includes('envelope ?? { protectedPayload: "unavailable" }') &&
    !mainSource.includes('registerDesktopApprovalPayload(proposal.approval.id, "channel_outbound"') &&
    approvalStateSource.includes("protectedPayload.length <= 1_500_000") &&
    approvalStateSource.includes("MAX_PAYLOAD_STORE_CHARS") &&
    approvalStateSource.includes("MAX_APPROVAL_STATE_BYTES") &&
    approvalStateSource.includes("{ maxBytes: this.maxBytes }") &&
    approvalStateSource.includes("schemaVersion: 3") &&
    approvalStateSource.includes("allowLegacyPlaintext") &&
    approvalStateSource.includes("protectedApprovalSummary(item)") &&
    approvalStateSource.includes("Sensitive review details are encrypted") &&
    mainSource.includes("restoreProtectedDesktopApprovalReview") &&
    approvalProtectionSource.includes("credentials.protect(serialized)") &&
    approvalProtectionSource.includes("credentials.unprotect(protectedPayload)"),
  "approval state is not restart-safe, payload-restoring, secret-protected, serialized and failure-preserving",
);

assert(
  navigation.includes("approvalCenter") &&
    navigation.includes('"approval_center"') &&
    navigation.includes("MENU_IDS.approvalCenter, enabled: false") &&
    app.includes('id: "approvals"') &&
    app.includes("approvalCenterPanel") &&
    navigation.includes("Approval Center"),
  "settings does not expose approval center outside the primary sidebar",
);
assert(
  app.includes("ApprovalCenterView") &&
    app.includes("MENU_IDS.approvalCenter") &&
    app.includes("onAttachMcpContext={attachImportedMcpContext}") &&
    app.includes("function attachImportedMcpContext") &&
    app.includes("Read-only MCP context import") &&
    app.includes("workspacePath={effectiveWorkspacePath}") &&
    app.includes("workspaceTrusted={workspaceTrusted}") &&
    app.includes("approval_center: ShieldCheck"),
  "app shell does not route approval center navigation",
);
assert(
  view.includes("createExecutionPolicy") &&
    view.includes("evaluateExecutionPermission") &&
    view.includes("describeExecutionPolicyMode") &&
    view.includes("ACTION_CATALOG") &&
    view.includes("DesktopPendingApproval") &&
    view.includes("listPendingApprovals") &&
    view.includes("DesktopMcpToolExecutionAuditEntry") &&
    view.includes("DesktopMcpContextResult") &&
    view.includes("DesktopMcpSessionAuditEntry") &&
    view.includes("DesktopMcpActiveSession") &&
    view.includes("DesktopMcpReusableSession") &&
    view.includes("listMcpToolExecutionAudits") &&
    view.includes("listMcpSessionAudits") &&
    view.includes("listMcpActiveSessions") &&
    view.includes("listMcpReusableSessions") &&
    view.includes("closeMcpReusableSession") &&
    view.includes("cancelMcpActiveSession") &&
    view.includes("attachMcpToolResult") &&
    view.includes("desktopApi.importMcpContext") &&
    view.includes("decidePendingApproval") &&
    view.includes("setInterval") &&
    view.includes("toDesktopBrowserTaskApproval") &&
    view.includes("onBrowserTaskEvent") &&
    view.includes("approval-pending-panel") &&
    view.includes("approval-mcp-audit-panel") &&
    view.includes("approval-mcp-active-panel") &&
    view.includes("approval-mcp-reusable-panel") &&
    view.includes("approval-mcp-session-panel") &&
    view.includes("isMcpPendingApproval") &&
    view.includes('reason === "cancel"') &&
    view.includes("Cancel MCP") &&
    view.includes("Acknowledge; do not replay") &&
    view.includes('approval.executionState === "ambiguous"') &&
    view.includes("Close idle") &&
    view.includes("Close session") &&
    view.includes("Attach result") &&
    view.includes("/mcp tool") &&
    view.includes("CommitApprovalChecklist") &&
    view.includes("COMMIT_REVIEW_ITEMS") &&
    view.includes("requiresCommitReviewGate") &&
    view.includes("isCommitReviewComplete") &&
    view.includes("Review checklist incomplete") &&
    view.includes("groupStagedFilesByDirectory") &&
    view.includes("Recent test result:") &&
    view.includes("Commit review checklist") &&
    view.includes('"shell.command"') &&
    view.includes('"git.commit"') &&
    view.includes('"fork.lifecycle"') &&
    view.includes('"fork.queue_start"') &&
    view.includes('"workflow.run"') &&
    view.includes('"external.service"') &&
    view.includes("desktopApi.getMyDrSaiConfig"),
  "approval center view is not fed by shared execution policy decisions",
);
assert(
  css.includes(".approval-center-view") &&
    css.includes(".approval-summary-grid") &&
    css.includes(".approval-pending-panel") &&
    css.includes(".approval-mcp-audit-panel") &&
    css.includes(".approval-mcp-active-panel") &&
    css.includes(".approval-mcp-reusable-panel") &&
    css.includes(".approval-mcp-session-panel") &&
    css.includes(".approval-mcp-audit-actions") &&
    css.includes(".approval-mcp-active-row") &&
    css.includes(".approval-mcp-reusable-row") &&
    css.includes(".approval-mcp-audit-row.completed") &&
    css.includes(".approval-mcp-session-row.timed_out") &&
    css.includes(".approval-mcp-session-row.cancelled") &&
    css.includes(".approval-mcp-session-row.closed") &&
    css.includes(".approval-pending-actions button.cancel") &&
    css.includes(".approval-pending-actions button.approve") &&
    css.includes(".approval-action-row") &&
    css.includes(".approval-action-row.blocked"),
  "approval center styles are missing",
);
assert(
  app.includes("ApprovalCenterView") &&
    read("../shared/api/desktopApi.ts").includes("BrowserTaskPendingApproval") &&
    read("../shared/api/desktopApi.ts").includes("DesktopPendingApproval") &&
    read("../shared/api/desktopApi.ts").includes("DesktopCommitApprovalChecklist") &&
    read("../shared/api/desktopApi.ts").includes("DesktopApprovalProposalRequest") &&
    read("../shared/api/desktopApi.ts").includes("DesktopApprovalProposalResult") &&
    read("../shared/api/desktopApi.ts").includes("DesktopApprovalDecisionRequest") &&
    read("../shared/api/desktopApi.ts").includes('reason?: "reject" | "cancel"') &&
    read("../shared/api/desktopApi.ts").includes("DesktopMcpToolExecutionAuditEntry") &&
    read("../shared/api/desktopApi.ts").includes("DesktopMcpSessionAuditEntry") &&
    read("../shared/api/desktopApi.ts").includes("DesktopMcpActiveSession") &&
    read("../shared/api/desktopApi.ts").includes("DesktopMcpReusableSession") &&
    read("../shared/api/desktopApi.ts").includes("DesktopMcpReusableSessionCloseRequest") &&
    read("../shared/api/desktopApi.ts").includes("DesktopMcpSessionCancelRequest") &&
    read("../shared/api/desktopApi.ts").includes("DesktopGitCommitApprovalRequest") &&
    read("../shared/api/desktopApi.ts").includes("DesktopForkLifecycleApprovalRequest") &&
    read("../shared/api/desktopApi.ts").includes("DesktopForkQueueStartApprovalRequest") &&
    read("../shared/api/desktopApi.ts").includes("DesktopWorkflowRunPrepareRequest") &&
    read("../shared/api/desktopApi.ts").includes("proposeApproval") &&
    read("../shared/api/desktopApi.ts").includes("requestShellCommandApproval") &&
    read("../shared/api/desktopApi.ts").includes("requestGitCommitApproval") &&
    read("../shared/api/desktopApi.ts").includes("requestForkLifecycleApproval") &&
    read("../shared/api/desktopApi.ts").includes("requestForkQueueStartApproval") &&
    read("../shared/api/desktopApi.ts").includes("listPendingApprovals") &&
    read("../shared/api/desktopApi.ts").includes("listMcpToolExecutionAudits") &&
    read("../shared/api/desktopApi.ts").includes("listMcpSessionAudits") &&
    read("../shared/api/desktopApi.ts").includes("listMcpActiveSessions") &&
    read("../shared/api/desktopApi.ts").includes("listMcpReusableSessions") &&
    read("../shared/api/desktopApi.ts").includes("closeMcpReusableSession") &&
    read("../shared/api/desktopApi.ts").includes("cancelMcpActiveSession") &&
    read("../shared/api/desktopApi.ts").includes("decidePendingApproval") &&
    read("../shared/api/desktopApi.ts").includes("decideApproval") &&
    read("../shared/api/desktopApi.ts").includes("listPendingBrowserTaskApprovals") &&
    read("../shared/main/preload.ts").includes("desktop:propose-approval") &&
    read("../shared/main/preload.ts").includes("desktop:shell-command-approval") &&
    read("../shared/main/preload.ts").includes("desktop:git-commit-approval") &&
    read("../shared/main/preload.ts").includes("desktop:fork-lifecycle-approval") &&
    read("../shared/main/preload.ts").includes("desktop:fork-queue-start-approval") &&
    read("../shared/main/preload.ts").includes("desktop:workflow-run-prepare") &&
    read("../shared/main/preload.ts").includes("desktop:pending-approvals") &&
    read("../shared/main/preload.ts").includes("desktop:mcp-execution-audits") &&
    read("../shared/main/preload.ts").includes("desktop:mcp-session-audits") &&
    read("../shared/main/preload.ts").includes("desktop:mcp-active-sessions") &&
    read("../shared/main/preload.ts").includes("desktop:mcp-reusable-sessions") &&
    read("../shared/main/preload.ts").includes("desktop:mcp-reusable-session-close") &&
    read("../shared/main/preload.ts").includes("desktop:mcp-session-cancel") &&
    read("../shared/main/preload.ts").includes("desktop:decide-approval") &&
    read("../shared/main/preload.ts").includes("decideApproval") &&
    read("../shared/main/preload.ts").includes("desktop:browser-task-pending-approvals") &&
    read("src/main/index.ts").includes("pendingDesktopApprovals") &&
    read("src/main/index.ts").includes("pendingShellCommandApprovals") &&
    read("src/main/index.ts").includes("pendingWorkspaceMutationApprovals") &&
    read("src/main/index.ts").includes("pendingGitCommitApprovals") &&
    read("src/main/index.ts").includes("pendingForkLifecycleApprovals") &&
    read("src/main/index.ts").includes("pendingForkQueueStartApprovals") &&
    read("src/main/index.ts").includes("recordRejectedMcpToolExecutionAudit") &&
    read("src/main/index.ts").includes("recordCancelledMcpLiveEnumerationAudit") &&
    read("src/main/index.ts").includes("recordCancelledMcpToolExecutionAudit") &&
    read("src/main/index.ts").includes("listMcpToolExecutionAudits(request)") &&
    read("src/main/index.ts").includes("listMcpActiveSessions(request)") &&
    read("src/main/index.ts").includes("listMcpReusableSessions(request)") &&
    read("src/main/index.ts").includes("closeMcpReusableSession(request)") &&
    read("src/main/index.ts").includes("cancelMcpActiveSession(request)") &&
    read("src/main/index.ts").includes("proposeDesktopApproval") &&
    read("src/main/index.ts").includes("requestTerminalShellCommandApproval") &&
    read("src/main/index.ts").includes("requestGitCommitApproval") &&
    read("src/main/index.ts").includes("requestForkLifecycleApproval") &&
    read("src/main/index.ts").includes("requestForkQueueStartApproval") &&
    read("src/main/index.ts").includes("prepareWorkflowRun") &&
    read("src/main/index.ts").includes("isDesktopCommitApprovalChecklist") &&
    read("src/main/index.ts").includes("executeGitCommit") &&
    read("src/main/index.ts").includes("formatGitCommitApprovalDetail") &&
    read("src/main/index.ts").includes("executeForkLifecycleApproval") &&
    read("src/main/index.ts").includes("executeForkQueueStartApproval") &&
    read("src/main/index.ts").includes("requestWorkspaceMutationApproval") &&
    read("src/main/index.ts").includes("createQueuedWorkspaceMutationResult") &&
    read("src/main/index.ts").includes("executeWorkspaceMutation") &&
    read("src/main/index.ts").includes("APPROVAL_SOURCE_ACTIONS") &&
    read("src/main/index.ts").includes("desktop:propose-approval") &&
    read("src/main/index.ts").includes("desktop:shell-command-approval") &&
    read("src/main/index.ts").includes("desktop:workflow-run-prepare") &&
    read("src/main/index.ts").includes("toDesktopBrowserTaskApproval") &&
    read("src/main/index.ts").includes("decidePendingDesktopApproval") &&
    read("src/main/index.ts").includes("browserTaskService.pendingApprovals()") &&
    read("src/main/index.ts").includes("updatePendingBrowserTaskApprovals"),
  "approval center is not wired to live unified pending approvals",
);
assert(
    read("src/main/index.ts").includes("request.body.trim()") &&
    read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts").includes("body: preflight.approvalBody") &&
    read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts").includes("checklist: preflight.checklist") &&
    read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts").includes("readRecentTerminalTestResult") &&
    read("../shared/renderer/src/components/TerminalPanel.tsx").includes("recordRecentTerminalTestResult") &&
    read("../shared/renderer/src/terminalTestResults.ts").includes("RecentTerminalTestResult") &&
    read("../shared/renderer/src/mockDesktopApi.ts").includes("request.checklist"),
  "git commit approvals do not include the guided preflight detail and recent test result",
);
assert(
  css.includes(".commit-approval-checklist") &&
    css.includes(".commit-approval-stats") &&
    css.includes(".commit-approval-review-gate") &&
    css.includes(".approval-pending-actions button:disabled") &&
    css.includes(".commit-approval-file-group"),
  "commit approval checklist styles are missing",
);
assert(
  read("src/main/index.ts").includes('requestWorkspaceMutationApproval("stage-file"') &&
    read("src/main/index.ts").includes('requestWorkspaceMutationApproval("revert-file"') &&
    read("src/main/index.ts").includes('requestWorkspaceMutationApproval("stage-hunk"') &&
    read("src/main/index.ts").includes('requestWorkspaceMutationApproval("revert-hunk"') &&
    read("../shared/renderer/src/components/files/PatchReviewPanel.tsx").includes("result.approvalQueued") &&
    read("../shared/api/desktopApi.ts").includes("approvalQueued?: boolean"),
  "workspace patch review mutations are not queued through approval center",
);
assert(
  packageJson.includes('"verify:approval-center"'),
  "package script is not registered",
);
assert(
  roadmap.includes("visible Approval Center") &&
    roadmap.includes("npm run verify:approval-center"),
  "roadmap does not record approval center evidence and verification",
);

console.log("Approval center verification passed.");
