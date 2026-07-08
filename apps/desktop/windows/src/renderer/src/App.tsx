import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bot,
  FileText,
  Globe2,
  History,
  Library,
  Lightbulb,
  MessageSquare,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal as TerminalIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AuthUser,
  ChatAttachment,
  CreateWorkspaceRequest,
  DesktopAgent,
  DesktopChannelContextImportResult,
  DesktopForkLifecycleAction,
  DesktopHealth,
  DesktopIdeContextSnapshot,
  DesktopMcpContextResult,
  DesktopThread,
  InstallProgress,
  MyDrSaiModelConfig,
  WorkspaceFilePreview,
  WorkspaceProject,
} from "@shared/desktopApi";
import { desktopApi } from "./desktopApi";
import { AuthSplash, LoginScreen } from "./auth/LoginScreen";
import { useAuth } from "./auth/AuthProvider";
import { AgentSquareView } from "./components/AgentSquareView";
import { AgentRunWorkspace } from "./components/AgentRunWorkspace";
import { ApprovalCenterView } from "./components/ApprovalCenterView";
import { ChannelsView } from "./components/ChannelsView";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { PreviewBrowserPanel } from "./components/PreviewBrowserPanel";
import { SkillSquareView } from "./components/SkillSquareView";
import { TerminalPanel } from "./components/TerminalPanel";
import { FilesContextPanel } from "./components/files/FilesContextPanel";
import {
  createAgentRunContextTraceEvents,
  createTraceEventFromAgentFileEvent,
  type AgentFileTraceEvent,
} from "./components/files/AgentFileActivityPanel";
import {
  WorkspaceShell,
  type ForkConflictContentPreviewResult,
  type ForkConflictDraftWriteResult,
  type ForkConflictFile,
  type ForkConflictStageResult,
  type WorkspaceThread,
} from "./components/WorkspaceShell";
import {
  type ChatThreadSnapshot,
  useDesktopChatAdapter,
} from "./adapters/useDesktopChatAdapter";
import type { ChatCommandAction } from "./chatCommands";
import { useDesktopHealthAdapter } from "./adapters/useDesktopHealthAdapter";
import {
  MENU_IDS,
  getNavItems,
  getNavSections,
  getRightTabs,
  type AppLanguage,
  type NavId,
  type RightTab,
} from "./navigation";

const navIcons: Record<NavId, LucideIcon> = {
  current_session: MessageSquare,
  my_agents: Bot,
  agent_square: Bot,
  saved_plan: FileText,
  skills_square: Lightbulb,
  plugins: Plug,
  library: Library,
  approval_center: ShieldCheck,
  profile: Settings,
  usage_analytics: History,
  channels: MessageSquare,
  logs: FileText,
  agent_management: Bot,
  user_management: Settings,
};

interface TerminalCommandProposal {
  command: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

const rightTabIcons: Record<RightTab, LucideIcon> = {
  files: FileText,
  templates: Sparkles,
  browser: Globe2,
  terminal: TerminalIcon,
};

const WORKSPACE_STORAGE_KEY = "opendrsai.workspaces";
const WORKSPACE_MIGRATION_KEY = "opendrsai.workspaces.migrated";
const THREAD_SNAPSHOT_STORAGE_KEY = "opendrsai.threadSnapshots";
const WORKSPACE_SORT_STORAGE_KEY = "opendrsai.workspaceSortMode";
const DEVELOPER_MODE_STORAGE_KEY = "opendrsai.developerMode";
type WorkspaceSortMode = "recent" | "name" | "created";

function App(): React.JSX.Element {
  const auth = useAuth();

  if (auth.loading) return <AuthSplash />;
  if (!auth.session.authenticated) return <LoginScreen />;

  return (
    <AuthenticatedApp
      user={auth.session.user}
      onLogout={() => auth.logout(false)}
    />
  );
}

function AuthenticatedApp({
  user,
  onLogout,
}: {
  user: AuthUser | null;
  onLogout: () => Promise<void>;
}): React.JSX.Element {
  const [language, setLanguage] = useState<AppLanguage>("zh");
  const [developerMode, setDeveloperMode] = useState(() => loadDeveloperMode());
  const [activeNav, setActiveNav] = useState<NavId>(MENU_IDS.currentSession);
  const [skillSquareCommandTarget, setSkillSquareCommandTarget] =
    useState<Extract<ChatCommandAction, { type: "open-view" }>["target"] | null>(null);
  const [navHistory, setNavHistory] = useState<NavId[]>([
    MENU_IDS.currentSession,
  ]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(0);
  const [activeRightTab, setActiveRightTab] = useState<RightTab>("files");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("current");
  const [storedWorkspaces, setStoredWorkspaces] = useState<WorkspaceProject[]>(
    [],
  );
  const [threads, setThreads] = useState<DesktopThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState(() =>
    createLocalThreadId(),
  );
  const [threadSnapshots, setThreadSnapshots] = useState<
    Record<string, ChatThreadSnapshot>
  >(() => loadThreadSnapshots());
  const [workspaceSortMode, setWorkspaceSortMode] = useState<WorkspaceSortMode>(
    () => loadWorkspaceSortMode(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [sessionScope, setSessionScope] = useState<"workspace" | "all">("workspace");
  const [availableChatAgents, setAvailableChatAgents] = useState<DesktopAgent[]>([]);
  const [availableChatModels, setAvailableChatModels] = useState<MyDrSaiModelConfig[]>([]);
  const [selectedChatAgentId, setSelectedChatAgentId] = useState<string | null>(null);
  const [selectedChatAgentName, setSelectedChatAgentName] = useState("OpenDrSai");
  const [selectedChatModel, setSelectedChatModel] = useState<string | null>(null);
  const [selectedChatExamples, setSelectedChatExamples] = useState<
    DesktopAgent["examples"]
  >();
  const [terminalAgentTask, setTerminalAgentTask] = useState("");
  const [terminalCommandProposal, setTerminalCommandProposal] =
    useState<TerminalCommandProposal | null>(null);
  const [browserPanelUrl, setBrowserPanelUrl] = useState<string | undefined>();
  const [browserAttachments, setBrowserAttachments] = useState<ChatAttachment[]>([]);
  const [ideContext, setIdeContext] = useState<DesktopIdeContextSnapshot | null>(null);
  const [workspaceContextAttachmentsByThread, setWorkspaceContextAttachmentsByThread] = useState<
    Record<string, ChatAttachment[]>
  >({});
  const [workspaceFileTraceByThread, setWorkspaceFileTraceByThread] = useState<
    Record<string, AgentFileTraceEvent[]>
  >({});
  const desktop = useDesktopHealthAdapter(language);
  const navSections = getNavSections(language);
  const navItems = getNavItems(language);
  const rightTabs = getRightTabs(language);
  const title =
    navItems.find((item) => item.id === activeNav)?.label ??
    (language === "zh" ? "当前会话" : "Chat");
  const { health } = desktop;
  const workspacePath = health?.install.repoPath || health?.install.home || "";
  const currentWorkspaceTime = "1970-01-01T00:00:00.000Z";
  const currentWorkspace: WorkspaceProject = {
    id: "current",
    name: getWorkspaceName(workspacePath) || "drsai",
    path: workspacePath || "Local workspace",
    type: "local",
    description: language === "zh" ? "当前项目" : "Current project",
    createdAt: currentWorkspaceTime,
    updatedAt: currentWorkspaceTime,
    lastOpenedAt: currentWorkspaceTime,
    trusted: true,
    pinned: true,
  };
  const workspaces: WorkspaceProject[] = [
    currentWorkspace,
    ...storedWorkspaces.filter(
      (workspace) => workspace.path !== currentWorkspace.path,
    ),
  ];
  const sortedWorkspaces = sortWorkspacesForSidebar(workspaces, workspaceSortMode);
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    currentWorkspace;
  const activeWorkspacePathKey = getComparablePath(activeWorkspace.path);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeThreadWorkspacePath = activeThread?.workspacePath?.trim();
  const effectiveWorkspacePath = activeThreadWorkspacePath || activeWorkspace.path;
  const effectiveWorkspace =
    workspaces.find(
      (workspace) =>
        getComparablePath(workspace.path) === getComparablePath(effectiveWorkspacePath),
    ) ?? activeWorkspace;
  const effectiveWorkspaceInstructions =
    effectiveWorkspace.instructions ?? activeWorkspace.instructions;
  const workspaceTrusted =
    effectiveWorkspace.id === activeWorkspace.id
      ? activeWorkspace.trusted
      : activeThread?.kind === "agent_run" && Boolean(activeThreadWorkspacePath)
        ? true
        : effectiveWorkspace.trusted;
  const scopedThreads =
    sessionScope === "all"
      ? threads
      : threads.filter((thread) => {
          if (thread.id === activeThreadId) return true;
          if (!thread.workspacePath) return true;
          return getComparablePath(thread.workspacePath) === activeWorkspacePathKey;
        });
  const visibleThreads = scopedThreads.filter((thread) =>
    sessionScope === "all" ? true : !thread.archived,
  );
  const recentThreads: WorkspaceThread[] = visibleThreads
    .slice(0, 12)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      timeLabel: formatThreadTime(thread.updatedAt, language),
      workspaceId: getWorkspaceId(thread.workspacePath || activeWorkspace.path),
      workspacePath: thread.workspacePath,
      fork: thread.fork,
      active: thread.id === activeThreadId,
      pinned: thread.pinned,
      archived: thread.archived,
      unread: thread.unread,
    }));
  const chat = useDesktopChatAdapter({
    availableAgents: availableChatAgents,
    availableModels: availableChatModels,
    canChat: Boolean(
      health?.installed && health?.gatewayReady && workspaceTrusted,
    ),
    developerMode,
    onChatComplete: desktop.refreshHealth,
    onForkThreadCreated: handleForkThreadCreated,
    onOpenSkillsSquare: (target) => {
      setSkillSquareCommandTarget(target ?? null);
      setActiveNav(MENU_IDS.skillsSquare);
    },
    onSelectAgent: handleChatAgentSelect,
    onSelectModel: handleChatModelSelect,
    onThreadUpdated: handleThreadUpdated,
    language,
    threadId: activeThreadId,
    threadSnapshot: threadSnapshots[activeThreadId] ?? null,
    workspaceInstructions: effectiveWorkspaceInstructions,
    workspacePath: effectiveWorkspacePath,
  });

  const proposeTerminalCommand = useCallback((
    command: string,
    workflow?: { workflowRunId?: string; workflowStepId?: string },
  ): void => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setTerminalCommandProposal(null);
    window.setTimeout(() => {
      setTerminalCommandProposal({
        command: trimmed,
        ...(workflow?.workflowRunId ? { workflowRunId: workflow.workflowRunId } : {}),
        ...(workflow?.workflowStepId ? { workflowStepId: workflow.workflowStepId } : {}),
      });
      setActiveRightTab("terminal");
      setRightPanelCollapsed(false);
    }, 0);
  }, []);

