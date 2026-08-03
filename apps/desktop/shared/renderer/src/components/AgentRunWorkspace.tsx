import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronUp, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import type {
  AgentRunEvent,
  AgentRunFileEvent,
  AgentTaskDepth,
  ChatAttachment,
  DesktopBackgroundTask,
  DesktopFailureRecovery,
  DesktopTaskPlanStep,
  DesktopHealth,
  WorkspaceInstructionSummary,
} from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi } from "../desktopApi";
import { buildAgentTaskPlan } from "@shared/agentTaskPlan";
import { AGENT_TASK_DEPTHS } from "@shared/agentTaskDepth";

interface AgentRunWorkspaceProps {
  health: DesktopHealth | null;
  fileContextAttachments?: ChatAttachment[];
  initialTask?: string;
  language: AppLanguage;
  onAgentFileEvent?: (event: {
    fileEvent: AgentRunFileEvent;
    requestId: string;
    runId: string;
  }) => void;
  onFileContextSent?: (event: {
    attachments: ChatAttachment[];
    requestId: string;
    runId: string;
  }) => void;
  onRunComplete?: () => void;
  onProposeTerminalCommand?: (command: string) => void;
  threadId?: string;
  workspaceInstructions?: WorkspaceInstructionSummary[];
  workspacePath?: string;
  workspaceTrusted?: boolean;
}

interface AgentRunLine {
  id: string;
  role: "system" | "agent" | "error";
  content: string;
}

type AgentBusinessStage = "understand_materials" | "organize_findings" | "prepare_result" | "ready" | "stopped";

interface AgentBusinessProgress {
  requestId: string;
  sourceEvent: AgentRunEvent["type"];
  stage: AgentBusinessStage;
  title: string;
  message: string;
  nextAction: string;
  progress: number;
}

const agentBusinessStages: Array<{ stage: AgentBusinessStage; label: string }> = [
  { stage: "understand_materials", label: "理解任务与材料" },
  { stage: "organize_findings", label: "整理发现" },
  { stage: "prepare_result", label: "整理成果" },
  { stage: "ready", label: "成果就绪" },
];

