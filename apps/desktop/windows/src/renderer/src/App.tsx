import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Bug,
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
  MyDrSaiConfig,
  RemoteSshHost,
  RemoteDirectoryEntry,
  RemoteGatewayPreflight,
  RemoteGatewayOperationEvent,
  RemoteHepaiWorker,
  WorkspaceFilePreview,
  WorkspaceProject,
} from "@shared/desktopApi";
import { desktopApi } from "./desktopApi";
import { AuthSplash, LoginScreen, ServiceUnavailableScreen } from "./auth/LoginScreen";
import { useAuth } from "./auth/AuthProvider";
import { AgentSquareView } from "./components/AgentSquareView";
import { AgentRunWorkspace } from "./components/AgentRunWorkspace";
import { ApprovalCenterView } from "./components/ApprovalCenterView";
import { ChannelsView } from "./components/ChannelsView";
import { ChatWorkspace, type ThinkingEffort } from "./components/ChatWorkspace";
import { PreviewBrowserPanel } from "./components/PreviewBrowserPanel";
import { ProviderAnalyticsView } from "./components/ProviderAnalyticsView";
import { SkillSquareView } from "./components/SkillSquareView";
import { TerminalPanel } from "./components/TerminalPanel";
import { DebugPanel } from "./components/DebugPanel";
import { installDebugLogCapture } from "./debugLogStore";
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
  debug: Bug,
};

installDebugLogCapture();

const WORKSPACE_STORAGE_KEY = "opendrsai.workspaces";
const WORKSPACE_MIGRATION_KEY = "opendrsai.workspaces.migrated";
const THREAD_SNAPSHOT_STORAGE_KEY = "opendrsai.threadSnapshots";
const WORKSPACE_SORT_STORAGE_KEY = "opendrsai.workspaceSortMode";
const DEVELOPER_MODE_STORAGE_KEY = "opendrsai.developerMode";
const LANGUAGE_STORAGE_KEY = "opendrsai.language";
const SESSION_SCOPE_STORAGE_KEY = "opendrsai.sessionScope";
const DEFAULT_AGENT_STORAGE_KEY = "opendrsai.defaultAgent";
const DEFAULT_MODEL_STORAGE_KEY = "opendrsai.defaultModel";
const THINKING_EFFORT_STORAGE_KEY = "opendrsai.thinkingEffort";
const RESTORE_SESSION_STORAGE_KEY = "opendrsai.restoreLastSession";
const RESTORE_WORKSPACE_STORAGE_KEY = "opendrsai.restoreLastWorkspace";
const LAST_THREAD_STORAGE_KEY = "opendrsai.lastThread";
const LAST_WORKSPACE_STORAGE_KEY = "opendrsai.lastWorkspace";
const COMPLETION_NOTIFICATION_STORAGE_KEY = "opendrsai.completionNotifications";
const APPEARANCE_STORAGE_KEY = "opendrsai.appearance";
const SIDEBAR_COMPONENTS_STORAGE_KEY = "opendrsai.sidebarComponents";
const RIGHT_SIDEBAR_COMPONENTS_STORAGE_KEY = "opendrsai.rightSidebarComponents";
const REMOTE_RECENT_PATHS_STORAGE_KEY = "opendrsai.remoteSsh.recentPaths";
type WorkspaceSortMode = "recent" | "name" | "created";
type AppearanceMode = "light" | "dark" | "system";
interface SidebarComponentVisibility {
  square: boolean;
  agents: boolean;
  skills: boolean;
}
interface RightSidebarComponentVisibility {
  files: boolean;
  browser: boolean;
  terminal: boolean;
  debug: boolean;
}