  useEffect(() => {
    function handleWorkflowTerminalCommand(event: Event): void {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const command = (detail as { command?: unknown }).command;
      if (typeof command !== "string" || !command.trim()) return;
      const workflowRunId = (detail as { workflowRunId?: unknown }).workflowRunId;
      const stepId = (detail as { stepId?: unknown }).stepId;
      proposeTerminalCommand(command, {
        ...(typeof workflowRunId === "string" ? { workflowRunId } : {}),
        ...(typeof stepId === "string" ? { workflowStepId: stepId } : {}),
      });
    }

    window.addEventListener(
      "drsai:workflow-terminal-command",
      handleWorkflowTerminalCommand,
    );
    return () => {
      window.removeEventListener(
        "drsai:workflow-terminal-command",
        handleWorkflowTerminalCommand,
      );
    };
  }, [proposeTerminalCommand]);
  const canChat = Boolean(
    health?.installed &&
    health?.gatewayReady &&
    workspaceTrusted &&
    !chat.activeRequestId,
  );
  const externalChatAttachments = [
    ...chat.commandAttachments,
    ...browserAttachments,
    ...(workspaceContextAttachmentsByThread[activeThreadId] ?? []),
  ];
  const workspaceContextAttachments =
    workspaceContextAttachmentsByThread[activeThreadId] ?? [];
  const workspaceFileTraceEvents =
    workspaceFileTraceByThread[activeThreadId] ?? [];
  const filesWorkspacePath = effectiveWorkspacePath || "Local workspace";