export function AgentRunWorkspace({
  health,
  fileContextAttachments = [],
  initialTask,
  language,
  onAgentFileEvent,
  onFileContextSent,
  onRunComplete,
  onProposeTerminalCommand,
  threadId,
  workspaceInstructions,
  workspacePath,
  workspaceTrusted = true,
}: AgentRunWorkspaceProps): React.JSX.Element {
  const zh = language === "zh";
  const [liveGatewayReady, setLiveGatewayReady] = useState(Boolean(health?.gatewayReady));
  const canRun = Boolean((health?.gatewayReady || liveGatewayReady) && workspaceTrusted);
  const [task, setTask] = useState("");
  const [executionDepth, setExecutionDepth] = useState<AgentTaskDepth>("standard");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [businessProgress, setBusinessProgress] = useState<AgentBusinessProgress | null>(null);
  const [plannedTask, setPlannedTask] = useState<DesktopBackgroundTask | null>(null);
  const [editablePlan, setEditablePlan] = useState<DesktopTaskPlanStep[] | null>(null);
  const [newPlanRequirement, setNewPlanRequirement] = useState("");
  const [lines, setLines] = useState<AgentRunLine[]>([
    {
      id: "welcome",
      role: "system",
      content: "Describe a task and run an OpenDrSai agent in the current workspace.",
    },
  ]);
  const outputByRequest = useRef<Record<string, string>>({});
  const recoveredThreadRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialTask) setTask(initialTask);
  }, [initialTask]);

  useEffect(() => {
    let active = true;
    const refreshGateway = async () => {
      try {
        const gateway = await desktopApi.getGatewayStatus();
        if (active) setLiveGatewayReady(gateway.ready === true);
      } catch {
        if (active) setLiveGatewayReady(false);
      }
    };
    void refreshGateway();
    const timer = window.setInterval(() => void refreshGateway(), 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (health?.gatewayReady) setLiveGatewayReady(true);
  }, [health?.gatewayReady]);

  useEffect(() => {
    return desktopApi.onAgentRunEvent((event) => {
      applyAgentRunEvent(event);
    });
  });

  useEffect(() => {
    if (!threadId || recoveredThreadRef.current === threadId) return;
    recoveredThreadRef.current = threadId;
    void desktopApi.recoverAgentRun(threadId).then((events) => {
      for (const event of events) applyAgentRunEvent(event);
    }).catch(() => undefined);
  }, [threadId]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = task.trim();
    if (!text || activeRequestId || !canRun) return;
    const executionPlan = editablePlan?.map((step) => ({ ...step }));
    const requestId = crypto.randomUUID();
    const runId = requestId;
    outputByRequest.current[requestId] = "";
    setActiveRequestId(requestId);
    setActiveRunId(runId);
    setBusinessProgress({
      requestId,
      sourceEvent: "start",
      stage: "understand_materials",
      title: zh ? "正在理解任务与材料" : "Understanding the task and materials",
      message: zh ? "正在确认你的目标，并读取本次提供的材料。" : "Confirming your goal and reading the supplied materials.",
      nextAction: zh ? "接下来：梳理材料中的共同点、差异和待确认问题。" : "Next: organize agreements, differences, and open questions.",
      progress: 10,
    });
    setLines((current) => [
      ...current,
      { id: `task-${requestId}`, role: "system", content: text },
      { id: `agent-${requestId}`, role: "agent", content: "Starting agent..." },
    ]);
    setTask("");
    setEditablePlan(null);
    setNewPlanRequirement("");
    setPlannedTask(null);

    try {
      const checkpoint = workspacePath
        ? await desktopApi.createWorkspaceCheckpoint({
            workspacePath,
            label: `${zh ? "智能体运行前" : "Before agent run"} ${runId.slice(0, 8)}`,
            kind: "agent_run_baseline",
            runId,
            maxFiles: 200,
            maxBytesPerFile: 2_000_000,
          })
        : null;
      if (checkpoint && (checkpoint.truncated || checkpoint.skippedFileCount > 0)) {
        throw new Error(
          zh
            ? "无法完整保存运行前状态：现有变更文件过多，或包含超过 2 MB / 不可保存的文件。为避免丢失用户修改，智能体任务未启动。"
            : "The pre-run state could not be captured completely because existing changes exceed checkpoint limits or include files larger than 2 MB. The agent was not started to protect user work.",
        );
      }
      const workspaceInstructionText = buildWorkspaceInstructionText(workspaceInstructions);
      await desktopApi.startAgentRun({
        requestId,
        runId,
        threadId,
        sessionId: threadId || requestId,
        task: workspaceInstructionText
          ? `${workspaceInstructionText}\n\nTask:\n${text}`
          : text,
        executionDepth,
        ...(executionPlan?.length ? { executionPlan } : {}),
        workspacePath,
        files: fileContextAttachments.map(serializeAgentRunFileContext),
        teamConfig: { preset: "general-collaboration" },
        metadata: {
          source: "windows-agent-run-workspace",
          ...(checkpoint ? { change_set_checkpoint_id: checkpoint.id } : {}),
          file_context_count: fileContextAttachments.length,
          file_context_paths: fileContextAttachments.map((attachment) => attachment.path),
          workspace_instructions: workspaceInstructions || [],
        },
      });
      if (fileContextAttachments.length > 0) {
        onFileContextSent?.({ attachments: fileContextAttachments, requestId, runId });
      }
    } catch (error) {
      delete outputByRequest.current[requestId];
      setActiveRequestId(null);
      setActiveRunId(null);
      setTask(text);
      setEditablePlan(executionPlan ?? null);
      setLines((current) => [
        ...current,
        {
          id: `error-${requestId}`,
          role: "error",
          content: error instanceof Error ? error.message : "Agent run failed to start.",
        },
      ]);
    }
  }

  async function abort(): Promise<void> {
    if (!activeRequestId) return;
    await desktopApi.abortAgentRun(activeRequestId);
    setActiveRequestId(null);
  }

  function applyAgentRunEvent(event: AgentRunEvent): void {
    void refreshTaskPlan(event.requestId, event.type);
    if (event.type === "start") {
      setActiveRequestId(event.requestId);
      setActiveRunId(event.runId);
      replaceAgentLine(event.requestId, "Agent started. Waiting for output...");
      setBusinessProgress(toAgentBusinessProgress(event, zh));
      return;
    }
    if (event.type === "chunk") {
      const next = `${outputByRequest.current[event.requestId] || ""}${event.content || ""}`;
      outputByRequest.current[event.requestId] = next;
      replaceAgentLine(event.requestId, next);
      setBusinessProgress(toAgentBusinessProgress(event, zh));
      return;
    }
    if (event.type === "status") {
      setLines((current) => {
        const id = `network-status-${event.requestId}`;
        const next = { id, role: "system" as const, content: event.content || "网络状态已更新。" };
        const existing = current.findIndex((line) => line.id === id);
        return existing >= 0
          ? current.map((line, index) => index === existing ? next : line)
          : [...current, next];
      });
      return;
    }
    if (event.type === "plan_adjustment" && event.planAdjustment) {
      const adjustment = event.planAdjustment;
      setLines((current) => [
        ...current.filter((line) => line.id !== `plan-adjustment-${adjustment.id}`),
        {
          id: `plan-adjustment-${adjustment.id}`,
          role: "system",
          content: `${zh ? "计划已调整" : "Plan adjusted"}：${adjustment.failedStepTitle}。${zh ? "原因" : "Reason"}：${adjustment.reason}。${zh ? "改为" : "Replacement"}：${adjustment.replacementStepTitle}。`,
        },
      ]);
      return;
    }
    if (event.type === "file_event" && event.fileEvent) {
      setBusinessProgress(toAgentBusinessProgress(event, zh));
      onAgentFileEvent?.({
        fileEvent: event.fileEvent,
        requestId: event.requestId,
        runId: event.runId,
      });
      return;
    }
    if (event.type === "done" || event.type === "aborted") {
      delete outputByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
      setActiveRunId((current) => (current === event.runId ? null : current));
      if (event.type === "aborted") {
        replaceAgentLine(event.requestId, "Agent run stopped.");
      } else {
        onRunComplete?.();
      }
      setBusinessProgress(toAgentBusinessProgress(event, zh));
      removeStatusLine(event.requestId);
      return;
    }
    if (event.type === "error") {
      delete outputByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
      setActiveRunId((current) => (current === event.runId ? null : current));
      const failureMessage = event.failureRecovery
        ? formatAgentFailure(event.failureRecovery, zh)
        : event.error || "Agent run failed.";
      replaceAgentLine(event.requestId, failureMessage, "error");
      setBusinessProgress(toAgentBusinessProgress(event, zh));
      removeStatusLine(event.requestId);
    }
  }

  function openPlanEditor(): void {
    const text = task.trim();
    if (!text) return;
    setEditablePlan(buildAgentTaskPlan(text));
  }

  function updatePlanTitle(id: string, title: string): void {
    setEditablePlan((current) => current?.map((step) => step.id === id ? { ...step, title } : step) ?? null);
  }

  function movePlanStep(index: number, direction: -1 | 1): void {
    setEditablePlan((current) => {
      if (!current) return null;
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removePlanStep(id: string): void {
    setEditablePlan((current) => current?.filter((step) => step.id !== id) ?? null);
  }

  function addPlanRequirement(): void {
    const title = newPlanRequirement.trim();
    if (!title) return;
    setEditablePlan((current) => [
      ...(current ?? buildAgentTaskPlan(task.trim())),
      { id: `custom-${crypto.randomUUID()}`, phase: "check", title },
    ]);
    setNewPlanRequirement("");
  }

  async function refreshTaskPlan(requestId: string, eventType: AgentRunEvent["type"]): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const backgroundTasks = await desktopApi.listBackgroundTasks({ limit: 100 });
      const matchingTask = backgroundTasks.find((item) => item.kind === "agent_run" && item.targetId === requestId);
      const eventStateReady = eventType === "done"
        ? matchingTask?.status === "completed" || matchingTask?.status === "blocked"
        : eventType === "plan_adjustment"
          ? (matchingTask?.planAdjustments?.length ?? 0) > 0
        : eventType === "file_event"
          ? (matchingTask?.completedSteps?.length ?? 0) >= 3
          : eventType === "chunk"
            ? (matchingTask?.completedSteps?.length ?? 0) >= 1
            : Boolean(matchingTask);
      if (matchingTask?.planSteps?.length && eventStateReady) {
        setPlannedTask(matchingTask);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  function removeStatusLine(requestId: string): void {
    setLines((current) => current.filter((line) => line.id !== `network-status-${requestId}`));
  }

  function replaceAgentLine(
    requestId: string,
    content: string,
    role: AgentRunLine["role"] = "agent",
  ): void {
    setLines((current) =>
      current.map((line) =>
        line.id === `agent-${requestId}` ? { ...line, role, content } : line,
      ),
    );
  }

  return (
    <div className="agent-run-workspace">
      <section className="agent-run-header">
        <Bot size={22} />
        <div>
          <h2>{zh ? "Agent Run" : "Agent Run"}</h2>
          <p>
            {canRun
              ? "Run a stoppable agent task in the current workspace."
              : !workspaceTrusted
                ? "Trust this workspace in workspace details before running an agent task."
                : "Prepare the local runtime before running an agent."}
          </p>
        </div>
      </section>

      <div className="agent-run-output" aria-live="polite">
        {businessProgress ? (
          <section
            className="agent-business-progress"
            data-testid="agent-business-progress"
            data-business-stage={businessProgress.stage}
            data-source-event={businessProgress.sourceEvent}
          >
            <div className="agent-business-progress-heading">
              <div>
                <strong>{businessProgress.title}</strong>
                <p>{businessProgress.message}</p>
              </div>
              <span>{businessProgress.progress}%</span>
            </div>
            <ol aria-label={zh ? "任务进度" : "Task progress"}>
              {agentBusinessStages.map((item, index) => {
                const activeIndex = agentBusinessStages.findIndex((candidate) => candidate.stage === businessProgress.stage);
                const done = businessProgress.stage === "ready" || (activeIndex >= 0 && index < activeIndex);
                const current = item.stage === businessProgress.stage;
                return (
                  <li className={done ? "done" : current ? "current" : ""} key={item.stage} aria-current={current ? "step" : undefined}>
                    <span aria-hidden="true">{done ? "✓" : current ? "●" : "○"}</span>
                    {zh ? item.label : ["Understand", "Organize", "Prepare result", "Ready"][index]}
                  </li>
                );
              })}
            </ol>
            <small>{businessProgress.nextAction}</small>
          </section>
        ) : null}
        {plannedTask?.planSteps?.length ? (
          <section className="background-task-plan agent-task-plan" data-testid="agent-task-plan">
            <strong>{zh ? "执行计划" : "Plan"}</strong>
            <ol>
              {plannedTask.planSteps.map((step) => {
                const completed = plannedTask.completedSteps?.includes(step.title) === true;
                const adjusted = plannedTask.planAdjustments?.some((item) => item.failedStepId === step.id || item.failedStepTitle === step.title) === true;
                const active = !completed && plannedTask.currentStep === step.title;
                return (
                  <li
                    data-phase={step.phase}
                    data-plan-state={adjusted ? "adjusted" : completed ? "completed" : active ? "active" : "pending"}
                    key={step.id}
                  >
                    <span aria-hidden="true">{adjusted ? "⚠" : completed ? "✓" : active ? "→" : "○"}</span>
                    <span>{step.title}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
        {plannedTask?.planAdjustments?.length ? (() => {
          const adjustment = plannedTask.planAdjustments[plannedTask.planAdjustments.length - 1];
          return (
            <section className="agent-plan-adjustment" data-testid="agent-plan-adjustment" data-completeness={adjustment.completeness} role="status">
              <header><span aria-hidden="true">⚠</span><strong>{zh ? "计划已调整，结果不完整" : "Plan adjusted; result incomplete"}</strong></header>
              <dl>
                <div><dt>{zh ? "未完成步骤" : "Step not completed"}</dt><dd>{adjustment.failedStepTitle}</dd></div>
                <div><dt>{zh ? "原因" : "Reason"}</dt><dd>{adjustment.reason}</dd></div>
                <div><dt>{zh ? "改为" : "Replacement"}</dt><dd>{adjustment.replacementStepTitle}</dd></div>
                <div><dt>{zh ? "对结果的影响" : "Impact on result"}</dt><dd>{adjustment.impact}</dd></div>
              </dl>
            </section>
          );
        })() : null}
        {lines.map((line) => {
          const terminalCommand =
            line.role === "agent" ? extractTerminalCommand(line.content) : "";
          return (
            <article className={`agent-run-line ${line.role}`} key={line.id}>
              <strong>{line.role === "system" ? "Task" : "OpenDrSai"}</strong>
              <p>{line.content}</p>
              {terminalCommand && onProposeTerminalCommand ? (
                <button
                  type="button"
                  className="agent-run-terminal-proposal"
                  onClick={() => onProposeTerminalCommand(terminalCommand)}
                >
                  Preview in terminal
                </button>
              ) : null}
            </article>
          );
        })}
      </div>

      <form className="agent-run-composer" onSubmit={submit}>
        <textarea
          data-testid="agent-task-input"
          value={task}
          onChange={(event) => {
            setTask(event.target.value);
            setEditablePlan(null);
          }}
          placeholder={zh ? "Describe the task for the agent..." : "Describe the task for the agent..."}
          rows={4}
        />
        <fieldset className="agent-depth-selector" data-testid="agent-depth-selector">
          <legend>{zh ? "任务深度" : "Task depth"}</legend>
          <p>{zh ? "深度会改变材料覆盖、检查方式和交付物，而不只是回答长短。" : "Depth changes material coverage, checks, and deliverables—not only response length."}</p>
          <div className="agent-depth-options">
            {AGENT_TASK_DEPTHS.map((option) => (
              <label className={executionDepth === option.id ? "selected" : ""} data-depth={option.id} data-testid={`agent-depth-${option.id}`} key={option.id}>
                <input
                  checked={executionDepth === option.id}
                  name="agent-task-depth"
                  onChange={() => setExecutionDepth(option.id)}
                  type="radio"
                  value={option.id}
                />
                <span>
                  <strong>{zh ? option.label : option.labelEn}</strong>
                  <small>{zh ? option.estimatedTime : option.estimatedTimeEn}</small>
                </span>
                <span>{zh ? option.summary : option.summaryEn}</span>
                <em>{zh ? option.output : option.outputEn}</em>
              </label>
            ))}
          </div>
        </fieldset>
        {editablePlan ? (
          <section className="agent-plan-editor" data-testid="agent-plan-editor">
            <div className="agent-plan-editor-heading">
              <div>
                <strong>{zh ? "编辑执行计划" : "Edit plan"}</strong>
                <small>{zh ? "删除、调整顺序或补充要求；执行时将严格采用这里的计划。" : "Delete, reorder, or add requirements. This plan will control execution."}</small>
              </div>
              <span>{editablePlan.length} {zh ? "步" : "steps"}</span>
            </div>
            <ol>
              {editablePlan.map((step, index) => (
                <li data-phase={step.phase} data-plan-step-id={step.id} key={step.id}>
                  <span className="agent-plan-step-number">{index + 1}</span>
                  <input
                    aria-label={`${zh ? "计划步骤" : "Plan step"} ${index + 1}`}
                    value={step.title}
                    onChange={(event) => updatePlanTitle(step.id, event.target.value)}
                  />
                  <div className="agent-plan-step-actions">
                    <button aria-label={zh ? "上移" : "Move up"} data-plan-action="move-up" disabled={index === 0} onClick={() => movePlanStep(index, -1)} type="button"><ChevronUp size={15} /></button>
                    <button aria-label={zh ? "下移" : "Move down"} data-plan-action="move-down" disabled={index === editablePlan.length - 1} onClick={() => movePlanStep(index, 1)} type="button"><ChevronDown size={15} /></button>
                    <button aria-label={zh ? "删除步骤" : "Delete step"} data-plan-action="delete" disabled={editablePlan.length === 1} onClick={() => removePlanStep(step.id)} type="button"><Trash2 size={15} /></button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="agent-plan-add-requirement">
              <input
                aria-label={zh ? "新增计划要求" : "New plan requirement"}
                data-testid="agent-plan-new-requirement"
                placeholder={zh ? "例如：必须有引用" : "For example: citations required"}
                value={newPlanRequirement}
                onChange={(event) => setNewPlanRequirement(event.target.value)}
              />
              <button data-testid="agent-plan-add-requirement" disabled={!newPlanRequirement.trim()} onClick={addPlanRequirement} type="button"><Plus size={15} />{zh ? "添加" : "Add"}</button>
            </div>
          </section>
        ) : null}
        <div className="agent-run-actions">
          <span>
            {activeRunId
              ? `Running: ${activeRunId.slice(0, 8)}`
              : `${workspacePath || "Local workspace"} - ${fileContextAttachments.length} file context`}
          </span>
          {activeRequestId ? (
            <button type="button" className="composer-submit stop" onClick={abort}>
              <Square size={16} />
              {zh ? "Stop" : "Stop"}
            </button>
          ) : (
            <div className="agent-run-plan-actions">
              <button type="button" className="agent-plan-edit-button" data-testid="agent-plan-edit-button" disabled={!task.trim()} onClick={openPlanEditor}>
                <Pencil size={15} />
                {editablePlan ? (zh ? "重新生成计划" : "Reset plan") : (zh ? "编辑计划" : "Edit plan")}
              </button>
              <button type="submit" className="composer-submit" data-testid="agent-run-submit" disabled={!task.trim() || !canRun || editablePlan?.some((step) => !step.title.trim())}>
                <Play size={16} />
                {zh ? "Run" : "Run"}
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function formatAgentFailure(
  recovery: DesktopFailureRecovery,
  zh: boolean,
): string {
  if (!zh) return `${recovery.message}\n${recovery.suggestedAction}`;
  const title = recovery.kind === "permission_denied"
    ? "Codex 需要重新登录。"
    : recovery.kind === "external_service"
      ? "Codex 服务暂时不可用。"
      : recovery.kind === "network"
        ? "连接已中断。"
        : "任务没有完成。";
  const action = recovery.retryable
    ? "请重试；如果问题仍然存在，请在设置中运行 Codex 检测。"
    : recovery.escalationLevel === "administrator"
      ? "请安装兼容版本，或联系管理员处理。"
      : "请打开诊断信息查看处理建议。";
  return `${title}\n${action}`;
}

function toAgentBusinessProgress(event: AgentRunEvent, zh: boolean): AgentBusinessProgress {
  const copy = (stage: AgentBusinessStage, titleZh: string, titleEn: string, messageZh: string, messageEn: string, nextZh: string, nextEn: string, progress: number): AgentBusinessProgress => ({
    requestId: event.requestId,
    sourceEvent: event.type,
    stage,
    title: zh ? titleZh : titleEn,
    message: zh ? messageZh : messageEn,
    nextAction: zh ? nextZh : nextEn,
    progress,
  });
  if (event.type === "start") return copy("understand_materials", "正在理解任务与材料", "Understanding the task and materials", "正在确认你的目标，并读取本次提供的材料。", "Confirming your goal and reading the supplied materials.", "接下来：梳理材料中的共同点、差异和待确认问题。", "Next: organize agreements, differences, and open questions.", 10);
  if (event.type === "chunk") return copy("organize_findings", "正在整理发现", "Organizing findings", "正在对照多份材料，提炼共识、争议和关键依据。", "Comparing the materials and extracting agreements, disagreements, and evidence.", "接下来：把发现整理成清晰、可使用的结果。", "Next: turn the findings into a clear, usable result.", 60);
  if (event.type === "file_event") return copy("prepare_result", "正在整理成果", "Preparing the result", "主要结论已经形成，正在整理输出文件并检查内容。", "The main findings are ready; organizing output files and checking the content.", "接下来：完成检查后交付结果。", "Next: deliver the result after final checks.", 85);
  if (event.type === "done") return copy("ready", "成果已就绪", "Result ready", "材料综合分析已经完成，可以查看结果。", "The multi-material analysis is complete and ready to review.", "你可以查看结果，或继续提出修改要求。", "Review the result or ask for revisions.", 100);
  if (event.type === "aborted") return copy("stopped", "任务已停止", "Task stopped", "任务已按你的要求停止。", "The task was stopped at your request.", "你可以调整要求后重新开始。", "Revise the request and start again.", 0);
  return copy("stopped", "任务未完成", "Task not completed", "本次任务没有完成，请查看原因后重试。", "This task did not complete. Review the reason and try again.", "你可以按提示处理后重新开始。", "Follow the guidance and start again.", 0);
}

function serializeAgentRunFileContext(
  attachment: ChatAttachment,
): Record<string, unknown> {
  return {
    kind: attachment.kind,
    name: attachment.name,
    path: attachment.path,
    file_hash: attachment.fileHash,
    note: attachment.note,
    visible_text: attachment.visibleText,
    title: attachment.title,
  };
}

function buildWorkspaceInstructionText(
  workspaceInstructions: WorkspaceInstructionSummary[] | undefined,
): string {
  if (!workspaceInstructions?.length) return "";
  return [
    "Workspace instructions for this project:",
    ...workspaceInstructions.map((instruction) =>
      `# ${instruction.name}\n${instruction.content}${instruction.truncated ? "\n[truncated]" : ""}`,
    ),
  ].join("\n\n");
}

function extractTerminalCommand(content: string): string {
  const fenceMatch = content.match(
    /```(?:powershell|ps1|pwsh|shell|bash|cmd|sh)?\s*\n([\s\S]*?)```/i,
  );
  if (fenceMatch?.[1]?.trim()) return fenceMatch[1].trim();
  const promptLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:PS>|>|\$)\s+/.test(line))
    .map((line) => line.replace(/^(?:PS>|>|\$)\s+/, ""));
  return promptLines.join("\n").trim();
}
