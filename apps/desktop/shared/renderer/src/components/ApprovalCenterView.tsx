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
        approved
          ? (zh ? "已允许，操作将按上述范围执行一次。" : "Allowed. The operation will run once within the scope shown above.")
          : reason === "cancel"
            ? (zh ? "已取消，操作不会执行。" : "Cancelled. The operation will not run.")
            : (zh ? "已拒绝，操作不会执行。" : "Rejected. The operation will not run."),
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
    <section className="approval-center-view" aria-label={zh ? "审批中心" : "Approval Center"}>
      <div className="approval-center-header">
        <div className="approval-center-title">
          <ShieldCheck size={20} />
          <div>
            <h2>{zh ? "审批中心" : "Approval Center"}</h2>
            <span>{zh ? "查看需要确认、已允许和已阻止的操作" : describeExecutionPolicyMode(policy)}</span>
          </div>
        </div>
        <span className={`approval-config-pill ${configStatus}`}>
          {configStatus === "ready"
            ? (zh ? "已就绪" : "config")
            : configStatus === "loading"
              ? (zh ? "加载中" : "loading")
              : (zh ? "使用默认设置" : "fallback")}
        </span>
      </div>

      <div className="approval-summary-grid">
        <ApprovalMetric label={zh ? "已允许" : "Allowed"} value={allowedCount} tone="allowed" />
        <ApprovalMetric label={zh ? "需要确认" : "Needs approval"} value={approvalCount} tone="approval" />
        <ApprovalMetric label={zh ? "已阻止" : "Blocked"} value={blockedCount} tone="blocked" />
      </div>

      <section className="approval-pending-panel" aria-label={zh ? "待确认操作" : "Pending approvals"}>
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "实时队列" : "Live queue"}</span>
            <h3>{zh ? "待确认操作" : "Pending approvals"}</h3>
          </div>
          <strong>{pendingApprovals.length}</strong>
        </div>
        {approvalMessage ? <p className="approval-pending-message" role="status" aria-live="polite">{approvalMessage}</p> : null}
        {pendingApprovals.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "当前没有等待确认的操作。" : "No approvals are waiting."}
          </p>
        ) : (
          <div className="approval-pending-list">
            {pendingApprovals.map((approval) => {
              const commitReviewRequired = requiresCommitReviewGate(approval);
              const commitReviewComplete = isCommitReviewComplete(approval);
              const businessAction = approvalBusinessAction(approval, zh);
              const businessObject = approvalBusinessObject(approval, zh);
              const businessScope = approvalBusinessScope(approval, zh);
              const businessImpact = approvalBusinessImpact(approval, zh);
              const risk = approvalRiskPresentation(approval.risk, zh);
              return (
                <article
                  className={`approval-pending-row ${approval.risk}`}
                  key={approval.id}
                  data-testid="business-approval-card"
                  data-approval-id={approval.id}
                  aria-label={
                    zh
                      ? `${businessAction}。对象：${businessObject}。范围：${businessScope}。影响：${businessImpact}。风险：${risk.label}，${risk.explanation}。请选择允许并执行或拒绝并停止。`
                      : `${businessAction}. Object: ${businessObject}. Scope: ${businessScope}. Impact: ${businessImpact}. Risk: ${risk.label}, ${risk.explanation}. Choose Allow and run or Reject and stop.`
                  }
                >
                  <div>
                    <span className="approval-risk-summary">{zh ? `需要确认 · ${risk.label}` : `Confirmation required · ${risk.label}`}</span>
                    <strong>{businessAction}</strong>
                    <small>{zh ? "请在执行前核对下面的信息。" : "Review the information below before this runs."}</small>
                    <dl className="approval-pending-facts" aria-label={zh ? "审批业务信息" : "Approval business information"}>
                      <div>
                        <dt>{zh ? "要做什么" : "Action"}</dt>
                        <dd>{businessAction}</dd>
                      </div>
                      <div>
                        <dt>{zh ? "涉及对象" : "Object"}</dt>
                        <dd>{businessObject}</dd>
                      </div>
                      <div>
                        <dt>{zh ? "作用范围" : "Scope"}</dt>
                        <dd>{businessScope}</dd>
                      </div>
                      <div>
                        <dt>{zh ? "可能影响" : "Impact"}</dt>
                        <dd>{businessImpact}</dd>
                      </div>
                      <div>
                        <dt>{zh ? "风险说明" : "Risk"}</dt>
                        <dd><b>{risk.label}</b><span>{risk.explanation}</span></dd>
                      </div>
                    </dl>
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
                      aria-label={zh ? `允许并执行：${businessAction}` : `Allow and run: ${businessAction}`}
                    >
                      <Check size={14} />
                      {zh ? "允许并执行" : "Allow and run"}
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
                        {zh ? "取消工具连接" : "Cancel MCP"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="reject"
                      onClick={() => void decidePendingApproval(approval, false)}
                      aria-label={zh ? `拒绝并停止：${businessAction}` : `Reject and stop: ${businessAction}`}
                    >
                      <XCircle size={14} />
                      {zh ? "拒绝并停止" : "Reject and stop"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="approval-mcp-audit-panel" aria-label={zh ? "工具执行审计" : "MCP execution audit"}>
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "工具审计" : "MCP audit"}</span>
            <h3>{zh ? "工具执行记录" : "Tool execution history"}</h3>
          </div>
          <strong>{mcpExecutionAudits.length}</strong>
        </div>
        {mcpExecutionAudits.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "当前工作区还没有工具执行记录。" : "No MCP tool executions recorded for this workspace."}
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
                      {attachingMcpAuditId === entry.id ? (zh ? "正在附加" : "Attaching") : (zh ? "附加结果" : "Attach result")}
                    </button>
                  </div>
                ) : null}
                <p>{entry.verification}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="approval-mcp-active-panel" aria-label={zh ? "正在运行的工具连接" : "Running MCP sessions"}>
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "正在运行" : "MCP running"}</span>
            <h3>{zh ? "活动连接" : "Active sessions"}</h3>
          </div>
          <strong>{mcpActiveSessions.length}</strong>
        </div>
        {mcpActiveSessions.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "当前工作区没有正在运行的工具连接。" : "No MCP stdio sessions are running for this workspace."}
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
                  {zh ? "取消工具连接" : "Cancel MCP"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="approval-mcp-reusable-panel" aria-label={zh ? "可复用工具连接" : "Reusable MCP session pool"}>
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "连接池" : "MCP pool"}</span>
            <h3>{zh ? "可复用连接" : "Reusable sessions"}</h3>
          </div>
          <strong>{mcpReusableSessions.length}</strong>
        </div>
        {mcpReusableSessions.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "当前工作区没有可复用的工具连接。" : "No reusable MCP sessions are pooled for this workspace."}
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
                    {session.restartDetectedAt
                      ? ` / restart detected ${session.restartDetectedAt}`
                      : ""}
                  </small>
                  <code>{session.command}</code>
                </div>
                {session.status === "restart_reconnect_required" ? (
                  <span className="approval-mcp-reconnect-pill">{zh ? "需要重新连接" : "Reconnect required"}</span>
                ) : (
                  <button
                    type="button"
                    className={session.status === "busy" ? "reject" : "cancel"}
                    onClick={() => void closeMcpReusableSession(session)}
                  >
                    <XCircle size={14} />
                    {session.status === "busy" ? (zh ? "关闭连接" : "Close session") : (zh ? "关闭空闲连接" : "Close idle")}
                  </button>
                )}
                {session.stderrPreview ? <p>{session.stderrPreview}</p> : null}
                {session.diagnosticMessage ? <p>{session.diagnosticMessage}</p> : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="approval-mcp-session-panel" aria-label={zh ? "工具连接生命周期审计" : "MCP session lifecycle audit"}>
        <div className="approval-pending-header">
          <div>
            <span>{zh ? "工具连接" : "MCP sessions"}</span>
            <h3>{zh ? "生命周期记录" : "Lifecycle history"}</h3>
          </div>
          <strong>{mcpSessionAudits.length}</strong>
        </div>
        {mcpSessionAudits.length === 0 ? (
          <p className="approval-pending-empty">
            {zh ? "当前工作区还没有工具连接生命周期记录。" : "No MCP session lifecycle events recorded for this workspace."}
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
                <span>{zh ? approvalGroupLabel(row.group) : row.group}</span>
                <strong>{zh ? approvalActionLabel(row.action) : row.label}</strong>
                {zh ? null : <code>{row.action}</code>}
              </div>
              <div className="approval-action-decision">
                <b>
                  {state === "allowed"
                    ? (zh ? "已允许" : "Allowed")
                    : state === "approval"
                      ? (zh ? "需要确认" : "Approval required")
                      : (zh ? "已阻止" : "Blocked")}
                </b>
                <small>{zh ? approvalDecisionReason(state) : row.decision.reason}</small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function approvalGroupLabel(group: string): string {
  return ({ Chat: "对话", Browser: "浏览器", Workspace: "工作区", Terminal: "命令执行", Git: "版本记录", Fork: "并行任务", Workflow: "自动流程", Network: "外部连接" } as Record<string, string>)[group] ?? group;
}

function approvalActionLabel(action: ExecutionActionKind): string {
  return ({
    "chat.model_call": "请求智能服务",
    "browser.read": "读取网页",
    "browser.interact": "操作网页",
    "browser.sensitive_interact": "执行敏感网页操作",
    "workspace.read": "读取工作区文件",
    "workspace.diff": "查看文件差异",
    "workspace.checkpoint": "保存恢复点",
    "workspace.stage": "准备文件变更",
    "workspace.revert": "撤销文件变更",
    "terminal.create": "打开命令窗口",
    "terminal.write": "输入命令",
    "shell.command": "执行系统命令",
    "git.commit": "保存版本记录",
    "fork.lifecycle": "管理并行任务",
    "fork.queue_start": "启动并行任务",
    "workflow.run": "运行自动流程",
    "network.request": "访问外部网络",
    "external.service": "使用外部服务",
  } as Record<ExecutionActionKind, string>)[action];
}

function approvalBusinessAction(approval: DesktopPendingApproval, zh: boolean): string {
  const explicit = approval.businessAction?.trim();
  if (explicit) return explicit;
  const existingTitle = approval.title.trim();
  if (existingTitle) return existingTitle;
  if (zh) return approvalActionLabel(approval.actionKind);
  return ACTION_CATALOG.find((item) => item.action === approval.actionKind)?.label ?? "Review requested operation";
}

function approvalBusinessObject(approval: DesktopPendingApproval, zh: boolean): string {
  return approval.businessObject?.trim()
    || approval.target?.trim()
    || approval.title.trim()
    || (zh ? "本次操作涉及的内容" : "Content involved in this operation");
}

function approvalBusinessScope(approval: DesktopPendingApproval, zh: boolean): string {
  return approval.scope?.trim()
    || (zh ? "仅限当前工作区的这一次操作" : "This operation in the current workspace only");
}

function approvalBusinessImpact(approval: DesktopPendingApproval, zh: boolean): string {
  return approval.impact?.trim()
    || approval.detail.trim()
    || (zh ? "执行后可能改变当前任务或材料。" : "This may change the current task or its materials.");
}

function approvalRiskPresentation(
  risk: DesktopPendingApproval["risk"],
  zh: boolean,
): { label: string; explanation: string } {
  if (risk === "high") {
    return zh
      ? { label: "高风险", explanation: "可能改变或删除文件、向外发送数据，或产生计算费用。" }
      : { label: "High risk", explanation: "May change or delete files, send data outside this device, or incur compute costs." };
  }
  if (risk === "medium") {
    return zh
      ? { label: "中等风险", explanation: "会改变当前任务状态，执行前请核对对象和范围。" }
      : { label: "Medium risk", explanation: "Changes task state; review the object and scope before continuing." };
  }
  return zh
    ? { label: "低风险", explanation: "以读取或检查为主，不会直接修改原始材料。" }
    : { label: "Low risk", explanation: "Primarily reads or checks information without directly changing source materials." };
}

function approvalDecisionReason(state: "allowed" | "approval" | "blocked"): string {
  if (state === "allowed") return "该操作符合当前工作区的权限设置。";
  if (state === "approval") return "执行前需要你确认操作对象和影响。";
  return "当前权限设置不允许执行该操作。";
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
