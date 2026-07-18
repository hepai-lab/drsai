import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardPaste,
  Copy,
  FolderOpen,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { recordRecentTerminalTestResult } from "../terminalTestResults";
import type {
  ChatAttachment,
  TerminalSessionInfo,
  TerminalShellProfile,
} from "@shared/desktopApi";

interface WorkflowTerminalCommandProposal {
  command: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

interface TerminalPanelProps {
  cwd?: string;
  workspaceId?: string;
  remoteHostAlias?: string;
  language: AppLanguage;
  onCommandResult?: (attachment: ChatAttachment) => void;
  onSendOutputToAgent?: (text: string) => void;
  proposedCommand?: string | WorkflowTerminalCommandProposal | null;
}

type CommandRisk = "read_only" | "write" | "network" | "process" | "destructive";
type CommandRunStatus = "pending" | "running" | "succeeded" | "failed" | "stopped";

interface CommandProposal {
  id: string;
  command: string;
  risk: CommandRisk;
  reason: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

interface CommandRun {
  id: string;
  command: string;
  risk: CommandRisk;
  status: CommandRunStatus;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  output?: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

export function TerminalPanel({
  cwd,
  workspaceId,
  remoteHostAlias,
  language: _language,
  onCommandResult,
  onSendOutputToAgent,
  proposedCommand,
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const reportedCommandResultsRef = useRef<Set<string>>(new Set());
  const reportedWorkflowStepResultsRef = useRef<Set<string>>(new Set());
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [statusNote, setStatusNote] = useState("Loading...");
  const [terminalBuffer, setTerminalBuffer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selectedShellProfile, setSelectedShellProfile] =
    useState<TerminalShellProfile>("powershell");
  const [commandDraft, setCommandDraft] = useState("");
  const [commandProposal, setCommandProposal] = useState<CommandProposal | null>(null);
  const [commandRuns, setCommandRuns] = useState<CommandRun[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    canCopy: boolean;
  } | null>(null);
  const workspaceKey = cwd || "default";

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const runningCommand = useMemo(
    () => commandRuns.find((run) => run.status === "running") ?? null,
    [commandRuns],
  );
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return 0;
    const source = terminalBuffer.toLowerCase();
    let count = 0;
    let index = source.indexOf(query);
    while (index !== -1) {
      count += 1;
      index = source.indexOf(query, index + query.length);
    }
    return count;
  }, [searchQuery, terminalBuffer]);
  const showToolDrawer = toolsOpen || Boolean(commandProposal) || Boolean(runningCommand);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(commandHistoryKey(workspaceKey));
      const parsed = raw ? JSON.parse(raw) : [];
      setCommandHistory(Array.isArray(parsed) ? parsed.slice(0, 12) : []);
      const shell = window.localStorage.getItem(terminalShellKey(workspaceKey));
      if (["powershell", "pwsh", "cmd", "git-bash", "wsl"].includes(shell || "")) {
        setSelectedShellProfile(shell as TerminalShellProfile);
      }
    } catch {
      setCommandHistory([]);
    }
  }, [workspaceKey]);

  useEffect(() => {
    if (activeSessionId) window.localStorage.setItem(terminalSelectionKey(workspaceKey), activeSessionId);
  }, [activeSessionId, workspaceKey]);

  useEffect(() => {
    window.localStorage.setItem(terminalShellKey(workspaceKey), selectedShellProfile);
  }, [selectedShellProfile, workspaceKey]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(commandRunsKey(workspaceKey));
      const parsed = raw ? JSON.parse(raw) : [];
      setCommandRuns(Array.isArray(parsed) ? parsed.slice(0, 12) : []);
      reportedCommandResultsRef.current = new Set(
        Array.isArray(parsed)
          ? parsed
              .filter((run: CommandRun) =>
                ["succeeded", "failed", "stopped"].includes(run.status),
              )
              .map((run: CommandRun) => run.id)
          : [],
      );
    } catch {
      setCommandRuns([]);
      reportedCommandResultsRef.current = new Set();
    }
  }, [workspaceKey]);

  useEffect(() => {
    window.localStorage.setItem(
      commandRunsKey(workspaceKey),
      JSON.stringify(commandRuns.slice(0, 12)),
    );
  }, [commandRuns, workspaceKey]);

  useEffect(() => {
    for (const run of commandRuns) {
      if (recordRecentTerminalTestResult(workspaceKey, run)) break;
    }
  }, [commandRuns, workspaceKey]);

  useEffect(() => {
    if (!onCommandResult) return;
    for (const run of commandRuns) {
      if (
        !["succeeded", "failed", "stopped"].includes(run.status) ||
        reportedCommandResultsRef.current.has(run.id)
      ) {
        continue;
      }
      reportedCommandResultsRef.current.add(run.id);
      onCommandResult(commandRunToAttachment(run, workspaceKey));
    }
  }, [commandRuns, onCommandResult, workspaceKey]);

  useEffect(() => {
    for (const run of commandRuns) {
      if (
        !run.workflowRunId ||
        !run.workflowStepId ||
        !["succeeded", "failed", "stopped"].includes(run.status) ||
        reportedWorkflowStepResultsRef.current.has(run.id)
      ) {
        continue;
      }
      reportedWorkflowStepResultsRef.current.add(run.id);
      void desktopApi
        .completeWorkflowRunStep({
          runId: run.workflowRunId,
          stepId: run.workflowStepId,
          exitCode:
            run.exitCode ??
            (run.status === "succeeded" ? 0 : run.status === "stopped" ? -1 : 1),
          output: run.output,
        })
        .then((result) => {
          setStatusNote(result.message);
          window.dispatchEvent(
            new CustomEvent("drsai:workflow-run-updated", {
              detail: { run: result.run },
            }),
          );
        })
        .catch((error) => {
          setStatusNote(
            error instanceof Error
              ? error.message
              : "Failed to update workflow run step.",
          );
        });
    }
  }, [commandRuns]);

  useEffect(() => {
    const normalized = normalizeProposedCommand(proposedCommand);
    const command = normalized?.command.trim();
    if (!command) return;
    const risk = classifyCommandRisk(command);
    setCommandDraft(command);
    setToolsOpen(true);
    setCommandProposal({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      command,
      risk: risk.risk,
      reason: risk.reason,
      ...(normalized?.workflowRunId ? { workflowRunId: normalized.workflowRunId } : {}),
      ...(normalized?.workflowStepId ? { workflowStepId: normalized.workflowStepId } : {}),
    });
  }, [proposedCommand]);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const sessionId = activeSessionIdRef.current;
    if (!terminal || !fitAddon) return;
    fitAddon.fit();
    if (sessionId) {
      void desktopApi.resizeTerminal(sessionId, terminal.cols, terminal.rows);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    const next = await desktopApi.listTerminalSessions(workspaceKey, workspaceId);
    setSessions(next);
    setActiveSessionId((current) => {
      if (current && next.some((session) => session.id === current))
        return current;
      const preferred = window.localStorage.getItem(terminalSelectionKey(workspaceKey));
      if (preferred && next.some((session) => session.id === preferred)) return preferred;
      return next[0]?.id ?? null;
    });
    return next;
  }, [workspaceId, workspaceKey]);

  const createSession = useCallback(
    async (title?: string, shellProfile = selectedShellProfile) => {
      const index = sessions.length + 1;
      const session = await desktopApi.createTerminal({
        cwd,
        workspaceId,
        remoteHostAlias,
        workspaceKey,
        title: title || `Terminal ${index}`,
        shellProfile,
        cols: terminalRef.current?.cols,
        rows: terminalRef.current?.rows,
      });
      setSessions((current) => [...current, session]);
      setActiveSessionId(session.id);
      return session;
    },
    [cwd, remoteHostAlias, selectedShellProfile, sessions.length, workspaceId, workspaceKey],
  );

  const showCopied = useCallback(() => {
    setCopyNotice("Copied");
    window.setTimeout(() => setCopyNotice(""), 900);
  }, []);

  const copySelection = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const selectedText = terminal.getSelection();
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      terminal.clearSelection();
      showCopied();
      terminal.focus();
    } catch {
      terminal.writeln("");
      terminal.writeln("Clipboard copy is not available.");
    }
  }, [showCopied]);

  const pasteClipboard = useCallback(async () => {
    const terminal = terminalRef.current;
    const sessionId = activeSessionIdRef.current;
    if (!terminal || !sessionId) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        await desktopApi.writeTerminal(sessionId, text);
        terminal.focus();
      }
    } catch {
      terminal.writeln("");
      terminal.writeln("Clipboard paste is not available. Use Ctrl+V instead.");
    }
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, []);

  const saveCommandHistory = useCallback(
    (command: string) => {
      const next = [
        command,
        ...commandHistory.filter((item) => item !== command),
      ].slice(0, 12);
      setCommandHistory(next);
      window.localStorage.setItem(commandHistoryKey(workspaceKey), JSON.stringify(next));
    },
    [commandHistory, workspaceKey],
  );

  const previewCommand = useCallback(() => {
    const command = commandDraft.trim();
    if (!command) return;
    const risk = classifyCommandRisk(command);
    setToolsOpen(true);
    setCommandProposal({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      command,
      risk: risk.risk,
      reason: risk.reason,
    });
  }, [commandDraft]);

  const runProposedCommand = useCallback(async () => {
    const proposal = commandProposal;
    const sessionId = activeSessionIdRef.current;
    if (!proposal || !sessionId || proposal.risk === "destructive") return;
    const commandId = proposal.id;
    const wrappedCommand = buildCommandInvocation(
      activeSession?.shellProfile || selectedShellProfile,
      proposal.command,
      commandId,
    );

    setCommandRuns((current) => [
      {
        id: commandId,
        command: proposal.command,
        risk: proposal.risk,
        status: "pending",
        startedAt: new Date().toISOString(),
        output: "",
        ...(proposal.workflowRunId ? { workflowRunId: proposal.workflowRunId } : {}),
        ...(proposal.workflowStepId ? { workflowStepId: proposal.workflowStepId } : {}),
      },
      ...current.slice(0, 5),
    ]);
    saveCommandHistory(proposal.command);
    setCommandDraft("");
    setCommandProposal(null);
    const approval = await desktopApi.requestShellCommandApproval({
      terminalSessionId: sessionId,
      commandId,
      command: proposal.command,
      invocation: wrappedCommand,
      risk: approvalRiskForCommand(proposal.risk),
      ...(proposal.workflowRunId ? { workflowRunId: proposal.workflowRunId } : {}),
      ...(proposal.workflowStepId ? { workflowStepId: proposal.workflowStepId } : {}),
    });
    if (approval.blocked || !approval.allowed) {
      setStatusNote(approval.reason);
      setCommandRuns((current) =>
        current.map((item) =>
          item.id === commandId
            ? { ...item, status: "failed", completedAt: new Date().toISOString() }
            : item,
        ),
      );
      return;
    }
    if (approval.queued) {
      setStatusNote("Command is waiting in Approval Center.");
    } else {
      setStatusNote("");
      setCommandRuns((current) =>
        current.map((item) =>
          item.id === commandId ? { ...item, status: "running" } : item,
        ),
      );
    }
    terminalRef.current?.focus();
  }, [activeSession?.shellProfile, commandProposal, saveCommandHistory, selectedShellProfile]);

  const stopRunningCommand = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const run = runningCommand;
    if (!sessionId || !run) return;
    await desktopApi.writeTerminal(sessionId, "\x03");
    setCommandRuns((current) =>
      current.map((item) =>
        item.id === run.id
          ? { ...item, status: "stopped", completedAt: new Date().toISOString() }
          : item,
      ),
    );
  }, [runningCommand]);

  const sendSelectionToAgent = useCallback(() => {
    const terminal = terminalRef.current;
    const selectedText = terminal?.getSelection();
    if (!selectedText || !onSendOutputToAgent) return;
    terminal?.clearSelection();
    onSendOutputToAgent(selectedText);
    showCopied();
  }, [onSendOutputToAgent, showCopied]);

  useEffect(() => {
    let cancelled = false;
    async function loadExistingSessions(): Promise<void> {
      setStatusNote("Loading...");
      setSessions([]);
      setActiveSessionId(null);
      const existing = await desktopApi.listTerminalSessions(workspaceKey);
      if (cancelled) return;
      setSessions(existing);
      setActiveSessionId(existing[0]?.id ?? null);
      setStatusNote(existing.length > 0 ? "" : "Select + to start a terminal.");
    }
    void loadExistingSessions();
    return () => {
      cancelled = true;
    };
  }, [workspaceKey]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    const container = containerRef.current;
    const sessionId = activeSessionId;
    if (!container || !sessionId) return;
    const panel = container;
    const currentSessionId = sessionId;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#ffffff",
        foreground: "#1f2937",
        cursor: "#111827",
        selectionBackground: "#bfdbfe",
        selectionForeground: "#111827",
      },
    });
    const fitAddon = new FitAddon();

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || event.altKey || event.metaKey)
        return true;
      const key = event.key.toLowerCase();
      if (
        event.ctrlKey &&
        key === "c" &&
        (event.shiftKey || !event.shiftKey) &&
        terminal.hasSelection()
      ) {
        void copySelection();
        return false;
      }
      if (event.ctrlKey && event.shiftKey && key === "v") {
        void pasteClipboard();
        return false;
      }
      if (event.ctrlKey && !event.shiftKey && key === "l") {
        clear();
        return false;
      }
      return true;
    });

    terminal.loadAddon(fitAddon);
    terminal.open(panel);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(panel);

    function handleContextMenu(event: MouseEvent): void {
      event.preventDefault();
      const bounds = panel.getBoundingClientRect();
      setContextMenu({
        x: Math.min(event.clientX - bounds.left, Math.max(bounds.width - 170, 0)),
        y: Math.min(event.clientY - bounds.top, Math.max(bounds.height - 190, 0)),
        canCopy: terminal.hasSelection(),
      });
    }

    panel.addEventListener("contextmenu", handleContextMenu);

    const inputDisposable = terminal.onData((data) => {
      void desktopApi.writeTerminal(currentSessionId, data);
    });

    const cleanupData = desktopApi.onTerminalData(({ id, data }) => {
      if (id === currentSessionId) {
        terminal.write(data);
        setCommandRuns((runs) =>
          runs.map((run) =>
            run.status === "running" || run.status === "pending"
              ? {
                  ...run,
                  status: "running",
                  output: `${run.output || ""}${data}`.slice(-12000),
                }
              : run,
          ),
        );
        setTerminalBuffer((current) => {
          const next = `${current}${data}`.slice(-200_000);
          const doneMatch = next
            .slice(-1200)
            .match(/__DRSAI_AGENT_COMMAND_DONE:([^:]+):(-?\d+)__/);
          if (doneMatch) {
            const [, commandId, codeText] = doneMatch;
            const exitCode = Number.parseInt(codeText, 10);
            setCommandRuns((runs) =>
              runs.map((run) =>
                run.id === commandId
                  ? {
                      ...run,
                      status: exitCode === 0 ? "succeeded" : "failed",
                      completedAt: new Date().toISOString(),
                      exitCode,
                    }
                  : run,
              ),
            );
          }
          return next;
        });
      }
    });
    const cleanupExit = desktopApi.onTerminalExit(({ id, exitCode }) => {
      if (id !== currentSessionId) return;
      terminal.writeln("");
      terminal.writeln(`Process exited with code ${exitCode}.`);
      setStatusNote(`Exited (${exitCode})`);
      void refreshSessions();
    });

    async function attach(): Promise<void> {
      fitAddon.fit();
      await desktopApi.resizeTerminal(
        currentSessionId,
        terminal.cols,
        terminal.rows,
      );
      const buffer = await desktopApi.getTerminalBuffer(currentSessionId);
      setTerminalBuffer(buffer);
      if (buffer) terminal.write(buffer);
      terminal.focus();
      setStatusNote("");
    }

    void attach();

    return () => {
      panel.removeEventListener("contextmenu", handleContextMenu);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      cleanupData();
      cleanupExit();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [activeSessionId, clear, copySelection, fitAndResize, pasteClipboard, refreshSessions]);

  const restart = useCallback(async () => {
    if (!activeSession) return;
    await desktopApi.killTerminal(activeSession.id);
    setSessions((current) =>
      current.filter((session) => session.id !== activeSession.id),
    );
    await createSession(activeSession.title, activeSession.shellProfile);
  }, [activeSession, createSession]);

  const closeActiveSession = useCallback(async () => {
    if (!activeSession) return;
    await desktopApi.killTerminal(activeSession.id);
    const next = sessions.filter((session) => session.id !== activeSession.id);
    setSessions(next);
    setActiveSessionId(next[0]?.id ?? null);
    if (next.length === 0) setStatusNote("Select + to start a terminal.");
  }, [activeSession, sessions]);

  const killActiveSession = useCallback(async () => {
    await closeActiveSession();
    setContextMenu(null);
  }, [closeActiveSession]);

  const renameSession = useCallback(async (session: TerminalSessionInfo) => {
    const title = window.prompt("Terminal name", session.title);
    if (!title || title.trim() === session.title) return;
    const renamed = await desktopApi.renameTerminal(session.id, title.trim());
    if (!renamed) return;
    setSessions((current) =>
      current.map((item) => (item.id === renamed.id ? renamed : item)),
    );
  }, []);

  const openWorkspaceFolder = useCallback(() => {
    const path = activeSession?.cwd || cwd;
    if (!path) return;
    void desktopApi.openPath(path);
  }, [activeSession?.cwd, cwd]);

  const runContextAction = useCallback(
    (action: "copy" | "paste" | "clear" | "restart" | "kill") => {
      setContextMenu(null);
      if (action === "copy") void copySelection();
      if (action === "paste") void pasteClipboard();
      if (action === "clear") clear();
      if (action === "restart") void restart();
      if (action === "kill") void killActiveSession();
    },
    [clear, copySelection, killActiveSession, pasteClipboard, restart],
  );

  return (
    <div className="terminal-side-panel">
      <div className="terminal-side-header">
        <div>
          <strong>{activeSession?.title ?? "Terminal"}</strong>
          <span>
            {statusNote ||
              (activeSession
                ? `${shellDisplayName(activeSession.shell)} | PID ${activeSession.pid} | ${activeSession.cwd}`
                : "No session")}
          </span>
        </div>
        <div className="terminal-side-actions">
          {copyNotice && (
            <span className="terminal-copy-notice">{copyNotice}</span>
          )}
          <select
            value={selectedShellProfile}
            onChange={(event) =>
              setSelectedShellProfile(event.target.value as TerminalShellProfile)
            }
            title="Shell for new terminals"
          >
            <option value="powershell">Windows PowerShell</option>
            <option value="pwsh">PowerShell 7</option>
            <option value="cmd">CMD</option>
            <option value="git-bash">Git Bash</option>
            <option value="wsl">WSL</option>
          </select>
          <button
            type="button"
            onClick={() => void createSession()}
            title="New terminal"
          >
            <Plus size={15} />
          </button>
          <button type="button" onClick={restart} title="Restart terminal">
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            onClick={openWorkspaceFolder}
            title="Open workspace folder"
          >
            <FolderOpen size={15} />
          </button>
          <button type="button" onClick={clear} title="Clear terminal">
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            className={showToolDrawer ? "active" : ""}
            onClick={() => setToolsOpen((open) => !open)}
            title="Terminal tools"
          >
            <Search size={15} />
          </button>
        </div>
      </div>
      <div className="terminal-session-tabs">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={session.id === activeSessionId ? "active" : ""}
            onClick={() => setActiveSessionId(session.id)}
            onDoubleClick={() => void renameSession(session)}
            title="Double-click to rename"
          >
            <span>{session.title}</span>
            <X
              size={13}
              onClick={(event) => {
                event.stopPropagation();
                if (session.id === activeSessionId) {
                  void closeActiveSession();
                } else {
                  void desktopApi
                    .killTerminal(session.id)
                    .then(() => refreshSessions());
                }
              }}
            />
          </button>
        ))}
      </div>
      {showToolDrawer ? (
        <div className="terminal-tool-drawer">
          <div className="terminal-search-row">
            <Search size={14} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search output"
            />
            <span>{searchQuery.trim() ? `${searchMatches} matches` : " "}</span>
          </div>
          <form
            className="terminal-agent-command"
            onSubmit={(event) => {
              event.preventDefault();
              previewCommand();
            }}
          >
            <div className="terminal-agent-command-main">
              <ShieldAlert size={14} />
              <input
                value={commandDraft}
                onChange={(event) => setCommandDraft(event.target.value)}
                placeholder="Agent command proposal"
              />
              <button type="submit" disabled={!commandDraft.trim()}>
                Preview
              </button>
              {runningCommand ? (
                <button type="button" className="stop" onClick={stopRunningCommand}>
                  <Square size={13} />
                  Stop
                </button>
              ) : null}
              {onSendOutputToAgent ? (
                <button type="button" onClick={sendSelectionToAgent}>
                  Send selection
                </button>
              ) : null}
            </div>
            {commandProposal ? (
              <div className={`terminal-command-preview ${commandProposal.risk}`}>
                <div>
                  <strong>{riskLabel(commandProposal.risk)}</strong>
                  <span>{commandProposal.reason}</span>
                </div>
                <code>{commandProposal.command}</code>
                <div className="terminal-command-preview-actions">
                  <button
                    type="button"
                    onClick={() => setCommandProposal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={commandProposal.risk === "destructive"}
                    onClick={() => void runProposedCommand()}
                  >
                    <Play size={13} />
                    Run visibly
                  </button>
                </div>
              </div>
            ) : null}
            {commandRuns.length > 0 || commandHistory.length > 0 ? (
              <div className="terminal-command-history">
                {commandRuns.slice(0, 3).map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    onClick={() => setCommandDraft(run.command)}
                    title={run.command}
                  >
                    <span className={run.status}>{run.status}</span>
                    {run.command}
                  </button>
                ))}
                {commandHistory
                  .filter(
                    (command) =>
                      !commandRuns.some((run) => run.command === command),
                  )
                  .slice(0, 3)
                  .map((command) => (
                    <button
                      type="button"
                      key={command}
                      onClick={() => setCommandDraft(command)}
                      title={command}
                    >
                      <span>recent</span>
                      {command}
                    </button>
                  ))}
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
      <div
        className="terminal-side-body"
        ref={containerRef}
        onClick={() => setContextMenu(null)}
      >
        {!activeSession ? (
          <div className="terminal-empty-state">
            <span>No terminal session</span>
            <button type="button" onClick={() => void createSession()}>
              <Plus size={14} />
              New terminal
            </button>
          </div>
        ) : null}
        {contextMenu && (
          <div
            className="terminal-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              disabled={!contextMenu.canCopy}
              onClick={() => runContextAction("copy")}
            >
              <Copy size={14} />
              Copy
            </button>
            <button type="button" onClick={() => runContextAction("paste")}>
              <ClipboardPaste size={14} />
              Paste
            </button>
            <button type="button" onClick={() => runContextAction("clear")}>
              <Trash2 size={14} />
              Clear
            </button>
            <button type="button" onClick={() => runContextAction("restart")}>
              <RotateCcw size={14} />
              Restart
            </button>
            <button type="button" onClick={() => runContextAction("kill")}>
              <X size={14} />
              Kill
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function shellDisplayName(shell: string): string {
  const parts = shell.split(/[\\/]/);
  return parts[parts.length - 1] || shell;
}

function commandHistoryKey(workspaceKey: string): string {
  return `opendrsai.terminal.commandHistory.${workspaceKey}`;
}

function commandRunsKey(workspaceKey: string): string {
  return `opendrsai.terminal.commandRuns.${workspaceKey}`;
}

function terminalSelectionKey(workspaceKey: string): string {
  return `drsai:terminal-selection:${workspaceKey}`;
}

function terminalShellKey(workspaceKey: string): string {
  return `drsai:terminal-shell:${workspaceKey}`;
}

function normalizeProposedCommand(
  proposedCommand?: string | WorkflowTerminalCommandProposal | null,
): WorkflowTerminalCommandProposal | null {
  if (!proposedCommand) return null;
  if (typeof proposedCommand === "string") {
    return { command: proposedCommand };
  }
  return proposedCommand;
}

function commandRunToAttachment(
  run: CommandRun,
  workspaceKey: string,
): ChatAttachment {
  const output = sanitizeTerminalOutput(run.output || "");
  const exitText =
    run.exitCode === undefined ? "" : `Exit code: ${run.exitCode}\n`;
  return {
    kind: "terminal",
    path: `terminal://${workspaceKey}/${run.id}`,
    name: `Terminal command ${run.status}`,
    title: run.command,
    visibleText: [
      `Command: ${run.command}`,
      `Risk: ${riskLabel(run.risk)}`,
      `Status: ${run.status}`,
      exitText.trim(),
      run.startedAt ? `Started: ${run.startedAt}` : "",
      run.completedAt ? `Completed: ${run.completedAt}` : "",
      output ? `Output:\n${output}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    note: "Terminal command result generated from the right sidebar terminal.",
  };
}

function sanitizeTerminalOutput(output: string): string {
  return output
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/__DRSAI_AGENT_COMMAND_DONE:[^:]+:-?\d+__/g, "")
    .trim()
    .slice(-8000);
}

function classifyCommandRisk(command: string): {
  risk: CommandRisk;
  reason: string;
} {
  const normalized = command.trim().toLowerCase();
  if (
    /\b(remove-item|rm|rmdir|del|format|diskpart|shutdown|restart-computer)\b/.test(normalized) ||
    /\b(git\s+reset\s+--hard|git\s+clean\s+-|drop\s+database)\b/.test(normalized)
  ) {
    return {
      risk: "destructive",
      reason: "Destructive commands are blocked from agent execution.",
    };
  }
  if (
    /\b(npm|pnpm|yarn|pip|uv|cargo|winget|choco)\s+(install|add|update|upgrade)\b/.test(normalized) ||
    /\b(curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod)\b/.test(normalized)
  ) {
    return {
      risk: "network",
      reason: "This may download code or contact the network.",
    };
  }
  if (
    /\b(stop-process|taskkill|kill|start-process|docker|kubectl|net\s+stop|net\s+start)\b/.test(normalized)
  ) {
    return {
      risk: "process",
      reason: "This may start, stop, or manage external processes.",
    };
  }
  if (
    /[>]|[|]\s*(set-content|add-content|out-file)\b/.test(normalized) ||
    /\b(new-item|set-content|add-content|out-file|copy-item|move-item|mkdir|git\s+commit|git\s+add)\b/.test(normalized)
  ) {
    return {
      risk: "write",
      reason: "This may write files or update repository state.",
    };
  }
  return {
    risk: "read_only",
    reason: "This looks read-only, but still requires confirmation.",
  };
}

function riskLabel(risk: CommandRisk): string {
  if (risk === "read_only") return "Read-only";
  if (risk === "write") return "Writes files";
  if (risk === "network") return "Network or install";
  if (risk === "process") return "Process control";
  return "Blocked destructive";
}

function approvalRiskForCommand(
  risk: CommandRisk,
): "low" | "medium" | "high" {
  if (risk === "read_only") return "low";
  if (risk === "network" || risk === "process") return "high";
  return "medium";
}

function buildCommandInvocation(
  shellProfile: TerminalShellProfile,
  command: string,
  commandId: string,
): string {
  const sentinel = `__DRSAI_AGENT_COMMAND_DONE:${commandId}:`;
  if (shellProfile === "cmd") {
    return [
      `echo [agent-command] ${command}`,
      command,
      "set drsaiExit=%ERRORLEVEL%",
      `echo ${sentinel}%drsaiExit%__`,
      "",
    ].join("\r\n");
  }
  if (shellProfile === "git-bash" || shellProfile === "wsl") {
    return [
      `echo "[agent-command] ${escapePosixDoubleQuoted(command)}"`,
      command,
      "drsaiExit=$?",
      `echo "${sentinel}\${drsaiExit}__"`,
      "",
    ].join("\n");
  }
  return [
    "$global:LASTEXITCODE = $null",
    `Write-Host "[agent-command] ${escapePowerShellDoubleQuoted(command)}"`,
    "try {",
    command,
    "} catch {",
    "  Write-Error $_",
    "  $global:LASTEXITCODE = 1",
    "}",
    "$drsaiExit = if ($global:LASTEXITCODE -ne $null) { $global:LASTEXITCODE } elseif ($?) { 0 } else { 1 }",
    `Write-Host "${sentinel}$drsaiExit__"`,
    "",
  ].join("\r\n") + "\r";
}

function escapePowerShellDoubleQuoted(value: string): string {
  return value.replace(/`/g, "``").replace(/"/g, '`"').replace(/\$/g, "`$");
}

function escapePosixDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}
