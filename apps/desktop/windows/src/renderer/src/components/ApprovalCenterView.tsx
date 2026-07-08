import { Check, MessageSquare, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createExecutionPolicy,
  describeExecutionPolicyMode,
  evaluateExecutionPermission,
  type ExecutionActionKind,
  type ExecutionPolicyConfig,
} from "@shared/executionPolicy";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import type {
  BrowserTaskPendingApproval,
  DesktopCommitApprovalChecklist,
  DesktopMcpActiveSession,
  DesktopMcpContextResult,
  DesktopMcpReusableSession,
  DesktopMcpSessionAuditEntry,
  DesktopMcpToolExecutionAuditEntry,
  DesktopPendingApproval,
  DesktopWorkflowRun,
} from "@shared/desktopApi";

interface ApprovalCenterViewProps {
  language: AppLanguage;
  onAttachMcpContext?: (result: DesktopMcpContextResult) => void;
  workspacePath: string;
  workspaceTrusted: boolean;
}

const ACTION_CATALOG: Array<{
  action: ExecutionActionKind;
  group: "Chat" | "Browser" | "Workspace" | "Terminal" | "Git" | "Fork" | "Workflow" | "Network";
  label: string;
}> = [
  { action: "chat.model_call", group: "Chat", label: "Model call" },
  { action: "browser.read", group: "Browser", label: "Browser read" },
  { action: "browser.interact", group: "Browser", label: "Browser interaction" },
  { action: "browser.sensitive_interact", group: "Browser", label: "Sensitive browser action" },
  { action: "workspace.read", group: "Workspace", label: "Workspace read" },
  { action: "workspace.diff", group: "Workspace", label: "Workspace diff" },
  { action: "workspace.checkpoint", group: "Workspace", label: "Create checkpoint" },
  { action: "workspace.stage", group: "Workspace", label: "Stage changes" },
  { action: "workspace.revert", group: "Workspace", label: "Revert changes" },
  { action: "terminal.create", group: "Terminal", label: "Create terminal" },
  { action: "terminal.write", group: "Terminal", label: "Write terminal input" },
  { action: "shell.command", group: "Terminal", label: "Shell command" },
  { action: "git.commit", group: "Git", label: "Git commit" },
  { action: "fork.lifecycle", group: "Fork", label: "Fork lifecycle" },
  { action: "fork.queue_start", group: "Fork", label: "Fork queue start" },
  { action: "workflow.run", group: "Workflow", label: "Workflow run" },
  { action: "network.request", group: "Network", label: "Network request" },
  { action: "external.service", group: "Network", label: "External service" },
];