function App(): React.JSX.Element {
  const auth = useAuth();

  if (auth.loading) return <AuthSplash />;
  if (!auth.session.authenticated) return <LoginScreen />;
  if (!auth.serviceReady) return <ServiceUnavailableScreen />;

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
  const [language, setLanguage] = useState<AppLanguage>(() => loadLanguage());
  const developerMode = import.meta.env.DEV && loadDeveloperMode();
  const [activeNav, setActiveNav] = useState<NavId>(MENU_IDS.currentSession);
  const [skillSquareCommandTarget, setSkillSquareCommandTarget] =
    useState<Extract<ChatCommandAction, { type: "open-view" }>["target"] | null>(null);
  const [navHistory, setNavHistory] = useState<NavId[]>([
    MENU_IDS.currentSession,
  ]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(0);
  const [activeRightTab, setActiveRightTab] = useState<RightTab>("files");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => loadRestoredWorkspaceId());
  const [storedWorkspaces, setStoredWorkspaces] = useState<WorkspaceProject[]>(
    [],
  );
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteHosts, setRemoteHosts] = useState<RemoteSshHost[]>([]);
  const [remoteHostAlias, setRemoteHostAlias] = useState("");
  const [remotePath, setRemotePath] = useState("/home/vscode");
  const [remoteDialogError, setRemoteDialogError] = useState("");
  const [remoteConnecting, setRemoteConnecting] = useState(false);
  const [remoteNeedsHostTrust, setRemoteNeedsHostTrust] = useState(false);
  const [remoteDirectories, setRemoteDirectories] = useState<RemoteDirectoryEntry[]>([]);
  const [remoteShowHidden, setRemoteShowHidden] = useState(false);
  const [remoteRecentPaths, setRemoteRecentPaths] = useState<string[]>(() => loadRemoteRecentPaths());
  const [remoteGatewayPreflight, setRemoteGatewayPreflight] = useState<RemoteGatewayPreflight | null>(null);
  const [remoteGatewayArtifact, setRemoteGatewayArtifact] = useState("");
  const [remoteGatewayOperation, setRemoteGatewayOperation] = useState<RemoteGatewayOperationEvent | null>(null);
  const [remoteWorkers, setRemoteWorkers] = useState<RemoteHepaiWorker[]>([]);
  useEffect(() => desktopApi.onRemoteGatewayOperation((event) => setRemoteGatewayOperation(event)), []);
  const [threads, setThreads] = useState<DesktopThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState(() => loadRestoredThreadId());
  const [threadSnapshots, setThreadSnapshots] = useState<
    Record<string, ChatThreadSnapshot>
  >(() => loadThreadSnapshots());
  const [workspaceSortMode, setWorkspaceSortMode] = useState<WorkspaceSortMode>(
    () => loadWorkspaceSortMode(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [sessionScope, setSessionScope] = useState<"workspace" | "all">(() => loadSessionScope());
  const [availableChatAgents, setAvailableChatAgents] = useState<DesktopAgent[]>([]);
  const [availableChatModels, setAvailableChatModels] = useState<MyDrSaiModelConfig[]>([]);
  const [selectedChatAgentId, setSelectedChatAgentId] = useState<string | null>(() => loadOptionalSetting(DEFAULT_AGENT_STORAGE_KEY));
  const [selectedChatAgentName, setSelectedChatAgentName] = useState("OpenDrSai");
  const [selectedChatModel, setSelectedChatModel] = useState<string | null>(() => loadOptionalSetting(DEFAULT_MODEL_STORAGE_KEY));
  const [defaultThinkingEffort, setDefaultThinkingEffort] = useState<ThinkingEffort>(() => loadThinkingEffort());
  const [restoreLastSession, setRestoreLastSession] = useState(() => loadBooleanSetting(RESTORE_SESSION_STORAGE_KEY, true));
  const [restoreLastWorkspace, setRestoreLastWorkspace] = useState(() => loadBooleanSetting(RESTORE_WORKSPACE_STORAGE_KEY, true));
  const [completionNotifications, setCompletionNotifications] = useState(() => loadBooleanSetting(COMPLETION_NOTIFICATION_STORAGE_KEY, false));
  const [appearance, setAppearance] = useState<AppearanceMode>(() => loadAppearance());
  const [sidebarComponents, setSidebarComponents] = useState<SidebarComponentVisibility>(() => loadSidebarComponents());
  const [rightSidebarComponents, setRightSidebarComponents] = useState<RightSidebarComponentVisibility>(() => loadRightSidebarComponents());
  const [myDrSaiConfig, setMyDrSaiConfig] = useState<MyDrSaiConfig | null>(null);
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
  const rightTabs = useMemo(
    () => getRightTabs(language).filter(({ id }) =>
      id === "templates" ? false : rightSidebarComponents[id],
    ),
    [language, rightSidebarComponents],
  );
  const firstVisibleRightTab = rightTabs[0]?.id;
  const title =
    navItems.find((item) => item.id === activeNav)?.label ??
    (language === "zh" ? "当前会话" : "Chat");
  const { health } = desktop;
  const workspacePath = health?.install.repoPath || health?.install.home || "";
  const currentWorkspaceTime = "1970-01-01T00:00:00.000Z";
  const currentWorkspace: WorkspaceProject = {
    id: "current",
    name: getWorkspaceName(workspacePath) || "drsai",
    path: workspacePath,
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
  const searchableThreads: WorkspaceThread[] = visibleThreads.map((thread) => ({
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
    onChatComplete: () => {
      void desktop.refreshHealth();
      showCompletionNotification(completionNotifications, language, false);
    },
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
  const filesWorkspacePath = effectiveWorkspacePath;

  useEffect(() => {
    void refreshWorkspaces();
  }, []);

  useEffect(() => desktopApi.onRemoteWorkspaceStatus((status) => {
    setStoredWorkspaces((current) => current.map((workspace) => workspace.id === status.workspaceId ? { ...workspace, remote: status, updatedAt: new Date().toISOString() } : workspace));
  }), []);

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
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(SESSION_SCOPE_STORAGE_KEY, sessionScope);
  }, [sessionScope]);

  useEffect(() => {
    persistOptionalSetting(DEFAULT_AGENT_STORAGE_KEY, selectedChatAgentId);
  }, [selectedChatAgentId]);

  useEffect(() => {
    persistOptionalSetting(DEFAULT_MODEL_STORAGE_KEY, selectedChatModel);
  }, [selectedChatModel]);

  useEffect(() => {
    window.localStorage.setItem(THINKING_EFFORT_STORAGE_KEY, defaultThinkingEffort);
  }, [defaultThinkingEffort]);

  useEffect(() => {
    window.localStorage.setItem(RESTORE_SESSION_STORAGE_KEY, String(restoreLastSession));
  }, [restoreLastSession]);

  useEffect(() => {
    window.localStorage.setItem(RESTORE_WORKSPACE_STORAGE_KEY, String(restoreLastWorkspace));
  }, [restoreLastWorkspace]);

  useEffect(() => {
    window.localStorage.setItem(COMPLETION_NOTIFICATION_STORAGE_KEY, String(completionNotifications));
  }, [completionNotifications]);

  useEffect(() => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (): void => {
      const resolvedTheme = appearance === "system"
        ? systemTheme.matches ? "dark" : "light"
        : appearance;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.style.colorScheme = resolvedTheme;
    };
    applyTheme();
    if (appearance !== "system") return;
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [appearance]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COMPONENTS_STORAGE_KEY, JSON.stringify(sidebarComponents));
  }, [sidebarComponents]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_COMPONENTS_STORAGE_KEY, JSON.stringify(rightSidebarComponents));
  }, [rightSidebarComponents]);

  useEffect(() => {
    if (rightTabs.some(({ id }) => id === activeRightTab)) return;
    if (firstVisibleRightTab) {
      setActiveRightTab(firstVisibleRightTab);
    } else {
      setRightPanelCollapsed(true);
    }
  }, [activeRightTab, firstVisibleRightTab, rightTabs]);

  useEffect(() => {
    if (restoreLastSession) window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, activeThreadId);
  }, [activeThreadId, restoreLastSession]);

  useEffect(() => {
    if (restoreLastWorkspace) window.localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, activeWorkspaceId);
  }, [activeWorkspaceId, restoreLastWorkspace]);

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
          effectiveWorkspacePath
            ? desktopApi.getMyDrSaiConfig(effectiveWorkspacePath).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setAvailableChatAgents(agents);
        setAvailableChatModels(myDrSaiConfig?.models ?? []);
        setMyDrSaiConfig(myDrSaiConfig);
        if (cancelled || agents.length === 0) return;
        const defaultAgent =
          agents.find((agent) => agent.isDefault) ??
          agents.find((agent) => agent.id === "my-drsai") ??
          agents.find((agent) => agent.status === "running") ??
          agents[0];
        const preferredAgent = agents.find((agent) => agent.id === selectedChatAgentId) ?? defaultAgent;
        setSelectedChatAgentId(preferredAgent.id);
        setSelectedChatAgentName(preferredAgent.name);
        setSelectedChatModel(
          (current) => current ?? defaultAgent.model ?? myDrSaiConfig?.defaultModelAlias ?? null,
        );
        setSelectedChatExamples(preferredAgent.examples);
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
    setRemoteDialogError("");
    const hosts = await desktopApi.listSshHosts();
    setRemoteHosts(hosts);
    setRemoteHostAlias(hosts[0]?.alias || "");
    setRemoteDialogOpen(true);
  }

  async function handleConnectRemoteWorkspace(): Promise<void> {
    setRemoteConnecting(true);
    setRemoteDialogError("");
    try {
      if (!(await desktopApi.testSshHost(remoteHostAlias))) {
        setRemoteNeedsHostTrust(true);
        throw new Error("SSH authentication or host-key verification failed.");
      }
      const workspace = await desktopApi.connectRemoteWorkspace({ hostAlias: remoteHostAlias, path: remotePath.trim(), trusted: true });
      setStoredWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
      setRemoteRecentPaths((current) => {
        const next = [workspace.remote?.canonicalPath || remotePath.trim(), ...current.filter((path) => path !== remotePath.trim())].slice(0, 8);
        window.localStorage.setItem(REMOTE_RECENT_PATHS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      const remoteThreads = await desktopApi.listRemoteThreads(workspace.id).catch(() => []);
      if (remoteThreads.length > 0) {
        setThreads((current) => sortThreadsForSidebar([...remoteThreads, ...current.filter((item) => !remoteThreads.some((remoteThread) => remoteThread.id === item.id))]));
      }
      setActiveWorkspaceId(workspace.id);
      navigateTo(MENU_IDS.currentSession);
      setRemoteDialogOpen(false);
    } catch (error) {
      setRemoteDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoteConnecting(false);
    }
  }

  async function browseRemotePath(path = remotePath): Promise<void> {
    if (!remoteHostAlias || !path.trim()) return;
    try {
      const entries = await desktopApi.listRemoteDirectories(remoteHostAlias, path.trim());
      setRemoteDirectories(entries); setRemotePath(path.trim()); setRemoteDialogError("");
    } catch (error) { setRemoteDialogError(error instanceof Error ? error.message : String(error)); }
  }

  async function inspectRemoteGateway(): Promise<void> {
    if (!remoteHostAlias) return;
    try {
      setRemoteGatewayPreflight(await desktopApi.preflightRemoteGateway(remoteHostAlias));
      setRemoteDialogError("");
    } catch (error) {
      setRemoteDialogError(error instanceof Error ? error.message : String(error));
    }
  }

  async function showRemoteDiagnostics(): Promise<void> {
    const report = await desktopApi.getRemoteSshDiagnosticReport();
    const host = report.hosts.find((item) => item.hostAlias === remoteHostAlias);
    setRemoteDialogError(host ? `Diagnostics: ${host.state}; workspaces=${host.workspaceCount}; reconnects=${host.reconnectCount}; attempts=${host.reconnectAttempts}; last=${host.events.at(-1)?.phase || "none"}` : "No live host diagnostics are available yet.");
  }

  async function chooseRemoteGatewayArtifact(): Promise<void> {
    const result = await desktopApi.pickFiles();
    if (!result.canceled && result.paths[0]) setRemoteGatewayArtifact(result.paths[0]);
  }

  async function requestRemoteGatewayOperation(action: "install" | "upgrade" | "rollback"): Promise<void> {
    if (!remoteHostAlias) return;
    if (action !== "rollback" && !remoteGatewayArtifact) {
      setRemoteDialogError("Select a signed or SHA-256-verifiable .whl/.tar.gz artifact first.");
      return;
    }
    try {
      const proposal = await desktopApi.requestRemoteGatewayInstallApproval({
        hostAlias: remoteHostAlias,
        action,
        ...(remoteGatewayArtifact ? { artifactPath: remoteGatewayArtifact } : {}),
      });
      setRemoteDialogError(proposal.queued ? "Operation queued in Approval Center." : proposal.reason);
      if (!proposal.queued && proposal.allowed) await inspectRemoteGateway();
    } catch (error) {
      setRemoteDialogError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadRemoteWorkers(): Promise<void> {
    const workspace = storedWorkspaces.find((item) => item.remote?.hostAlias === remoteHostAlias && item.remote.canonicalPath === remotePath.trim());
    if (!workspace) return setRemoteWorkers([]);
    setRemoteWorkers(await desktopApi.listRemoteHepaiWorkers(workspace.id));
  }

  async function toggleRemoteWorker(worker: RemoteHepaiWorker): Promise<void> {
    const workspace = storedWorkspaces.find((item) => item.remote?.hostAlias === remoteHostAlias && item.remote.canonicalPath === remotePath.trim());
    if (!workspace) return;
    await desktopApi.setRemoteHepaiWorkerEnabled(workspace.id, worker.id, !worker.enabled);
    await loadRemoteWorkers();
  }

  async function handleAddLocalWorkspace(): Promise<void> {
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
    setRemoteDialogOpen(false);
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
    const workspace = storedWorkspaces.find((item) => item.id === workspaceId);
    if (workspace?.type === "remote-ssh") {
      await desktopApi.disconnectRemoteWorkspace(workspaceId).catch(() => false);
    }
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
    const workspace = storedWorkspaces.find((item) => item.path === path);
    if (workspace?.type === "remote-ssh") return;
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
      boundAgentId: selectedChatAgentId || undefined,
      boundAgentName: selectedChatAgentName || undefined,
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
    if (thread?.boundAgentId) {
      const boundAgent = availableChatAgents.find((agent) => agent.id === thread.boundAgentId);
      if (boundAgent) {
        setSelectedChatAgentId(boundAgent.id);
        setSelectedChatAgentName(boundAgent.name);
        setSelectedChatModel(boundAgent.model || null);
        setSelectedChatExamples(boundAgent.examples);
      }
    }
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
    void hydrateThreadSnapshot(threadId);
    if (thread?.unread) {
      void handleThreadUpdate(threadId, { unread: false });
    }
    navigateTo(MENU_IDS.currentSession);
  }

  async function handleNewAgentTask(): Promise<void> {
    setRightPanelCollapsed(true);
    const thread = await desktopApi.createThread({
      kind: "agent_run",
      title: language === "zh" ? "新 Agent 任务" : "New agent task",
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

  async function hydrateThreadSnapshot(threadId: string): Promise<void> {
    try {
      const snapshot = await desktopApi.getThreadSnapshot(threadId);
      if (!snapshot) return;
      setThreadSnapshots((current) => {
        const existing = current[threadId];
        if (existing && existing.updatedAt >= snapshot.updatedAt) return current;
        return {
          ...current,
          [threadId]: snapshot,
        };
      });
    } catch {
      // Older app data may only have localStorage snapshots; keep the current view responsive.
    }
  }

  function applyChatAgent(agent: DesktopAgent): void {
    setSelectedChatAgentId(agent.id);
    setSelectedChatAgentName(agent.name);
    setSelectedChatModel(agent.model || selectedChatModel);
    setSelectedChatExamples(agent.examples);
  }

  async function selectChatAgent(agentId: string): Promise<boolean> {
    const agent = availableChatAgents.find((item) => item.id === agentId);
    if (!agent) return false;
    const activeThread = threads.find((thread) => thread.id === activeThreadId);
    const snapshotCount = threadSnapshots[activeThreadId]?.messageCount ?? 0;
    const hasConversation = (activeThread?.messageCount ?? 0) > 0 || snapshotCount > 0;
    const changesBoundAgent = Boolean(activeThread?.boundAgentId && activeThread.boundAgentId !== agent.id);
    if (hasConversation && changesBoundAgent) {
      const createNew = window.confirm(
        language === "zh"
          ? `当前会话已绑定 ${activeThread?.boundAgentName || "其他智能体"}。切换到 ${agent.name} 将新建会话，是否继续？`
          : `This conversation is bound to ${activeThread?.boundAgentName || "another agent"}. Start a new conversation with ${agent.name}?`,
      );
      if (!createNew) return false;
      applyChatAgent(agent);
      const thread = await desktopApi.createThread({
        kind: "chat",
        title: language === "zh" ? `与 ${agent.name} 的新会话` : `New chat with ${agent.name}`,
        workspacePath: effectiveWorkspacePath,
        boundAgentId: agent.id,
        boundAgentName: agent.name,
      });
      setActiveThreadId(thread.id);
      setThreads((current) => sortThreadsForSidebar([thread, ...current.filter((item) => item.id !== thread.id)]));
      return true;
    }
    applyChatAgent(agent);
    if (activeThread && !hasConversation) {
      const updated = await desktopApi.updateThread({ id: activeThread.id, boundAgentId: agent.id, boundAgentName: agent.name });
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
    }
    return true;
  }

  function handleChatAgentSelect(agentId: string): void {
    void selectChatAgent(agentId);
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
    void desktopApi.updateThreadSnapshot(snapshot).catch(() => {
      // The local snapshot is still kept in renderer state and localStorage if disk persistence fails.
    });
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
    if (!effectiveWorkspacePath) {
      setIdeContext(null);
      return;
    }
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
      activeThread?.kind === "agent_run" ? (
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
            setActiveRightTab("files");
            setRightPanelCollapsed(false);
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
          onProposeTerminalCommand={proposeTerminalCommand}
          onRunComplete={() => {
            showCompletionNotification(completionNotifications, language, true);
          }}
          threadId={activeThreadId}
          workspaceInstructions={effectiveWorkspaceInstructions}
          workspacePath={effectiveWorkspacePath}
          workspaceTrusted={workspaceTrusted}
        />
      ) : (
        <section className="conversation-panel">
        <ChatWorkspace
          activeRequestId={chat.activeRequestId}
          canChat={canChat}
          health={health}
          input={chat.input}
          language={language}
          messages={chat.messages}
          currentRuntimeMode={chat.currentRuntimeMode}
          defaultThinkingEffort={defaultThinkingEffort}
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
          workspaceType={effectiveWorkspace.type}
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
          onPickFiles={() => desktopApi.pickFiles()}
          onPickFolder={() => desktopApi.pickFolder()}
          onSummarizeWorkspaceFolder={(request) =>
            desktopApi.summarizeWorkspaceFolder(request)
          }
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
      )
    ) : activeNav === MENU_IDS.agentSquare ? (
      <section className="agent-square-panel">
        <AgentSquareView
          language={language}
          userEmail={user?.email}
          selectedAgentId={selectedChatAgentId}
          onSetDefault={(agent) => void selectChatAgent(agent.id)}
          onStartChat={(agent) => {
            void selectChatAgent(agent.id).then((selected) => {
              if (!selected) return;
              setRightPanelCollapsed(true);
              chat.setInput(
                language === "zh"
                  ? `我想使用 ${agent.name} 处理一个任务：`
                  : `I want to use ${agent.name} for a task:`,
              );
              navigateTo(MENU_IDS.currentSession);
            });
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
        onRunComplete={() => {
          showCompletionNotification(completionNotifications, language, true);
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
    ) : activeNav === MENU_IDS.usageAnalytics ? (
      <ProviderAnalyticsView language={language} />
    ) : activeNav === MENU_IDS.profile ? (
      <SettingsPanel
        agents={availableChatAgents}
        appearance={appearance}
        approvalCenterPanel={(
          <ApprovalCenterView
            language={language}
            onAttachMcpContext={attachImportedMcpContext}
            workspacePath={effectiveWorkspacePath}
            workspaceTrusted={workspaceTrusted}
          />
        )}
        channelsPanel={(
          <ChannelsView
            language={language}
            onAttachImportedContext={attachImportedChannelContext}
            workspacePath={effectiveWorkspacePath}
          />
        )}
        completionNotifications={completionNotifications}
        defaultThinkingEffort={defaultThinkingEffort}
        health={health}
        ideContext={ideContext}
        language={language}
        models={availableChatModels}
        myDrSaiConfig={myDrSaiConfig}
        onCheckUpdates={() => void desktop.checkUpdates()}
        onAppearanceChange={setAppearance}
        onCompletionNotificationsChange={(enabled) => {
          if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") {
            void Notification.requestPermission().then((permission) => setCompletionNotifications(permission === "granted"));
          } else {
            setCompletionNotifications(enabled);
          }
        }}
        onCopyDiagnostics={() => void navigator.clipboard.writeText(JSON.stringify({ health, workspace: effectiveWorkspacePath, user: user?.email ?? null }, null, 2))}
        onDeveloperModeChange={(enabled) => {
          window.localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, String(enabled));
          window.location.reload();
        }}
        onExportLocalData={() => exportLocalDesktopData(threadSnapshots)}
        onLanguageChange={setLanguage}
        onLogout={onLogout}
        onNewAgentTask={() => void handleNewAgentTask()}
        onOpenBrowserPanel={() => {
          setActiveRightTab("browser");
          setRightPanelCollapsed(false);
        }}
        onOpenPath={(path) => void desktopApi.openPath(path)}
        onResetPreferences={() => resetDesktopPreferences()}
        onRestoreLastSessionChange={setRestoreLastSession}
        onRestoreLastWorkspaceChange={setRestoreLastWorkspace}
        onRightSidebarComponentsChange={setRightSidebarComponents}
        onSelectAgent={handleChatAgentSelect}
        onSelectModel={handleChatModelSelect}
        onSessionScopeChange={setSessionScope}
        onSidebarComponentsChange={setSidebarComponents}
        onThinkingEffortChange={setDefaultThinkingEffort}
        onWorkspaceSortModeChange={setWorkspaceSortMode}
        onUpdateAgentConfig={async (updates) => {
          const next = await desktopApi.updateMyDrSaiConfig(updates);
          setMyDrSaiConfig(next);
        }}
        developerMode={developerMode}
        developerModeAvailable={import.meta.env.DEV}
        restoreLastSession={restoreLastSession}
        restoreLastWorkspace={restoreLastWorkspace}
        rightSidebarComponents={rightSidebarComponents}
        selectedAgentId={selectedChatAgentId}
        selectedModel={selectedChatModel}
        sessionScope={sessionScope}
        sidebarComponents={sidebarComponents}
        updateBusy={desktop.busy}
        updateMessage={desktop.actionMessage}
        user={user}
        usageAnalyticsPanel={<ProviderAnalyticsView language={language} />}
        workspaceSortMode={workspaceSortMode}
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
      onCancelUpdate={desktop.cancelUpdate}
      onCheckUpdates={desktop.checkUpdates}
      onDownloadUpdate={desktop.downloadUpdate}
      onInstallUpdate={desktop.installUpdate}
      onOpenPath={(path) => desktopApi.openPath(path)}
      onRefresh={desktop.refreshHealth}
    />
  );

  const rightPanelContent =
    activeRightTab === "debug" ? (
      <DebugPanel language={language} />
    ) : activeRightTab === "terminal" ? (
      <TerminalPanel
        cwd={effectiveWorkspacePath}
        remoteHostAlias={activeWorkspace.remote?.hostAlias}
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

  useEffect(() => {
    function openApprovalCenterForE2e(): void {
      setActiveNav(MENU_IDS.approvalCenter);
    }
    window.addEventListener("drsai:e2e-open-approval-center", openApprovalCenterForE2e);
    return () => {
      window.removeEventListener("drsai:e2e-open-approval-center", openApprovalCenterForE2e);
    };
  }, []);

  return (<>
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
      searchableThreads={searchableThreads}
      rightPanel={rightPanelContent}
      rightPanelCollapsed={rightPanelCollapsed}
      rightTabIcons={rightTabIcons}
      rightTabs={rightTabs}
      sessionScope={sessionScope}
      sidebarCollapsed={sidebarCollapsed}
      sidebarComponents={sidebarComponents}
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
      onSearchThreadMessages={(query, threadIds) =>
        desktopApi.searchThreadMessages({ query, threadIds, limit: 24 })
      }
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
    {remoteDialogOpen ? (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(3, 7, 18, .68)" }}>
        <section role="dialog" aria-modal="true" aria-labelledby="remote-workspace-title" style={{ width: 520, maxWidth: "calc(100vw - 40px)", padding: 24, borderRadius: 14, background: "#111827", color: "#f9fafb", boxShadow: "0 24px 80px rgba(0,0,0,.5)" }}>
          <h2 id="remote-workspace-title" style={{ marginTop: 0 }}>{language === "zh" ? "添加工作区" : "Add workspace"}</h2>
          <button type="button" style={{ width: "100%", padding: 10, marginBottom: 18 }} onClick={() => void handleAddLocalWorkspace()}>{language === "zh" ? "选择本地文件夹" : "Choose local folder"}</button>
          <div style={{ paddingTop: 18, borderTop: "1px solid #374151" }}>
            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>SSH host
              <select value={remoteHostAlias} onChange={(event) => setRemoteHostAlias(event.target.value)} style={{ padding: 9 }}>
                {remoteHosts.map((host) => <option key={host.alias} value={host.alias}>{host.alias} — {host.user ? `${host.user}@` : ""}{host.hostname}:{host.port}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>Remote Linux path
              <input value={remotePath} onChange={(event) => setRemotePath(event.target.value)} placeholder="/home/vscode" style={{ padding: 9 }} />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><button type="button" onClick={() => void browseRemotePath()}>{language === "zh" ? "浏览" : "Browse"}</button><button type="button" onClick={() => void browseRemotePath("~")}>Home</button><button type="button" onClick={() => void browseRemotePath(remotePath.replace(/\/[^/]+\/?$/, "") || "/")}>{language === "zh" ? "父目录" : "Parent"}</button><label><input type="checkbox" checked={remoteShowHidden} onChange={(event) => setRemoteShowHidden(event.target.checked)} /> {language === "zh" ? "隐藏目录" : "Hidden"}</label></div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>{remotePath.split("/").filter(Boolean).map((part, index, parts) => <button type="button" key={`${part}-${index}`} onClick={() => void browseRemotePath(`/${parts.slice(0, index + 1).join("/")}`)}>{index === 0 ? "/" : ""}{part}</button>)}</div>
            {remoteRecentPaths.length > 0 ? <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}><small>Recent:</small>{remoteRecentPaths.map((path) => <button type="button" key={path} title={path} onClick={() => void browseRemotePath(path)}>{path.split("/").filter(Boolean).at(-1) || path}</button>)}</div> : null}
            {remoteDirectories.length > 0 ? <div style={{ maxHeight: 180, overflow: "auto", marginTop: 8, border: "1px solid #374151" }}>{remoteDirectories.filter((entry) => remoteShowHidden || !entry.name.startsWith(".")).map((entry) => <button type="button" disabled={entry.readable === false} title={`${entry.path} · ${entry.mode || "mode unknown"}${entry.writable === false ? " · read-only" : ""}`} key={entry.path} style={{ display: "block", width: "100%", textAlign: "left", padding: 7 }} onDoubleClick={() => void browseRemotePath(entry.path)} onClick={() => setRemotePath(entry.path)}>📁 {entry.name} {entry.writable === false ? "🔒" : ""}</button>)}</div> : null}
            <section style={{ marginTop: 14, padding: 10, border: "1px solid #374151", borderRadius: 8 }}>
              <strong>Remote Gateway</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" onClick={() => void inspectRemoteGateway()}>Preflight</button>
                <button type="button" onClick={() => void showRemoteDiagnostics()}>Diagnostics</button>
                <button type="button" onClick={() => void chooseRemoteGatewayArtifact()}>Select artifact</button>
                <button type="button" onClick={() => void requestRemoteGatewayOperation(remoteGatewayPreflight?.gatewayInstalled ? "upgrade" : "install")}>{remoteGatewayPreflight?.gatewayInstalled ? "Upgrade" : "Install"}</button>
                <button type="button" disabled={!remoteGatewayPreflight?.previousRelease} onClick={() => void requestRemoteGatewayOperation("rollback")}>Rollback</button>
                {remoteGatewayOperation?.state === "running" ? <button type="button" onClick={() => void desktopApi.cancelRemoteGatewayOperation(remoteGatewayOperation.hostAlias)}>Cancel operation</button> : null}
              </div>
              {remoteGatewayArtifact ? <small style={{ display: "block", marginTop: 8, overflowWrap: "anywhere" }}>Artifact: {remoteGatewayArtifact}</small> : null}
              {remoteGatewayPreflight ? <small style={{ display: "block", marginTop: 8 }}>Python {remoteGatewayPreflight.pythonVersion} · Gateway {remoteGatewayPreflight.gatewayVersion || "not installed"} · current {remoteGatewayPreflight.currentRelease || "none"} · previous {remoteGatewayPreflight.previousRelease || "none"}</small> : null}
              {remoteGatewayOperation ? <div style={{ marginTop: 8 }}><progress max={100} value={remoteGatewayOperation.progress} style={{ width: "100%" }} /><small>{remoteGatewayOperation.phase} · {remoteGatewayOperation.message}</small></div> : null}
            </section>
            <section style={{ marginTop: 10, padding: 10, border: "1px solid #374151", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>HepAI Workers</strong><button type="button" onClick={() => void loadRemoteWorkers()}>Refresh</button></div>
              {remoteWorkers.map((worker) => <label key={worker.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 7 }}><span>{worker.name} · {worker.status || "available"}{worker.callables?.length ? ` · ${worker.callables.length} tools` : ""}</span><input type="checkbox" checked={worker.enabled} onChange={() => void toggleRemoteWorker(worker)} /></label>)}
              {remoteWorkers.length === 0 ? <small style={{ display: "block", marginTop: 7 }}>Connect this host/path, then refresh to manage discovered workers.</small> : null}
            </section>
            {remoteHosts.length === 0 ? <p style={{ color: "#fbbf24" }}>{language === "zh" ? "OpenSSH 配置中没有可用主机。" : "No hosts were found in the OpenSSH config."}</p> : null}
            {remoteDialogError ? <p role="alert" style={{ color: "#fca5a5" }}>{remoteDialogError}</p> : null}
            {remoteNeedsHostTrust ? <button type="button" onClick={() => void desktopApi.approveSshHostKey(remoteHostAlias).then((ok) => { setRemoteNeedsHostTrust(!ok); setRemoteDialogError(ok ? "Host key accepted. Retry the connection." : "Host key approval failed; changed keys must be resolved in known_hosts."); })}>{language === "zh" ? "确认并信任新主机密钥" : "Trust new host key"}</button> : null}
          </div>
          <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={() => setRemoteDialogOpen(false)}>{language === "zh" ? "取消" : "Cancel"}</button>
            <button type="button" disabled={remoteConnecting || !remoteHostAlias || !remotePath.trim()} onClick={() => void handleConnectRemoteWorkspace()}>{remoteConnecting ? (language === "zh" ? "连接中…" : "Connecting…") : "Connect Remote SSH"}</button>
          </footer>
        </section>
      </div>
    ) : null}
  </>
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

function loadRemoteRecentPaths(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMOTE_RECENT_PATHS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string" && path.length > 0).slice(0, 8) : [];
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

function showCompletionNotification(
  enabled: boolean,
  language: AppLanguage,
  agentRun: boolean,
): void {
  if (
    !enabled ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  new Notification("OpenDrSai", {
    body:
      language === "zh"
        ? agentRun
          ? "Agent 任务已完成。"
          : "会话任务已完成。"
        : agentRun
          ? "The Agent task has completed."
          : "The conversation task has completed.",
  });
}

function loadLanguage(): AppLanguage {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh";
}

function loadAppearance(): AppearanceMode {
  const value = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function loadSidebarComponents(): SidebarComponentVisibility {
  const defaults: SidebarComponentVisibility = {
    square: true,
    agents: true,
    skills: false,
  };
  try {
    const value = JSON.parse(window.localStorage.getItem(SIDEBAR_COMPONENTS_STORAGE_KEY) ?? "null") as Partial<SidebarComponentVisibility> | null;
    if (!value || typeof value !== "object") return defaults;
    return {
      square: typeof value.square === "boolean" ? value.square : defaults.square,
      agents: typeof value.agents === "boolean" ? value.agents : defaults.agents,
      skills: typeof value.skills === "boolean" ? value.skills : defaults.skills,
    };
  } catch {
    return defaults;
  }
}

function loadRightSidebarComponents(): RightSidebarComponentVisibility {
  const defaults: RightSidebarComponentVisibility = {
    files: true,
    browser: true,
    terminal: true,
    debug: false,
  };
  try {
    const value = JSON.parse(window.localStorage.getItem(RIGHT_SIDEBAR_COMPONENTS_STORAGE_KEY) ?? "null") as Partial<RightSidebarComponentVisibility> | null;
    if (!value || typeof value !== "object") return defaults;
    return {
      files: typeof value.files === "boolean" ? value.files : defaults.files,
      browser: typeof value.browser === "boolean" ? value.browser : defaults.browser,
      terminal: typeof value.terminal === "boolean" ? value.terminal : defaults.terminal,
      debug: typeof value.debug === "boolean" ? value.debug : defaults.debug,
    };
  } catch {
    return defaults;
  }
}

function loadSessionScope(): "workspace" | "all" {
  return window.localStorage.getItem(SESSION_SCOPE_STORAGE_KEY) === "all" ? "all" : "workspace";
}

function loadOptionalSetting(key: string): string | null {
  return window.localStorage.getItem(key)?.trim() || null;
}

function persistOptionalSetting(key: string, value: string | null): void {
  if (value) window.localStorage.setItem(key, value);
  else window.localStorage.removeItem(key);
}

function loadThinkingEffort(): ThinkingEffort {
  const value = window.localStorage.getItem(THINKING_EFFORT_STORAGE_KEY);
  return value === "low" || value === "high" || value === "xhigh" ? value : "medium";
}

function loadBooleanSetting(key: string, fallback: boolean): boolean {
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

function loadRestoredThreadId(): string {
  if (!loadBooleanSetting(RESTORE_SESSION_STORAGE_KEY, true)) return createLocalThreadId();
  return loadOptionalSetting(LAST_THREAD_STORAGE_KEY) ?? createLocalThreadId();
}

function loadRestoredWorkspaceId(): string {
  if (!loadBooleanSetting(RESTORE_WORKSPACE_STORAGE_KEY, true)) return "current";
  return loadOptionalSetting(LAST_WORKSPACE_STORAGE_KEY) ?? "current";
}

function exportLocalDesktopData(threadSnapshots: Record<string, ChatThreadSnapshot>): void {
  const payload = JSON.stringify({
    exportedAt: new Date().toISOString(),
    preferences: Object.fromEntries(
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("opendrsai.") && key !== THREAD_SNAPSHOT_STORAGE_KEY)
        .map((key) => [key, window.localStorage.getItem(key)]),
    ),
    threadSnapshots,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `opendrsai-local-data-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetDesktopPreferences(): void {
  const preservedSnapshots = window.localStorage.getItem(THREAD_SNAPSHOT_STORAGE_KEY);
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("opendrsai.")) window.localStorage.removeItem(key);
  }
  if (preservedSnapshots) window.localStorage.setItem(THREAD_SNAPSHOT_STORAGE_KEY, preservedSnapshots);
  window.location.reload();
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
  onCancelUpdate,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenPath,
  onRefresh,
}: {
  actionMessage: string | null;
  busy: boolean;
  health: DesktopHealth | null;
  installProgress: InstallProgress | null;
  language: AppLanguage;
  onCancelInstall: () => void;
  onCancelUpdate: () => void;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
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
              ? "面向科研用户的、可监督、可复现、可持续运行的智能任务工作台。"
              : "An intelligent task workspace for researchers: supervisable, reproducible, and built for continuous operation."}
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
          <dt>{zh ? "认证" : "Authentication"}</dt>
          <dd>OIDC</dd>
        </div>
      </dl>

      <section className="about-section">
        <div className="about-section-title">
          <strong>{zh ? "维护" : "Maintenance"}</strong>
          <span>{zh ? "检查、下载并安全重启更新" : "Check, download, and safely restart to update"}</span>
        </div>
        <div className="about-action-grid">
          <button disabled={busy} onClick={onCheckUpdates}>
            {zh ? "检查更新" : "Check Updates"}
          </button>
          {health?.update.canDownload && (
            <button disabled={busy} onClick={onDownloadUpdate}>
              {zh ? `下载 ${health.update.version ?? "更新"}` : `Download ${health.update.version ?? "update"}`}
            </button>
          )}
          {health?.update.canCancel && (
            <button onClick={onCancelUpdate}>
              {zh ? "取消下载" : "Cancel Download"}
            </button>
          )}
          {health?.update.canInstall && (
            <button disabled={busy} onClick={onInstallUpdate}>
              {zh ? "重启并更新" : "Restart and Update"}
            </button>
          )}
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

type SettingsPane = "general" | "agent-defaults" | "agent-task" | "approvals" | "analytics" | "integrations" | "channels" | "other";

function SettingsPanel({
  agents,
  appearance,
  approvalCenterPanel,
  channelsPanel,
  completionNotifications,
  defaultThinkingEffort,
  developerMode,
  developerModeAvailable,
  health,
  ideContext,
  language,
  models,
  myDrSaiConfig,
  onCheckUpdates,
  onAppearanceChange,
  onCompletionNotificationsChange,
  onCopyDiagnostics,
  onDeveloperModeChange,
  onExportLocalData,
  onLanguageChange,
  onLogout,
  onNewAgentTask,
  onOpenBrowserPanel,
  onOpenPath,
  onResetPreferences,
  onRestoreLastSessionChange,
  onRestoreLastWorkspaceChange,
  onRightSidebarComponentsChange,
  onSelectAgent,
  onSelectModel,
  onSessionScopeChange,
  onSidebarComponentsChange,
  onThinkingEffortChange,
  onWorkspaceSortModeChange,
  onUpdateAgentConfig,
  restoreLastSession,
  restoreLastWorkspace,
  rightSidebarComponents,
  selectedAgentId,
  selectedModel,
  sessionScope,
  sidebarComponents,
  updateBusy,
  updateMessage,
  usageAnalyticsPanel,
  user,
  workspaceSortMode,
}: {
  agents: DesktopAgent[];
  appearance: AppearanceMode;
  approvalCenterPanel: React.ReactNode;
  channelsPanel: React.ReactNode;
  completionNotifications: boolean;
  defaultThinkingEffort: ThinkingEffort;
  developerMode: boolean;
  developerModeAvailable: boolean;
  health: DesktopHealth | null;
  ideContext: DesktopIdeContextSnapshot | null;
  language: AppLanguage;
  models: MyDrSaiModelConfig[];
  myDrSaiConfig: MyDrSaiConfig | null;
  onCheckUpdates: () => void;
  onAppearanceChange: (appearance: AppearanceMode) => void;
  onCompletionNotificationsChange: (enabled: boolean) => void;
  onCopyDiagnostics: () => void;
  onDeveloperModeChange: (enabled: boolean) => void;
  onExportLocalData: () => void;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => Promise<void>;
  onNewAgentTask: () => void;
  onOpenBrowserPanel: () => void;
  onOpenPath: (path: string) => void;
  onResetPreferences: () => void;
  onRestoreLastSessionChange: (enabled: boolean) => void;
  onRestoreLastWorkspaceChange: (enabled: boolean) => void;
  onRightSidebarComponentsChange: React.Dispatch<React.SetStateAction<RightSidebarComponentVisibility>>;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (model: string) => void;
  onSessionScopeChange: (scope: "workspace" | "all") => void;
  onSidebarComponentsChange: React.Dispatch<React.SetStateAction<SidebarComponentVisibility>>;
  onThinkingEffortChange: (effort: ThinkingEffort) => void;
  onWorkspaceSortModeChange: (mode: WorkspaceSortMode) => void;
  onUpdateAgentConfig: (updates: { plan_mode?: boolean; workspace_enabled?: boolean }) => Promise<void>;
  restoreLastSession: boolean;
  restoreLastWorkspace: boolean;
  rightSidebarComponents: RightSidebarComponentVisibility;
  selectedAgentId: string | null;
  selectedModel: string | null;
  sessionScope: "workspace" | "all";
  sidebarComponents: SidebarComponentVisibility;
  updateBusy: boolean;
  updateMessage: string | null;
  usageAnalyticsPanel: React.ReactNode;
  user: AuthUser | null;
  workspaceSortMode: WorkspaceSortMode;
}): React.JSX.Element {
  const zh = language === "zh";
  const [activePane, setActivePane] = useState<SettingsPane>("general");
  const [voiceIntegrationState, setVoiceIntegrationState] = useState<string | null>(null);
  const [remoteHostCount, setRemoteHostCount] = useState<number | null>(null);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigMessage, setAgentConfigMessage] = useState<string | null>(null);

  async function updateAgentConfig(updates: { plan_mode?: boolean; workspace_enabled?: boolean }): Promise<void> {
    setAgentConfigSaving(true);
    setAgentConfigMessage(null);
    try {
      await onUpdateAgentConfig(updates);
      setAgentConfigMessage(zh ? "Agent 配置已保存。" : "Agent configuration saved.");
    } catch (error) {
      setAgentConfigMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentConfigSaving(false);
    }
  }

  useEffect(() => {
    if (activePane !== "integrations") return;
    let cancelled = false;
    void Promise.all([
      desktopApi.getVoiceRuntimeStatus().catch(() => null),
      desktopApi.listSshHosts().catch(() => []),
    ]).then(([voiceStatus, hosts]) => {
      if (cancelled) return;
      setVoiceIntegrationState(voiceStatus?.state ?? "unavailable");
      setRemoteHostCount(hosts.length);
    });
    return () => {
      cancelled = true;
    };
  }, [activePane]);
  const groups: Array<{
    label: string;
    items: Array<{ id: SettingsPane; label: string; icon: LucideIcon }>;
  }> = [
    {
      label: zh ? "常规" : "General",
      items: [{ id: "general", label: zh ? "常规" : "General", icon: Settings }],
    },
    {
      label: "Agent",
      items: [
        { id: "agent-defaults", label: zh ? "默认配置" : "Defaults", icon: Settings },
        { id: "agent-task", label: zh ? "Agent 任务" : "Agent tasks", icon: Bot },
        { id: "approvals", label: "Approval Center", icon: ShieldCheck },
        { id: "analytics", label: zh ? "使用分析" : "Usage analytics", icon: History },
      ],
    },
    {
      label: zh ? "集成" : "Integrations",
      items: [
        { id: "integrations", label: zh ? "集成概览" : "Overview", icon: Plug },
        { id: "channels", label: zh ? "频道" : "Channels", icon: MessageSquare },
      ],
    },
    {
      label: zh ? "其他" : "Other",
      items: [{ id: "other", label: zh ? "系统与路径" : "System and paths", icon: FileText }],
    },
  ];

  return (
    <div className="settings-view">
      <aside className="settings-navigation" aria-label={zh ? "设置分组" : "Settings groups"}>
        <h1>{zh ? "设置" : "Settings"}</h1>
        {groups.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={activePane === item.id ? "active" : ""}
                  onClick={() => setActivePane(item.id)}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </section>
        ))}
      </aside>

      <div className="settings-content">
        {activePane === "general" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "常规" : "General"}</h2>
              <p>{zh ? "管理账户和桌面端的基础偏好。" : "Manage your account and desktop preferences."}</p>
            </header>
            <section className="settings-section">
              <div>
                <h2>{zh ? "HepAI 账号" : "HepAI account"}</h2>
                <p>{user?.name || user?.email || (zh ? "已通过 OIDC 登录" : "Signed in with OIDC")}</p>
                {user?.email && user.email !== user.name && <small>{user.email}</small>}
              </div>
              <button type="button" onClick={() => void onLogout()}>{zh ? "退出登录" : "Sign out"}</button>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "显示语言" : "Language"}</h2>
                <p>{zh ? "切换 OpenDrSai 桌面端的界面语言。" : "Switch the interface language for OpenDrSai Desktop."}</p>
              </div>
              <div className="settings-language-control">
                <span>{zh ? "界面语言" : "Interface language"}</span>
                <div className="language-segment" role="group" aria-label={zh ? "界面语言" : "Interface language"}>
                  <button type="button" className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>
                    {zh ? "英文" : "English"}
                  </button>
                  <button type="button" className={language === "zh" ? "active" : ""} onClick={() => onLanguageChange("zh")}>
                    {zh ? "中文" : "Chinese"}
                  </button>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "外观" : "Appearance"}</h2>
                <p>{zh ? "选择界面主题，并决定左侧栏显示哪些广场组件。" : "Choose the interface theme and which Square components appear in the sidebar."}</p>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "主题" : "Theme"}</strong><small>{zh ? "跟随系统会实时响应 Windows 的颜色模式。" : "System mode follows Windows color changes in real time."}</small></span>
                <div className="appearance-segment" role="group" aria-label={zh ? "外观主题" : "Appearance theme"}>
                  {(["light", "dark", "system"] as AppearanceMode[]).map((mode) => (
                    <button key={mode} type="button" className={appearance === mode ? "active" : ""} onClick={() => onAppearanceChange(mode)}>
                      {mode === "light" ? (zh ? "白天" : "Light") : mode === "dark" ? (zh ? "黑夜" : "Dark") : (zh ? "跟随系统" : "System")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-component-list">
                <strong>{zh ? "左侧栏组件" : "Sidebar components"}</strong>
                <label className="settings-toggle"><span><strong>{zh ? "广场" : "Square"}</strong><small>{zh ? "显示或隐藏整个广场分组。" : "Show or hide the entire Square group."}</small></span><input type="checkbox" checked={sidebarComponents.square} onChange={(event) => onSidebarComponentsChange((current) => ({ ...current, square: event.target.checked }))} /></label>
                <label className="settings-toggle"><span><strong>{zh ? "智能体" : "Agents"}</strong><small>{zh ? "在广场分组中显示智能体入口。" : "Show Agents inside the Square group."}</small></span><input type="checkbox" checked={sidebarComponents.agents} onChange={(event) => onSidebarComponentsChange((current) => ({ ...current, agents: event.target.checked }))} /></label>
                <label className="settings-toggle"><span><strong>{zh ? "技能" : "Skills"}</strong><small>{zh ? "在广场分组中显示技能入口。" : "Show Skills inside the Square group."}</small></span><input type="checkbox" checked={sidebarComponents.skills} onChange={(event) => onSidebarComponentsChange((current) => ({ ...current, skills: event.target.checked }))} /></label>
              </div>
              <div className="settings-component-list">
                <strong>{zh ? "右侧栏组件" : "Right sidebar components"}</strong>
                {(["files", "browser", "terminal", "debug"] as Array<keyof RightSidebarComponentVisibility>).map((component) => {
                  const label = component === "files"
                    ? (zh ? "文件" : "Files")
                    : component === "browser"
                      ? (zh ? "浏览器" : "Browser")
                      : component === "terminal"
                        ? (zh ? "终端" : "Terminal")
                        : (zh ? "调试" : "Debug");
                  return (
                    <label className="settings-toggle" key={component}>
                      <span><strong>{label}</strong><small>{zh ? `在右侧栏中显示${label}标签。` : `Show the ${label} tab in the right sidebar.`}</small></span>
                      <input type="checkbox" checked={rightSidebarComponents[component]} onChange={(event) => onRightSidebarComponentsChange((current) => ({ ...current, [component]: event.target.checked }))} />
                    </label>
                  );
                })}
              </div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "工作区与会话" : "Workspace and sessions"}</h2>
                <p>{zh ? "设置侧栏会话范围和工作区排序的默认方式。" : "Choose the default session scope and workspace sorting."}</p>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "会话范围" : "Session scope"}</strong><small>{zh ? "控制侧栏默认显示当前工作区还是全部会话。" : "Control whether the sidebar shows this workspace or all sessions."}</small></span>
                <select value={sessionScope} onChange={(event) => onSessionScopeChange(event.target.value as "workspace" | "all")}>
                  <option value="workspace">{zh ? "当前工作区" : "Current workspace"}</option>
                  <option value="all">{zh ? "全部会话" : "All sessions"}</option>
                </select>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "工作区排序" : "Workspace sorting"}</strong><small>{zh ? "同时应用到主侧栏的工作区列表。" : "Also applies to the workspace list in the primary sidebar."}</small></span>
                <select value={workspaceSortMode} onChange={(event) => onWorkspaceSortModeChange(event.target.value as WorkspaceSortMode)}>
                  <option value="recent">{zh ? "最近使用" : "Recent"}</option>
                  <option value="name">{zh ? "名称" : "Name"}</option>
                  <option value="created">{zh ? "创建时间" : "Created"}</option>
                </select>
              </div>
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "启动与通知" : "Startup and notifications"}</h2><p>{zh ? "恢复上次工作状态，并在任务完成时发送桌面通知。" : "Restore your last working state and notify when a task completes."}</p></div>
              <label className="settings-toggle"><span><strong>{zh ? "恢复上次会话" : "Restore last session"}</strong><small>{zh ? "下次启动时重新打开最近使用的会话。" : "Reopen the most recently used session on launch."}</small></span><input type="checkbox" checked={restoreLastSession} onChange={(event) => onRestoreLastSessionChange(event.target.checked)} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "恢复上次工作区" : "Restore last workspace"}</strong><small>{zh ? "下次启动时重新选择最近使用的工作区。" : "Select the most recently used workspace on launch."}</small></span><input type="checkbox" checked={restoreLastWorkspace} onChange={(event) => onRestoreLastWorkspaceChange(event.target.checked)} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "任务完成通知" : "Completion notifications"}</strong><small>{zh ? "会话任务完成时发送系统通知。" : "Send a system notification when a conversation task completes."}</small></span><input type="checkbox" checked={completionNotifications} onChange={(event) => onCompletionNotificationsChange(event.target.checked)} /></label>
            </section>
          </>
        )}

        {activePane === "agent-defaults" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "Agent 默认配置" : "Agent defaults"}</h2>
              <p>{zh ? "设置新会话默认使用的 Agent、模型和思考强度。" : "Choose the Agent, model, and thinking effort used by new conversations."}</p>
            </header>
            <section className="settings-section">
              <div className="settings-row">
                <span><strong>{zh ? "默认 Agent" : "Default Agent"}</strong><small>{zh ? "会同步应用到聊天输入区。" : "Also applies to the chat composer."}</small></span>
                <select value={selectedAgentId ?? ""} onChange={(event) => onSelectAgent(event.target.value)} disabled={agents.length === 0}>
                  {agents.length === 0 && <option value="">{zh ? "暂无可用 Agent" : "No Agent available"}</option>}
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "默认模型" : "Default model"}</strong><small>{zh ? "模型列表由当前工作区的 DrSai 配置提供。" : "Models are provided by the current workspace DrSai configuration."}</small></span>
                <select value={selectedModel ?? ""} onChange={(event) => onSelectModel(event.target.value)} disabled={models.length === 0}>
                  {models.length === 0 && <option value="">{zh ? "暂无可用模型" : "No model available"}</option>}
                  {models.map((model) => <option key={model.alias} value={model.alias}>{model.display_name || model.alias}</option>)}
                </select>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "思考强度" : "Thinking effort"}</strong><small>{zh ? "可在每次发送前从聊天输入区临时调整。" : "Can still be changed in the composer before sending."}</small></span>
                <select value={defaultThinkingEffort} onChange={(event) => onThinkingEffortChange(event.target.value as ThinkingEffort)}>
                  <option value="low">{zh ? "低" : "Low"}</option>
                  <option value="medium">{zh ? "中" : "Medium"}</option>
                  <option value="high">{zh ? "高" : "High"}</option>
                  <option value="xhigh">{zh ? "极高" : "Extra high"}</option>
                </select>
              </div>
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "执行与上下文" : "Execution and context"}</h2><p>{zh ? "这些选项保存到当前 DrSai 配置，并受现有审批策略约束。" : "These options are saved to the current DrSai configuration and remain governed by approval policy."}</p></div>
              <label className="settings-toggle"><span><strong>Plan mode</strong><small>{zh ? "让 Agent 先生成计划，再开始执行。" : "Ask the Agent to create a plan before acting."}</small></span><input type="checkbox" checked={Boolean(myDrSaiConfig?.config.plan_mode)} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ plan_mode: event.target.checked })} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "限制在当前工作区" : "Restrict to current workspace"}</strong><small>{zh ? "文件操作优先限制在当前工作区，越界操作继续走审批。" : "Prefer file operations inside the current workspace; out-of-scope actions still require approval."}</small></span><input type="checkbox" checked={myDrSaiConfig?.config.workspace_enabled !== false} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ workspace_enabled: event.target.checked })} /></label>
              {agentConfigMessage && <div className="settings-message">{agentConfigMessage}</div>}
            </section>
          </>
        )}

        {activePane === "agent-task" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "Agent 任务" : "Agent tasks"}</h2>
              <p>{zh ? "创建隔离的 Agent 任务，并在会话中继续管理执行过程。" : "Create an isolated Agent task and manage its run from the conversation."}</p>
            </header>
            <section className="settings-section settings-action-section">
              <Bot size={22} />
              <div>
                <h2>{zh ? "新建 Agent 任务" : "New Agent task"}</h2>
                <p>{zh ? "基于当前工作区创建新的 Agent 任务会话。" : "Start a new Agent task for the current workspace."}</p>
              </div>
              <button type="button" onClick={onNewAgentTask}>{zh ? "创建任务" : "Create task"}</button>
            </section>
          </>
        )}

        {activePane === "approvals" && <div className="settings-embedded-view">{approvalCenterPanel}</div>}
        {activePane === "analytics" && <div className="settings-embedded-view">{usageAnalyticsPanel}</div>}
        {activePane === "channels" && <div className="settings-embedded-view">{channelsPanel}</div>}

        {activePane === "integrations" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "集成概览" : "Integration overview"}</h2>
              <p>{zh ? "管理外部消息、工具和桌面上下文入口。" : "Manage external messaging, tools, and desktop context."}</p>
            </header>
            <section className="settings-section settings-integration-list">
              <div className="settings-integration-row"><MessageSquare size={18} /><span><strong>{zh ? "频道" : "Channels"}</strong><small>{zh ? "连接消息渠道并导入只读上下文。" : "Connect message channels and import reviewed context."}</small></span><button type="button" onClick={() => setActivePane("channels")}>{zh ? "管理" : "Manage"}</button></div>
              <div className="settings-integration-row"><Plug size={18} /><span><strong>MCP</strong><small>{zh ? "在 Approval Center 中管理 MCP 会话和工具审批。" : "Manage MCP sessions and tool approvals in Approval Center."}</small></span><button type="button" onClick={() => setActivePane("approvals")}>{zh ? "管理" : "Manage"}</button></div>
              <div className="settings-integration-row"><FileText size={18} /><span><strong>IDE</strong><small>{ideContext?.currentFile?.path || (zh ? "当前没有 IDE 文件上下文" : "No IDE file context is active")}</small></span><em>{ideContext ? (zh ? "已连接" : "Connected") : (zh ? "未连接" : "Not connected")}</em></div>
              <div className="settings-integration-row"><Globe2 size={18} /><span><strong>{zh ? "浏览器" : "Browser"}</strong><small>{zh ? "使用右侧浏览器面板查看和附加网页上下文。" : "Use the right browser panel to inspect and attach web context."}</small></span><button type="button" onClick={onOpenBrowserPanel}>{zh ? "打开" : "Open"}</button></div>
              <div className="settings-integration-row"><MessageSquare size={18} /><span><strong>{zh ? "语音" : "Voice"}</strong><small>{zh ? "聊天输入区使用的语音转写运行时。" : "Voice transcription runtime used by the chat composer."}</small></span><em>{voiceIntegrationState === null ? (zh ? "检查中" : "Checking") : voiceIntegrationState}</em></div>
              <div className="settings-integration-row"><TerminalIcon size={18} /><span><strong>Remote SSH</strong><small>{zh ? "从本机 OpenSSH 配置发现的远程主机。" : "Remote hosts discovered from the local OpenSSH configuration."}</small></span><em>{remoteHostCount === null ? (zh ? "检查中" : "Checking") : zh ? `${remoteHostCount} 台主机` : `${remoteHostCount} hosts`}</em></div>
            </section>
          </>
        )}

        {activePane === "other" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "系统与路径" : "System and paths"}</h2>
              <p>{zh ? "查看 OpenDrSai 使用的本地运行环境。" : "Inspect the local runtime used by OpenDrSai."}</p>
            </header>
            <section className="settings-section">
              <h2>{zh ? "路径" : "Paths"}</h2>
              <dl>
                <div><dt>{zh ? "DrSai 主目录" : "DrSai home"}</dt><dd>{health?.install.home || (zh ? "未知" : "unknown")}</dd>{health?.install.home && <button type="button" onClick={() => onOpenPath(health.install.home)}>{zh ? "打开" : "Open"}</button>}</div>
                <div><dt>{zh ? "仓库" : "Repository"}</dt><dd>{health?.install.repoPath || (zh ? "未知" : "unknown")}</dd>{health?.install.repoPath && <button type="button" onClick={() => onOpenPath(health.install.repoPath)}>{zh ? "打开" : "Open"}</button>}</div>
                <div><dt>Python</dt><dd>{health?.install.pythonPath || (zh ? "未知" : "unknown")}</dd></div>
              </dl>
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "应用与更新" : "App and updates"}</h2><p>{zh ? "检查 OpenDrSai 桌面端更新。" : "Check for OpenDrSai Desktop updates."}</p></div>
              <div className="settings-row"><span><strong>{zh ? "更新状态" : "Update status"}</strong><small>{formatUpdateStatus(health, language)}</small></span><button type="button" onClick={onCheckUpdates} disabled={updateBusy}>{updateBusy ? (zh ? "检查中..." : "Checking...") : (zh ? "检查更新" : "Check updates")}</button></div>
              {updateMessage && <div className="settings-message">{updateMessage}</div>}
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "数据与隐私" : "Data and privacy"}</h2><p>{zh ? "导出本地会话和偏好，或仅重置桌面偏好。" : "Export local conversations and preferences, or reset desktop preferences only."}</p></div>
              <div className="settings-button-row"><button type="button" onClick={onExportLocalData}>{zh ? "导出本地数据" : "Export local data"}</button><button type="button" onClick={() => { if (window.confirm(zh ? "重置所有桌面偏好？本地会话内容会保留。" : "Reset all desktop preferences? Local conversation content will be preserved.")) onResetPreferences(); }}>{zh ? "重置偏好" : "Reset preferences"}</button></div>
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "日志与诊断" : "Logs and diagnostics"}</h2><p>{zh ? "复制当前运行状态，便于排查桌面端问题。" : "Copy the current runtime state for desktop troubleshooting."}</p></div>
              <div className="settings-button-row"><button type="button" onClick={onCopyDiagnostics}>{zh ? "复制诊断信息" : "Copy diagnostics"}</button>{health?.install.home && <button type="button" onClick={() => onOpenPath(health.install.home)}>{zh ? "打开 DrSai 目录" : "Open DrSai home"}</button>}</div>
            </section>
            {developerModeAvailable && <section className="settings-section"><div><h2>{zh ? "开发者选项" : "Developer options"}</h2><p>{zh ? "切换后会重新加载桌面界面。" : "Changing this option reloads the desktop interface."}</p></div><label className="settings-toggle"><span><strong>{zh ? "开发者模式" : "Developer mode"}</strong><small>{zh ? "显示详细状态和调试输出。" : "Show detailed status and debugging output."}</small></span><input type="checkbox" checked={developerMode} onChange={(event) => onDeveloperModeChange(event.target.checked)} /></label></section>}
          </>
        )}
      </div>
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
