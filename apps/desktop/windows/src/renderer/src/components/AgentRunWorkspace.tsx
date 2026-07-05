import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Play, Square } from "lucide-react";
import type { AgentRunEvent, DesktopHealth, WorkspaceInstructionSummary } from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi } from "../desktopApi";

interface AgentRunWorkspaceProps {
  health: DesktopHealth | null;
  language: AppLanguage;
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

export function AgentRunWorkspace({
  health,
  language,
  threadId,
  workspaceInstructions,
  workspacePath,
  workspaceTrusted = true,
}: AgentRunWorkspaceProps): React.JSX.Element {
  const zh = language === "zh";
  const canRun = Boolean(health?.installed && health?.gatewayReady && workspaceTrusted);
  const [task, setTask] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lines, setLines] = useState<AgentRunLine[]>([
    {
      id: "welcome",
      role: "system",
      content: zh
        ? "选择一个任务，让 OpenDrSai 智能体在当前工作区中运行。"
        : "Describe a task and run an OpenDrSai agent in the current workspace.",
    },
  ]);
  const outputByRequest = useRef<Record<string, string>>({});

  useEffect(() => {
    return desktopApi.onAgentRunEvent((event) => {
      applyAgentRunEvent(event);
    });
  });

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = task.trim();
    if (!text || activeRequestId || !canRun) return;
    const requestId = crypto.randomUUID();
    const runId = requestId;
    outputByRequest.current[requestId] = "";
    setActiveRequestId(requestId);
    setActiveRunId(runId);
    setLines((current) => [
      ...current,
      { id: `task-${requestId}`, role: "system", content: text },
      { id: `agent-${requestId}`, role: "agent", content: zh ? "正在启动智能体..." : "Starting agent..." },
    ]);
    setTask("");

    try {
      const workspaceInstructionText = buildWorkspaceInstructionText(workspaceInstructions);
      await desktopApi.startAgentRun({
        requestId,
        runId,
        threadId,
        sessionId: threadId || requestId,
        task: workspaceInstructionText ? `${workspaceInstructionText}\n\nTask:\n${text}` : text,
        workspacePath,
        files: [],
        teamConfig: { preset: "general-collaboration" },
        metadata: {
          source: "windows-agent-run-workspace",
          workspace_instructions: workspaceInstructions || [],
        },
      });
    } catch (error) {
      delete outputByRequest.current[requestId];
      setActiveRequestId(null);
      setActiveRunId(null);
      setTask(text);
      setLines((current) => [
        ...current,
        {
          id: `error-${requestId}`,
          role: "error",
          content: error instanceof Error ? error.message : zh ? "智能体运行未能启动。" : "Agent run failed to start.",
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
    if (event.type === "start") {
      setActiveRequestId(event.requestId);
      setActiveRunId(event.runId);
      replaceAgentLine(event.requestId, zh ? "智能体已启动，等待输出..." : "Agent started. Waiting for output...");
      return;
    }
    if (event.type === "chunk") {
      const next = `${outputByRequest.current[event.requestId] || ""}${event.content || ""}`;
      outputByRequest.current[event.requestId] = next;
      replaceAgentLine(event.requestId, next);
      return;
    }
    if (event.type === "done" || event.type === "aborted") {
      delete outputByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
      setActiveRunId((current) => (current === event.runId ? null : current));
      if (event.type === "aborted") {
        replaceAgentLine(event.requestId, zh ? "智能体运行已停止。" : "Agent run stopped.");
      }
      return;
    }
    if (event.type === "error") {
      delete outputByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
      setActiveRunId((current) => (current === event.runId ? null : current));
      replaceAgentLine(event.requestId, event.error || (zh ? "智能体运行失败。" : "Agent run failed."), "error");
    }
  }

  function replaceAgentLine(requestId: string, content: string, role: AgentRunLine["role"] = "agent"): void {
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
          <h2>{zh ? "智能体运行" : "Agent Run"}</h2>
          <p>
            {canRun
              ? zh ? "在当前工作区启动一次可停止的智能体任务。" : "Run a stoppable agent task in the current workspace."
              : !workspaceTrusted
                ? zh ? "请先在工作区详情中信任该工作区，再运行智能体任务。" : "Trust this workspace in workspace details before running an agent task."
              : zh ? "请先完成本地运行时和网关准备。" : "Prepare the local runtime and gateway before running an agent."}
          </p>
        </div>
      </section>

      <div className="agent-run-output" aria-live="polite">
        {lines.map((line) => (
          <article className={`agent-run-line ${line.role}`} key={line.id}>
            <strong>{line.role === "system" ? (zh ? "任务" : "Task") : "OpenDrSai"}</strong>
            <p>{line.content}</p>
          </article>
        ))}
      </div>

      <form className="agent-run-composer" onSubmit={submit}>
        <textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder={zh ? "描述要智能体完成的任务..." : "Describe the task for the agent..."}
          rows={4}
        />
        <div className="agent-run-actions">
          <span>{activeRunId ? `${zh ? "运行中" : "Running"}: ${activeRunId.slice(0, 8)}` : workspacePath || "Local workspace"}</span>
          {activeRequestId ? (
            <button type="button" className="composer-submit stop" onClick={abort}>
              <Square size={16} />
              {zh ? "停止" : "Stop"}
            </button>
          ) : (
            <button type="submit" className="composer-submit" disabled={!task.trim() || !canRun}>
              <Play size={16} />
              {zh ? "运行" : "Run"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function buildWorkspaceInstructionText(workspaceInstructions: WorkspaceInstructionSummary[] | undefined): string {
  if (!workspaceInstructions?.length) return "";
  return [
    "Workspace instructions for this project:",
    ...workspaceInstructions.map((instruction) =>
      `# ${instruction.name}\n${instruction.content}${instruction.truncated ? "\n[truncated]" : ""}`,
    ),
  ].join("\n\n");
}