export function ApprovalCenterView({
  language,
  onAttachMcpContext,
  workspacePath,
  workspaceTrusted,
}: ApprovalCenterViewProps): React.JSX.Element {
  const zh = language === "zh";
  const [policy, setPolicy] = useState<ExecutionPolicyConfig>(() =>
    createExecutionPolicy({ workspace_enabled: workspaceTrusted }),
  );
  const [configStatus, setConfigStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [pendingApprovals, setPendingApprovals] = useState<DesktopPendingApproval[]>([]);
  const [mcpExecutionAudits, setMcpExecutionAudits] = useState<DesktopMcpToolExecutionAuditEntry[]>([]);
  const [mcpSessionAudits, setMcpSessionAudits] = useState<DesktopMcpSessionAuditEntry[]>([]);
  const [mcpActiveSessions, setMcpActiveSessions] = useState<DesktopMcpActiveSession[]>([]);
  const [mcpReusableSessions, setMcpReusableSessions] = useState<DesktopMcpReusableSession[]>([]);
  const [approvalReviewState, setApprovalReviewState] = useState<Record<string, Record<string, boolean>>>({});
  const [approvalMessage, setApprovalMessage] = useState("");
  const [attachingMcpAuditId, setAttachingMcpAuditId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPolicy(): Promise<void> {
      setConfigStatus("loading");
      try {
        const myDrSaiConfig = await desktopApi.getMyDrSaiConfig();
        if (cancelled) return;
        setPolicy(
          createExecutionPolicy({
            ...myDrSaiConfig.config,
            workspace_enabled:
              workspaceTrusted && myDrSaiConfig.config.workspace_enabled !== false,
          }),
        );
        setConfigStatus("ready");
      } catch {
        if (cancelled) return;
        setPolicy(createExecutionPolicy({ workspace_enabled: workspaceTrusted }));
        setConfigStatus("fallback");
      }
    }
    void loadPolicy();
    return () => {
      cancelled = true;
    };
  }, [workspaceTrusted]);

  useEffect(() => {
    let cancelled = false;
    async function loadPendingApprovals(): Promise<void> {
      try {
        const approvals = await desktopApi.listPendingApprovals();
        if (!cancelled) setPendingApprovals(approvals);
      } catch (error) {
        if (!cancelled) {
          setApprovalMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadPendingApprovals();
    const pendingApprovalPoll = window.setInterval(() => {
      void loadPendingApprovals();
    }, 3000);
    const unsubscribe = desktopApi.onBrowserTaskEvent((event) => {
      if (event.type === "action.proposed" && event.requiresApproval) {
        const approval = toDesktopBrowserTaskApproval(event);
        setPendingApprovals((current) => [
          approval,
          ...current.filter((item) => item.id !== approval.id),
        ]);
        return;
      }
      if (event.type === "action.completed") {
        setPendingApprovals((current) =>
          current.filter((item) => item.id !== createBrowserTaskApprovalId(event.taskId, event.actionId)),
        );
        return;
      }
      if (
        event.type === "task.completed" ||
        event.type === "task.failed" ||
        event.type === "task.cancelled"
      ) {
        setPendingApprovals((current) =>
          current.filter((item) => item.taskId !== event.taskId),
        );
      }
    });
    return () => {
      cancelled = true;
      window.clearInterval(pendingApprovalPoll);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMcpExecutionAudits(): Promise<void> {
      if (!workspacePath) {
        setMcpExecutionAudits([]);
        setMcpSessionAudits([]);
        setMcpActiveSessions([]);
        setMcpReusableSessions([]);
        return;
      }
      try {
        const activeSessions = await desktopApi.listMcpActiveSessions({
          workspacePath,
        });
        const reusableSessions = await desktopApi.listMcpReusableSessions({
          workspacePath,
        });
        const audits = await desktopApi.listMcpToolExecutionAudits({
          workspacePath,
          limit: 8,
        });
        const sessionAudits = await desktopApi.listMcpSessionAudits({
          workspacePath,
          limit: 8,
        });
        if (!cancelled) {
          setMcpActiveSessions(activeSessions);
          setMcpReusableSessions(reusableSessions);
          setMcpExecutionAudits(audits);
          setMcpSessionAudits(sessionAudits);
        }
      } catch (error) {
        if (!cancelled) {
          setApprovalMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadMcpExecutionAudits();
    const auditPoll = window.setInterval(() => {
      void loadMcpExecutionAudits();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(auditPoll);
    };
  }, [workspacePath]);

  const rows = useMemo(
    () =>
      ACTION_CATALOG.map((item) => ({
        ...item,
        decision: evaluateExecutionPermission(item.action, policy),
      })),
    [policy],
  );
  const allowedCount = rows.filter(
    (row) => row.decision.allowed && !row.decision.requiresApproval,
  ).length;
  const approvalCount = rows.filter((row) => row.decision.requiresApproval).length;
  const blockedCount = rows.filter((row) => !row.decision.allowed).length;

  async function decidePendingApproval(
    approval: DesktopPendingApproval,
    approved: boolean,
    reason?: "reject" | "cancel",
  ): Promise<void> {
    if (approved && requiresCommitReviewGate(approval) && !isCommitReviewComplete(approval)) {
      setApprovalMessage("Complete the commit review checklist before approving.");
      return;
    }
    try {
      const accepted = await desktopApi.decidePendingApproval({
        id: approval.id,
        approved,
        ...(reason ? { reason } : {}),
      });
      if (!accepted) {
        setApprovalMessage("Approval request was rejected by the desktop bridge.");
        return;
      }
      setPendingApprovals((current) =>
        current.filter((item) => item.id !== approval.id),
      );
      setApprovalReviewState((current) => {
        const next = { ...current };
        delete next[approval.id];
        return next;
      });
      if (approved && approval.actionKind === "shell.command") {
        await broadcastLatestWorkflowRunUpdate();
      }
      if (approval.actionKind === "fork.lifecycle" || approval.actionKind === "fork.queue_start") {
        window.dispatchEvent(new CustomEvent("drsai:threads-updated"));
      }
      setApprovalMessage(
        approved ? "Approval accepted." : reason === "cancel" ? "Approval cancelled." : "Approval rejected.",
      );
    } catch (error) {
      setApprovalMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function cancelMcpActiveSession(session: DesktopMcpActiveSession): Promise<void> {
    try {
      const result = await desktopApi.cancelMcpActiveSession({
        workspacePath,
        sessionId: session.sessionId,
      });
      setApprovalMessage(result.message);
      if (result.cancelled) {
        setMcpActiveSessions((current) =>
          current.filter((item) => item.sessionId !== session.sessionId),
        );
        const sessionAudits = await desktopApi.listMcpSessionAudits({
          workspacePath,
          limit: 8,
        });
        setMcpSessionAudits(sessionAudits);
      }
    } catch (error) {
      setApprovalMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function closeMcpReusableSession(session: DesktopMcpReusableSession): Promise<void> {
    try {
      const result = await desktopApi.closeMcpReusableSession({
        workspacePath,
        sessionReuseKey: session.sessionReuseKey,
      });
      setApprovalMessage(result.message);
      if (result.closed) {
        setMcpReusableSessions((current) =>
          current.filter((item) => item.sessionReuseKey !== session.sessionReuseKey),
        );
        const [activeSessions, reusableSessions] = await Promise.all([
          desktopApi.listMcpActiveSessions({ workspacePath }),
          desktopApi.listMcpReusableSessions({ workspacePath }),
        ]);
        setMcpActiveSessions(activeSessions);
        setMcpReusableSessions(reusableSessions);
      }
    } catch (error) {
      setApprovalMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function attachMcpToolResult(entry: DesktopMcpToolExecutionAuditEntry): Promise<void> {
    if (!entry.resultContextName || !workspacePath) return;
    setAttachingMcpAuditId(entry.id);
    try {
      const result = await desktopApi.importMcpContext({
        workspacePath,
        kind: "tool",
        selector: entry.resultContextName,
        limit: 1,
      });
      if (result.items.length === 0) {
        setApprovalMessage("No reviewed MCP tool context matched this audit result.");
        return;
      }
      onAttachMcpContext?.(result);
      setApprovalMessage(`Attached ${result.items.length} reviewed MCP tool result to chat.`);
    } catch (error) {
      setApprovalMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAttachingMcpAuditId(null);
    }
  }

  function setCommitReviewItem(
    approvalId: string,
    itemId: string,
    checked: boolean,
  ): void {
    setApprovalReviewState((current) => ({
      ...current,
      [approvalId]: {
        ...(current[approvalId] ?? {}),
        [itemId]: checked,
      },
    }));
  }

  function isCommitReviewComplete(approval: DesktopPendingApproval): boolean {
    if (!requiresCommitReviewGate(approval)) return true;
    const reviewed = approvalReviewState[approval.id] ?? {};
    return COMMIT_REVIEW_ITEMS.every((item) => reviewed[item.id]);
  }

  return (
    <section className="approval-center-view" aria-label="Approval Center">
      <div className="approval-center-header">
        <div className="approval-center-title">
          <ShieldCheck size={20} />
          <div>
            <h2>{zh ? "Approval Center" : "Approval Center"}</h2>
            <span>{describeExecutionPolicyMode(policy)}</span>
          </div>
        </div>
        <span className={`approval-config-pill ${configStatus}`}>
          {configStatus === "ready"
            ? "config"
            : configStatus === "loading"
              ? "loading"
              : "fallback"}
        </span>
      </div>

      <div className="approval-summary-grid">
        <ApprovalMetric label={zh ? "Allowed" : "Allowed"} value={allowedCount} tone="allowed" />
        <ApprovalMetric label={zh ? "Needs approval" : "Needs approval"} value={approvalCount} tone="approval" />
        <ApprovalMetric label={zh ? "Blocked" : "Blocked"} value={blockedCount} tone="blocked" />
      </div>

      <section className="approval-pending-panel" aria-label="Pending approvals">
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "Live queue" : "Live queue"}</span>
            <h3>{zh ? "Pending approvals" : "Pending approvals"}</h3>
          </div>
          <strong>{pendingApprovals.length}</strong>
        </div>
        {approvalMessage ? <p className="approval-pending-message">{approvalMessage}</p> : null}
        {pendingApprovals.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "No approvals are waiting." : "No approvals are waiting."}
          </p>
        ) : (
          <div className="approval-pending-list">
            {pendingApprovals.map((approval) => {
              const commitReviewRequired = requiresCommitReviewGate(approval);
              const commitReviewComplete = isCommitReviewComplete(approval);
              return (
                <article className={`approval-pending-row ${approval.risk}`} key={approval.id}>
                  <div>
                    <span>{approval.source} / {approval.actionKind} / {approval.risk}</span>
                    <strong>{approval.title}</strong>
                    <small>{approval.target || approval.detail}</small>
                    {approval.checklist?.type === "git_commit" ? (
                      <CommitApprovalChecklist
                        approvalId={approval.id}
                        checklist={approval.checklist}
                        reviewState={approvalReviewState[approval.id] ?? {}}
                        onReviewItemChange={setCommitReviewItem}
                      />
                    ) : null}
                  </div>
                  <div className="approval-pending-actions">
                    <button
                      type="button"
                      className="approve"
                      disabled={commitReviewRequired && !commitReviewComplete}
                      title={
                        commitReviewRequired && !commitReviewComplete
                          ? "Complete the commit review checklist first."
                          : undefined
                      }
                      onClick={() => void decidePendingApproval(approval, true)}
                    >
                      <Check size={14} />
                      Approve
                    </button>
                    {commitReviewRequired && !commitReviewComplete ? (
                      <small className="approval-review-gate">Review checklist incomplete</small>
                    ) : null}
                    {isMcpPendingApproval(approval) ? (
                      <button
                        type="button"
                        className="cancel"
                        onClick={() => void decidePendingApproval(approval, false, "cancel")}
                      >
                        <XCircle size={14} />
                        Cancel MCP
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="reject"
                      onClick={() => void decidePendingApproval(approval, false)}
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="approval-mcp-audit-panel" aria-label="MCP execution audit">
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "MCP audit" : "MCP audit"}</span>
            <h3>{zh ? "Tool execution history" : "Tool execution history"}</h3>
          </div>
          <strong>{mcpExecutionAudits.length}</strong>
        </div>
        {mcpExecutionAudits.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "No MCP tool executions recorded for this workspace." : "No MCP tool executions recorded for this workspace."}
          </p>
        ) : (
          <div className="approval-mcp-audit-list">
            {mcpExecutionAudits.map((entry) => (
              <article className={`approval-mcp-audit-row ${entry.status}`} key={entry.id}>
                <div>
                  <span>{entry.server} / {entry.tool} / {entry.status}</span>
                  <strong>{entry.message}</strong>
                  <small>{entry.createdAt}</small>
                  {entry.resultContextName ? (
                    <code>{`/mcp tool ${entry.resultContextName}`}</code>
                  ) : null}
                </div>
                {entry.resultContextName ? (
                  <div className="approval-mcp-audit-actions">
                    <button
                      type="button"
                      className="approve"
                      disabled={attachingMcpAuditId === entry.id}
                      onClick={() => void attachMcpToolResult(entry)}
                    >
                      <MessageSquare size={14} />
                      {attachingMcpAuditId === entry.id ? "Attaching" : "Attach result"}
                    </button>
                  </div>
                ) : null}
                <p>{entry.verification}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="approval-mcp-active-panel" aria-label="Running MCP sessions">
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "MCP running" : "MCP running"}</span>
            <h3>{zh ? "Active sessions" : "Active sessions"}</h3>
          </div>
          <strong>{mcpActiveSessions.length}</strong>
        </div>
        {mcpActiveSessions.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "No MCP stdio sessions are running for this workspace." : "No MCP stdio sessions are running for this workspace."}
          </p>
        ) : (
          <div className="approval-mcp-active-list">
            {mcpActiveSessions.map((session) => (
              <article className="approval-mcp-active-row" key={session.sessionId}>
                <div>
                  <span>{session.phase} / {session.server}</span>
                  <strong>{session.tool ? `${session.tool} is running` : "Enumeration is running"}</strong>
                  <small>{session.startedAt}</small>
                  <code>{session.sessionId}</code>
                </div>
                <button
                  type="button"
                  className="reject"
                  onClick={() => void cancelMcpActiveSession(session)}
                >
                  <XCircle size={14} />
                  Cancel MCP
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="approval-mcp-reusable-panel" aria-label="Reusable MCP session pool">
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "MCP pool" : "MCP pool"}</span>
            <h3>{zh ? "Reusable sessions" : "Reusable sessions"}</h3>
          </div>
          <strong>{mcpReusableSessions.length}</strong>
        </div>
        {mcpReusableSessions.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "No reusable MCP sessions are pooled for this workspace." : "No reusable MCP sessions are pooled for this workspace."}
          </p>
        ) : (
          <div className="approval-mcp-reusable-list">
            {mcpReusableSessions.map((session) => (
              <article className={`approval-mcp-reusable-row ${session.status}`} key={session.sessionReuseKey}>
                <div>
                  <span>{session.server} / {session.status} / pending {session.pendingRequestCount}</span>
                  <strong>{session.sessionReuseKey}</strong>
                  <small>
                    Last used {session.lastUsedAt}
                    {typeof session.idleExpiresInMs === "number"
                      ? ` / idle closes in ${Math.ceil(session.idleExpiresInMs / 1000)}s`
                      : ""}
                  </small>
                  <code>{session.command}</code>
                </div>
                <button
                  type="button"
                  className={session.status === "busy" ? "reject" : "cancel"}
                  onClick={() => void closeMcpReusableSession(session)}
                >
                  <XCircle size={14} />
                  {session.status === "busy" ? "Close session" : "Close idle"}
                </button>
                {session.stderrPreview ? <p>{session.stderrPreview}</p> : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="approval-mcp-session-panel" aria-label="MCP session lifecycle audit">
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "MCP sessions" : "MCP sessions"}</span>
            <h3>{zh ? "Lifecycle history" : "Lifecycle history"}</h3>
          </div>
          <strong>{mcpSessionAudits.length}</strong>
        </div>
        {mcpSessionAudits.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "No MCP session lifecycle events recorded for this workspace." : "No MCP session lifecycle events recorded for this workspace."}
          </p>
        ) : (
          <div className="approval-mcp-session-list">
            {mcpSessionAudits.map((entry) => (
              <article className={`approval-mcp-session-row ${entry.status}`} key={entry.id}>
                <div>
                  <span>{entry.phase} / {entry.server} / {entry.status}</span>
                  <strong>{entry.message}</strong>
                  <small>{entry.createdAt}</small>
                  {entry.tool ? <code>{entry.tool}</code> : null}
                </div>
                <p>{entry.verification}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="approval-action-list">
        {rows.map((row) => {
          const state = row.decision.allowed
            ? row.decision.requiresApproval
              ? "approval"
              : "allowed"
            : "blocked";
          return (
            <article className={`approval-action-row ${state}`} key={row.action}>
              <div>
                <span>{row.group}</span>
                <strong>{row.label}</strong>
                <code>{row.action}</code>
              </div>
              <div className="approval-action-decision">
                <b>
                  {state === "allowed"
                    ? "Allowed"
                    : state === "approval"
                      ? "Approval required"
                      : "Blocked"}
                </b>
                <small>{row.decision.reason}</small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

async function broadcastLatestWorkflowRunUpdate(): Promise<void> {
  const runs = await desktopApi.listWorkflowRuns();
  const run = findLatestRunningWorkflowRun(runs);
  if (!run) return;
  window.dispatchEvent(
    new CustomEvent("drsai:workflow-run-updated", {
      detail: { run },
    }),
  );
}

function findLatestRunningWorkflowRun(
  runs: DesktopWorkflowRun[],
): DesktopWorkflowRun | null {
  return (
    runs.find((run) =>
      run.steps.some((step) => step.kind === "terminal_command" && step.status === "running"),
    ) ??
    runs[0] ??
    null
  );
}

const COMMIT_REVIEW_ITEMS = [
  {
    id: "staged-files",
    label: "Reviewed staged file list",
    detail: "The listed files are the intended commit scope.",
  },
  {
    id: "unstaged-risk",
    label: "Checked unstaged-change risk",
    detail: "Unstaged and untracked files are understood as excluded from this commit.",
  },
  {
    id: "test-commitment",
    label: "Accepted test commitment",
    detail: "The commit is backed by recent verification or explicitly marked as unverified.",
  },
];

function requiresCommitReviewGate(approval: DesktopPendingApproval): boolean {
  return approval.actionKind === "git.commit" && approval.checklist?.type === "git_commit";
}

function isMcpPendingApproval(approval: DesktopPendingApproval): boolean {
  return (
    (approval.source === "network" && approval.actionKind === "network.request") ||
    (approval.source === "connector" && approval.actionKind === "external.service")
  ) && /mcp/i.test(`${approval.id} ${approval.title} ${approval.detail}`);
}

function CommitApprovalChecklist({
  approvalId,
  checklist,
  reviewState,
  onReviewItemChange,
}: {
  approvalId: string;
  checklist: DesktopCommitApprovalChecklist;
  reviewState: Record<string, boolean>;
  onReviewItemChange: (approvalId: string, itemId: string, checked: boolean) => void;
}): React.JSX.Element {
  const groups = groupStagedFilesByDirectory(checklist.stagedFiles);
  return (
    <div className="commit-approval-checklist" aria-label="Commit review checklist">
      <div className="commit-approval-stats">
        <CommitApprovalStat label="Staged files" value={String(checklist.stagedFiles.length)} />
        <CommitApprovalStat
          label="Unstaged outside commit"
          value={String(checklist.unstagedFileCount)}
        />
        <CommitApprovalStat
          label="Diff lines reviewed"
          value={`${checklist.diffLineCount}${checklist.diffTruncated ? "+" : ""}`}
        />
      </div>
      <div className="commit-approval-review">
        <span>Review before approving</span>
        <p>{checklist.riskSummary}</p>
        <p>Recent test result: {checklist.recentTestResult || "Not captured yet."}</p>
        <p>Test commitment: {checklist.testCommitment}</p>
      </div>
      <fieldset className="commit-approval-review-gate">
        <legend>Required approval checklist</legend>
        {COMMIT_REVIEW_ITEMS.map((item) => (
          <label className="commit-approval-review-item" key={item.id}>
            <input
              type="checkbox"
              checked={Boolean(reviewState[item.id])}
              onChange={(event) =>
                onReviewItemChange(approvalId, item.id, event.currentTarget.checked)
              }
            />
            <span>
              <b>{item.label}</b>
              <small>{item.detail}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="commit-approval-file-groups">
        {groups.slice(0, 6).map((group) => (
          <div className="commit-approval-file-group" key={group.name}>
            <b>{group.name}</b>
            <span>{group.files.length} file{group.files.length === 1 ? "" : "s"}</span>
            <code>{group.files.slice(0, 4).join(", ")}</code>
          </div>
        ))}
        {groups.length > 6 ? (
          <small>{groups.length - 6} more file group(s) hidden in this compact review.</small>
        ) : null}
      </div>
    </div>
  );
}

function CommitApprovalStat({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="commit-approval-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function groupStagedFilesByDirectory(
  stagedFiles: string[],
): Array<{ name: string; files: string[] }> {
  const groups = new Map<string, string[]>();
  for (const file of stagedFiles) {
    const normalized = file.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const name = parts.length > 1 ? parts[0] : "root";
    const files = groups.get(name) ?? [];
    files.push(normalized);
    groups.set(name, files);
  }
  return [...groups.entries()]
    .map(([name, files]) => ({
      name,
      files: files.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createBrowserTaskApprovalId(taskId: string, actionId: string): string {
  return `browser_task:${taskId}:${actionId}`;
}

function toDesktopBrowserTaskApproval(
  approval: BrowserTaskPendingApproval,
): DesktopPendingApproval {
  const sensitive =
    approval.action === "type" ||
    approval.action === "click" ||
    approval.action === "select" ||
    approval.action === "key_press";
  return {
    id: createBrowserTaskApprovalId(approval.taskId, approval.actionId),
    source: "browser_task",
    actionKind: sensitive ? "browser.sensitive_interact" : "browser.interact",
    title: `Browser ${approval.action}`,
    detail: approval.target || approval.actionId,
    target: approval.target,
    createdAt: approval.timestamp,
    risk: sensitive ? "high" : "medium",
    taskId: approval.taskId,
    actionId: approval.actionId,
  };
}

function ApprovalMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "allowed" | "approval" | "blocked";
  value: number;
}): React.JSX.Element {
  return (
    <div className={`approval-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