  useEffect(() => {
    void refreshWorkspaces();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      THREAD_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(threadSnapshots),
    );
  }, [threadSnapshots]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_SORT_STORAGE_KEY, workspaceSortMode);
  }, [workspaceSortMode]);

  useEffect(() => {
    window.localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, developerMode ? "true" : "false");
  }, [developerMode]);

  useEffect(() => {
    void refreshThreads();
  }, []);

  useEffect(() => {
    function handleThreadsUpdated(): void {
      void refreshThreads();
    }
    window.addEventListener("drsai:threads-updated", handleThreadsUpdated);
    return () => {
      window.removeEventListener("drsai:threads-updated", handleThreadsUpdated);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadChatChoices(): Promise<void> {
      try {
        const [agents, myDrSaiConfig] = await Promise.all([
          desktopApi.listAgents(),
          desktopApi.getMyDrSaiConfig(effectiveWorkspacePath).catch(() => null),
        ]);
        if (cancelled) return;
        setAvailableChatAgents(agents);
        setAvailableChatModels(myDrSaiConfig?.models ?? []);
        if (cancelled || agents.length === 0) return;
        const defaultAgent =
          agents.find((agent) => agent.id === "my-drsai") ??
          agents.find((agent) => agent.status === "running") ??
          agents[0];
        setSelectedChatAgentId((current) => current ?? defaultAgent.id);
        setSelectedChatAgentName((current) =>
          current === "OpenDrSai" ? defaultAgent.name : current,
        );
        setSelectedChatModel(
          (current) => current ?? defaultAgent.model ?? myDrSaiConfig?.defaultModelAlias ?? null,
        );
        setSelectedChatExamples((current) => current ?? defaultAgent.examples);
      } catch {
        // The chat composer should remain usable even if the agent catalog is unavailable.
      }
    }
    void loadChatChoices();
    return () => {
      cancelled = true;
    };
  }, [effectiveWorkspacePath, health?.gatewayReady]);

  useEffect(() => {
    setWorkspaceContextAttachmentsByThread({});
    setWorkspaceFileTraceByThread({});
  }, [effectiveWorkspacePath]);

  async function handleSaveApiKey(event: FormEvent): Promise<void> {
    event.preventDefault();
    await desktop.saveApiKey();
  }

  const navigateTo = useCallback(
    (id: NavId): void => {
      setActiveNav((current) => {
        if (current === id) return current;
        setNavHistory((history) => {
          const next = [...history.slice(0, navHistoryIndex + 1), id];
          setNavHistoryIndex(next.length - 1);
          return next;
        });
        return id;
      });
    },
    [navHistoryIndex],
  );

  const goBack = useCallback((): void => {
    setNavHistoryIndex((current) => {
      if (current <= 0) return current;
      const next = current - 1;
      setActiveNav(navHistory[next]);
      return next;
    });
  }, [navHistory]);

  const goForward = useCallback((): void => {
    setNavHistoryIndex((current) => {
      if (current >= navHistory.length - 1) return current;
      const next = current + 1;
      setActiveNav(navHistory[next]);
      return next;
    });
  }, [navHistory]);

  async function handleAddWorkspace(): Promise<void> {
    const result = await desktopApi.pickFolder();
    if (result.canceled || result.paths.length === 0) return;
    const path = result.paths[0];
    await handleCreateWorkspace({
      source: "existing",
      path,
      name: getWorkspaceName(path) || path,
      description: language === "zh" ? "本地工作区" : "Local workspace",
      trusted: true,
    });
  }

  async function handleCreateWorkspace(
    request: CreateWorkspaceRequest,
  ): Promise<void> {
    const workspace = await desktopApi.createWorkspace({
      ...request,
      trusted: true,
    });
    setStoredWorkspaces((current) => {
      const withoutDuplicate = current.filter(
        (item) => item.id !== workspace.id && item.path !== workspace.path,
      );
      return [workspace, ...withoutDuplicate];
    });
    setActiveWorkspaceId(workspace.id);
    navigateTo(MENU_IDS.currentSession);
  }

  async function handlePickWorkspaceFolder(): Promise<string | null> {
    const result = await desktopApi.pickFolder();
    if (result.canceled || result.paths.length === 0) return null;
    return result.paths[0];
  }

  async function handleWorkspaceChange(workspaceId: string): Promise<void> {
    setActiveWorkspaceId(workspaceId);
    if (workspaceId !== "current") {
      try {
        const workspace = await desktopApi.updateWorkspace({
          id: workspaceId,
          lastOpenedAt: new Date().toISOString(),
        });
        setStoredWorkspaces((current) => [
          workspace,
          ...current.filter((item) => item.id !== workspace.id),
        ]);
      } catch {
        // Keep navigation responsive even if the recent timestamp refresh fails.
      }
    }
    navigateTo(MENU_IDS.currentSession);
  }

  async function handleRemoveWorkspace(workspaceId: string): Promise<void> {
    if (workspaceId === "current") return;
    await desktopApi.deleteWorkspace(workspaceId);
    setStoredWorkspaces((current) =>
      current.filter((workspace) => workspace.id !== workspaceId),
    );
    if (activeWorkspaceId === workspaceId) {
      setActiveWorkspaceId("current");
      navigateTo(MENU_IDS.currentSession);
    }
  }

  async function handleUpdateWorkspace(
    workspaceId: string,
    updates: Partial<
      Pick<WorkspaceProject, "name" | "description" | "trusted" | "pinned">
    >,
  ): Promise<void> {
    if (workspaceId === "current") return;
    const workspace = await desktopApi.updateWorkspace({
      id: workspaceId,
      ...updates,
    });
    setStoredWorkspaces((current) => [
      workspace,
      ...current.filter((item) => item.id !== workspace.id),
    ]);
  }

  async function handleOpenWorkspacePath(path: string): Promise<void> {
    await desktopApi.openPath(path);
  }

  async function refreshWorkspaces(): Promise<void> {
    const remoteWorkspaces = await desktopApi.listWorkspaces();
    const migrated =
      window.localStorage.getItem(WORKSPACE_MIGRATION_KEY) === "true";
    const legacyWorkspaces = migrated ? [] : loadLegacyWorkspaces();
    if (legacyWorkspaces.length > 0) {
      const created: WorkspaceProject[] = [];
      for (const legacy of legacyWorkspaces) {
        try {
          created.push(
            await desktopApi.createWorkspace({
              path: legacy.path,
              name: legacy.name,
              description: legacy.description,
              trusted: true,
            }),
          );
        } catch {
          // Ignore stale legacy folders; the user can add them again from the picker.
        }
      }
      window.localStorage.setItem(WORKSPACE_MIGRATION_KEY, "true");
      setStoredWorkspaces([...created, ...remoteWorkspaces]);
      return;
    }
    setStoredWorkspaces(remoteWorkspaces);
  }

  async function handleNewChat(): Promise<void> {
    setRightPanelCollapsed(true);
    const thread = await desktopApi.createThread({
      kind: "chat",
      title: language === "zh" ? "新会话" : "New chat",
      workspacePath: effectiveWorkspacePath,
    });
    setActiveThreadId(thread.id);
    setThreads((current) =>
      sortThreadsForSidebar([
        thread,
        ...current.filter((item) => item.id !== thread.id),
      ]),
    );
    navigateTo(MENU_IDS.currentSession);
  }

  function handleForkThreadCreated(thread: DesktopThread): void {
    setThreads((current) =>
      sortThreadsForSidebar([
        thread,
        ...current.filter((item) => item.id !== thread.id),
      ]),
    );
    setActiveThreadId(thread.id);
    setRightPanelCollapsed(true);
    navigateTo(MENU_IDS.currentSession);
  }

  function handleThreadSelect(threadId: string): void {
    const thread = threads.find((item) => item.id === threadId);
    if (thread?.workspacePath) {
      const nextWorkspace = workspaces.find(
        (workspace) =>
          getComparablePath(workspace.path) === getComparablePath(thread.workspacePath),
      );
      if (nextWorkspace && nextWorkspace.id !== activeWorkspaceId) {
        setActiveWorkspaceId(nextWorkspace.id);
      }
    }
    setActiveThreadId(threadId);
    setRightPanelCollapsed(true);
    if (thread?.unread) {
      void handleThreadUpdate(threadId, { unread: false });
    }
    navigateTo(MENU_IDS.currentSession);
  }

  function handleChatAgentSelect(agentId: string): void {
    const agent = availableChatAgents.find((item) => item.id === agentId);
    if (!agent) return;
    setSelectedChatAgentId(agent.id);
    setSelectedChatAgentName(agent.name);
    setSelectedChatModel(agent.model || selectedChatModel);
    setSelectedChatExamples(agent.examples);
  }

  function handleChatModelSelect(model: string): void {
    setSelectedChatModel(model);
  }

  async function handleThreadUpdate(
    threadId: string,
    updates: { title?: string; pinned?: boolean; archived?: boolean; unread?: boolean; fork?: DesktopThread["fork"] },
  ): Promise<void> {
    const thread = await desktopApi.updateThread({
      id: threadId,
      ...updates,
    });
    setThreads((current) =>
      sortThreadsForSidebar([
        thread,
        ...current.filter((item) => item.id !== thread.id),
      ]),
    );
    if (updates.archived && activeThreadId === threadId) {
      void handleNewChat();
    }
  }

  async function handleForkLifecycleRequest(
    threadId: string,
    action: DesktopForkLifecycleAction,
  ): Promise<void> {
    const result = await desktopApi.requestForkLifecycleApproval({
      threadId,
      action,
    });
    if (result.thread) {
      setThreads((current) =>
        sortThreadsForSidebar([
          result.thread!,
          ...current.filter((item) => item.id !== result.thread!.id),
        ]),
      );
    }
    if (result.queued) {
      setActiveNav(MENU_IDS.approvalCenter);
    }
  }

  async function handleThreadUpdated(
    snapshot: ChatThreadSnapshot,
  ): Promise<void> {
    setThreadSnapshots((current) => ({
      ...current,
      [snapshot.threadId]: snapshot,
    }));
    const thread = await desktopApi.updateThread({
      id: snapshot.threadId,
      kind: threads.find((item) => item.id === snapshot.threadId)?.kind ?? "chat",
      title: snapshot.title,
      workspacePath: effectiveWorkspacePath,
      status: snapshot.messages.some((message) => message.streaming)
        ? "running"
        : "idle",
      messageCount: snapshot.messageCount,
    });
    setThreads((current) =>
      sortThreadsForSidebar([
        thread,
        ...current.filter((item) => item.id !== thread.id),
      ]),
    );
  }

  async function refreshThreads(): Promise<void> {
    setThreads(await desktopApi.listThreads());
  }

  const openPreviewBrowser = useCallback((url?: string): void => {
    if (url) setBrowserPanelUrl(url);
    setActiveRightTab("browser");
    setRightPanelCollapsed(false);
  }, []);

  const refreshIdeContext = useCallback(async (): Promise<void> => {
    try {
      setIdeContext(await desktopApi.getIdeContext(effectiveWorkspacePath));
    } catch {
      setIdeContext(null);
    }
  }, [effectiveWorkspacePath]);

  useEffect(() => {
    void refreshIdeContext();
  }, [refreshIdeContext]);

  function setActiveThreadWorkspaceContextAttachments(
    attachments: ChatAttachment[],
  ): void {
    setWorkspaceContextAttachmentsByThread((current) => ({
      ...current,
      [activeThreadId]: attachments,
    }));
  }

  function addActiveThreadWorkspaceContextAttachment(
    attachment: ChatAttachment,
  ): void {
    setWorkspaceContextAttachmentsByThread((current) => {
      const existing = current[activeThreadId] ?? [];
      const key = getAttachmentIdentity(attachment);
      const next = [
        ...existing.filter((item) => getAttachmentIdentity(item) !== key),
        attachment,
      ];
      return {
        ...current,
        [activeThreadId]: next,
      };
    });
  }

  function attachIdeCurrentFile(): void {
    const currentFile = ideContext?.currentFile;
    if (!currentFile) return;
    addActiveThreadWorkspaceContextAttachment({
      kind: "file",
      path: currentFile.path,
      name: currentFile.name,
      note: `IDE current file from ${ideContext?.source ?? "unknown"}.`,
    });
  }

  function attachIdeCurrentSelection(): void {
    const selection = ideContext?.currentSelection;
    if (!selection) return;
    const lineRange =
      selection.startLine && selection.endLine
        ? `:${selection.startLine}-${selection.endLine}`
        : "";
    addActiveThreadWorkspaceContextAttachment({
      kind: "selection",
      path: `ide-selection:${selection.path}${lineRange}`,
      name: "IDE selection",
      title: selection.relativePath
        ? `${selection.relativePath}${lineRange}`
        : selection.name,
      visibleText: selection.text,
      note: selection.truncated
        ? "IDE current selection context. Truncated to 12000 characters."
        : "IDE current selection context.",
    });
  }

  function attachImportedChannelContext(
    result: DesktopChannelContextImportResult,
  ): void {
    const attachments = result.items.map((item): ChatAttachment => ({
      kind: "selection",
      path: `channel-import:${item.path}`,
      name: `Channel import: ${item.title}`,
      title: `${item.relativePath} (${item.kind})`,
      visibleText: [
        `Imported from ${item.provider} / ${result.adapterId}.`,
        `Workspace path: ${result.workspacePath}`,
        `Source file: ${item.path}`,
        item.mime ? `MIME: ${item.mime}` : "",
        typeof item.size === "number" ? `Size: ${item.size} bytes` : "",
        item.truncated ? "Summary was truncated by the read-only channel importer." : "",
        "",
        item.summary,
      ].filter(Boolean).join("\n"),
      note:
        "Read-only channel context import. This summary was reviewed as a visible chat attachment before send.",
    }));
    if (!attachments.length) return;
    setWorkspaceContextAttachmentsByThread((current) => {
      const existing = current[activeThreadId] ?? [];
      const next = [...existing];
      for (const attachment of attachments) {
        const key = getAttachmentIdentity(attachment);
        const existingIndex = next.findIndex(
          (item) => getAttachmentIdentity(item) === key,
        );
        if (existingIndex >= 0) {
          next[existingIndex] = attachment;
        } else {
          next.push(attachment);
        }
      }
      return {
        ...current,
        [activeThreadId]: next,
      };
    });
    setRightPanelCollapsed(true);
    navigateTo(MENU_IDS.currentSession);
  }

  function attachImportedMcpContext(
    result: DesktopMcpContextResult,
  ): void {
    const attachments = result.items.map((item): ChatAttachment => ({
      kind: "selection",
      path: `mcp-context:${item.id}`,
      name: `MCP ${item.kind}: ${item.title}`,
      title: `${item.server} / ${item.name}`,
      visibleText: [
        `Reviewed MCP ${item.kind} context imported from .drsai/mcp-context.json.`,
        `Workspace path: ${result.workspacePath}`,
        `Source file: ${result.sourcePath}`,
        item.truncated ? "Content was truncated by the read-only MCP context importer." : "",
        "",
        item.content,
      ].filter(Boolean).join("\n"),
      note:
        "Read-only MCP context import. This result was reviewed as a visible chat attachment before send.",
    }));
    if (!attachments.length) return;
    setWorkspaceContextAttachmentsByThread((current) => {
      const existing = current[activeThreadId] ?? [];
      const next = [...existing];
      for (const attachment of attachments) {
        const key = getAttachmentIdentity(attachment);
        const existingIndex = next.findIndex(
          (item) => getAttachmentIdentity(item) === key,
        );
        if (existingIndex >= 0) {
          next[existingIndex] = attachment;
        } else {
          next.push(attachment);
        }
      }
      return {
        ...current,
        [activeThreadId]: next,
      };
    });
    setRightPanelCollapsed(true);
    navigateTo(MENU_IDS.currentSession);
  }

  function setActiveThreadFileTraceEvents(
    events: AgentFileTraceEvent[],
  ): void {
    setWorkspaceFileTraceByThread((current) => ({
      ...current,
      [activeThreadId]: events,
    }));
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
        return;
      if (event.key === "[") {
        event.preventDefault();
        goBack();
      } else if (event.key === "]") {
        event.preventDefault();
        goForward();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goBack, goForward]);

  const mainContent =
    activeNav === MENU_IDS.currentSession ? (
      <section className="conversation-panel">
        <ChatWorkspace
          activeRequestId={chat.activeRequestId}
          canChat={canChat}
          health={health}
          input={chat.input}
          language={language}
          messages={chat.messages}
          currentRuntimeMode={chat.currentRuntimeMode}
          selectedAgentId={selectedChatAgentId ?? undefined}
          selectedAgentName={selectedChatAgentName}
          selectedModelName={selectedChatModel ?? undefined}
          agentOptions={availableChatAgents}
          modelOptions={availableChatModels}
          samplePrompts={selectedChatExamples}
          externalAttachments={externalChatAttachments}
          ideContext={ideContext}
          workspaceInstructions={effectiveWorkspaceInstructions}
          workspacePath={effectiveWorkspacePath}
          onAbort={chat.abort}
          onClearRuntimeMode={chat.clearRuntimeMode}
          onClearExternalAttachments={() => {
            chat.clearCommandAttachments();
            setBrowserAttachments([]);
            setActiveThreadWorkspaceContextAttachments([]);
            setActiveThreadFileTraceEvents([]);
          }}
          onInputChange={chat.setInput}
          onSelectAgent={handleChatAgentSelect}
          onSelectModel={handleChatModelSelect}
          onOpenExternal={(url) => desktopApi.openExternal(url)}
          onOpenPreviewBrowser={openPreviewBrowser}
          onAttachIdeCurrentFile={attachIdeCurrentFile}
          onAttachIdeCurrentSelection={attachIdeCurrentSelection}
          onRefreshIdeContext={() => {
            void refreshIdeContext();
          }}
          onRemoveExternalAttachment={(index) =>
            index < chat.commandAttachments.length
              ? chat.removeCommandAttachment(index)
              : removeExternalAttachment(
                  index - chat.commandAttachments.length,
                  browserAttachments.length,
                  setBrowserAttachments,
                  workspaceContextAttachments,
                  setActiveThreadWorkspaceContextAttachments,
                )
          }
          onSubmit={chat.submit}
        />
      </section>
    ) : activeNav === MENU_IDS.agentSquare ? (
      <section className="agent-square-panel">
        <AgentSquareView
          language={language}
          userEmail={user?.email}
          onStartChat={(agent) => {
            setSelectedChatAgentId(agent.id);
            setSelectedChatAgentName(agent.name);
            setSelectedChatModel(agent.model || null);
            setSelectedChatExamples(agent.examples);
            setRightPanelCollapsed(true);
            chat.setInput(
              language === "zh"
                ? `我想使用 ${agent.name} 处理一个任务：`
                : `I want to use ${agent.name} for a task:`,
            );
            navigateTo(MENU_IDS.currentSession);
          }}
        />
      </section>
    ) : activeNav === MENU_IDS.skillsSquare ? (
      <section className="skills-square-panel">
        <SkillSquareView
          initialFocus={skillSquareCommandTarget ?? undefined}
          language={language}
          workspacePath={effectiveWorkspacePath}
        />
      </section>
    ) : activeNav === MENU_IDS.myAgents ? (
      <AgentRunWorkspace
        fileContextAttachments={workspaceContextAttachments}
        health={health}
        initialTask={terminalAgentTask}
        language={language}
        onAgentFileEvent={({ fileEvent, requestId, runId }) => {
          setActiveThreadFileTraceEvents([
            createTraceEventFromAgentFileEvent({
              event: fileEvent,
              requestId,
              runId,
              scopeId: activeThreadId,
            }),
            ...workspaceFileTraceEvents,
          ]);
        }}
        onFileContextSent={({ attachments, requestId, runId }) => {
          setActiveThreadFileTraceEvents([
            ...createAgentRunContextTraceEvents({
              attachments,
              requestId,
              runId,
              scopeId: activeThreadId,
            }),
            ...workspaceFileTraceEvents,
          ]);
        }}
        onProposeTerminalCommand={(command) => {
          proposeTerminalCommand(command);
        }}
        threadId={activeThreadId}
        workspaceInstructions={effectiveWorkspaceInstructions}
        workspacePath={effectiveWorkspacePath}
        workspaceTrusted={workspaceTrusted}
      />
    ) : activeNav === MENU_IDS.approvalCenter ? (
      <ApprovalCenterView
        language={language}
        onAttachMcpContext={attachImportedMcpContext}
        workspacePath={effectiveWorkspacePath}
        workspaceTrusted={workspaceTrusted}
      />
    ) : activeNav === MENU_IDS.channels ? (
      <ChannelsView
        language={language}
        onAttachImportedContext={attachImportedChannelContext}
        workspacePath={effectiveWorkspacePath}
      />
    ) : activeNav === MENU_IDS.profile ? (
      <SettingsPanel
        apiKeyInput={desktop.apiKeyInput}
        busy={desktop.busy}
        health={health}
        developerMode={developerMode}
        language={language}
        message={desktop.settingsMessage}
        onApiKeyChange={desktop.setApiKeyInput}
        onDeveloperModeChange={setDeveloperMode}
        onLanguageChange={setLanguage}
        onSubmit={handleSaveApiKey}
      />
    ) : (
      <div className="placeholder-view">
        <Sparkles size={28} />
        <h2>{title}</h2>
        <p>
          {language === "zh"
            ? "该视图预留给 WebUI 兼容的共享组件。桌面端适配层和 IPC 边界已先行就位。"
            : "This view is reserved for WebUI-compatible shared components. The desktop adapter and IPC boundary are in place first."}
        </p>
      </div>
    );

  const desktopStatusPanel = (
    <DesktopStatusPanel
      actionMessage={desktop.actionMessage}
      busy={desktop.busy}
      health={health}
      installProgress={desktop.installProgress}
      language={language}
      onCancelInstall={desktop.cancelInstall}
      onCheckUpdates={desktop.checkUpdates}
      onOpenPath={(path) => desktopApi.openPath(path)}
      onRefresh={desktop.refreshHealth}
    />
  );

  const rightPanelContent =
    activeRightTab === "terminal" ? (
      <TerminalPanel
        cwd={effectiveWorkspacePath}
        language={language}
        onCommandResult={(attachment) => {
          setBrowserAttachments((current) => [attachment, ...current].slice(0, 6));
        }}
        proposedCommand={terminalCommandProposal}
        onSendOutputToAgent={(text) => {
          setTerminalAgentTask(`Analyze this terminal output:\n\n${text}`);
          navigateTo(MENU_IDS.myAgents);
        }}
      />
    ) : activeRightTab === "browser" ? (
      <PreviewBrowserPanel
        initialUrl={browserPanelUrl}
        language={language}
        onAttachContext={(attachment) =>
          setBrowserAttachments((current) => [...current, attachment])
        }
        onClose={() => setActiveRightTab("files")}
      />
    ) : activeRightTab === "files" ? (
      <FilesContextPanel
        basket={workspaceContextAttachments}
        fileTraceEvents={workspaceFileTraceEvents}
        language={language}
        scopeId={activeThreadId}
        workspacePath={filesWorkspacePath}
        workspaceTrusted={workspaceTrusted}
        onBasketChange={setActiveThreadWorkspaceContextAttachments}
        onFileTraceChange={setActiveThreadFileTraceEvents}
        onInsertPath={(path) => {
          const current = chat.input.trimEnd();
          chat.setInput(current ? `${current}\n\n${path}` : path);
        }}
      />
    ) : (
      <SidePlaceholder language={language} tab={activeRightTab} />
    );

  const getPreviewContent = useCallback((preview: WorkspaceFilePreview): string => {
    return preview.content ?? preview.message ?? `${preview.kind} preview is metadata-only.`;
  }, []);

  const loadForkConflictContent = useCallback(
    async (
      thread: WorkspaceThread,
      file: ForkConflictFile,
    ): Promise<ForkConflictContentPreviewResult> => {
      const fork = thread.fork;
      if (!fork) throw new Error("Fork metadata is missing for this thread.");
      const [baseResult, sourceResult, forkResult, diffResult] = await Promise.allSettled([
        desktopApi.getWorkspaceGitFileAtRef({
          workspacePath: fork.sourceWorkspacePath,
          ref: fork.baseRef,
          path: file.path,
          maxBytes: 80_000,
        }),
        desktopApi.previewWorkspaceFile({
          workspacePath: fork.sourceWorkspacePath,
          path: file.path,
          maxBytes: 80_000,
        }),
        desktopApi.previewWorkspaceFile({
          workspacePath: fork.worktreePath,
          path: file.path,
          maxBytes: 80_000,
        }),
        desktopApi.getWorkspaceGitDiff({
          workspacePath: fork.sourceWorkspacePath,
          path: file.path,
          maxChars: 80_000,
        }),
      ] as const);
      const sourceContent =
        sourceResult.status === "fulfilled"
          ? getPreviewContent(sourceResult.value)
          : `Unable to preview source file: ${String(sourceResult.reason)}`;
      const baseContent =
        baseResult.status === "fulfilled"
          ? baseResult.value.content || baseResult.value.message
          : `Unable to preview merge-base file: ${String(baseResult.reason)}`;
      const forkContent =
        forkResult.status === "fulfilled"
          ? getPreviewContent(forkResult.value)
          : `Unable to preview fork file: ${String(forkResult.reason)}`;
      const diff =
        diffResult.status === "fulfilled"
          ? diffResult.value.diff || "No unstaged source diff is currently available for this file."
          : `Unable to load source diff: ${String(diffResult.reason)}`;
      return {
        baseContent,
        baseRef: fork.baseRef,
        baseMissing: baseResult.status === "fulfilled" ? baseResult.value.missing : true,
        sourceContent,
        forkContent,
        diff,
        diffHash: diffResult.status === "fulfilled" ? diffResult.value.diffHash : undefined,
        truncated:
          (sourceResult.status === "fulfilled" && sourceResult.value.truncated) ||
          (baseResult.status === "fulfilled" && baseResult.value.truncated) ||
          (forkResult.status === "fulfilled" && forkResult.value.truncated) ||
          (diffResult.status === "fulfilled" && diffResult.value.truncated),
      };
    },
    [getPreviewContent],
  );

  const stageForkConflictFile = useCallback(
    async (thread: WorkspaceThread, file: ForkConflictFile): Promise<ForkConflictStageResult> => {
      const fork = thread.fork;
      if (!fork) throw new Error("Fork metadata is missing for this thread.");
      const diff = await desktopApi.getWorkspaceGitDiff({
        workspacePath: fork.sourceWorkspacePath,
        path: file.path,
        maxChars: 80_000,
      });
      if (!diff.diffHash) {
        throw new Error("No source diff hash is available for this conflict file.");
      }
      const result = await desktopApi.stageWorkspaceFile({
        workspacePath: fork.sourceWorkspacePath,
        path: file.path,
        expectedDiffHash: diff.diffHash,
      });
      return {
        diff: diff.diff,
        diffHash: diff.diffHash,
        message: result.message,
        approvalQueued: result.approvalQueued,
        staged: result.staged,
      };
    },
    [],
  );

  const writeForkConflictDraft = useCallback(
    async (
      thread: WorkspaceThread,
      file: ForkConflictFile,
      draft: string,
      expectedDiffHash?: string,
    ): Promise<ForkConflictDraftWriteResult> => {
      const fork = thread.fork;
      if (!fork) throw new Error("Fork metadata is missing for this thread.");
      if (!expectedDiffHash) {
        throw new Error("Load and review the source diff before writing a resolved draft.");
      }
      const result = await desktopApi.writeForkConflictDraft({
        threadId: thread.id,
        workspacePath: fork.sourceWorkspacePath,
        path: file.path,
        draft,
        expectedDiffHash,
      });
      return {
        path: result.path,
        message: result.message,
        approvalQueued: result.approvalQueued,
        written: result.written,
      };
    },
    [],
  );

  return (
    <WorkspaceShell
      activeNav={activeNav}
      activeRightTab={activeRightTab}
      activeWorkspaceId={activeWorkspaceId}
      activeWorkspaceName={activeWorkspace.name}
      canGoBack={navHistoryIndex > 0}
      canGoForward={navHistoryIndex < navHistory.length - 1}
      desktopStatusPanel={desktopStatusPanel}
      language={language}
      mainContent={mainContent}
      navIcons={navIcons}
      navSections={navSections}
      recentThreads={recentThreads}
      rightPanel={rightPanelContent}
      rightPanelCollapsed={rightPanelCollapsed}
      rightTabIcons={rightTabIcons}
      rightTabs={rightTabs}
      sessionScope={sessionScope}
      sidebarCollapsed={sidebarCollapsed}
      user={user}
      workspaceSortMode={workspaceSortMode}
      workspaces={sortedWorkspaces}
      onCreateWorkspace={handleCreateWorkspace}
      onGoBack={goBack}
      onGoForward={goForward}
      onAddWorkspace={handleAddWorkspace}
      onLanguageChange={setLanguage}
      onLoadForkConflictContent={loadForkConflictContent}
      onLogout={async () => {
        await chat.abort();
        await onLogout();
      }}
      onNavChange={navigateTo}
      onNewChat={() => {
        void handleNewChat();
      }}
      onOpenWorkspacePath={handleOpenWorkspacePath}
      onPickWorkspaceFolder={handlePickWorkspaceFolder}
      onRefreshWorkspaces={refreshWorkspaces}
      onRemoveWorkspace={handleRemoveWorkspace}
      onRequestForkLifecycle={handleForkLifecycleRequest}
      onRightTabChange={setActiveRightTab}
      onStageForkConflictFile={stageForkConflictFile}
      onWriteForkConflictDraft={writeForkConflictDraft}
      onThreadSelect={handleThreadSelect}
      onThreadUpdate={handleThreadUpdate}
      onToggleSessionScope={() =>
        setSessionScope((scope) => (scope === "workspace" ? "all" : "workspace"))
      }
      onToggleRightPanel={() => setRightPanelCollapsed((current) => !current)}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      onUpdateWorkspace={handleUpdateWorkspace}
      onWorkspaceChange={handleWorkspaceChange}
      onWorkspaceSortModeChange={setWorkspaceSortMode}
    />
  );
}

function loadLegacyWorkspaces(): Array<
  Pick<WorkspaceProject, "name" | "path" | "description">
> {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<WorkspaceProject>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((workspace) => workspace.name && workspace.path)
      .map((workspace) => ({
        name: String(workspace.name),
        path: String(workspace.path),
        description: workspace.description
          ? String(workspace.description)
          : undefined,
      }));
  } catch {
    return [];
  }
}

function loadThreadSnapshots(): Record<string, ChatThreadSnapshot> {
  try {
    const raw = window.localStorage.getItem(THREAD_SNAPSHOT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChatThreadSnapshot>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function loadWorkspaceSortMode(): WorkspaceSortMode {
  const value = window.localStorage.getItem(WORKSPACE_SORT_STORAGE_KEY);
  return value === "name" || value === "created" || value === "recent"
    ? value
    : "recent";
}

function loadDeveloperMode(): boolean {
  return window.localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) === "true";
}

function sortWorkspacesForSidebar(
  workspaces: WorkspaceProject[],
  mode: WorkspaceSortMode,
): WorkspaceProject[] {
  return [...workspaces].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    if (mode === "name") {
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    if (mode === "created") {
      return right.createdAt.localeCompare(left.createdAt);
    }
    return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
  });
}

function sortThreadsForSidebar(threads: DesktopThread[]): DesktopThread[] {
  return [...threads].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function createLocalThreadId(): string {
  return `thread-${crypto.randomUUID()}`;
}

function formatThreadTime(updatedAt: string, language: AppLanguage): string {
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return language === "zh" ? "刚刚" : "now";
  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return language === "zh" ? "刚刚" : "now";
  if (minutes < 60) return language === "zh" ? `${minutes} 分` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === "zh" ? `${hours} 小时` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return language === "zh" ? `${days} 天` : `${days}d`;
}

function getWorkspaceId(path: string): string {
  return `workspace:${path.toLowerCase()}`;
}

function getComparablePath(path: string | null | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function getWorkspaceName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

function getAttachmentIdentity(attachment: ChatAttachment): string {
  return [
    attachment.kind,
    attachment.path,
    attachment.title || "",
    attachment.visibleText ? attachment.visibleText.slice(0, 64) : "",
  ].join("|");
}

function DesktopStatusPanel({
  actionMessage,
  busy,
  health,
  installProgress,
  language,
  onCancelInstall,
  onCheckUpdates,
  onOpenPath,
  onRefresh,
}: {
  actionMessage: string | null;
  busy: boolean;
  health: DesktopHealth | null;
  installProgress: InstallProgress | null;
  language: AppLanguage;
  onCancelInstall: () => void;
  onCheckUpdates: () => void;
  onOpenPath: (path: string) => void;
  onRefresh: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const version = health?.install.version ?? (zh ? "未知版本" : "unknown");
  const installStatus = health?.install.backendNeedsRepair
    ? zh
      ? "需要修复"
      : "Repair required"
    : health?.install.installed
      ? zh
        ? "已安装"
        : "Installed"
      : zh
        ? "未安装"
        : "Missing";
  const gatewayStatus = health?.gateway.externalConflict
    ? zh
      ? "端口冲突"
      : "Port conflict"
    : health?.gateway.ready
      ? zh
        ? "就绪"
        : "Ready"
      : zh
        ? "已停止"
        : "Stopped";
  const modeLabel =
    health?.mode === "local"
      ? zh
        ? "本地"
        : "local"
      : (health?.mode ?? (zh ? "本地" : "local"));
  const apiKeyStatus = health?.install.apiKeyConfigured
    ? zh
      ? "已配置"
      : "configured"
    : zh
      ? "缺失"
      : "missing";

  return (
    <div className="desktop-status-panel">
      <div className="about-hero">
        <div className="about-mark" aria-hidden>
          OD
        </div>
        <div className="about-heading">
          <span>{zh ? "桌面智能体工作台" : "Desktop Agent Workspace"}</span>
          <h2>OpenDrSai</h2>
          <p>
            {zh
              ? "面向本地工作区、智能体协作和科研工程流程的桌面端。"
              : "A desktop workspace for local projects, agent collaboration, and research workflows."}
          </p>
        </div>
        <div className="about-version-card">
          <span>{zh ? "当前版本" : "Version"}</span>
          <strong>{version}</strong>
          <button type="button" onClick={onRefresh}>{zh ? "刷新状态" : "Refresh Status"}</button>
        </div>
      </div>

      <dl className="about-status-grid">
        <div>
          <dt>{zh ? "安装" : "Install"}</dt>
          <dd>{installStatus}</dd>
        </div>
        <div>
          <dt>{zh ? "网关" : "Gateway"}</dt>
          <dd>{gatewayStatus}</dd>
        </div>
        <div>
          <dt>{zh ? "模式" : "Mode"}</dt>
          <dd>{modeLabel}</dd>
        </div>
        <div>
          <dt>API Key</dt>
          <dd>{apiKeyStatus}</dd>
        </div>
      </dl>

      <section className="about-section">
        <div className="about-section-title">
          <strong>{zh ? "维护" : "Maintenance"}</strong>
          <span>{zh ? "仅保留更新检查" : "Update check only"}</span>
        </div>
        <div className="about-action-grid">
          <button disabled={busy} onClick={onCheckUpdates}>
            {zh ? "检查更新" : "Check Updates"}
          </button>
        </div>
      </section>

      {actionMessage && <div className="action-message">{actionMessage}</div>}

      <div className="diagnostics about-diagnostics">
        <strong>{zh ? "诊断信息" : "Diagnostics"}</strong>
        <span>
          {health?.install.home ??
            (zh ? "未检测到 DrSai 主目录" : "No DrSai home detected")}
        </span>
        <span>
          {zh ? "缺失项：" : "Missing: "}
          {health?.install.missing.length
            ? health.install.missing.join(", ")
            : zh
              ? "无"
              : "none"}
        </span>
        <span>
          {zh ? "后端目标版本：" : "Backend target: "}
          {health?.install.expectedVersion ?? (zh ? "开发模式" : "development")}
        </span>
        <span>
          {zh ? "后端修复：" : "Backend repair: "}
          {health?.install.backendNeedsRepair
            ? zh
              ? "需要"
              : "required"
            : zh
              ? "不需要"
              : "not required"}
        </span>
        <span>
          {zh ? "后端来源：" : "Backend source: "}
          {health?.install.bundledBackendAvailable
            ? zh
              ? "内置源码包"
              : "bundled archive"
            : zh
              ? "代码仓库"
              : "repository"}
        </span>
        <span>
          {zh ? "网关运行时：" : "Gateway runtime: "}
          {health?.gateway.externalConflict
            ? zh
              ? "端口被其他进程占用"
              : "port occupied by another process"
            : health?.gateway.externalReady
              ? health.gateway.managed
                ? zh
                  ? "已自动托管并可访问"
                  : "auto-managed and reachable"
                : zh
                  ? "可访问但未托管"
                  : "reachable but unmanaged"
              : zh
                ? "自动启动中或暂不可用"
                : "starting automatically or unavailable"}
        </span>
        <span>
          Python{zh ? "：" : ": "}
          {health?.install.prerequisites.pythonVersion ??
            (zh ? "未找到" : "not found")}
        </span>
        <span>
          {zh ? "Python 路径：" : "Python path: "}
          {health?.install.prerequisites.pythonCommand ??
            (zh ? "未找到" : "not found")}
        </span>
        <span>
          Git{zh ? "：" : ": "}
          {health?.install.prerequisites.gitVersion ??
            (zh ? "未找到" : "not found")}
        </span>
        <span>
          {zh ? "Git 路径：" : "Git path: "}
          {health?.install.prerequisites.gitCommand ??
            (zh ? "未找到" : "not found")}
        </span>
        <span>
          {zh ? "更新：" : "Update: "}
          {formatUpdateStatus(health, language)}
        </span>
        {typeof health?.update.progress === "number" && (
          <span>
            {zh ? "下载进度：" : "Download: "}
            {Math.round(health.update.progress)}%
          </span>
        )}
        {health?.install.prerequisites.problems.map((problem) => (
          <span key={problem}>
            {zh ? "问题：" : "Issue: "}
            {problem}
          </span>
        ))}
      </div>
      {installProgress && (
        <div className={`install-log ${installProgress.phase}`}>
          <strong>
            {localizeInstallMessage(installProgress.message, language)}
          </strong>
          {installProgress.logFile && (
            <div className="log-path-row">
              <span>
                {zh ? "日志文件：" : "Log file: "}
                {installProgress.logFile}
              </span>
              <button onClick={() => onOpenPath(installProgress.logFile ?? "")}>
                {zh ? "打开日志" : "Open Log"}
              </button>
            </div>
          )}
          {installProgress.phase === "running" && (
            <button className="cancel-install-button" onClick={onCancelInstall}>
              {zh ? "取消安装" : "Cancel Install"}
            </button>
          )}
          <pre>
            {installProgress.log ||
              (zh
                ? "正在等待安装器输出..."
                : "Waiting for installer output...")}
          </pre>
        </div>
      )}
    </div>
  );
}

function localizeInstallMessage(
  message: string,
  language: AppLanguage,
): string {
  if (language === "en") return message;
  const known: Record<string, string> = {
    "Starting OpenDrSai installation...": "正在启动 OpenDrSai 安装...",
    "Installing OpenDrSai...": "正在安装 OpenDrSai...",
    "Installation complete.": "安装完成。",
    "Installation cancelled.": "安装已取消。",
    "Installation is already running.": "安装已在运行。",
  };
  if (/^Installer exited with code/.test(message)) return "安装器异常退出。";
  return known[message] ?? message;
}

function formatUpdateStatus(
  health: DesktopHealth | null,
  language: AppLanguage,
): string {
  const zh = language === "zh";
  if (!health) return zh ? "未检查" : "not checked";
  if (health.update.error) return health.update.error;
  if (health.update.downloaded)
    return zh
      ? `已下载，待安装 ${health.update.version ?? ""}`
      : `ready to install ${health.update.version ?? ""}`;
  if (health.update.downloading)
    return zh
      ? `正在下载 ${health.update.version ?? ""}`
      : `downloading ${health.update.version ?? ""}`;
  if (health.update.checking) return zh ? "正在检查" : "checking";
  if (health.update.available)
    return zh
      ? `可更新 ${health.update.version ?? ""}`
      : `available ${health.update.version ?? ""}`;
  return zh ? "未检查" : "not checked";
}

function SettingsPanel({
  apiKeyInput,
  busy,
  developerMode,
  health,
  language,
  message,
  onApiKeyChange,
  onDeveloperModeChange,
  onLanguageChange,
  onSubmit,
}: {
  apiKeyInput: string;
  busy: boolean;
  developerMode: boolean;
  health: DesktopHealth | null;
  language: AppLanguage;
  message: string | null;
  onApiKeyChange: (value: string) => void;
  onDeveloperModeChange: (enabled: boolean) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onSubmit: (event: FormEvent) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <div className="settings-view">
      <section className="settings-section">
        <div>
          <h2>{zh ? "显示语言" : "Language"}</h2>
          <p>
            {zh
              ? "切换 OpenDrSai 桌面端的界面语言。"
              : "Switch the interface language for OpenDrSai Desktop."}
          </p>
        </div>
        <div className="settings-language-control">
          <span>{zh ? "界面语言" : "Interface language"}</span>
          <div
            className="language-segment"
            role="group"
            aria-label={zh ? "界面语言" : "Interface language"}
          >
            <button
              type="button"
              className={language === "en" ? "active" : ""}
              onClick={() => onLanguageChange("en")}
            >
              {zh ? "英文" : "English"}
            </button>
            <button
              type="button"
              className={language === "zh" ? "active" : ""}
              onClick={() => onLanguageChange("zh")}
            >
              {zh ? "中文" : "Chinese"}
            </button>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>{zh ? "开发者模式" : "Developer Mode"}</h2>
          <p>
            {zh
              ? "关闭时，聊天中的模型错误只显示简要摘要，并且只保留最新一条重试提示。开启后显示完整错误详情，便于排查。"
              : "When off, chat model errors show a short summary and only the latest retry notice. Turn it on to keep full diagnostic details."}
          </p>
        </div>
        <label className="settings-toggle">
          <span>
            <strong>{zh ? "显示完整错误信息" : "Show full error details"}</strong>
            <small>{developerMode ? (zh ? "已启用" : "Enabled") : (zh ? "默认关闭" : "Off by default")}</small>
          </span>
          <input
            type="checkbox"
            checked={developerMode}
            onChange={(event) => onDeveloperModeChange(event.target.checked)}
          />
        </label>
      </section>
      <section className="settings-section">
        <div>
          <h2>API Key</h2>
          <p>
            {zh
              ? "配置本地网关使用的 HepAI key。该值会保存到 DrSai `.env` 文件，保存后不会在此处再次显示。"
              : "Configure the HepAI key used by the local gateway. The value is saved to the DrSai `.env` file and is never shown again here."}
          </p>
        </div>
        <form className="settings-form" onSubmit={onSubmit}>
          <label htmlFor="api-key-input">HEPAI_API_KEY</label>
          <input
            id="api-key-input"
            type="password"
            value={apiKeyInput}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={
              health?.install.apiKeyConfigured
                ? zh
                  ? "已配置 key；输入新值可替换"
                  : "Key is configured; enter a new value to replace it"
                : zh
                  ? "粘贴你的 API key"
                  : "Paste your API key"
            }
          />
          <button disabled={busy || !apiKeyInput.trim()} type="submit">
            {zh ? "保存 API Key" : "Save API Key"}
          </button>
        </form>
        {message && <div className="settings-message">{message}</div>}
      </section>
      <section className="settings-section">
        <h2>{zh ? "路径" : "Paths"}</h2>
        <dl>
          <div>
            <dt>{zh ? "DrSai 主目录" : "DrSai home"}</dt>
            <dd>{health?.install.home || (zh ? "未知" : "unknown")}</dd>
          </div>
          <div>
            <dt>{zh ? "仓库" : "Repository"}</dt>
            <dd>{health?.install.repoPath || (zh ? "未知" : "unknown")}</dd>
          </div>
          <div>
            <dt>Python</dt>
            <dd>{health?.install.pythonPath || (zh ? "未知" : "unknown")}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function SidePlaceholder({
  language,
  tab,
}: {
  language: AppLanguage;
  tab: RightTab;
}): React.JSX.Element {
  return (
    <div className="side-placeholder">
      <FileText size={20} />
      <strong>{tab}</strong>
      <span>
        {language === "zh"
          ? "预留给共享 WebUI 面板内容。"
          : "Reserved for shared WebUI panel content."}
      </span>
    </div>
  );
}

function removeExternalAttachment(
  index: number,
  browserCount: number,
  setBrowserAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>,
  workspaceContextAttachments: ChatAttachment[],
  setWorkspaceContextAttachments: (attachments: ChatAttachment[]) => void,
): void {
  if (index < browserCount) {
    setBrowserAttachments((current) =>
      current.filter((_attachment, itemIndex) => itemIndex !== index),
    );
    return;
  }
  const workspaceIndex = index - browserCount;
  setWorkspaceContextAttachments(
    workspaceContextAttachments.filter(
      (_attachment, itemIndex) => itemIndex !== workspaceIndex,
    ),
  );
}

export default App;
