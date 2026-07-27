import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Bug,
  FileText,
  Globe2,
  History,
  Library,
  PackageOpen,
  Lightbulb,
  MessageSquare,
  Plug,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal as TerminalIcon,
  Volume2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AuthUser,
  ChatAttachment,
  CreateWorkspaceRequest,
  DesktopAgent,
  DesktopAnomalyDecision,
  DesktopBackgroundTask,
  DesktopBootstrapBlocker,
  DesktopCitationRecord,
  CodexBackendLogin,
  CodexBackendStatus,
  DesktopDataCleanupPreview,
  DesktopDataCleanupScope,
  DesktopIndependentReviewRecord,
  DesktopReusableTask,
  DesktopReusableTaskAdjustments,
  DesktopReusableTaskAdjustmentScope,
  DesktopShareManifest,
  DesktopShareInspectionResult,
  DesktopShareSensitiveAction,
  DesktopSharePermission,
  DesktopShareComment,
  DesktopShareCommentAnchorType,
  DesktopShareCommentTask,
  DesktopShareCommentTaskPreview,
  DesktopShareVersionInspection,
  DesktopSharedObjectOpenResult,
  DesktopTaskArtifactLink,
  DesktopChannelContextImportResult,
  DesktopForkLifecycleAction,
  DesktopHealth,
  DesktopIdeContextSnapshot,
  DesktopVoiceInteractionMode,
  DesktopVoiceRuntimeStatus,
  DesktopStreamingVoiceCapabilities,
  DesktopMcpContextResult,
  DesktopMobilePairingReadiness,
  DesktopThread,
  DesktopWorktreeSummary,
  InstallProgress,
  MyDrSaiModelConfig,
  MyDrSaiConfig,
  RemoteSshHost,
  RemoteSshHostKey,
  RemoteDirectoryEntry,
  WorkspaceFilePreview,
  WorkspaceProject,
} from "@shared/desktopApi";
import { desktopApi } from "./desktopApi";
import { copyTextSafely } from "./clipboard";
import { LoginScreen } from "./auth/LoginScreen";
import { useAuth } from "./auth/AuthProvider";
import { AgentSquareView } from "./components/AgentSquareView";
import { AgentRunWorkspace } from "./components/AgentRunWorkspace";
import { ApprovalCenterView } from "./components/ApprovalCenterView";
import { ChannelsView } from "./components/ChannelsView";
import { ChatWorkspace, type ThinkingEffort } from "./components/ChatWorkspace";
import { PreviewBrowserPanel } from "./components/PreviewBrowserPanel";
import { ProviderAnalyticsView } from "./components/ProviderAnalyticsView";
import { BackgroundTaskQueue, SkillSquareView } from "./components/SkillSquareView";
import { TaskCenterView } from "./components/TaskCenterView";
import { MobilePairingDialog, mobilePairingErrorText } from "./components/MobilePairingDialog";
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
import type { DesktopPlatformDescriptor } from "@shared/platform";
import { useDesktopHealthAdapter } from "./adapters/useDesktopHealthAdapter";
import { resolveAvailableVoiceName, useVoicePreferences } from "./voice/useVoicePreferences";
import { deriveVoiceModeCapabilities, getVoiceModeAvailability } from "./voice/voiceMode";
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
  results: PackageOpen,
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
const AWAY_STARTED_AT_STORAGE_KEY = "opendrsai.awayStartedAt";
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
interface AwaySummary {
  startedAt: string;
  returnedAt: string;
  completed: DesktopBackgroundTask[];
  failed: DesktopBackgroundTask[];
  pending: DesktopBackgroundTask[];
}
type NetworkConnectivityState = "online" | "offline" | "restored";

function App(): React.JSX.Element {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <AuthenticatedApp
        user={auth.session.user}
        onLogout={() => auth.logout(false)}
        sessionRestoring
      />
    );
  }
  if (!auth.session.authenticated) return <LoginScreen />;

  return (
    <AuthenticatedApp
      user={auth.session.user}
      onLogout={() => auth.logout(false)}
      sessionRestoring={false}
    />
  );
}

function AuthenticatedApp({
  user,
  onLogout,
  sessionRestoring,
}: {
  user: AuthUser | null;
  onLogout: () => Promise<void>;
  sessionRestoring: boolean;
}): React.JSX.Element {
  const auth = useAuth();
  const nativePlatformId = document.documentElement.dataset.desktopPlatform === "macos" || /Macintosh|Mac OS X/i.test(navigator.userAgent)
    ? "macos"
    : "windows";
  const [language, setLanguage] = useState<AppLanguage>(() => loadLanguage());
  const [platformDescriptor, setPlatformDescriptor] = useState<DesktopPlatformDescriptor | null>(null);
  const developerMode = import.meta.env.DEV && loadDeveloperMode();
  const [activeNav, setActiveNav] = useState<NavId>(MENU_IDS.currentSession);
  const [mobilePairingOpen, setMobilePairingOpen] = useState(false);
  const [awaySummary, setAwaySummary] = useState<AwaySummary | null>(null);
  const [deliveryTask, setDeliveryTask] = useState<DesktopBackgroundTask | null>(null);
  const [networkConnectivity, setNetworkConnectivity] = useState<NetworkConnectivityState>(() =>
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online",
  );
  const wasOfflineRef = useRef(networkConnectivity === "offline");
  const awaySummaryLoadingRef = useRef(false);

  useEffect(() => {
    void desktopApi.getPlatformDescriptor().then(setPlatformDescriptor).catch(() => undefined);
  }, []);

  useEffect(() => {
    let restoredTimer: ReturnType<typeof setTimeout> | undefined;
    const handleOffline = () => {
      wasOfflineRef.current = true;
      if (restoredTimer) clearTimeout(restoredTimer);
      setNetworkConnectivity("offline");
    };
    const handleOnline = () => {
      if (!wasOfflineRef.current) {
        setNetworkConnectivity("online");
        return;
      }
      wasOfflineRef.current = false;
      setNetworkConnectivity("restored");
      restoredTimer = setTimeout(() => setNetworkConnectivity("online"), 6_000);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      if (restoredTimer) clearTimeout(restoredTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);
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
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [workspaceLocationChoice, setWorkspaceLocationChoice] = useState<"remote" | null>(null);
  const [remoteWorkspaceStep, setRemoteWorkspaceStep] = useState<"computer" | "directory">("computer");
  const [remoteHosts, setRemoteHosts] = useState<RemoteSshHost[]>([]);
  const [remoteHostAlias, setRemoteHostAlias] = useState("");
  const [remotePath, setRemotePath] = useState("/home/vscode");
  const [remoteDialogError, setRemoteDialogError] = useState("");
  const [remoteConnecting, setRemoteConnecting] = useState(false);
  const [remoteNeedsHostTrust, setRemoteNeedsHostTrust] = useState(false);
  const [remoteHostKeys, setRemoteHostKeys] = useState<RemoteSshHostKey[]>([]);
  const [remoteDirectories, setRemoteDirectories] = useState<RemoteDirectoryEntry[]>([]);
  const [remoteShowHidden, setRemoteShowHidden] = useState(false);
  const [remoteRecentPaths, setRemoteRecentPaths] = useState<string[]>(() => loadRemoteRecentPaths());
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
  const chatModelOptions = useMemo(
    () => getAgentModelOptions(
      availableChatModels,
      availableChatAgents.find((agent) => agent.id === selectedChatAgentId),
      selectedChatModel,
    ),
    [availableChatAgents, availableChatModels, selectedChatAgentId, selectedChatModel],
  );
  const [pendingChatInput, setPendingChatInput] = useState<string | null>(null);
  const [resultsScopeRequestKey, setResultsScopeRequestKey] = useState(0);
  const [terminalAgentTask, setTerminalAgentTask] = useState("");
  const [terminalCommandProposal, setTerminalCommandProposal] =
    useState<TerminalCommandProposal | null>(null);
  const [browserPanelUrl, setBrowserPanelUrl] = useState<string | undefined>();
  const [filesPanelFocusPath, setFilesPanelFocusPath] = useState<string | undefined>();
  const [structuredTurnFocus, setStructuredTurnFocus] = useState<{ turnId: string; nonce: number } | null>(null);
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
      id === "templates" ? false
        : id === "browser" && platformDescriptor?.capabilities.features.browser !== true ? false
        : id === "debug" && platformDescriptor?.capabilities.features.debugger !== true ? false
        : id === "terminal" && platformDescriptor?.capabilities.features.terminal !== true ? false
        : rightSidebarComponents[id],
    ),
    [language, platformDescriptor, rightSidebarComponents],
  );
  const firstVisibleRightTab = rightTabs[0]?.id;
  const title =
    navItems.find((item) => item.id === activeNav)?.label ??
    (language === "zh" ? "当前会话" : "Chat");
  const { health } = desktop;
  const [codexStatus, setCodexStatus] = useState<CodexBackendStatus | null>(null);
  useEffect(() => {
    if (!health?.gatewayReady || platformDescriptor?.capabilities.features.codexBackend !== true) { setCodexStatus(null); return; }
    let active = true;
    void desktopApi.getCodexBackendStatus().then((status) => { if (active) setCodexStatus(status); }).catch(() => {
      if (active) setCodexStatus({ backendId: "codex", state: "fault", available: false, version: null,
        loggedIn: false, authMode: null, accountLabel: null, reason: "runtime_unavailable", retryable: true, action: "restart" });
    });
    return () => { active = false; };
  }, [health?.gatewayReady, platformDescriptor]);
  const workspacePath = health?.install.repoPath || health?.install.home || "";
  const currentWorkspaceTime = "1970-01-01T00:00:00.000Z";
  const currentWorkspace: WorkspaceProject = {
    id: "current",
    name: language === "zh" ? "默认" : "Default",
    path: workspacePath,
    location: "local",
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
  const effectiveWorkspacePath = activeThread?.execution?.canonicalPath || activeThreadWorkspacePath || activeWorkspace.path;
  const effectiveWorkspace =
    getComparablePath(activeWorkspace.path) === getComparablePath(effectiveWorkspacePath)
      ? activeWorkspace
      : workspaces.find(
      (workspace) =>
        getComparablePath(workspace.path) === getComparablePath(effectiveWorkspacePath),
      ) ?? activeWorkspace;
  const effectiveWorkspaceInstructions =
    effectiveWorkspace.instructions ?? activeWorkspace.instructions;
  const effectiveRuntimeWorkspaceId = activeThread?.execution?.workspaceId || effectiveWorkspace.id;
  const workspaceTrusted =
    effectiveWorkspace.id === activeWorkspace.id
      ? activeWorkspace.trusted
      : activeThread?.kind === "agent_run" && Boolean(activeThreadWorkspacePath)
        ? true
        : effectiveWorkspace.trusted;
  useEffect(() => {
    async function handleVisibilityChange(): Promise<void> {
      if (document.visibilityState === "hidden") {
        const startedAt = new Date().toISOString();
        window.localStorage.setItem(AWAY_STARTED_AT_STORAGE_KEY, startedAt);
        return;
      }
      const startedAt = window.localStorage.getItem(AWAY_STARTED_AT_STORAGE_KEY);
      if (!startedAt || awaySummaryLoadingRef.current) return;
      awaySummaryLoadingRef.current = true;
      try {
        const tasks = await desktopApi.listBackgroundTasks({ limit: 50 });
        const startedMs = Date.parse(startedAt);
        const changed = tasks.filter((task) => {
          const updatedMs = Date.parse(task.updatedAt);
          return Number.isFinite(startedMs) && Number.isFinite(updatedMs) && updatedMs >= startedMs;
        });
        const pending = changed.filter((task) =>
          task.status === "waiting_approval"
          || (task.pendingDecisions?.length ?? 0) > 0,
        );
        const pendingIds = new Set(pending.map((task) => task.id));
        const completed = changed.filter((task) => task.status === "completed" && !pendingIds.has(task.id));
        const failed = changed.filter((task) => task.status === "failed" && !pendingIds.has(task.id));
        if (completed.length || failed.length || pending.length) {
          setAwaySummary({
            startedAt,
            returnedAt: new Date().toISOString(),
            completed,
            failed,
            pending,
          });
        }
        window.localStorage.removeItem(AWAY_STARTED_AT_STORAGE_KEY);
      } finally {
        awaySummaryLoadingRef.current = false;
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.visibilityState === "visible") void handleVisibilityChange();
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);
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
      workspaceId: thread.execution?.workspaceId || (thread.workspacePath ? getWorkspaceId(thread.workspacePath) : "current"),
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
    workspaceId: thread.execution?.workspaceId || (thread.workspacePath ? getWorkspaceId(thread.workspacePath) : "current"),
    workspacePath: thread.workspacePath,
    fork: thread.fork,
    active: thread.id === activeThreadId,
    pinned: thread.pinned,
    archived: thread.archived,
    unread: thread.unread,
  }));
  const workspaceThreads: WorkspaceThread[] = threads
    .filter((thread) => !thread.archived)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      timeLabel: formatThreadTime(thread.updatedAt, language),
      workspaceId: thread.execution?.workspaceId || (thread.workspacePath ? getWorkspaceId(thread.workspacePath) : "current"),
      workspacePath: thread.workspacePath,
      fork: thread.fork,
      active: thread.id === activeThreadId,
      pinned: thread.pinned,
      archived: thread.archived,
      unread: thread.unread,
    }));
  const servicePreparing = auth.serviceBusy || !auth.serviceReady;
  const runtimeAvailable = Boolean(health?.installed || health?.gateway?.externalReady);
  const chatUnavailableReason = auth.serviceBusy
    ? language === "zh"
      ? "正在后台检查模型服务，完成后即可发送。"
      : "Checking model services in the background. Sending will be available shortly."
    : !auth.serviceReady
      ? getServiceUnavailableReason(auth.serviceBlocker, language)
      : !health
        ? language === "zh"
          ? "正在初始化桌面端..."
          : "Initializing the desktop..."
        : !runtimeAvailable
          ? language === "zh"
            ? "本地运行时未安装，请先完成安装。"
            : "The local runtime is not installed. Install it first."
          : !workspaceTrusted
            ? language === "zh"
              ? "请先信任当前工作区。"
              : "Trust this workspace before sending."
            : undefined;
  const chat = useDesktopChatAdapter({
    availableAgents: availableChatAgents,
    availableModels: availableChatModels,
    canChat: Boolean(
      !sessionRestoring
        && !servicePreparing
        && runtimeAvailable
        && workspaceTrusted,
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
    workspaceId: effectiveRuntimeWorkspaceId,
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

  useEffect(() => {
    if (activeNav !== MENU_IDS.currentSession || !pendingChatInput) return;
    chat.setInput(pendingChatInput);
    setPendingChatInput(null);
  }, [activeNav, chat, pendingChatInput]);

  const canChat = Boolean(
    !sessionRestoring &&
    !servicePreparing &&
    runtimeAvailable &&
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

  useEffect(() => {
    if (!workspacesLoaded || !health?.gatewayReady || !workspacePath) return;
    if (storedWorkspaces.some((workspace) => getComparablePath(workspace.path) === getComparablePath(workspacePath))) return;
    let cancelled = false;
    void desktopApi.createWorkspace({
      source: "existing",
      path: workspacePath,
      name: getWorkspaceName(workspacePath) || (language === "zh" ? "默认" : "Default"),
      description: language === "zh" ? "当前项目" : "Current project",
      trusted: true,
      pinned: true,
    }).then((workspace) => {
      if (cancelled) return;
      setStoredWorkspaces((current) => [
        workspace,
        ...current.filter((item) => item.id !== workspace.id && getComparablePath(item.path) !== getComparablePath(workspace.path)),
      ]);
    }).catch(() => {
      // Runtime health and workspace registration can briefly race during startup.
      // A later health transition or manual workspace refresh will retry safely.
    });
    return () => { cancelled = true; };
  }, [health?.gatewayReady, language, storedWorkspaces, workspacePath, workspacesLoaded]);

  useEffect(() => desktopApi.onRemoteWorkspaceStatus((status) => {
    setStoredWorkspaces((current) => current.map((workspace) => workspace.id === status.workspaceId ? { ...workspace, remote: status, updatedAt: new Date().toISOString() } : workspace));
  }), []);
  useEffect(() => desktopApi.onThreadSnapshot((event) => {
    setThreadSnapshots((current) => ({
      ...current,
      [event.threadId]: event.snapshot,
    }));
  }), []);
  useEffect(() => desktopApi.onThreadCatalogUpdate((event) => {
    setThreads((current) => sortThreadsForSidebar([
      event.thread,
      ...current.filter((item) => item.id !== event.thread.id),
    ]));
  }), []);
  useEffect(() => {
    if (!activeThreadId) return;
    let subscribed = false;
    let disposed = false;
    void desktopApi.subscribeThreadSnapshot(activeThreadId)
      .then((value) => {
        subscribed = value;
        if (disposed && value) void desktopApi.unsubscribeThreadSnapshot(activeThreadId);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (subscribed) void desktopApi.unsubscribeThreadSnapshot(activeThreadId);
    };
  }, [activeThreadId]);

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
    void desktopApi.setCompletionNotificationPreference({
      enabled: completionNotifications,
      language,
    });
  }, [completionNotifications, language]);

  useEffect(() => desktopApi.onCompletionNotificationClick((event) => {
    if (event.target.workspacePath) {
      setActiveWorkspaceId(getWorkspaceId(event.target.workspacePath));
    }
    if (event.target.threadId) setActiveThreadId(event.target.threadId);
    setActiveNav(MENU_IDS.currentSession);
    void desktopApi.listBackgroundTasks({
      ...(event.target.workspacePath ? { workspacePath: event.target.workspacePath } : {}),
      limit: 100,
    }).then((tasks) => {
      const task = tasks.find((candidate) => candidate.kind === event.target.kind
        && candidate.targetId === event.target.targetId
        && candidate.status === "completed"
        && candidate.deliverySummary);
      if (task) setDeliveryTask(task);
    });
  }), []);

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
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

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
    if (restoreLastSession && threads.some((thread) => thread.id === activeThreadId)) {
      window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, activeThreadId);
    }
  }, [activeThreadId, restoreLastSession, threads]);

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
          desktopApi.getMyDrSaiConfig(effectiveWorkspacePath || undefined).catch(() => null),
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
        setSelectedChatModel((current) => {
          const preferredModel = preferredAgent.model ?? preferredAgent.models?.[0]
            ?? myDrSaiConfig?.defaultModelAlias ?? null;
          if (
            preferredAgent.id === "my-drsai"
            && (!current || ["deepseek-ai/deepseek-v4-pro", "hepai/deepseek-v4-pro"].includes(current))
          ) {
            return preferredModel;
          }
          return current ?? preferredModel;
        });
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

  useEffect(() => desktopApi.onOpenRequest((request) => {
    if (request.kind === "thread") {
      setActiveThreadId(request.threadId);
      navigateTo(MENU_IDS.currentSession);
      return;
    }
    if (request.kind === "file") {
      setFilesPanelFocusPath(request.path);
      setActiveRightTab("files");
      setRightPanelCollapsed(false);
      navigateTo(MENU_IDS.currentSession);
      return;
    }
    if (request.kind === "settings") {
      navigateTo(MENU_IDS.profile);
      return;
    }
    void desktop.refreshHealth();
  }), [desktop, navigateTo]);

  useEffect(() => desktopApi.onLifecycleEvent(() => {
    void desktop.refreshHealth();
  }), [desktop]);

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
    setWorkspaceLocationChoice(null);
    setRemoteWorkspaceStep("computer");
    setRemoteDialogOpen(true);
  }

  async function beginRemoteWorkspace(): Promise<void> {
    setWorkspaceLocationChoice("remote");
    setRemoteWorkspaceStep("computer");
    setRemoteDialogError("");
    const hosts = await desktopApi.listSshHosts();
    setRemoteHosts(hosts);
    setRemoteHostAlias((current) => current || hosts[0]?.alias || "");
  }

  async function selectRemoteComputer(): Promise<void> {
    setRemoteDialogError("");
    const diagnostic = await desktopApi.diagnoseSshHost(remoteHostAlias);
    if (diagnostic.state !== "reachable") {
      const needsTrust = diagnostic.state === "host_key_failed";
      setRemoteNeedsHostTrust(needsTrust);
      setRemoteHostKeys(needsTrust ? await desktopApi.inspectSshHostKeys(remoteHostAlias).catch(() => []) : []);
      setRemoteDialogError(needsTrust
        ? (language === "zh" ? "请在批准前通过可信渠道核对主机密钥指纹。" : "Verify these host-key fingerprints through a trusted channel before approval.")
        : diagnostic.message || (language === "zh" ? "无法连接这台计算机，请检查身份凭据和网络。" : "This computer is unavailable. Check its credentials and network."));
      return;
    }
    setRemoteNeedsHostTrust(false);
    setRemoteHostKeys([]);
    setRemoteWorkspaceStep("directory");
    await browseRemotePath(remotePath);
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
    if (workspace?.location === "remote") {
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
    if (workspace?.location === "remote") return;
    await desktopApi.openPath(path);
  }

  async function refreshWorkspaces(): Promise<void> {
    try {
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
    } finally {
      setWorkspacesLoaded(true);
    }
  }

  async function handleNewChat(): Promise<void> {
    setRightPanelCollapsed(true);
    setActiveThreadId(createLocalThreadId());
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
        setSelectedChatModel(boundAgent.model || boundAgent.models?.[0] || null);
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
      title: language === "zh" ? "新智能体任务" : "New agent task",
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
    setSelectedChatModel(agent.model || agent.models?.[0] || selectedChatModel);
    setSelectedChatExamples(agent.examples);
  }

  async function handleNewWorktreeChat(worktree: DesktopWorktreeSummary): Promise<void> {
    if (!worktree.workspaceId) throw new Error("Worktree execution Workspace is not registered.");
    setRightPanelCollapsed(true);
    const thread = await desktopApi.createThread({
      kind: "chat",
      title: `${language === "zh" ? "Worktree 会话" : "Worktree session"}: ${worktree.branch}`,
      workspacePath: worktree.canonicalPath,
      boundAgentId: selectedChatAgentId || undefined,
      boundAgentName: selectedChatAgentName || undefined,
      execution: {
        sourceWorkspaceId: worktree.sourceWorkspaceId,
        workspaceId: worktree.workspaceId,
        worktreeId: worktree.worktreeId,
        canonicalPath: worktree.canonicalPath,
      },
    });
    setThreads((current) => sortThreadsForSidebar([thread, ...current.filter((item) => item.id !== thread.id)]));
    setActiveThreadId(thread.id);
    navigateTo(MENU_IDS.currentSession);
  }

  function handleOpenWorkspaceResults(workspaceId: string): void {
    setActiveWorkspaceId(workspaceId);
    setResultsScopeRequestKey((current) => current + 1);
    navigateTo(MENU_IDS.results);
    if (workspaceId === "current") return;
    void desktopApi.updateWorkspace({
      id: workspaceId,
      lastOpenedAt: new Date().toISOString(),
    }).then((workspace) => {
      setStoredWorkspaces((current) => [
        workspace,
        ...current.filter((item) => item.id !== workspace.id),
      ]);
    }).catch(() => {
      // Opening results must stay responsive if the recent timestamp cannot be persisted.
    });
  }

  async function handleNewWorkspaceChat(workspace: WorkspaceProject): Promise<void> {
    setRightPanelCollapsed(true);
    setActiveWorkspaceId(workspace.id);
    setActiveThreadId(createLocalThreadId());
    navigateTo(MENU_IDS.currentSession);
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

  async function handleEmptyChatWorkspaceSelect(workspaceId: string): Promise<void> {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    setActiveWorkspaceId(workspace.id);
    const thread = threads.find((item) => item.id === activeThreadId);
    const snapshotCount = threadSnapshots[activeThreadId]?.messageCount ?? 0;
    const hasConversation = (thread?.messageCount ?? 0) > 0 || snapshotCount > 0;
    if (thread && !hasConversation) {
      const updated = await desktopApi.updateThread({ id: thread.id, workspacePath: workspace.path });
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
    }
    if (workspace.id !== "current") {
      void desktopApi.updateWorkspace({ id: workspace.id, lastOpenedAt: new Date().toISOString() })
        .then((updated) => setStoredWorkspaces((current) => [updated, ...current.filter((item) => item.id !== updated.id)]))
        .catch(() => undefined);
    }
  }

  function handleChatModelSelect(model: string): void {
    setSelectedChatModel(model);
  }

  async function handleThreadUpdate(
    threadId: string,
    updates: { title?: string; pinned?: boolean; archived?: boolean; unread?: boolean; fork?: DesktopThread["fork"] },
  ): Promise<void> {
    const thread = updates.archived === undefined ? await desktopApi.updateThread({
      id: threadId,
      ...updates,
    }) : await desktopApi.setThreadArchived({ threadId, archived: updates.archived });
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
    const existingThread = threads.find((item) => item.id === snapshot.threadId);
    const thread = await desktopApi.updateThread({
      id: snapshot.threadId,
      kind: existingThread?.kind ?? "chat",
      title: snapshot.title,
      workspacePath: effectiveWorkspacePath,
      boundAgentId: existingThread?.boundAgentId ?? selectedChatAgentId ?? undefined,
      boundAgentName: existingThread?.boundAgentName ?? selectedChatAgentName ?? undefined,
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
      if (event.defaultPrevented) return;
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
          health={sessionRestoring ? null : health}
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
            void desktop.refreshHealth();
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
          chatUnavailableReason={chatUnavailableReason}
          conversationId={activeThreadId}
          conversationHistoryPending={Boolean(
            (activeThread?.messageCount ?? 0) > 0 && !threadSnapshots[activeThreadId],
          )}
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
          modelOptions={chatModelOptions}
          samplePrompts={selectedChatExamples}
          structuredTurnFocus={structuredTurnFocus}
          externalAttachments={externalChatAttachments}
          ideContext={ideContext}
          workspaceInstructions={effectiveWorkspaceInstructions}
          workspaceName={effectiveWorkspace.name}
          workspacePath={effectiveWorkspacePath}
          workspaceLocation={effectiveWorkspace.location}
          workspaceOptions={sortedWorkspaces}
          selectedWorkspaceId={effectiveWorkspace.id}
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
          onSelectWorkspace={(workspaceId) => void handleEmptyChatWorkspaceSelect(workspaceId)}
          onSelectModel={handleChatModelSelect}
          onOpenExternal={(url) => desktopApi.openExternal(url)}
          onOpenDebug={platformDescriptor?.capabilities.features.debugger !== true ? undefined : () => {
            setActiveRightTab("debug");
            setRightPanelCollapsed(false);
          }}
          onOpenPreviewBrowser={platformDescriptor?.capabilities.features.browser !== true ? undefined : openPreviewBrowser}
          onOpenWorkspaceArtifact={(path) => {
            setFilesPanelFocusPath(path);
            setActiveRightTab("files");
            setRightPanelCollapsed(false);
          }}
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
    ) : activeNav === MENU_IDS.savedPlan ? (
      <TaskCenterView
        language={language}
        workspacePath={effectiveWorkspacePath}
      />
    ) : activeNav === MENU_IDS.results ? (
      <ResultsCenterView
        language={language}
        scopeRequestKey={resultsScopeRequestKey}
        workspaceName={activeWorkspace.name}
        workspacePath={activeWorkspace.path}
        onContinueQuestion={(question) => {
          setPendingChatInput(question);
          navigateTo(MENU_IDS.currentSession);
        }}
      />
    ) : activeNav === MENU_IDS.agentSquare ? (
      <section className="agent-square-panel">
        <AgentSquareView
          language={language}
          userEmail={user?.email}
          userGroups={user?.groups ?? []}
          workspacePath={effectiveWorkspacePath}
          selectedAgentId={selectedChatAgentId}
          onSetDefault={(agent) => void selectChatAgent(agent.id)}
          onStartChat={(agent) => {
            void selectChatAgent(agent.id).then((selected) => {
              if (!selected) return;
              setRightPanelCollapsed(true);
              setPendingChatInput(
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
        health={sessionRestoring ? null : health}
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
          void desktop.refreshHealth();
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
          platformDescriptor?.capabilities.features.channels !== true ? null : <ChannelsView
            language={language}
            onAttachImportedContext={attachImportedChannelContext}
            workspacePath={effectiveWorkspacePath}
          />
        )}
        featureCapabilities={platformDescriptor?.capabilities.features}
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
          setCompletionNotifications(enabled);
        }}
        onCopyDiagnostics={() => void copyTextSafely(JSON.stringify({ health, workspace: effectiveWorkspacePath, user: user?.email ?? null }, null, 2))}
        onDeveloperModeChange={(enabled) => {
          window.localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, String(enabled));
          window.location.reload();
        }}
        onExportLocalData={() => exportLocalDesktopData(threadSnapshots)}
        onLanguageChange={setLanguage}
        onLogout={onLogout}
        onNewAgentTask={() => void handleNewAgentTask()}
        onOpenMobilePairing={() => setMobilePairingOpen(true)}
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
        threads={threads}
        onArchiveThread={(threadId, archived) => void handleThreadUpdate(threadId, { archived })}
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
            ? "该功能正在准备中，完成后会直接显示在这里。"
            : "This view is reserved for WebUI-compatible shared components. The desktop adapter and IPC boundary are in place first."}
        </p>
      </div>
    );

  const desktopStatusPanel = (
    <DesktopStatusPanel
      actionMessage={desktop.actionMessage}
      busy={desktop.busy}
      health={health}
      codexStatus={codexStatus}
      codexEnabled={platformDescriptor?.capabilities.features.codexBackend === true}
      installProgress={desktop.installProgress}
      language={language}
      onCancelInstall={desktop.cancelInstall}
      onCancelUpdate={desktop.cancelUpdate}
      onCheckUpdates={desktop.checkUpdates}
      onDownloadUpdate={desktop.downloadUpdate}
      onInstallUpdate={desktop.installUpdate}
      onOpenPath={(path) => desktopApi.openPath(path)}
      onRefresh={desktop.refreshHealth}
      onCodexRefresh={async () => setCodexStatus(await desktopApi.getCodexBackendStatus(true))}
      onCodexLogin={async (type) => desktopApi.startCodexBackendLogin(type)}
      onCodexLogout={async () => { await desktopApi.logoutCodexBackend(); setCodexStatus(await desktopApi.getCodexBackendStatus(true)); }}
    />
  );

  const rightPanelContent =
    activeRightTab === "debug" ? (
      <DebugPanel
        language={language}
        onSelectTurn={(turnId) => setStructuredTurnFocus((current) => ({ turnId, nonce: (current?.nonce ?? 0) + 1 }))}
      />
    ) : activeRightTab === "terminal" && platformDescriptor?.capabilities.terminal !== false ? (
      <TerminalPanel
        cwd={effectiveWorkspacePath}
        workspaceId={effectiveRuntimeWorkspaceId}
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
    ) : activeRightTab === "terminal" ? (
      <div className="placeholder-view" role="status">
        <TerminalIcon size={28} />
        <h2>{language === "zh" ? "此平台未启用终端" : "Terminal is unavailable on this platform"}</h2>
      </div>
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
        workspaceId={effectiveRuntimeWorkspaceId}
        workspacePath={filesWorkspacePath}
        workspaceTrusted={workspaceTrusted}
        focusPath={filesPanelFocusPath}
        onBasketChange={setActiveThreadWorkspaceContextAttachments}
        onFileTraceChange={setActiveThreadFileTraceEvents}
        onInsertPath={(path) => {
          const current = chat.input.trimEnd();
          chat.setInput(current ? `${current}\n\n${path}` : path);
        }}
        onPrepareTask={(task) => {
          chat.setInput(task);
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

  function openAwaySummaryTask(task: DesktopBackgroundTask): void {
    if (task.status === "waiting_approval" || task.approvalId || task.pendingDecisions?.length) {
      navigateTo(MENU_IDS.approvalCenter);
    } else if (task.kind === "agent_run" && task.targetId) {
      const thread = threads.find((candidate) =>
        candidate.lastRequestId === task.targetId || candidate.lastRunId === task.targetId,
      );
      if (thread) handleThreadSelect(thread.id);
      else navigateTo(MENU_IDS.myAgents);
    } else if (task.kind === "presentation_generation") {
      setActiveRightTab("files");
      setRightPanelCollapsed(false);
      navigateTo(MENU_IDS.currentSession);
    } else {
      setSkillSquareCommandTarget({ query: task.targetId || task.title, source: "slash_command" });
      navigateTo(MENU_IDS.skillsSquare);
    }
    setAwaySummary(null);
  }

  return (<>
    {networkConnectivity !== "online" ? (
      <div
        className={`network-connectivity-banner ${networkConnectivity}`}
        data-testid="network-connectivity-status"
        role="status"
        aria-live="assertive"
      >
        {networkConnectivity === "offline"
          ? (language === "zh"
              ? "网络已断开。现有内容不会丢失；本地文件处理会继续，联网任务将在恢复后安全续传。"
              : "You are offline. Existing content is safe; local file work continues and online tasks will resume safely.")
          : (language === "zh"
              ? "网络已恢复，正在安全继续未完成的联网任务。"
              : "Connection restored. Unfinished online tasks are resuming safely.")}
      </div>
    ) : null}
    {awaySummary ? (
      <AwaySummaryPanel
        language={language}
        summary={awaySummary}
        onDismiss={() => setAwaySummary(null)}
        onOpenTask={openAwaySummaryTask}
      />
    ) : null}
    {deliveryTask?.deliverySummary ? (
      <TaskDeliverySummaryPanel
        language={language}
        task={deliveryTask}
        onClose={() => setDeliveryTask(null)}
        onOpenTask={() => {
          openAwaySummaryTask(deliveryTask);
          setDeliveryTask(null);
        }}
      />
    ) : null}
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
      platformId={platformDescriptor?.id ?? nativePlatformId}
      recentThreads={recentThreads}
      searchableThreads={searchableThreads}
      rightPanel={rightPanelContent}
      rightPanelCollapsed={rightPanelCollapsed}
      rightTabIcons={rightTabIcons}
      rightTabs={rightTabs}
      sidebarCollapsed={sidebarCollapsed}
      sidebarComponents={sidebarComponents}
      user={user}
      workspaceSortMode={workspaceSortMode}
      workspaceThreads={workspaceThreads}
      workspaces={sortedWorkspaces}
      onCreateWorkspace={handleCreateWorkspace}
      onGoBack={goBack}
      onGoForward={goForward}
      onAddWorkspace={handleAddWorkspace}
      onLanguageChange={setLanguage}
      onLoadForkConflictContent={loadForkConflictContent}
      onListWorktrees={(request) => desktopApi.listWorktrees(request)}
      onListWorktreeEvents={(request) => desktopApi.listWorktreeEvents(request)}
      onGetWorktreeMigrationDiagnostics={(request) => desktopApi.getWorktreeMigrationDiagnostics(request)}
      onGetWorktreeDiff={(request) => desktopApi.getWorkspaceGitDiff(request)}
      onCreateWorkspaceSession={handleNewWorkspaceChat}
      onCreateWorktreeSession={handleNewWorktreeChat}
      onLogout={async () => {
        await chat.abort();
        await onLogout();
      }}
      onNavChange={navigateTo}
      onNewChat={() => {
        void handleNewChat();
      }}
      onOpenWorkspaceResults={handleOpenWorkspaceResults}
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
      onToggleRightPanel={() => setRightPanelCollapsed((current) => !current)}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      onUpdateWorkspace={handleUpdateWorkspace}
      onWorkspaceChange={handleWorkspaceChange}
      onWorkspaceSortModeChange={setWorkspaceSortMode}
    />
    {mobilePairingOpen ? <MobilePairingDialog language={language} onClose={() => setMobilePairingOpen(false)} /> : null}
    {remoteDialogOpen ? (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(3, 7, 18, .68)" }}>
        <section role="dialog" aria-modal="true" aria-labelledby="remote-workspace-title" style={{ width: 520, maxWidth: "calc(100vw - 40px)", padding: 24, borderRadius: 14, background: "#111827", color: "#f9fafb", boxShadow: "0 24px 80px rgba(0,0,0,.5)" }}>
          <h2 id="remote-workspace-title" style={{ marginTop: 0 }}>{language === "zh" ? "添加工作区" : "Add workspace"}</h2>
          {workspaceLocationChoice === null ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <button type="button" style={{ minHeight: 92, padding: 14 }} onClick={() => void handleAddLocalWorkspace()}>
                <strong style={{ display: "block" }}>{language === "zh" ? "本地" : "Local"}</strong>
                <small>{language === "zh" ? "选择这台电脑上的文件夹" : "Choose a folder on this computer"}</small>
              </button>
              {platformDescriptor?.capabilities.features.remoteWorkspace === true && <button type="button" style={{ minHeight: 92, padding: 14 }} onClick={() => void beginRemoteWorkspace()}>
                <strong style={{ display: "block" }}>{language === "zh" ? "远程" : "Remote"}</strong>
                <small>{language === "zh" ? "选择另一台计算机上的文件夹" : "Choose a folder on another computer"}</small>
              </button>}
            </div>
          ) : <div style={{ paddingTop: 8 }}>
            <p style={{ marginTop: 0, color: "#cbd5e1" }}>
              {remoteWorkspaceStep === "computer"
                ? (language === "zh" ? "第 1 步（共 2 步）：选择计算机" : "Step 1 of 2: Choose a computer")
                : (language === "zh" ? "第 2 步（共 2 步）：选择目录" : "Step 2 of 2: Choose a directory")}
            </p>
            {remoteWorkspaceStep === "computer" ? <>
            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>{language === "zh" ? "计算机" : "Computer"}
              <select value={remoteHostAlias} onChange={(event) => setRemoteHostAlias(event.target.value)} style={{ padding: 9 }}>
                {remoteHosts.map((host) => <option key={host.alias} value={host.alias}>{host.alias} — {host.user ? `${host.user}@` : ""}{host.hostname}:{host.port}</option>)}
              </select>
            </label>
            <button type="button" disabled={!remoteHostAlias} onClick={() => void selectRemoteComputer()}>{language === "zh" ? "继续" : "Continue"}</button>
            </> : <>
            <button type="button" style={{ marginBottom: 12 }} onClick={() => setRemoteWorkspaceStep("computer")}>
              {language === "zh" ? `← ${remoteHostAlias}` : `← ${remoteHostAlias}`}
            </button>
            <label style={{ display: "grid", gap: 6 }}>{language === "zh" ? "远程目录" : "Remote directory"}
              <input value={remotePath} onChange={(event) => setRemotePath(event.target.value)} placeholder="/home/vscode" style={{ padding: 9 }} />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><button type="button" onClick={() => void browseRemotePath()}>{language === "zh" ? "浏览" : "Browse"}</button><button type="button" onClick={() => void browseRemotePath("~")}>Home</button><button type="button" onClick={() => void browseRemotePath(remotePath.replace(/\/[^/]+\/?$/, "") || "/")}>{language === "zh" ? "父目录" : "Parent"}</button><label><input type="checkbox" checked={remoteShowHidden} onChange={(event) => setRemoteShowHidden(event.target.checked)} /> {language === "zh" ? "隐藏目录" : "Hidden"}</label></div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>{remotePath.split("/").filter(Boolean).map((part, index, parts) => <button type="button" key={`${part}-${index}`} onClick={() => void browseRemotePath(`/${parts.slice(0, index + 1).join("/")}`)}>{index === 0 ? "/" : ""}{part}</button>)}</div>
            {remoteRecentPaths.length > 0 ? <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}><small>Recent:</small>{remoteRecentPaths.map((path) => <button type="button" key={path} title={path} onClick={() => void browseRemotePath(path)}>{path.split("/").filter(Boolean).at(-1) || path}</button>)}</div> : null}
            {remoteDirectories.length > 0 ? <div style={{ maxHeight: 180, overflow: "auto", marginTop: 8, border: "1px solid #374151" }}>{remoteDirectories.filter((entry) => remoteShowHidden || !entry.name.startsWith(".")).map((entry) => <button type="button" disabled={entry.readable === false} title={`${entry.path} · ${entry.mode || "mode unknown"}${entry.writable === false ? " · read-only" : ""}`} key={entry.path} style={{ display: "block", width: "100%", textAlign: "left", padding: 7 }} onDoubleClick={() => void browseRemotePath(entry.path)} onClick={() => setRemotePath(entry.path)}>📁 {entry.name} {entry.writable === false ? "🔒" : ""}</button>)}</div> : null}
            </>}
            {remoteHosts.length === 0 ? <p style={{ color: "#fbbf24" }}>{language === "zh" ? "没有找到已配置的远程计算机。" : "No configured remote computers were found."}</p> : null}
            {remoteDialogError ? <p role="alert" style={{ color: "#fca5a5" }}>{remoteDialogError}</p> : null}
            {remoteNeedsHostTrust ? <section style={{ padding: 10, border: "1px solid #f59e0b", borderRadius: 8 }}>
              {remoteHostKeys.map((key) => <code key={`${key.algorithm}-${key.fingerprint}`} style={{ display: "block", overflowWrap: "anywhere", marginBottom: 5 }}>{key.algorithm} · {key.fingerprint}</code>)}
              <button type="button" onClick={() => void desktopApi.approveSshHostKey(remoteHostAlias).then(async (ok) => {
                setRemoteNeedsHostTrust(!ok);
                setRemoteDialogError(ok ? "" : "Host key approval failed; changed keys must be resolved in known_hosts.");
                if (ok) await selectRemoteComputer();
              })}>{language === "zh" ? "已核对，信任这台计算机" : "Verified — trust this computer"}</button>
            </section> : null}
          </div>}
          <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={() => setRemoteDialogOpen(false)}>{language === "zh" ? "取消" : "Cancel"}</button>
            {workspaceLocationChoice === "remote" && remoteWorkspaceStep === "directory" ? <button type="button" disabled={remoteConnecting || !remoteHostAlias || !remotePath.trim()} onClick={() => void handleConnectRemoteWorkspace()}>{remoteConnecting ? (language === "zh" ? "连接中…" : "Connecting…") : (language === "zh" ? "打开远程工作区" : "Open remote workspace")}</button> : null}
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
          ? "智能体任务已完成。"
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

function LegacyTaskCenterView({
  language,
  workspacePath,
}: {
  language: AppLanguage;
  workspacePath: string;
}): React.JSX.Element {
  const zh = language === "zh";
  const [tasks, setTasks] = useState<DesktopBackgroundTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function refresh(): Promise<void> {
      try {
        const next = await desktopApi.listBackgroundTasks({ workspacePath, limit: 50 });
        if (!active) return;
        setTasks(next);
        setError("");
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [workspacePath]);

  return (
    <section className="task-center-view" data-testid="task-center-view">
      <header>
        <div>
          <h2>{zh ? "任务中心" : "Task center"}</h2>
          <p>{zh ? "统一查看等待、执行、待决定、成功和未完成的任务。状态会自动更新。" : "See waiting, running, decision, completed, and unsuccessful tasks in one place. Statuses update automatically."}</p>
        </div>
        <span role="status">{loading ? (zh ? "正在更新…" : "Updating…") : (zh ? "状态已同步" : "Status synced")}</span>
      </header>
      {error ? <p className="task-center-error" role="alert">{zh ? `无法更新任务状态：${error}` : `Could not update task status: ${error}`}</p> : null}
      <BackgroundTaskQueue language={language} tasks={tasks} />
    </section>
  );
}

void LegacyTaskCenterView;

interface IndexedTaskArtifact extends DesktopTaskArtifactLink {
  sourceTaskId: string;
  sourceTaskTitle: string;
  sourceTaskUpdatedAt: string;
  sourceWorkspacePath?: string;
}

function buildArtifactVersionTask(artifact: IndexedTaskArtifact): string {
  const baseName = artifact.label.replace(/\.[^.]+$/, "") || "result";
  return [
    `将成果文件“${artifact.path}”转换为五种面向不同使用场景的版本。`,
    "只使用源文件中已有的事实和数字，不得虚构、改写或遗漏核心数据；五个版本中的核心事实和数字必须 100% 一致。",
    "在工作区内生成并登记以下五个独立 Markdown 成果文件：",
    `1. ${baseName}-one-page-summary.md：一页摘要，包含标题、关键发现、建议/下一步，供决策者快速阅读。`,
    `2. ${baseName}-full-report.md：完整报告，包含标题、摘要、方法、结果、限制、来源。`,
    `3. ${baseName}-presentation-outline.md：PPT 提纲，按“幻灯片 1、幻灯片 2…”编号，每页包含标题和讲述要点。`,
    `4. ${baseName}-email.md：可直接发送的邮件，包含主题、简短正文和明确行动请求。`,
    `5. ${baseName}-english.md：全英文版本，包含 Executive Summary、Methods、Results、Limitations、Sources。`,
    "每个文件都必须注明源成果文件名；完成前逐一核对五个文件的格式、受众适配和全部数字。",
  ].join("\n");
}

type LocalEditScope = { type: "text" | "table" | "image"; label: string; text?: string };

function localEditAction(kind: WorkspaceFilePreview["kind"]): "simplify_text" | "sort_table_numeric" | "log_scale_image" {
  if (kind === "table") return "sort_table_numeric";
  if (kind === "image") return "log_scale_image";
  return "simplify_text";
}

function buildLocalEditTask(artifact: IndexedTaskArtifact, preview: WorkspaceFilePreview, scope: LocalEditScope): string {
  const extension = artifact.label.match(/(\.[^.]+)$/)?.[1] || "";
  const baseName = extension ? artifact.label.slice(0, -extension.length) : artifact.label;
  const outputName = `${baseName}-edited${extension}`;
  const action = localEditAction(preview.kind);
  const instruction = action === "simplify_text"
    ? `只把选中文字改得更简单：${scope.text}`
    : action === "sort_table_numeric"
      ? "只对选中的整个表格按数值列升序排序，保留表头、全部单元格和值。"
      : "只把选中的图片改为对数坐标表现，保留图像主题和未选择的其他成果。";
  return [
    `对成果“${artifact.path}”执行局部修改。`,
    `明确范围：${scope.label}。`,
    instruction,
    `生成新文件 ${outputName}，不得覆盖或改写源文件。`,
    "除明确选中范围外，其他文字、表格单元格、图片和成果必须逐字节保持不变。",
    "完成后登记新文件，供用户与原版比较。",
  ].join("\n");
}

type ChartConfig = { xColumn: string; yColumn: string; anomalyColumn: string; unit: string; legend: string };

function buildChartTask(artifact: IndexedTaskArtifact, config: ChartConfig): string {
  const baseName = artifact.label.replace(/\.[^.]+$/, "") || "data";
  return [
    `根据 CSV 成果“${artifact.path}”生成 ${baseName}-chart.svg。`,
    `横轴使用 ${config.xColumn}，纵轴使用 ${config.yColumn}，单位 ${config.unit}，图例 ${config.legend}，异常列 ${config.anomalyColumn}。`,
    "SVG 必须显示横纵坐标标签、单位和图例。每行数据对应一个 circle，并写入 data-x、data-y；异常点写入 data-anomaly=\"true\"。",
    "使用线性坐标映射：绘图区 left=60、right=540、top=40、bottom=340；范围由任务 metadata 给出，circle 的 cx/cy 必须精确匹配。",
    "不得改写 CSV，不得遗漏或虚构数据点；完成后将 SVG 登记为成果，系统会逐点自动核对。",
  ].join("\n");
}

function buildAlternativeRouteTask(artifact: IndexedTaskArtifact, config: ChartConfig): string {
  const sourceName = artifact.chartQuality?.sourcePath.split(/[\\/]/).pop() || "data.csv";
  const baseName = sourceName.replace(/\.[^.]+$/, "") || "data";
  return [
    `保留现有成果“${artifact.path}”，基于同一输入“${artifact.chartQuality?.sourcePath}”建立另一条独立分析路线。`,
    `生成新的独立成果 ${baseName}-anomaly-first-route.svg，禁止覆盖、改名或修改现有成果。`,
    `新路线采用“异常点优先分段分析”：先识别 ${config.anomalyColumn} 标记的异常，再比较非异常基线与异常偏离；原路线采用时间顺序趋势分析。`,
    `横轴使用 ${config.xColumn}，纵轴使用 ${config.yColumn}，单位 ${config.unit}，图例 ${config.legend}。`,
    "SVG 必须显示横纵坐标标签、单位和图例。每行数据对应一个 circle，并写入 data-x、data-y；异常点写入 data-anomaly=\"true\"。",
    "使用线性坐标映射：绘图区 left=60、right=540、top=40、bottom=340；范围由任务 metadata 给出，circle 的 cx/cy 必须精确匹配。",
    "不得改写输入 CSV 或原路线成果；完成后登记新的 SVG 成果，供用户分别打开两条路线。",
  ].join("\n");
}

interface AnalysisRouteInsights {
  inputSummary: string;
  originalConclusion: string;
  originalRisk: string;
  originalUse: string;
  alternativeConclusion: string;
  alternativeRisk: string;
  alternativeUse: string;
}

function buildAnalysisRouteInsights(content: string, quality: NonNullable<DesktopTaskArtifactLink["chartQuality"]>, zh: boolean): AnalysisRouteInsights {
  const lines = content.trim().split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() || "").split(",").map((item) => item.trim());
  const xIndex = headers.indexOf(quality.xAxis);
  const yIndex = headers.indexOf(quality.yAxis);
  const anomalyIndex = headers.findIndex((item) => /anomaly/i.test(item));
  const rows = lines.map((line) => line.split(",").map((item) => item.trim())).map((cells) => ({
    x: xIndex >= 0 ? cells[xIndex] : "",
    y: yIndex >= 0 ? Number(cells[yIndex]) : Number.NaN,
    anomaly: anomalyIndex >= 0 && /^(?:true|1|yes|anomaly)$/i.test(cells[anomalyIndex] || ""),
  })).filter((row) => Number.isFinite(row.y));
  const first = rows[0];
  const last = rows.at(-1);
  const anomaly = rows.find((row) => row.anomaly);
  const baseline = rows.filter((row) => !row.anomaly);
  const baselineAverage = baseline.length ? baseline.reduce((sum, row) => sum + row.y, 0) / baseline.length : Number.NaN;
  const inputSummary = zh
    ? `${quality.sourcePath.split(/[\\/]/).pop()} · ${quality.xAxis}/${quality.yAxis} · ${rows.length || quality.pointsExpected} 个数据点 · ${quality.unit}`
    : `${quality.sourcePath.split(/[\\/]/).pop()} · ${quality.xAxis}/${quality.yAxis} · ${rows.length || quality.pointsExpected} points · ${quality.unit}`;
  const originalConclusion = first && last
    ? (zh ? `${quality.yAxis} 从 ${first.y} ${quality.unit} 变化到 ${last.y} ${quality.unit}，按 ${quality.xAxis} 展示整体趋势。` : `${quality.yAxis} changes from ${first.y} ${quality.unit} to ${last.y} ${quality.unit} across ${quality.xAxis}.`)
    : (zh ? `按 ${quality.xAxis} 展示 ${quality.pointsExpected} 个数据点的整体趋势。` : `Shows the overall trend across ${quality.pointsExpected} points by ${quality.xAxis}.`);
  const alternativeConclusion = anomaly
    ? (zh ? `异常点 ${anomaly.x || "—"} 为 ${anomaly.y} ${quality.unit}${Number.isFinite(baselineAverage) ? `，比非异常基线均值 ${baselineAverage.toFixed(1)} ${quality.unit} 高` : ""}。` : `Anomaly ${anomaly.x || "—"} is ${anomaly.y} ${quality.unit}${Number.isFinite(baselineAverage) ? ` versus a ${baselineAverage.toFixed(1)} ${quality.unit} non-anomaly baseline` : ""}.`)
    : (zh ? `优先检查 ${quality.anomaliesExpected} 个异常点与非异常基线的差异。` : `Prioritizes ${quality.anomaliesExpected} anomalies against the non-anomaly baseline.`);
  return {
    inputSummary,
    originalConclusion,
    originalRisk: zh ? "整体趋势可能弱化局部异常，需要结合异常路线复核峰值。" : "The overall trend can understate local anomalies; review peaks with the anomaly route.",
    originalUse: zh ? "适合汇报整体变化和容量规划。" : "Best for communicating overall change and capacity planning.",
    alternativeConclusion,
    alternativeRisk: zh ? "异常峰值不等同于长期趋势，不能单独用于外推。" : "An anomaly peak is not a long-term trend and should not be extrapolated alone.",
    alternativeUse: zh ? "适合排查峰值、数据质量和需要进一步确认的异常。" : "Best for investigating peaks, data quality, and anomalies needing confirmation.",
  };
}

function reviewFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildIndependentReview(
  artifact: IndexedTaskArtifact,
  mode: DesktopIndependentReviewRecord["mode"],
): DesktopIndependentReviewRecord {
  const now = new Date().toISOString();
  const issues = artifact.consistencyCheck?.items ?? [];
  const conclusions = artifact.keyConclusions ?? [];
  const method = mode === "alternative" ? "constraint_recalculation" : "reverse_source_trace";
  const evidenceRows = issues.length
    ? issues.map((item) => ({
        id: item.id,
        title: item.title,
        sourcePath: item.sourcePath,
        locatorType: item.locatorType,
        locator: item.locator,
        evidenceText: item.evidenceText,
        detail: mode === "alternative"
          ? `不读取首次检查摘要，按“当前值 ${item.observedValue}／来源值 ${item.expectedValue}”重新计算约束，独立复现该问题。`
          : `从成果中的“${item.observedValue}”反向追踪到 ${item.locator}，再与原始依据“${item.evidenceText}”逐项核对。`,
        outcome: "issue_found" as const,
      }))
    : conclusions.map((item) => ({
        id: item.id,
        title: item.conclusion,
        sourcePath: item.sourcePath,
        locatorType: item.locatorType,
        locator: item.locator,
        evidenceText: item.evidenceText,
        detail: mode === "alternative"
          ? `绕过首次结论文本，按来源摘录、数字输入与计算关系重建约束；复算结果支持该结论。`
          : `从结论反向打开 ${item.locator}，逐字核对来源摘录后确认该结论可复现。`,
        outcome: "confirmed" as const,
      }));
  const uniqueSources = new Set(evidenceRows.map((item) => `${item.sourcePath}#${item.locator}`));
  const scope = mode === "alternative"
    ? [
        `对 ${evidenceRows.length} 项事实建立不依赖首次摘要的数值、状态和来源约束`,
        `重新读取 ${uniqueSources.size} 个原始位置并复算可计算关系`,
        "比较独立复算结果与成果，不复用首次检查的通过/失败结论",
      ]
    : [
        `对 ${evidenceRows.length} 项事实执行结论到原始来源的反向追踪`,
        `逐一打开并核对 ${uniqueSources.size} 个来源位置`,
        "重新判断来源是否直接支持成果中的相邻事实",
      ];
  const uncovered = mode === "alternative"
    ? ["未连接的外部实时数据源是否在复核后发生更新", "作者未写入材料的隐含业务意图"]
    : ["视觉排版是否符合组织品牌规范", "未提供原始材料的事实无法独立验证"];
  const status = issues.length ? "issues_found" : evidenceRows.length ? "passed" : "inconclusive";
  const methodDifference = mode === "alternative"
    ? "采用约束重建与数值复算，从来源值重新推出结论；不读取第一次检查的摘要或状态。"
    : "采用结论反向追踪，逐项从成果返回原始位置；检查顺序与第一次正向扫描相反。";
  const fingerprintInput = [method, artifact.path, ...evidenceRows.flatMap((item) => [item.sourcePath, item.locator, item.evidenceText, item.detail])].join("|");
  return {
    id: `review-${mode}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    mode,
    method,
    methodLabel: mode === "alternative" ? "约束重建与数值复算" : "结论到来源的反向追踪",
    reviewerLabel: "独立复核器",
    requestedAt: now,
    completedAt: now,
    status,
    checkedClaimCount: evidenceRows.length,
    checkedSourceCount: uniqueSources.size,
    scope,
    findings: evidenceRows.map((item) => ({ ...item })),
    uncovered,
    summary: status === "issues_found"
      ? `独立复核发现 ${evidenceRows.length} 项需要修正的问题。`
      : status === "passed"
        ? `独立复核完成，${evidenceRows.length} 项事实均可由原始材料重新验证。`
        : "当前成果没有足够的来源记录，无法完成独立复核。",
    baselineCheckId: artifact.consistencyCheck
      ? `consistency:${artifact.consistencyCheck.checkedAt}`
      : `traceability:${artifact.id}`,
    usesOriginalAnswerText: false,
    methodDifference,
    evidenceFingerprint: reviewFingerprint(fingerprintInput),
  };
}

function ResultsCenterView({
  language,
  scopeRequestKey,
  workspaceName,
  workspacePath,
  onContinueQuestion,
}: {
  language: AppLanguage;
  scopeRequestKey: number;
  workspaceName: string;
  workspacePath: string;
  onContinueQuestion: (question: string) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const [tasks, setTasks] = useState<DesktopBackgroundTask[]>([]);
  const [reusableTasks, setReusableTasks] = useState<DesktopReusableTask[]>([]);
  const [reusableSaveDraft, setReusableSaveDraft] = useState<{ sourceTaskId: string; name: string } | null>(null);
  const [reusableInputs, setReusableInputs] = useState<Record<string, string>>({});
  const [reusableAdjustments, setReusableAdjustments] = useState<Record<string, DesktopReusableTaskAdjustments>>({});
  const [reusableAdjustmentScopes, setReusableAdjustmentScopes] = useState<Record<string, DesktopReusableTaskAdjustmentScope>>({});
  const [reusableState, setReusableState] = useState<{ state: "saving" | "saved" | "preparing" | "running" | "completed" | "failed"; message: string; requestId?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspaceScope, setWorkspaceScope] = useState<"workspace" | "all">("workspace");
  const [kindFilter, setKindFilter] = useState<"all" | DesktopTaskArtifactLink["kind"]>("all");

  useEffect(() => {
    setWorkspaceScope("workspace");
  }, [scopeRequestKey, workspacePath]);
  const [openState, setOpenState] = useState<{
    artifactId: string;
    state: "opening" | "opened" | "failed";
    message: string;
  } | null>(null);
  const [evidenceOpenState, setEvidenceOpenState] = useState<{
    evidenceId: string;
    state: "opening" | "opened" | "failed";
    message: string;
  } | null>(null);
  const [versionState, setVersionState] = useState<{
    artifactId: string;
    state: "starting" | "running" | "completed" | "failed";
    message: string;
    requestId?: string;
  } | null>(null);
  const [previewState, setPreviewState] = useState<{
    artifact: IndexedTaskArtifact;
    state: "loading" | "ready" | "failed";
    preview?: WorkspaceFilePreview;
    message: string;
  } | null>(null);
  const [saveState, setSaveState] = useState<{
    artifactId: string;
    state: "saving" | "saved" | "canceled" | "failed";
    message: string;
  } | null>(null);
  const [localEditScope, setLocalEditScope] = useState<LocalEditScope | null>(null);
  const [editState, setEditState] = useState<{
    artifactId: string;
    state: "starting" | "running" | "completed" | "failed";
    message: string;
  } | null>(null);
  const [compareState, setCompareState] = useState<{
    artifact: IndexedTaskArtifact;
    state: "loading" | "ready" | "failed";
    source?: WorkspaceFilePreview;
    edited?: WorkspaceFilePreview;
    message: string;
  } | null>(null);
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);
  const [chartState, setChartState] = useState<{
    artifactId: string;
    state: "starting" | "running" | "completed" | "failed";
    message: string;
  } | null>(null);
  const [routeState, setRouteState] = useState<{
    artifactId: string;
    state: "starting" | "running" | "completed" | "failed";
    message: string;
  } | null>(null);
  const [routeSelectionState, setRouteSelectionState] = useState<{
    groupId: string;
    routeId: string;
    state: "saving" | "selected" | "failed";
    message: string;
  } | null>(null);
  const [anomalyChoices, setAnomalyChoices] = useState<Record<string, DesktopAnomalyDecision>>({});
  const [anomalyDecisionState, setAnomalyDecisionState] = useState<{
    artifactId: string;
    state: "applying" | "completed" | "failed";
    message: string;
  } | null>(null);
  const [consistencyDecisions, setConsistencyDecisions] = useState<Partial<Record<string, "accepted" | "ignored">>>({});
  const [independentReviewState, setIndependentReviewState] = useState<{
    artifactId: string;
    mode: DesktopIndependentReviewRecord["mode"];
    state: "running" | "completed" | "failed";
    message: string;
  } | null>(null);
  const [shareDraft, setShareDraft] = useState<{
    sourceTaskId: string;
    scope: "result_only" | "complete_task";
    artifactId?: string;
    title: string;
  } | null>(null);
  const shareOpenerRef = useRef<HTMLButtonElement | null>(null);
  const firstResultActionRef = useRef<HTMLButtonElement | null>(null);
  const [shareRecipient, setShareRecipient] = useState("");
  const [sharePermission, setSharePermission] = useState<DesktopSharePermission>("view");
  const [shareState, setShareState] = useState<{
    state: "creating" | "created" | "failed";
    message: string;
    manifest?: DesktopShareManifest;
  } | null>(null);
  const [shareInspection, setShareInspection] = useState<{
    state: "scanning" | "ready" | "failed";
    message: string;
    result?: DesktopShareInspectionResult;
  } | null>(null);
  const [shareSensitiveActions, setShareSensitiveActions] = useState<Record<string, DesktopShareSensitiveAction>>({});
  const [incomingShares, setIncomingShares] = useState<DesktopShareManifest[]>([]);
  const [outgoingShares, setOutgoingShares] = useState<DesktopShareManifest[]>([]);
  const [shareComments, setShareComments] = useState<Record<string, DesktopShareComment[]>>({});
  const [shareCommentDrafts, setShareCommentDrafts] = useState<Record<string, string>>({});
  const [shareCommentTargets, setShareCommentTargets] = useState<Record<string, { objectId: string; anchorType: DesktopShareCommentAnchorType; anchorLabel: string }>>({});
  const [shareCommentTasks, setShareCommentTasks] = useState<DesktopShareCommentTask[]>([]);
  const [commentTaskDraft, setCommentTaskDraft] = useState<(DesktopShareCommentTaskPreview & { taskId?: string }) | null>(null);
  const [commentTaskState, setCommentTaskState] = useState<{ state: "loading" | "saving" | "completed" | "failed"; message: string } | null>(null);
  const [shareCollaborationState, setShareCollaborationState] = useState<{ state: "working" | "completed" | "failed"; message: string } | null>(null);
  const [shareRevokeDraft, setShareRevokeDraft] = useState<DesktopShareManifest | null>(null);
  const [shareRevokeConfirmation, setShareRevokeConfirmation] = useState("");
  const [shareRevocationReceipts, setShareRevocationReceipts] = useState<Record<string, { revokedAt: string; objectsInvalidated: number; auditEntryId: string }>>({});
  const [shareVersionDraft, setShareVersionDraft] = useState<{ share: DesktopShareManifest; inspection: DesktopShareVersionInspection } | null>(null);
  const [shareVersionState, setShareVersionState] = useState<{ state: "scanning" | "publishing" | "published" | "conflict" | "failed"; message: string } | null>(null);
  const [sharedOpenState, setSharedOpenState] = useState<{
    state: "opening" | "opened" | "failed";
    message: string;
    result?: DesktopSharedObjectOpenResult;
  } | null>(null);
  const [sharedDownloadState, setSharedDownloadState] = useState<{
    state: "downloading" | "downloaded" | "failed";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!shareDraft) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setShareDraft(null);
      setShareRecipient("");
      setSharePermission("view");
      setShareState(null);
      window.requestAnimationFrame(() => shareOpenerRef.current?.focus());
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [shareDraft]);

  useEffect(() => {
    let active = true;
    async function refresh(): Promise<void> {
      try {
        const next = await desktopApi.listBackgroundTasks({ limit: 100 });
        if (!active) return;
        setTasks(next);
        setError("");
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    if (!shareDraft) {
      setShareInspection(null);
      setShareSensitiveActions({});
      return;
    }
    let active = true;
    setShareInspection({ state: "scanning", message: zh ? "正在检查待分享内容中的个人信息和秘密…" : "Scanning the content for personal information and secrets…" });
    void desktopApi.inspectShare({ sourceTaskId: shareDraft.sourceTaskId, scope: shareDraft.scope, ...(shareDraft.artifactId ? { artifactId: shareDraft.artifactId } : {}) })
      .then((result) => {
        if (!active) return;
        setShareSensitiveActions(Object.fromEntries(result.findings.map((finding) => [finding.id, "redact"])));
        setShareInspection({ state: "ready", result, message: result.findings.length ? (zh ? `发现 ${result.findings.length} 类敏感信息，必须逐项遮蔽或删除后才能分享。` : `Found ${result.findings.length} sensitive items. Redact or remove each one before sharing.`) : (zh ? "检查完成，未发现需要处理的个人信息或秘密。" : "Scan complete; no personal information or secrets require action.") });
      })
      .catch((caught) => { if (active) setShareInspection({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); });
    return () => { active = false; };
  }, [shareDraft, zh]);

  useEffect(() => {
    let active = true;
    const refresh = (): void => { void Promise.all([desktopApi.listIncomingShares(), desktopApi.listOutgoingShares(), desktopApi.listShareCommentTasks()]).then(async ([incoming, outgoing, commentTasks]) => { if (!active) return; setIncomingShares(incoming); setOutgoingShares(outgoing); setShareCommentTasks(commentTasks); const readableShares = [...outgoing, ...incoming.filter((share) => share.permission !== "view")].filter((share, index, items) => items.findIndex((item) => item.id === share.id) === index); const comments = await Promise.all(readableShares.map(async (share) => [share.id, await desktopApi.listShareComments({ shareId: share.id }).catch(() => [])] as const)); if (active) setShareComments(Object.fromEntries(comments)); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    desktopApi.listReusableTasks().then((items) => { if (active) setReusableTasks(items); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => desktopApi.onAgentRunEvent((event) => {
    if (!reusableState?.requestId || event.requestId !== reusableState.requestId) return;
    if (event.type === "done") {
      setReusableState({ state: "running", requestId: event.requestId, message: zh ? "任务已执行完成，正在登记新成果…" : "Execution completed; registering the new result…" });
    } else if (event.type === "error" || event.type === "aborted") {
      setReusableState({ state: "failed", message: event.error || (zh ? "可复用任务未完成。" : "Reusable task did not complete.") });
    }
  }), [reusableState?.requestId, zh]);

  async function saveAsReusableTask(): Promise<void> {
    if (!reusableSaveDraft?.name.trim()) return;
    setReusableState({ state: "saving", message: zh ? "正在保存可复用任务…" : "Saving reusable task…" });
    try {
      const saved = await desktopApi.saveReusableTask({ sourceTaskId: reusableSaveDraft.sourceTaskId, name: reusableSaveDraft.name.trim() });
      setReusableTasks((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setReusableInputs(Object.fromEntries(saved.inputs.map((input) => [input.id, input.originalValue])));
      setReusableAdjustments((current) => ({ ...current, [saved.id]: saved.savedAdjustments }));
      setReusableAdjustmentScopes((current) => ({ ...current, [saved.id]: "this_run" }));
      setReusableSaveDraft(null);
      setReusableState({ state: "saved", message: zh ? `已保存“${saved.name}”。运行前只需替换下面的输入。` : `Saved “${saved.name}”. Replace only the inputs below before running.` });
    } catch (caught) {
      setReusableState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function runReusableTask(task: DesktopReusableTask): Promise<void> {
    setReusableState({ state: "preparing", message: zh ? "正在校验新材料并准备任务…" : "Validating the replacement input and preparing the task…" });
    try {
      const runWorkspacePath = task.sourceWorkspacePath || workspacePath;
      const adjustments = reusableAdjustments[task.id] ?? task.savedAdjustments ?? { checkItems: [] };
      const adjustmentScope = reusableAdjustmentScopes[task.id] ?? "this_run";
      const recipe = await desktopApi.prepareReusableTaskRun({ reusableTaskId: task.id, workspacePath: runWorkspacePath, inputs: reusableInputs, adjustments, adjustmentScope });
      const requestId = crypto.randomUUID();
      const sessionId = `reusable-${requestId}`;
      setReusableState({ state: "running", message: zh ? "正在读取新材料并重新执行；不会沿用旧结果缓存。" : "Reading the replacement input and rerunning; earlier output caches are disabled.", requestId });
      await desktopApi.startAgentRun({
        requestId, runId: requestId, threadId: sessionId, sessionId,
        task: recipe.resolvedTask, workspacePath: runWorkspacePath,
        files: recipe.inputs.map((input) => ({ name: input.path.split(/[\\/]/).pop(), path: input.path, sha256: input.sha256, bytes: input.bytes, source: "reusable_task_replacement" })),
        teamConfig: { preset: "general-collaboration" },
        metadata: { source: "windows-reusable-task", reusable_task_id: task.id, reusable_run_id: recipe.id, input_fingerprint: recipe.inputs.map((input) => input.sha256).join(":"), cache_policy: recipe.cachePolicy, adjustment_scope: recipe.adjustmentScope, reusable_adjustments: recipe.adjustments },
      });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const latestTasks = await desktopApi.listBackgroundTasks({ workspacePath: runWorkspacePath, limit: 100 });
        const run = latestTasks.find((item) => item.kind === "agent_run" && item.targetId === requestId);
        if (run?.status === "completed") {
          setTasks(latestTasks);
          setReusableTasks(await desktopApi.listReusableTasks());
          setReusableState({ state: "completed", message: zh ? "已使用新材料完成任务，结果已进入成果中心。" : "Task completed from the replacement input; the new result is in Results center." });
          return;
        }
        if (run && ["failed", "blocked", "cancelled"].includes(run.status)) {
          throw new Error(run.message || (zh ? "可复用任务未完成。" : "Reusable task did not complete."));
        }
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      throw new Error(zh ? "等待可复用任务完成超时。" : "Timed out waiting for the reusable task to complete.");
    } catch (caught) {
      setReusableState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function confirmShare(): Promise<void> {
    if (!shareDraft || !shareRecipient.trim()) return;
    setShareState({ state: "creating", message: zh ? "正在创建分享…" : "Creating share…" });
    try {
      const manifest = await desktopApi.createShare({
        sourceTaskId: shareDraft.sourceTaskId,
        scope: shareDraft.scope,
        recipientAccount: shareRecipient.trim(),
        ...(shareDraft.artifactId ? { artifactId: shareDraft.artifactId } : {}),
        sensitiveResolutions: (shareInspection?.result?.findings ?? []).map((finding) => ({ findingId: finding.id, action: shareSensitiveActions[finding.id] ?? "redact" })),
        permission: sharePermission,
      });
      setShareState({ state: "created", manifest, message: zh ? "分享已创建。接收账号只能打开下面清单中的内容。" : "Share created. The recipient can open only the objects listed below." });
    } catch (caught) {
      setShareState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function changeSharePermission(shareId: string, permission: DesktopSharePermission): Promise<void> {
    setShareCollaborationState({ state: "working", message: zh ? "正在更新权限…" : "Updating permission…" });
    try {
      const updated = await desktopApi.updateSharePermission({ shareId, permission });
      setOutgoingShares((current) => current.map((item) => item.id === updated.id ? updated : item));
      setShareCollaborationState({ state: "completed", message: zh ? "权限已立即更新。" : "Permission updated immediately." });
    } catch (caught) { setShareCollaborationState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); }
  }

  async function confirmShareRevocation(): Promise<void> {
    if (!shareRevokeDraft || shareRevokeConfirmation !== "REVOKE") return;
    const shareId = shareRevokeDraft.id;
    setShareCollaborationState({ state: "working", message: zh ? "正在撤销分享访问权限…" : "Revoking shared access…" });
    try {
      const result = await desktopApi.revokeShare({ shareId, confirmation: "REVOKE" });
      setOutgoingShares((current) => current.map((item) => item.id === shareId ? { ...item, status: "revoked", revokedAt: result.revokedAt, revokedByAccount: item.ownerAccount } : item));
      setShareComments((current) => { const next = { ...current }; delete next[shareId]; return next; });
      setShareRevocationReceipts((current) => ({ ...current, [shareId]: { revokedAt: result.revokedAt, objectsInvalidated: result.objectsInvalidated, auditEntryId: result.auditEntryId } }));
      setShareCollaborationState({ state: "completed", message: zh ? `分享已撤销；${result.objectsInvalidated} 个对象已失效，并已写入安全审计。` : `Share revoked; ${result.objectsInvalidated} object(s) are inaccessible and the security audit was recorded.` });
      setShareRevokeDraft(null);
      setShareRevokeConfirmation("");
    } catch (caught) {
      setShareCollaborationState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function inspectOutgoingShareVersion(share: DesktopShareManifest): Promise<void> {
    setShareVersionState({ state: "scanning", message: zh ? "正在比较已分享版本和当前源文件…" : "Comparing the published version with the current source…" });
    try {
      const inspection = await desktopApi.inspectShareVersion({ shareId: share.id });
      setShareVersionDraft({ share, inspection });
      setShareVersionState(null);
    } catch (caught) {
      setShareVersionState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function publishOutgoingShareVersion(): Promise<void> {
    if (!shareVersionDraft?.inspection.hasChanges) return;
    const { share, inspection } = shareVersionDraft;
    setShareVersionState({ state: "publishing", message: zh ? `正在发布 v${inspection.nextVersion}…` : `Publishing v${inspection.nextVersion}…` });
    try {
      const result = await desktopApi.publishShareVersion({ shareId: share.id, expectedVersion: inspection.currentVersion, sourceFingerprints: inspection.sourceFingerprints });
      setOutgoingShares((current) => current.map((item) => item.id === result.shareId ? result.manifest : item));
      const comments = await desktopApi.listShareComments({ shareId: share.id }).catch(() => []);
      setShareComments((current) => ({ ...current, [share.id]: comments }));
      setShareVersionDraft(null);
      setShareVersionState({ state: "published", message: zh ? `v${result.currentVersion} 已发布；${result.staleCommentCount} 条旧评论已标记为过期。` : `v${result.currentVersion} published; ${result.staleCommentCount} earlier comment(s) are marked stale.` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setShareVersionState({ state: /conflict/i.test(message) || message.includes("冲突") ? "conflict" : "failed", message });
    }
  }

  async function addIncomingComment(share: DesktopShareManifest): Promise<void> {
    const body = shareCommentDrafts[share.id]?.trim(); if (!body) return;
    const defaultObject = share.objects.find((item) => item.objectType === "artifact") ?? share.objects[0];
    const target = shareCommentTargets[share.id] ?? { objectId: defaultObject?.objectId ?? "", anchorType: "whole_result" as const, anchorLabel: defaultObject?.label ?? "" };
    setShareCollaborationState({ state: "working", message: zh ? "正在发送评论…" : "Sending comment…" });
    try {
      const comment = await desktopApi.addShareComment({ shareId: share.id, body, objectId: target.objectId, anchorType: target.anchorType, anchorLabel: target.anchorLabel });
      setShareComments((current) => ({ ...current, [share.id]: [...(current[share.id] ?? []), comment] }));
      setShareCommentDrafts((current) => ({ ...current, [share.id]: "" }));
      setShareCollaborationState({ state: "completed", message: zh ? "评论已发送。" : "Comment sent." });
    } catch (caught) { setShareCollaborationState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); }
  }

  async function openCommentTaskDraft(shareId: string, commentId: string, existing?: DesktopShareCommentTask): Promise<void> {
    setCommentTaskState({ state: "loading", message: zh ? "正在生成任务预览…" : "Preparing task preview…" });
    try {
      const preview = await desktopApi.previewShareCommentTask({ shareId, commentId });
      setCommentTaskDraft(existing ? { ...preview, taskId: existing.id, title: existing.title, instructions: existing.instructions } : preview);
      setCommentTaskState(null);
    } catch (caught) { setCommentTaskState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); }
  }

  async function saveCommentTask(): Promise<void> {
    if (!commentTaskDraft?.title.trim() || !commentTaskDraft.instructions.trim()) return;
    setCommentTaskState({ state: "saving", message: zh ? "正在保存评论任务…" : "Saving comment task…" });
    try {
      const task = commentTaskDraft.taskId
        ? await desktopApi.updateShareCommentTask({ taskId: commentTaskDraft.taskId, title: commentTaskDraft.title.trim(), instructions: commentTaskDraft.instructions.trim() })
        : await desktopApi.createShareCommentTask({ shareId: commentTaskDraft.shareId, commentId: commentTaskDraft.commentId, title: commentTaskDraft.title.trim(), instructions: commentTaskDraft.instructions.trim() });
      setShareCommentTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setCommentTaskDraft(null);
      setCommentTaskState({ state: "completed", message: zh ? "评论任务已保存并进入后台任务列表。" : "Comment task saved to the background task list." });
    } catch (caught) { setCommentTaskState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); }
  }

  async function completeCommentTask(task: DesktopShareCommentTask): Promise<void> {
    setCommentTaskState({ state: "saving", message: zh ? "正在完成任务…" : "Completing task…" });
    try {
      const completed = await desktopApi.completeShareCommentTask({ taskId: task.id });
      setShareCommentTasks((current) => current.map((item) => item.id === completed.id ? completed : item));
      setCommentTaskState({ state: "completed", message: zh ? "任务已完成，可返回原评论核对。" : "Task completed; its original comment remains linked." });
    } catch (caught) { setCommentTaskState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); }
  }

  function openCommentBacklink(commentId: string): void {
    const row = document.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(commentId)}"]`);
    row?.scrollIntoView({ block: "center" });
    row?.focus();
    setCommentTaskState({ state: row ? "completed" : "failed", message: row ? (zh ? "已返回原评论。" : "Returned to the original comment.") : (zh ? "原评论当前不可见。" : "The original comment is not currently visible.") });
  }

  async function continueIncomingShare(share: DesktopShareManifest): Promise<void> {
    setShareCollaborationState({ state: "working", message: zh ? "正在创建继续处理请求…" : "Creating continuation request…" });
    try {
      await desktopApi.continueSharedTask({ shareId: share.id });
      setShareCollaborationState({ state: "completed", message: zh ? "已创建继续处理请求。" : "Continuation requested." });
    } catch (caught) { setShareCollaborationState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); }
  }

  async function openIncomingObject(share: DesktopShareManifest, object: DesktopShareManifest["objects"][number]): Promise<void> {
    setSharedOpenState({ state: "opening", message: zh ? "正在检查权限并打开…" : "Checking permission and opening…" });
    try {
      const result = await desktopApi.openSharedObject({ shareId: share.id, objectType: object.objectType, objectId: object.objectId });
      setSharedOpenState({ state: "opened", result, message: zh ? `已打开“${result.label}”。` : `Opened “${result.label}”.` });
    } catch (caught) {
      setSharedOpenState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function downloadIncomingArtifact(share: DesktopShareManifest, objectId: string): Promise<void> {
    setSharedDownloadState({ state: "downloading", message: zh ? "正在核验分享清单并准备下载…" : "Checking the share manifest and preparing download…" });
    try {
      const result = await desktopApi.downloadSharedArtifact({ shareId: share.id, objectId });
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes]));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSharedDownloadState({ state: "downloaded", message: zh ? `已准备下载“${result.fileName}”，内容已通过分享清单校验。` : `Prepared “${result.fileName}”; its content was authorized by the share manifest.` });
    } catch (caught) {
      setSharedDownloadState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  const artifacts = useMemo(() => {
    const indexed = new Map<string, IndexedTaskArtifact>();
    for (const task of tasks) {
      for (const artifact of task.deliverySummary?.artifacts ?? []) {
        if (!indexed.has(artifact.id)) {
          indexed.set(artifact.id, {
            ...artifact,
            sourceTaskId: task.id,
            sourceTaskTitle: task.title,
            sourceTaskUpdatedAt: task.updatedAt,
            ...(task.workspacePath ? { sourceWorkspacePath: task.workspacePath } : {}),
          });
        }
      }
    }
    return [...indexed.values()].sort((left, right) =>
      right.sourceTaskUpdatedAt.localeCompare(left.sourceTaskUpdatedAt),
    );
  }, [tasks]);
  const scopedArtifacts = workspaceScope === "all"
    ? artifacts
    : artifacts.filter((artifact) =>
        getComparablePath(artifact.sourceWorkspacePath) === getComparablePath(workspacePath),
      );
  const visibleArtifacts = kindFilter === "all"
    ? scopedArtifacts
    : scopedArtifacts.filter((artifact) => artifact.kind === kindFilter);
  const groupedArtifacts = visibleArtifacts.reduce<Array<{
    taskId: string;
    taskTitle: string;
    artifacts: IndexedTaskArtifact[];
  }>>((groups, artifact) => {
    const group = groups.find((item) => item.taskId === artifact.sourceTaskId);
    if (group) group.artifacts.push(artifact);
    else groups.push({
      taskId: artifact.sourceTaskId,
      taskTitle: artifact.sourceTaskTitle,
      artifacts: [artifact],
    });
    return groups;
  }, []);

  useEffect(() => {
    if (loading || groupedArtifacts.length === 0) return;
    const active = document.activeElement;
    if (active?.matches('[data-nav-id="results"]') || active === document.body) {
      window.requestAnimationFrame(() => firstResultActionRef.current?.focus());
    }
  }, [groupedArtifacts.length, loading]);
  const sharePreviewObjects = shareDraft
    ? [
        ...(shareDraft.scope === "complete_task"
          ? [{ objectType: "task" as const, objectId: shareDraft.sourceTaskId, label: shareDraft.title }]
          : []),
        ...artifacts
          .filter((artifact) => artifact.sourceTaskId === shareDraft.sourceTaskId && (shareDraft.scope === "complete_task" || artifact.id === shareDraft.artifactId))
          .map((artifact) => ({ objectType: "artifact" as const, objectId: artifact.id, label: artifact.label, kind: artifact.kind })),
      ]
    : [];
  const routeGroups = scopedArtifacts.filter((artifact) => artifact.analysisRoute).reduce<Array<{
    groupId: string;
    sourcePath: string;
    routes: IndexedTaskArtifact[];
  }>>((groups, artifact) => {
    const route = artifact.analysisRoute!;
    const group = groups.find((item) => item.groupId === route.routeGroupId);
    if (group) group.routes.push(artifact);
    else groups.push({ groupId: route.routeGroupId, sourcePath: route.sourcePath, routes: [artifact] });
    return groups;
  }, []);
  const kinds: Array<"all" | DesktopTaskArtifactLink["kind"]> = [
    "all", "report", "presentation", "file", "folder",
  ];

  async function openArtifact(artifact: IndexedTaskArtifact): Promise<void> {
    setOpenState({
      artifactId: artifact.id,
      state: "opening",
      message: zh ? `正在打开 ${artifact.label}…` : `Opening ${artifact.label}…`,
    });
    try {
      const openError = await desktopApi.openPath(artifact.path);
      setOpenState({
        artifactId: artifact.id,
        state: openError ? "failed" : "opened",
        message: openError
          ? (zh ? `无法打开：${openError}` : `Could not open: ${openError}`)
          : (zh ? `已打开 ${artifact.label}` : `Opened ${artifact.label}`),
      });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setOpenState({
        artifactId: artifact.id,
        state: "failed",
        message: zh ? `无法打开：${detail}` : `Could not open: ${detail}`,
      });
    }
  }

  async function runIndependentReview(
    artifact: IndexedTaskArtifact,
    mode: DesktopIndependentReviewRecord["mode"],
  ): Promise<void> {
    setIndependentReviewState({
      artifactId: artifact.id,
      mode,
      state: "running",
      message: mode === "alternative"
        ? (zh ? "正在换一种方法独立验证…" : "Verifying with an alternative method…")
        : (zh ? "正在从原始来源重新检查…" : "Checking again from original sources…"),
    });
    try {
      const sourceTask = tasks.find((task) => task.id === artifact.sourceTaskId);
      if (!sourceTask?.deliverySummary) throw new Error(zh ? "找不到成果的原始任务记录。" : "The source task record is unavailable.");
      const review = buildIndependentReview(artifact, mode);
      const nextArtifacts = sourceTask.deliverySummary.artifacts.map((item) => item.id === artifact.id
        ? {
            ...item,
            independentReviews: [
              ...(item.independentReviews ?? []).filter((existing) => existing.mode !== mode),
              review,
            ],
          }
        : item);
      const updated = await desktopApi.updateBackgroundTask({
        taskId: sourceTask.id,
        status: sourceTask.status,
        deliverySummary: { ...sourceTask.deliverySummary, artifacts: nextArtifacts },
      });
      setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
      setIndependentReviewState({
        artifactId: artifact.id,
        mode,
        state: "completed",
        message: mode === "alternative"
          ? (zh ? "换一种方法验证已完成，已保存独立复核记录。" : "Alternative verification completed and saved.")
          : (zh ? "再检查已完成，已保存独立复核记录。" : "Repeat review completed and saved."),
      });
    } catch (caught) {
      setIndependentReviewState({
        artifactId: artifact.id,
        mode,
        state: "failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  async function openConclusionEvidence(evidence: Pick<DesktopCitationRecord, "id" | "sourcePath" | "locatorType" | "locator">): Promise<void> {
    setEvidenceOpenState({ evidenceId: evidence.id, state: "opening", message: zh ? "正在打开依据…" : "Opening evidence…" });
    try {
      if (evidence.locatorType === "pdf_page") {
        const page = Number(evidence.locator.match(/\d+/)?.[0]);
        if (!Number.isInteger(page) || page < 1) throw new Error(zh ? "页码无效" : "Invalid page number");
        await desktopApi.openPdfPage({ path: evidence.sourcePath, page });
      } else {
        const error = await desktopApi.openPath(evidence.sourcePath);
        if (error) throw new Error(error);
      }
      setEvidenceOpenState({ evidenceId: evidence.id, state: "opened", message: zh ? `已打开依据：${evidence.locator}` : `Opened evidence: ${evidence.locator}` });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setEvidenceOpenState({ evidenceId: evidence.id, state: "failed", message: zh ? `无法打开依据：${detail}` : `Could not open evidence: ${detail}` });
    }
  }

  async function createArtifactVersions(artifact: IndexedTaskArtifact): Promise<void> {
    if (!artifact.sourceWorkspacePath) {
      setVersionState({
        artifactId: artifact.id,
        state: "failed",
        message: zh ? "无法生成：来源任务没有工作区。" : "Could not generate: the source task has no workspace.",
      });
      return;
    }
    const requestId = `artifact-versions-${crypto.randomUUID()}`;
    const runId = requestId;
    setVersionState({
      artifactId: artifact.id,
      state: "starting",
      message: zh ? "正在创建五种成果版本…" : "Creating five result versions…",
      requestId,
    });
    let unsubscribe: (() => void) | undefined;
    try {
      const thread = await desktopApi.createThread({
        kind: "agent_run",
        title: zh ? `生成多种版本：${artifact.label}` : `Create result versions: ${artifact.label}`,
        workspacePath: artifact.sourceWorkspacePath,
      });
      unsubscribe = desktopApi.onAgentRunEvent((event) => {
        if (event.requestId !== requestId) return;
        if (event.type === "done") {
          setVersionState({
            artifactId: artifact.id,
            state: "completed",
            message: zh ? "五种版本已生成，可在成果中心查看。" : "Five versions created. They are available in Results center.",
            requestId,
          });
          unsubscribe?.();
        } else if (event.type === "error" || event.type === "aborted") {
          setVersionState({
            artifactId: artifact.id,
            state: "failed",
            message: event.error || event.content || (zh ? "版本生成未完成。" : "Version generation did not complete."),
            requestId,
          });
          unsubscribe?.();
        } else {
          setVersionState({
            artifactId: artifact.id,
            state: "running",
            message: zh ? "正在生成并核对五种版本…" : "Generating and checking five versions…",
            requestId,
          });
        }
      });
      await desktopApi.startAgentRun({
        requestId,
        runId,
        threadId: thread.id,
        sessionId: thread.id,
        task: buildArtifactVersionTask(artifact),
        executionDepth: "standard",
        workspacePath: artifact.sourceWorkspacePath,
        files: [{ kind: "file", path: artifact.path, name: artifact.label }],
        teamConfig: { preset: "general-collaboration" },
        metadata: {
          source: "windows-results-center-versioning",
          source_artifact_id: artifact.id,
          source_task_id: artifact.sourceTaskId,
          output_versions: ["one_page_summary", "full_report", "presentation_outline", "email", "english"],
          required_numeric_consistency: 100,
        },
      });
    } catch (caught) {
      unsubscribe?.();
      const detail = caught instanceof Error ? caught.message : String(caught);
      setVersionState({
        artifactId: artifact.id,
        state: "failed",
        message: zh ? `无法生成版本：${detail}` : `Could not create versions: ${detail}`,
        requestId,
      });
    }
  }

  async function previewArtifact(artifact: IndexedTaskArtifact): Promise<void> {
    if (!artifact.sourceWorkspacePath) {
      setPreviewState({ artifact, state: "failed", message: zh ? "无法预览：来源任务没有工作区。" : "Could not preview: the source task has no workspace." });
      return;
    }
    setLocalEditScope(null);
    setPreviewState({ artifact, state: "loading", message: zh ? "正在准备预览…" : "Preparing preview…" });
    try {
      const preview = await desktopApi.previewWorkspaceFile({
        workspacePath: artifact.sourceWorkspacePath,
        path: artifact.path,
        maxBytes: 500_000,
      });
      if (preview.kind === "table" && preview.columns && preview.columns.length >= 2) {
        const anomalyColumn = preview.columns.find((column) => /anomaly|异常/i.test(column)) || "";
        const yColumn = preview.columns.find((column, index) => index > 0 && column !== anomalyColumn) || preview.columns[1];
        setChartConfig({
          xColumn: preview.columns[0], yColumn, anomalyColumn,
          unit: /tbps/i.test(yColumn) ? "Tbps" : (zh ? "数值" : "value"), legend: yColumn,
        });
      } else setChartConfig(null);
      setPreviewState({ artifact, state: "ready", preview, message: preview.message || (zh ? "预览已就绪" : "Preview ready") });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setPreviewState({ artifact, state: "failed", message: zh ? `无法预览：${detail}` : `Could not preview: ${detail}` });
    }
  }

  function captureTextSelection(): void {
    const text = window.getSelection()?.toString().trim() || "";
    if (text) setLocalEditScope({ type: "text", label: zh ? `选中文字（${text.length} 字）` : `Selected text (${text.length} chars)`, text });
  }

  async function generateLocalEdit(): Promise<void> {
    if (!previewState?.preview || !localEditScope || !previewState.artifact.sourceWorkspacePath) return;
    const artifact = previewState.artifact;
    const requestId = `artifact-local-edit-${crypto.randomUUID()}`;
    const action = localEditAction(previewState.preview.kind);
    setEditState({ artifactId: artifact.id, state: "starting", message: zh ? "正在创建局部修改任务…" : "Starting localized edit…" });
    let unsubscribe: (() => void) | undefined;
    try {
      const thread = await desktopApi.createThread({ kind: "agent_run", title: zh ? `局部修改：${artifact.label}` : `Localized edit: ${artifact.label}`, workspacePath: artifact.sourceWorkspacePath });
      unsubscribe = desktopApi.onAgentRunEvent((event) => {
        if (event.requestId !== requestId) return;
        if (event.type === "done") {
          setEditState({ artifactId: artifact.id, state: "completed", message: zh ? "修改版已生成，原成果保持不变。" : "Edited version created; the original is unchanged." });
          setPreviewState(null);
          unsubscribe?.();
        } else if (event.type === "error" || event.type === "aborted") {
          setEditState({ artifactId: artifact.id, state: "failed", message: event.error || event.content || (zh ? "局部修改未完成。" : "Localized edit did not complete.") });
          unsubscribe?.();
        } else {
          setEditState({ artifactId: artifact.id, state: "running", message: zh ? "正在只修改选中范围…" : "Editing only the selected scope…" });
        }
      });
      await desktopApi.startAgentRun({
        requestId, runId: requestId, threadId: thread.id, sessionId: thread.id,
        task: buildLocalEditTask(artifact, previewState.preview, localEditScope), executionDepth: "standard",
        workspacePath: artifact.sourceWorkspacePath,
        files: [{ kind: "file", path: artifact.path, name: artifact.label }],
        teamConfig: { preset: "general-collaboration" },
        metadata: {
          source: "windows-results-center-local-edit", source_artifact_id: artifact.id,
          source_task_id: artifact.sourceTaskId, source_path: artifact.path,
          scope_type: localEditScope.type, scope_label: localEditScope.label,
          selected_text: localEditScope.text || "", edit_action: action,
          preserve_unselected: true, create_new_version: true,
        },
      });
    } catch (caught) {
      unsubscribe?.();
      setEditState({ artifactId: artifact.id, state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function compareArtifact(artifact: IndexedTaskArtifact): Promise<void> {
    if (!artifact.editLineage || !artifact.sourceWorkspacePath) return;
    setCompareState({ artifact, state: "loading", message: zh ? "正在读取原版和修改版…" : "Loading original and edited versions…" });
    try {
      const [source, edited] = await Promise.all([
        desktopApi.previewWorkspaceFile({ workspacePath: artifact.sourceWorkspacePath, path: artifact.editLineage.sourcePath, maxBytes: 500_000 }),
        desktopApi.previewWorkspaceFile({ workspacePath: artifact.sourceWorkspacePath, path: artifact.path, maxBytes: 500_000 }),
      ]);
      setCompareState({ artifact, state: "ready", source, edited, message: zh ? "新旧版本已就绪" : "Comparison ready" });
    } catch (caught) {
      setCompareState({ artifact, state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function generateCheckedChart(): Promise<void> {
    if (!previewState?.preview || !chartConfig || !previewState.artifact.sourceWorkspacePath) return;
    const artifact = previewState.artifact;
    const xIndex = previewState.preview.columns?.indexOf(chartConfig.xColumn) ?? -1;
    const yIndex = previewState.preview.columns?.indexOf(chartConfig.yColumn) ?? -1;
    const points = (previewState.preview.rows ?? []).map((row) => ({ x: Number(row[xIndex]), y: Number(row[yIndex]) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!points.length) return;
    const xValues = points.map((point) => point.x);
    const yValues = points.map((point) => point.y);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(0, ...yValues);
    const yMax = Math.ceil(Math.max(...yValues));
    const requestId = `artifact-chart-${crypto.randomUUID()}`;
    setChartState({ artifactId: artifact.id, state: "starting", message: zh ? "正在生成并核对图表…" : "Generating and checking chart…" });
    let unsubscribe: (() => void) | undefined;
    try {
      const thread = await desktopApi.createThread({ kind: "agent_run", title: zh ? `生成核对图表：${artifact.label}` : `Generate checked chart: ${artifact.label}`, workspacePath: artifact.sourceWorkspacePath });
      unsubscribe = desktopApi.onAgentRunEvent((event) => {
        if (event.requestId !== requestId) return;
        if (event.type === "done") {
          setChartState({ artifactId: artifact.id, state: "completed", message: zh ? "图表已生成，自动一致性结果已登记。" : "Chart created with consistency results recorded." });
          setPreviewState(null); unsubscribe?.();
        } else if (event.type === "error" || event.type === "aborted") {
          setChartState({ artifactId: artifact.id, state: "failed", message: event.error || event.content || (zh ? "图表生成未完成。" : "Chart generation did not complete.") }); unsubscribe?.();
        } else setChartState({ artifactId: artifact.id, state: "running", message: zh ? "正在逐点核对坐标和数据…" : "Checking coordinates and data point by point…" });
      });
      await desktopApi.startAgentRun({
        requestId, runId: requestId, threadId: thread.id, sessionId: thread.id,
        task: buildChartTask(artifact, chartConfig), executionDepth: "standard", workspacePath: artifact.sourceWorkspacePath,
        files: [{ kind: "file", path: artifact.path, name: artifact.label }], teamConfig: { preset: "general-collaboration" },
        metadata: {
          source: "windows-results-center-chart-generation", source_artifact_id: artifact.id, source_path: artifact.path,
          x_column: chartConfig.xColumn, y_column: chartConfig.yColumn, anomaly_column: chartConfig.anomalyColumn,
          unit: chartConfig.unit, legend: chartConfig.legend, x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax,
          plot_left: 60, plot_right: 540, plot_top: 40, plot_bottom: 340,
        },
      });
    } catch (caught) {
      unsubscribe?.();
      setChartState({ artifactId: artifact.id, state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function startAlternativeRoute(artifact: IndexedTaskArtifact): Promise<void> {
    if (!artifact.chartQuality || !artifact.sourceWorkspacePath || artifact.chartQuality.status !== "passed") return;
    const sourceTask = tasks.find((task) => task.id === artifact.sourceTaskId);
    if (!sourceTask?.deliverySummary) return;
    const sourcePath = artifact.chartQuality.sourcePath;
    const sourcePreview = await desktopApi.previewWorkspaceFile({ workspacePath: artifact.sourceWorkspacePath, path: sourcePath, maxBytes: 250_000 }).catch(() => null);
    const insights = buildAnalysisRouteInsights(sourcePreview?.content || "", artifact.chartQuality, zh);
    const routeGroupId = artifact.analysisRoute?.routeGroupId || `analysis-${reviewFingerprint(sourcePath)}`;
    const inputFingerprint = reviewFingerprint([
      sourcePath,
      artifact.chartQuality.xAxis,
      artifact.chartQuality.yAxis,
      artifact.chartQuality.unit,
      artifact.chartQuality.legend,
      artifact.chartQuality.pointsExpected,
      artifact.chartQuality.anomaliesExpected,
    ].join("|"));
    const createdAt = new Date().toISOString();
    const originalRoute: NonNullable<DesktopTaskArtifactLink["analysisRoute"]> = artifact.analysisRoute ?? {
      routeGroupId,
      routeId: `${routeGroupId}-original`,
      role: "original",
      method: zh ? "时间顺序趋势分析" : "Chronological trend analysis",
      inputSummary: insights.inputSummary,
      keyConclusion: insights.originalConclusion,
      risk: insights.originalRisk,
      recommendedUse: insights.originalUse,
      status: "completed",
      selected: false,
      sourceArtifactId: artifact.id,
      sourcePath,
      inputFingerprint,
      createdAt,
    };
    setRouteState({ artifactId: artifact.id, state: "starting", message: zh ? "正在保留当前结果并建立另一条路线…" : "Preserving this result and starting another route…" });
    let unsubscribe: (() => void) | undefined;
    try {
      if (!artifact.analysisRoute) {
        const nextArtifacts = sourceTask.deliverySummary.artifacts.map((item) => item.id === artifact.id ? { ...item, analysisRoute: originalRoute } : item);
        const updated = await desktopApi.updateBackgroundTask({
          taskId: sourceTask.id,
          status: sourceTask.status,
          deliverySummary: { ...sourceTask.deliverySummary, artifacts: nextArtifacts },
        });
        setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
      }
      const requestId = `artifact-route-${crypto.randomUUID()}`;
      const thread = await desktopApi.createThread({ kind: "agent_run", title: zh ? `另一路线：${artifact.label}` : `Alternative route: ${artifact.label}`, workspacePath: artifact.sourceWorkspacePath });
      unsubscribe = desktopApi.onAgentRunEvent((event) => {
        if (event.requestId !== requestId) return;
        if (event.type === "done") {
          setRouteState({ artifactId: artifact.id, state: "completed", message: zh ? "两条路线均已保留，可分别打开。" : "Both routes are preserved and can be opened separately." });
          unsubscribe?.();
        } else if (event.type === "error" || event.type === "aborted") {
          setRouteState({ artifactId: artifact.id, state: "failed", message: event.error || event.content || (zh ? "另一路线未完成，原结果保持不变。" : "The alternative route did not complete; the original is unchanged.") });
          unsubscribe?.();
        } else {
          setRouteState({ artifactId: artifact.id, state: "running", message: zh ? "正在用异常点优先方法分析，原路线保持可用…" : "Running anomaly-first analysis; the original route stays available…" });
        }
      });
      const quality = artifact.chartQuality;
      await desktopApi.startAgentRun({
        requestId,
        runId: requestId,
        threadId: thread.id,
        sessionId: thread.id,
        task: buildAlternativeRouteTask(artifact, { xColumn: quality.xAxis, yColumn: quality.yAxis, anomalyColumn: "anomaly", unit: quality.unit, legend: quality.legend }),
        executionDepth: "standard",
        workspacePath: artifact.sourceWorkspacePath,
        files: [{ kind: "file", path: sourcePath, name: sourcePath.split(/[\\/]/).pop() || "data.csv" }],
        teamConfig: { preset: "general-collaboration" },
        metadata: {
          source: "windows-results-center-analysis-route",
          source_artifact_id: artifact.id,
          source_path: sourcePath,
          original_artifact_path: artifact.path,
          route_group_id: routeGroupId,
          route_id: `${routeGroupId}-alternative`,
          route_role: "alternative",
          route_method: zh ? "异常点优先分段分析" : "Anomaly-first segmented analysis",
          route_input_summary: insights.inputSummary,
          route_key_conclusion: insights.alternativeConclusion,
          route_risk: insights.alternativeRisk,
          route_recommended_use: insights.alternativeUse,
          route_status: "completed",
          route_selected: false,
          route_created_at: createdAt,
          input_fingerprint: inputFingerprint,
          preserve_original: true,
          x_column: quality.xAxis,
          y_column: quality.yAxis,
          anomaly_column: "anomaly",
          unit: quality.unit,
          legend: quality.legend,
          x_min: 1,
          x_max: quality.pointsExpected,
          y_min: 0,
          y_max: 10,
          plot_left: 60,
          plot_right: 540,
          plot_top: 40,
          plot_bottom: 340,
        },
      });
    } catch (caught) {
      unsubscribe?.();
      setRouteState({ artifactId: artifact.id, state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function applyArtifactAnomalyDecision(artifact: IndexedTaskArtifact): Promise<void> {
    const choice = anomalyChoices[artifact.id];
    const sourcePath = artifact.anomalyDecision?.sourcePath || artifact.chartQuality?.sourcePath;
    if (!choice || !sourcePath || !artifact.sourceWorkspacePath) return;
    const sourceTask = tasks.find((task) => task.id === artifact.sourceTaskId);
    if (!sourceTask?.deliverySummary) return;
    setAnomalyDecisionState({ artifactId: artifact.id, state: "applying", message: zh ? "正在按所选方式生成独立结果…" : "Applying the selected option to independent outputs…" });
    try {
      const result = await desktopApi.applyAnomalyDecision({
        workspacePath: artifact.sourceWorkspacePath,
        sourcePath,
        anomalyColumn: artifact.anomalyDecision?.anomalyColumn || "anomaly",
        decision: choice,
      });
      const resultArtifacts: DesktopTaskArtifactLink[] = [
        ...result.outputs.map((output) => ({
          id: `anomaly-output-${reviewFingerprint(output.path)}`,
          label: output.path.split(/[\\/]/).pop() || output.path,
          path: output.path,
          kind: "file" as const,
        })),
        {
          id: `anomaly-receipt-${reviewFingerprint(result.receiptPath)}`,
          label: result.receiptPath.split(/[\\/]/).pop() || result.receiptPath,
          path: result.receiptPath,
          kind: "report" as const,
        },
      ];
      const replacedIds = new Set(resultArtifacts.map((item) => item.id));
      const nextArtifacts = sourceTask.deliverySummary.artifacts
        .filter((item) => !replacedIds.has(item.id))
        .map((item) => item.id === artifact.id ? { ...item, anomalyDecision: result } : item)
        .concat(resultArtifacts);
      const updated = await desktopApi.updateBackgroundTask({
        taskId: sourceTask.id,
        status: sourceTask.status,
        deliverySummary: { ...sourceTask.deliverySummary, artifacts: nextArtifacts },
      });
      setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
      setAnomalyDecisionState({ artifactId: artifact.id, state: "completed", message: result.resultSummary });
    } catch (caught) {
      setAnomalyDecisionState({ artifactId: artifact.id, state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function selectAnalysisRoute(group: { groupId: string; routes: IndexedTaskArtifact[] }, selectedArtifact: IndexedTaskArtifact): Promise<void> {
    const selectedRoute = selectedArtifact.analysisRoute;
    if (!selectedRoute) return;
    setRouteSelectionState({ groupId: group.groupId, routeId: selectedRoute.routeId, state: "saving", message: zh ? "正在保存所选版本…" : "Saving the selected version…" });
    try {
      const selectedAt = new Date().toISOString();
      const affectedTaskIds = [...new Set(group.routes.map((route) => route.sourceTaskId))];
      const updatedTasks: DesktopBackgroundTask[] = [];
      for (const taskId of affectedTaskIds) {
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task?.deliverySummary) throw new Error(zh ? "找不到路线对应的成果记录。" : "The route result record could not be found.");
        const artifacts = task.deliverySummary.artifacts.map((item) => {
          if (item.analysisRoute?.routeGroupId !== group.groupId) return item;
          const selected = item.analysisRoute.routeId === selectedRoute.routeId;
          return { ...item, analysisRoute: { ...item.analysisRoute, selected, ...(selected ? { selectedAt } : { selectedAt: undefined }) } };
        });
        updatedTasks.push(await desktopApi.updateBackgroundTask({ taskId: task.id, status: task.status, deliverySummary: { ...task.deliverySummary, artifacts } }));
      }
      const byId = new Map(updatedTasks.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => byId.get(task.id) || task));
      setRouteSelectionState({ groupId: group.groupId, routeId: selectedRoute.routeId, state: "selected", message: zh ? `已选择：${selectedRoute.method}` : `Selected: ${selectedRoute.method}` });
    } catch (caught) {
      setRouteSelectionState({ groupId: group.groupId, routeId: selectedRoute.routeId, state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function saveArtifactAs(artifact: IndexedTaskArtifact): Promise<void> {
    if (!artifact.sourceWorkspacePath) {
      setSaveState({ artifactId: artifact.id, state: "failed", message: zh ? "无法另存：来源任务没有工作区。" : "Could not save: the source task has no workspace." });
      return;
    }
    setSaveState({ artifactId: artifact.id, state: "saving", message: zh ? "正在另存并校验文件…" : "Saving and verifying file…" });
    try {
      const result = await desktopApi.saveWorkspaceFileAs({
        workspacePath: artifact.sourceWorkspacePath,
        path: artifact.path,
        suggestedName: artifact.label,
      });
      setSaveState({
        artifactId: artifact.id,
        state: result.canceled ? "canceled" : "saved",
        message: result.canceled
          ? (zh ? "已取消另存，原成果未改变。" : "Save canceled; the original result is unchanged.")
          : (zh ? `已另存并通过完整性校验：${result.destinationPath}` : `Saved with integrity verified: ${result.destinationPath}`),
      });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setSaveState({ artifactId: artifact.id, state: "failed", message: zh ? `无法另存：${detail}` : `Could not save: ${detail}` });
    }
  }

  function kindLabel(kind: "all" | DesktopTaskArtifactLink["kind"]): string {
    const labels = zh
      ? { all: "全部", report: "报告", presentation: "演示文稿", file: "文件", folder: "文件夹" }
      : { all: "All", report: "Reports", presentation: "Presentations", file: "Files", folder: "Folders" };
    return labels[kind];
  }

  return (
    <section className="results-center-view" data-testid="results-center-view" data-route="results">
      <header>
        <div>
          <h2>{zh ? "成果库" : "Results Library"}</h2>
          <p>{zh ? "集中查看、复核和继续使用任务产生的文件。" : "Review, verify, and continue working with files produced by tasks."}</p>
        </div>
        <span role="status">{loading ? (zh ? "正在同步…" : "Syncing…") : (zh ? `${scopedArtifacts.length} 个成果` : `${scopedArtifacts.length} results`)}</span>
      </header>
      <div className="results-workspace-scope" role="group" aria-label={zh ? "成果范围" : "Results scope"}>
        <button type="button" aria-pressed={workspaceScope === "workspace"} onClick={() => setWorkspaceScope("workspace")}>
          {workspaceName}
        </button>
        <button type="button" aria-pressed={workspaceScope === "all"} onClick={() => setWorkspaceScope("all")}>
          {zh ? "全部工作区" : "All workspaces"}
        </button>
      </div>
      <nav className="results-kind-index" aria-label={zh ? "按成果类型筛选" : "Filter by result type"}>
        {kinds.map((kind) => (
          <button key={kind} type="button" data-kind={kind} aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)}>
            {kindLabel(kind)}
            <span>{kind === "all" ? scopedArtifacts.length : scopedArtifacts.filter((artifact) => artifact.kind === kind).length}</span>
          </button>
        ))}
      </nav>
      {outgoingShares.length ? (
        <section className="results-shared-inbox" data-testid="outgoing-shares" aria-label={zh ? "我发出的分享" : "Shares I sent"}>
          <header><div><strong>{zh ? "我发出的分享" : "Shares I sent"}</strong><small>{zh ? "权限修改后会立即影响接收账号" : "Permission changes take effect immediately"}</small></div><span>{outgoingShares.length}</span></header>
          {outgoingShares.map((share) => {
            const comments = shareComments[share.id] ?? [];
            const linkedTasks = shareCommentTasks.filter((task) => task.shareId === share.id);
            return <article key={share.id} data-testid="outgoing-share-card" data-share-id={share.id} data-share-status={share.status}>
              <div><strong>{share.objects.map((item) => item.label).join("、")}</strong><small>{share.recipientAccount}</small><span className="share-version-badge" data-testid="share-version-badge">v{share.version} · {zh ? "当前版本" : "Current version"}</span>{share.status === "revoked" ? <span className="share-revoked-badge" data-testid="share-revoked-badge">{zh ? "已撤销" : "Revoked"}</span> : null}</div>
              {share.status === "active" ? <label className="share-permission-control"><span>{zh ? "权限" : "Permission"}</span><select data-testid="outgoing-share-permission" value={share.permission} onChange={(event) => void changeSharePermission(share.id, event.target.value as DesktopSharePermission)}><option value="view">{zh ? "只查看" : "View only"}</option><option value="comment">{zh ? "可评论" : "Can comment"}</option><option value="continue">{zh ? "可继续处理" : "Can continue"}</option></select></label> : null}
              {share.status === "active" ? <button type="button" className="share-version-check" data-testid="share-version-check" onClick={() => void inspectOutgoingShareVersion(share)}>{zh ? "检查并发布新版本" : "Check and publish new version"}</button> : null}
              {share.status === "active" && comments.length ? <section className="outgoing-share-comments" data-testid="outgoing-share-comments"><strong>{zh ? "收到的评论" : "Received comments"}</strong><ul>{comments.map((comment) => {
                const linked = linkedTasks.find((task) => task.commentId === comment.id);
                return <li key={comment.id} tabIndex={-1} data-testid="outgoing-share-comment" data-comment-id={comment.id} data-comment-object-id={comment.target.objectId} data-comment-anchor-type={comment.target.anchorType} data-comment-version={comment.version} data-comment-version-status={comment.versionStatus}><div><small>{comment.authorAccount} · {comment.target.objectLabel} · v{comment.version}</small><b>{comment.target.anchorLabel}</b>{comment.versionStatus === "stale" ? <em className="share-comment-stale" data-testid="share-comment-stale">{zh ? `过期评论：当前为 v${share.version}` : `Stale comment: current is v${share.version}`}</em> : null}<p>{comment.body}</p></div>{linked ? <span data-testid="comment-task-linked">{linked.status === "completed" ? (zh ? "任务已完成" : "Task completed") : (zh ? "已转为任务" : "Task created")}</span> : <button type="button" data-testid="comment-to-task" onClick={() => void openCommentTaskDraft(share.id, comment.id)}>{zh ? "转为任务" : "Turn into task"}</button>}</li>;
              })}</ul></section> : null}
              {linkedTasks.length ? <section className="share-comment-tasks" data-testid="share-comment-tasks"><strong>{zh ? "评论任务" : "Comment tasks"}</strong>{linkedTasks.map((task) => <article key={task.id} data-testid="share-comment-task-card" data-task-id={task.id} data-task-status={task.status}><div><b>{task.title}</b><small>{task.target.objectLabel} · {task.target.anchorLabel}</small><p>{task.instructions}</p></div><div><button type="button" data-testid="comment-task-backlink" onClick={() => openCommentBacklink(task.commentId)}>{zh ? "查看原评论" : "Original comment"}</button>{task.status === "ready" ? <><button type="button" data-testid="comment-task-edit" onClick={() => void openCommentTaskDraft(task.shareId, task.commentId, task)}>{zh ? "修改任务" : "Edit task"}</button><button type="button" data-testid="comment-task-complete" onClick={() => void completeCommentTask(task)}>{zh ? "标记完成" : "Mark complete"}</button></> : <span>{zh ? "已完成" : "Completed"}</span>}</div></article>)}</section> : null}
              {share.status === "active" ? <button type="button" className="share-revoke-button" data-testid="share-revoke" onClick={() => { setShareRevokeDraft(share); setShareRevokeConfirmation(""); }}>{zh ? "撤销分享" : "Revoke share"}</button> : <div className="share-revocation-receipt" data-testid="share-revocation-receipt"><strong>{zh ? "访问已失效" : "Access invalidated"}</strong><small>{share.revokedAt ? new Date(share.revokedAt).toLocaleString() : ""}</small><span>{zh ? `${share.objects.length} 个对象不可再打开或下载` : `${share.objects.length} object(s) can no longer be opened or downloaded`}</span>{shareRevocationReceipts[share.id] ? <code data-testid="share-revocation-audit-id">{shareRevocationReceipts[share.id].auditEntryId}</code> : null}</div>}
            </article>;
          })}
        </section>
      ) : null}
      {incomingShares.length ? (
        <section className="results-shared-inbox" data-testid="shared-inbox" aria-label={zh ? "收到的分享" : "Shared with me"}>
          <header><div><strong>{zh ? "收到的分享" : "Shared with me"}</strong><small>{zh ? "只显示分享清单中授权给当前账号的内容" : "Only objects authorized to the signed-in account are shown"}</small></div><span>{incomingShares.length}</span></header>
          {incomingShares.map((share) => (
            <article key={share.id} data-testid="incoming-share-card" data-share-id={share.id} data-share-scope={share.scope} data-share-permission={share.permission} data-share-version={share.version}>
              <div><strong>{share.scope === "result_only" ? (zh ? "成果分享" : "Result share") : (zh ? "完整任务分享" : "Complete task share")}</strong><small>{zh ? `来自 ${share.ownerAccount}` : `From ${share.ownerAccount}`}</small><span className="share-version-badge" data-testid="share-version-badge">v{share.version} · {zh ? "当前版本" : "Current version"}</span><span className="share-permission-badge" data-testid="share-permission-badge">{share.permission === "view" ? (zh ? "只查看" : "View only") : share.permission === "comment" ? (zh ? "可评论" : "Can comment") : (zh ? "可继续处理" : "Can continue")}</span></div>
              <ul>{share.objects.map((object) => <li key={`${object.objectType}:${object.objectId}`} data-shared-object-type={object.objectType} data-shared-object-id={object.objectId}><span>{object.objectType === "task" ? (zh ? "任务" : "Task") : (zh ? "成果" : "Result")} · {object.label}</span><span className="shared-object-actions"><button type="button" data-testid="shared-object-open" onClick={() => void openIncomingObject(share, object)}>{zh ? "打开" : "Open"}</button>{object.objectType === "artifact" ? <button type="button" data-testid="shared-artifact-download" onClick={() => void downloadIncomingArtifact(share, object.objectId)}>{zh ? "下载" : "Download"}</button> : null}</span></li>)}</ul>
              {share.permission !== "view" ? <div className="share-comment-composer"><ul data-testid="share-comments">{(shareComments[share.id] ?? []).map((comment) => <li key={comment.id} data-comment-id={comment.id} data-comment-version={comment.version} data-comment-version-status={comment.versionStatus}><span>{comment.authorAccount} · v{comment.version} · {comment.target.anchorLabel}</span>{comment.versionStatus === "stale" ? <em className="share-comment-stale" data-testid="share-comment-stale">{zh ? `过期评论：当前为 v${share.version}` : `Stale comment: current is v${share.version}`}</em> : null}<p>{comment.body}</p></li>)}</ul><div className="share-comment-target"><label><span>{zh ? "评论对象" : "Comment target"}</span><select data-testid="share-comment-object" value={shareCommentTargets[share.id]?.objectId ?? (share.objects.find((item) => item.objectType === "artifact") ?? share.objects[0])?.objectId ?? ""} onChange={(event) => setShareCommentTargets((current) => ({ ...current, [share.id]: { objectId: event.target.value, anchorType: current[share.id]?.anchorType ?? "whole_result", anchorLabel: current[share.id]?.anchorLabel ?? "" } }))}>{share.objects.map((object) => <option key={object.objectId} value={object.objectId}>{object.label}</option>)}</select></label><label><span>{zh ? "位置类型" : "Location type"}</span><select data-testid="share-comment-anchor-type" value={shareCommentTargets[share.id]?.anchorType ?? "whole_result"} onChange={(event) => setShareCommentTargets((current) => ({ ...current, [share.id]: { objectId: current[share.id]?.objectId ?? (share.objects.find((item) => item.objectType === "artifact") ?? share.objects[0])?.objectId ?? "", anchorType: event.target.value as DesktopShareCommentAnchorType, anchorLabel: current[share.id]?.anchorLabel ?? "" } }))}><option value="whole_result">{zh ? "整个成果" : "Whole result"}</option><option value="paragraph">{zh ? "段落" : "Paragraph"}</option><option value="chart">{zh ? "图表" : "Chart"}</option></select></label><label><span>{zh ? "具体位置" : "Exact location"}</span><input data-testid="share-comment-anchor-label" placeholder={zh ? "例如：第 42 页带宽图" : "e.g. p.42 bandwidth chart"} value={shareCommentTargets[share.id]?.anchorLabel ?? ""} onChange={(event) => setShareCommentTargets((current) => ({ ...current, [share.id]: { objectId: current[share.id]?.objectId ?? (share.objects.find((item) => item.objectType === "artifact") ?? share.objects[0])?.objectId ?? "", anchorType: current[share.id]?.anchorType ?? "whole_result", anchorLabel: event.target.value } }))} /></label></div><label><span>{zh ? "评论" : "Comment"}</span><input data-testid="share-comment-input" value={shareCommentDrafts[share.id] ?? ""} onChange={(event) => setShareCommentDrafts((current) => ({ ...current, [share.id]: event.target.value }))} /></label><button type="button" data-testid="share-comment-send" disabled={!shareCommentDrafts[share.id]?.trim()} onClick={() => void addIncomingComment(share)}>{zh ? "发送评论" : "Send comment"}</button></div> : null}
              {share.permission === "continue" ? <button type="button" data-testid="share-continue" onClick={() => void continueIncomingShare(share)}>{zh ? "继续处理" : "Continue processing"}</button> : null}
            </article>
          ))}
          {sharedOpenState ? <output data-testid="shared-object-open-status" data-state={sharedOpenState.state}>{sharedOpenState.message}</output> : null}
          {sharedDownloadState ? <output data-testid="shared-artifact-download-status" data-state={sharedDownloadState.state}>{sharedDownloadState.message}</output> : null}
          {shareCollaborationState ? <output data-testid="share-collaboration-status" data-state={shareCollaborationState.state}>{shareCollaborationState.message}</output> : null}
        </section>
      ) : null}
      {commentTaskDraft ? <section className="comment-task-dialog" role="dialog" aria-modal="true" data-testid="comment-task-dialog"><header><div><strong>{commentTaskDraft.taskId ? (zh ? "修改评论任务" : "Edit comment task") : (zh ? "评论转为任务" : "Turn comment into task")}</strong><small>{commentTaskDraft.target.objectLabel} · {commentTaskDraft.target.anchorLabel}</small></div></header><blockquote data-testid="comment-task-source-context"><b>{commentTaskDraft.commentAuthorAccount}</b><p>{commentTaskDraft.commentBody}</p></blockquote><label><span>{zh ? "任务标题" : "Task title"}</span><input data-testid="comment-task-title" value={commentTaskDraft.title} onChange={(event) => setCommentTaskDraft((current) => current ? { ...current, title: event.target.value } : null)} /></label><label><span>{zh ? "任务说明" : "Task instructions"}</span><textarea data-testid="comment-task-instructions" value={commentTaskDraft.instructions} onChange={(event) => setCommentTaskDraft((current) => current ? { ...current, instructions: event.target.value } : null)} /></label><div><button type="button" onClick={() => setCommentTaskDraft(null)}>{zh ? "取消" : "Cancel"}</button><button type="button" data-testid="comment-task-save" disabled={!commentTaskDraft.title.trim() || !commentTaskDraft.instructions.trim()} onClick={() => void saveCommentTask()}>{commentTaskDraft.taskId ? (zh ? "保存修改" : "Save changes") : (zh ? "创建任务" : "Create task")}</button></div></section> : null}
      {commentTaskState ? <output data-testid="comment-task-status" data-state={commentTaskState.state}>{commentTaskState.message}</output> : null}
      {shareVersionDraft ? <section className="share-version-dialog" role="dialog" aria-modal="true" aria-labelledby="share-version-title" data-testid="share-version-dialog"><header><div><strong id="share-version-title">{zh ? `发布共享版本 v${shareVersionDraft.inspection.nextVersion}` : `Publish shared version v${shareVersionDraft.inspection.nextVersion}`}</strong><small>{shareVersionDraft.share.recipientAccount} · {zh ? `当前 v${shareVersionDraft.inspection.currentVersion}` : `Current v${shareVersionDraft.inspection.currentVersion}`}</small></div></header><p>{shareVersionDraft.inspection.hasChanges ? (zh ? "检测到源成果变化。发布会创建不可变快照，不会覆盖之前版本。" : "Source changes were detected. Publishing creates an immutable snapshot and does not overwrite the earlier version.") : (zh ? "源成果与当前已发布版本一致。" : "The source matches the currently published version.")}</p><ul>{shareVersionDraft.inspection.artifacts.map((artifact) => <li key={artifact.objectId} data-testid="share-version-artifact" data-version-changed={artifact.changed}><span>{artifact.label}</span><b>{artifact.changed ? (zh ? "已变化" : "Changed") : (zh ? "未变化" : "Unchanged")}</b><code>{artifact.publishedSha256.slice(0, 12)} → {artifact.sourceSha256.slice(0, 12)}</code></li>)}</ul>{shareVersionDraft.inspection.commentsThatWillBecomeStale ? <p className="share-version-warning" data-testid="share-version-stale-warning">{zh ? `发布后 ${shareVersionDraft.inspection.commentsThatWillBecomeStale} 条当前评论会标记为过期，但不会删除。` : `${shareVersionDraft.inspection.commentsThatWillBecomeStale} current comment(s) will be marked stale, not deleted.`}</p> : null}<div className="share-confirmation-actions"><button type="button" data-testid="share-version-cancel" onClick={() => { setShareVersionDraft(null); setShareVersionState(null); }}>{zh ? "取消" : "Cancel"}</button><button type="button" data-testid="share-version-publish" disabled={!shareVersionDraft.inspection.hasChanges || shareVersionState?.state === "publishing"} onClick={() => void publishOutgoingShareVersion()}>{zh ? `发布 v${shareVersionDraft.inspection.nextVersion}` : `Publish v${shareVersionDraft.inspection.nextVersion}`}</button></div></section> : null}
      {shareVersionState ? <output className="share-version-status" data-testid="share-version-status" data-state={shareVersionState.state}>{shareVersionState.message}</output> : null}
      {shareRevokeDraft ? <section className="share-revoke-dialog" role="dialog" aria-modal="true" aria-labelledby="share-revoke-title" data-testid="share-revoke-dialog"><header><div><strong id="share-revoke-title">{zh ? "撤销这个分享？" : "Revoke this share?"}</strong><small>{zh ? `接收账号：${shareRevokeDraft.recipientAccount}` : `Recipient: ${shareRevokeDraft.recipientAccount}`}</small></div></header><p>{zh ? "撤销后，原分享入口、已登录账号中的收件卡以及后续打开、下载、评论和继续处理权限都会立即失效。此操作会写入安全审计。" : "The original share entry, signed-in inbox card, and future open, download, comment, and continue access will immediately stop working. A security audit entry will be recorded."}</p><ul>{shareRevokeDraft.objects.map((object) => <li key={object.objectId}>{object.label}</li>)}</ul><label><span>{zh ? "输入 REVOKE 确认" : "Type REVOKE to confirm"}</span><input autoFocus data-testid="share-revoke-confirmation" value={shareRevokeConfirmation} onChange={(event) => setShareRevokeConfirmation(event.target.value)} /></label><div className="share-confirmation-actions"><button type="button" data-testid="share-revoke-cancel" onClick={() => { setShareRevokeDraft(null); setShareRevokeConfirmation(""); }}>{zh ? "取消" : "Cancel"}</button><button type="button" data-testid="share-revoke-confirm" disabled={shareRevokeConfirmation !== "REVOKE"} onClick={() => void confirmShareRevocation()}>{zh ? "确认撤销" : "Confirm revocation"}</button></div></section> : null}
      {shareDraft ? (
        <section className="share-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" data-testid="share-confirmation-dialog">
          <header><div><strong id="share-dialog-title">{shareDraft.scope === "result_only" ? (zh ? "分享这个成果" : "Share this result") : (zh ? "分享完整任务" : "Share complete task")}</strong><small>{zh ? "确认接收账号和将被授权的内容" : "Confirm the recipient and authorized objects"}</small></div></header>
          <label><span>{zh ? "接收账号" : "Recipient account"}</span><input autoFocus type="email" data-testid="share-recipient-input" placeholder="colleague@example.org" value={shareRecipient} onChange={(event) => setShareRecipient(event.target.value)} /></label>
          <label><span>{zh ? "协作权限" : "Collaboration permission"}</span><select data-testid="share-permission-select" value={sharePermission} onChange={(event) => setSharePermission(event.target.value as DesktopSharePermission)}><option value="view">{zh ? "只查看" : "View only"}</option><option value="comment">{zh ? "可评论" : "Can comment"}</option><option value="continue">{zh ? "可继续处理" : "Can continue"}</option></select></label>
          <div className="share-manifest-preview" data-testid="share-manifest-preview"><strong>{zh ? "分享清单" : "Share manifest"}</strong><p>{shareDraft.scope === "result_only" ? (zh ? "仅分享所选成果" : "Selected result only") : (zh ? "分享任务说明及该任务的全部成果" : "Task details and all results from this task")}</p><ul>{sharePreviewObjects.map((object) => <li key={`${object.objectType}:${object.objectId}`} data-manifest-object-type={object.objectType} data-manifest-object-id={object.objectId}>{object.objectType === "task" ? (zh ? "任务" : "Task") : (zh ? "成果" : "Result")} · {object.label}</li>)}</ul></div>
          {shareInspection ? <section className="share-sensitive-review" data-testid="share-sensitive-review" data-state={shareInspection.state}><header><strong>{zh ? "敏感信息检查" : "Sensitive information check"}</strong><span>{shareInspection.result?.findings.length ?? 0}</span></header><p>{shareInspection.message}</p>{shareInspection.result?.findings.length ? <ul>{shareInspection.result.findings.map((finding) => <li key={finding.id} data-testid="share-sensitive-finding" data-finding-kind={finding.kind} data-finding-severity={finding.severity}><span><strong>{finding.kind === "api_key" ? "API Key" : finding.kind === "bearer_token" ? "Bearer Token" : finding.kind === "email" ? (zh ? "邮箱" : "Email") : finding.kind === "phone" ? (zh ? "手机号" : "Phone") : (zh ? "用户定义秘密" : "User-defined secret")}</strong><small>{finding.artifactLabel} · {finding.maskedPreview} · {finding.occurrences}</small></span><select data-testid="share-sensitive-action" aria-label={zh ? `处理 ${finding.kind}` : `Resolve ${finding.kind}`} value={shareSensitiveActions[finding.id] ?? "redact"} onChange={(event) => setShareSensitiveActions((current) => ({ ...current, [finding.id]: event.target.value as DesktopShareSensitiveAction }))}><option value="redact">{zh ? "遮蔽" : "Redact"}</option><option value="remove">{zh ? "删除" : "Remove"}</option></select></li>)}</ul> : null}</section> : null}
          {shareState ? <output data-testid="share-create-status" data-state={shareState.state}>{shareState.message}</output> : null}
          {shareState?.manifest ? <div className="share-created-manifest" data-testid="share-created-manifest" data-share-id={shareState.manifest.id}><strong>{zh ? "已授权对象" : "Authorized objects"}</strong><ul>{shareState.manifest.objects.map((object) => <li key={`${object.objectType}:${object.objectId}`}>{object.objectType} · {object.label}</li>)}</ul></div> : null}
          <div className="share-confirmation-actions"><button type="button" data-testid="share-cancel" onClick={() => { setShareDraft(null); setShareRecipient(""); setSharePermission("view"); setShareState(null); }}>{shareState?.state === "created" ? (zh ? "完成" : "Done") : (zh ? "取消" : "Cancel")}</button>{shareState?.state !== "created" ? <button type="button" data-testid="share-confirm" disabled={!shareRecipient.trim() || shareState?.state === "creating" || shareInspection?.state !== "ready"} onClick={() => void confirmShare()}>{zh ? "确认分享" : "Confirm share"}</button> : null}</div>
        </section>
      ) : null}
      <section className="results-reusable-tasks" data-testid="reusable-tasks" aria-label={zh ? "可复用任务" : "Reusable tasks"}>
        <header><div><strong>{zh ? "可复用任务" : "Reusable tasks"}</strong><small>{zh ? "保留成功流程，下次只替换输入材料" : "Keep a successful workflow and replace only its inputs next time"}</small></div><span>{reusableTasks.length}</span></header>
        {reusableSaveDraft ? (
          <div className="reusable-task-save-dialog" data-testid="reusable-task-save-dialog">
            <label><span>{zh ? "任务名称" : "Task name"}</span><input data-testid="reusable-task-name" value={reusableSaveDraft.name} onChange={(event) => setReusableSaveDraft((current) => current ? { ...current, name: event.target.value } : null)} /></label>
            <p>{zh ? "保存后会列出下次需要替换的输入和保持不变的规则。" : "After saving, the app shows replacement inputs and rules that stay fixed."}</p>
            <button type="button" data-testid="reusable-task-confirm-save" disabled={!reusableSaveDraft.name.trim()} onClick={() => void saveAsReusableTask()}>{zh ? "保存任务" : "Save task"}</button>
            <button type="button" onClick={() => setReusableSaveDraft(null)}>{zh ? "取消" : "Cancel"}</button>
          </div>
        ) : null}
        <div className="reusable-task-list">
          {reusableTasks.map((task) => (
            <article key={task.id} data-testid="reusable-task-card" data-reusable-task-id={task.id}>
              <header><div><strong>{task.name}</strong><small>{zh ? `已运行 ${task.runCount} 次` : `Run ${task.runCount} times`}</small></div></header>
              <div className="reusable-task-inputs"><b>{zh ? "下次替换" : "Replace next time"}</b>{task.inputs.map((input) => <label key={input.id}><span>{input.label}</span><input data-testid={`reusable-task-input-${input.id}`} value={reusableInputs[input.id] ?? input.originalValue} onChange={(event) => setReusableInputs((current) => ({ ...current, [input.id]: event.target.value }))} /></label>)}</div>
              <details open><summary>{zh ? "保持不变的规则" : "Rules kept fixed"}</summary><ul>{task.fixedRules.map((rule) => <li key={rule}>{rule}</li>)}</ul></details>
              <details className="reusable-task-adjustments" data-testid="reusable-task-adjustments" open>
                <summary>{zh ? "运行前调整" : "Adjust before running"}</summary>
                <p>{zh ? "可修改本次输出语言、截止时间和检查项目，再选择修改是否保存到以后。" : "Change language, deadline, and checks, then choose whether to save the changes for future runs."}</p>
                <div className="reusable-task-adjustment-grid">
                  <label><span>{zh ? "输出语言" : "Output language"}</span><select data-testid="reusable-task-adjustment-language" value={(reusableAdjustments[task.id] ?? task.savedAdjustments)?.outputLanguage ?? ""} onChange={(event) => setReusableAdjustments((current) => ({ ...current, [task.id]: { ...(current[task.id] ?? task.savedAdjustments ?? { checkItems: [] }), outputLanguage: event.target.value === "zh" || event.target.value === "en" ? event.target.value : undefined } }))}><option value="">{zh ? "按原规则" : "Keep original"}</option><option value="zh">{zh ? "中文" : "Chinese"}</option><option value="en">{zh ? "英文" : "English"}</option></select></label>
                  <label><span>{zh ? "截止时间" : "Deadline"}</span><input data-testid="reusable-task-adjustment-deadline" placeholder={zh ? "例如：2026-07-20 18:00" : "e.g. 2026-07-20 18:00"} value={(reusableAdjustments[task.id] ?? task.savedAdjustments)?.deadline ?? ""} onChange={(event) => setReusableAdjustments((current) => ({ ...current, [task.id]: { ...(current[task.id] ?? task.savedAdjustments ?? { checkItems: [] }), deadline: event.target.value } }))} /></label>
                  <label className="reusable-task-check-items"><span>{zh ? "检查项目（每行一项）" : "Check items (one per line)"}</span><textarea data-testid="reusable-task-adjustment-checks" value={((reusableAdjustments[task.id] ?? task.savedAdjustments)?.checkItems ?? []).join("\n")} onChange={(event) => setReusableAdjustments((current) => ({ ...current, [task.id]: { ...(current[task.id] ?? task.savedAdjustments ?? { checkItems: [] }), checkItems: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } }))} /></label>
                </div>
                <fieldset data-testid="reusable-task-adjustment-scope"><legend>{zh ? "这次修改如何生效？" : "How should these changes apply?"}</legend>
                  <label><input type="radio" name={`reusable-scope-${task.id}`} value="this_run" checked={(reusableAdjustmentScopes[task.id] ?? "this_run") === "this_run"} onChange={() => setReusableAdjustmentScopes((current) => ({ ...current, [task.id]: "this_run" }))} /><span><b>{zh ? "仅本次" : "This run only"}</b><small>{zh ? "运行后模板保持不变" : "Keep the saved template unchanged"}</small></span></label>
                  <label><input type="radio" name={`reusable-scope-${task.id}`} value="update_template" checked={reusableAdjustmentScopes[task.id] === "update_template"} onChange={() => setReusableAdjustmentScopes((current) => ({ ...current, [task.id]: "update_template" }))} /><span><b>{zh ? "以后都这样" : "Use from now on"}</b><small>{zh ? "本次执行并更新保存的模板" : "Apply now and update the saved template"}</small></span></label>
                </fieldset>
              </details>
              <button type="button" data-testid="reusable-task-run" disabled={reusableState?.state === "preparing" || reusableState?.state === "running"} onClick={() => void runReusableTask(task)}>{zh ? "使用新材料运行" : "Run with replacement input"}</button>
            </article>
          ))}
        </div>
        {reusableState ? <output data-testid="reusable-task-status" data-state={reusableState.state}>{reusableState.message}</output> : null}
      </section>
      {routeGroups.length ? (
        <section className="results-analysis-routes" data-testid="analysis-route-groups" aria-label={zh ? "分析路线" : "Analysis routes"}>
          <header><div><strong>{zh ? "分析路线" : "Analysis routes"}</strong><small>{zh ? "原结果和新路线彼此独立，可分别打开。" : "Original and alternative results stay independent and open separately."}</small></div></header>
          {routeGroups.map((group) => (
            <article key={group.groupId} data-testid="analysis-route-group" data-route-group-id={group.groupId} data-source-path={group.sourcePath}>
              <strong>{group.sourcePath.split(/[\\/]/).pop()}</strong>
              <div>
                {[...group.routes].sort((left, right) => left.analysisRoute!.role.localeCompare(right.analysisRoute!.role)).map((routeArtifact) => (
                  <section key={routeArtifact.analysisRoute!.routeId} data-testid="analysis-route-card" data-route-id={routeArtifact.analysisRoute!.routeId} data-route-role={routeArtifact.analysisRoute!.role} data-route-status={routeArtifact.analysisRoute!.status} data-input-fingerprint={routeArtifact.analysisRoute!.inputFingerprint}>
                    <b>{routeArtifact.analysisRoute!.role === "original" ? (zh ? "原路线" : "Original route") : (zh ? "新路线" : "Alternative route")}</b>
                    <span>{routeArtifact.analysisRoute!.method}</span>
                    <small>{routeArtifact.label}</small>
                    {routeArtifact.analysisRoute!.selected ? <strong data-testid="analysis-route-selected">{zh ? "当前选择" : "Current choice"}</strong> : null}
                    <div className="results-analysis-route-actions">
                      <button type="button" data-testid="analysis-route-open" onClick={() => void openArtifact(routeArtifact)}>{zh ? "打开这条路线" : "Open this route"}</button>
                      <button type="button" data-testid="analysis-route-select" aria-pressed={routeArtifact.analysisRoute!.selected} onClick={() => void selectAnalysisRoute(group, routeArtifact)}>{zh ? "选择这个版本" : "Choose this version"}</button>
                      <button type="button" data-testid="analysis-route-continue" onClick={() => onContinueQuestion(zh ? `继续询问分析路线“${routeArtifact.analysisRoute!.method}”：关键结论是“${routeArtifact.analysisRoute!.keyConclusion}”，风险是“${routeArtifact.analysisRoute!.risk}”。请基于成果 ${routeArtifact.path} 回答：` : `Continue asking about the “${routeArtifact.analysisRoute!.method}” route. Its conclusion is “${routeArtifact.analysisRoute!.keyConclusion}” and its risk is “${routeArtifact.analysisRoute!.risk}”. Use ${routeArtifact.path} to answer: `)}>{zh ? "继续询问" : "Continue asking"}</button>
                    </div>
                  </section>
                ))}
              </div>
              {group.routes.length >= 2 ? (
                <section className="results-analysis-comparison" data-testid="analysis-route-comparison" aria-label={zh ? "路线版本比较" : "Route version comparison"}>
                  <header><strong>{zh ? "路线版本比较" : "Route version comparison"}</strong><small>{zh ? "每项差异都对应到具体路线，可直接选择或继续询问。" : "Every difference maps to a route you can choose or ask about."}</small></header>
                  {([
                    ["method", zh ? "方法" : "Method"],
                    ["input", zh ? "输入" : "Input"],
                    ["conclusion", zh ? "关键结论" : "Key conclusion"],
                    ["artifact", zh ? "成果" : "Result"],
                    ["risk", zh ? "风险" : "Risk"],
                    ["recommendedUse", zh ? "适用场景" : "Best use"],
                  ] as const).map(([field, label]) => (
                    <div key={field} data-testid="analysis-route-comparison-row" data-difference-field={field}>
                      <strong>{label}</strong>
                      {[...group.routes].sort((left, right) => left.analysisRoute!.role.localeCompare(right.analysisRoute!.role)).map((routeArtifact) => {
                        const route = routeArtifact.analysisRoute!;
                        const value = field === "method" ? route.method : field === "input" ? route.inputSummary : field === "conclusion" ? route.keyConclusion : field === "artifact" ? routeArtifact.label : field === "risk" ? route.risk : route.recommendedUse;
                        return <div key={`${field}:${route.routeId}`} data-testid="analysis-route-comparison-value" data-route-id={route.routeId} data-route-role={route.role}><b>{route.role === "original" ? (zh ? "原路线" : "Original") : (zh ? "新路线" : "Alternative")}</b><span>{value}</span>{field === "artifact" ? <button type="button" onClick={() => void openArtifact(routeArtifact)}>{zh ? "定位成果" : "Open result"}</button> : null}</div>;
                      })}
                    </div>
                  ))}
                  {routeSelectionState?.groupId === group.groupId ? <p data-testid="analysis-route-selection-status" data-state={routeSelectionState.state} data-route-id={routeSelectionState.routeId} role="status">{routeSelectionState.message}</p> : null}
                </section>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {error ? <p className="task-center-error" role="alert">{zh ? `无法加载成果：${error}` : `Could not load results: ${error}`}</p> : null}
      {!loading && groupedArtifacts.length === 0 ? (
        <div className="results-center-empty" data-testid="results-center-empty">
          <strong>{workspaceScope === "workspace" ? (zh ? "当前工作区还没有成果" : "No results in this workspace") : (zh ? "还没有可查看的成果" : "No results yet")}</strong>
          <p>{workspaceScope === "workspace" ? (zh ? "任务生成文件后会自动出现在这里，也可以切换到全部工作区查看。" : "Task files appear here automatically. You can also switch to all workspaces.") : (zh ? "任务完成并生成文件后，会自动出现在这里。" : "Completed task files will appear here automatically.")}</p>
        </div>
      ) : (
        <div className="results-task-index" data-testid="results-task-index">
          {groupedArtifacts.map((group, groupIndex) => (
            <section key={group.taskId} data-source-task-id={group.taskId}>
              <header>
                <div><small>{zh ? "来源任务" : "Source task"}</small><h3>{group.taskTitle}</h3></div>
                <div className="results-task-group-actions"><span>{group.artifacts.length}</span><button type="button" data-testid="results-share-task" aria-label={zh ? `分享完整任务：${group.taskTitle}` : `Share complete task: ${group.taskTitle}`} onClick={(event) => { shareOpenerRef.current = event.currentTarget; setShareDraft({ sourceTaskId: group.taskId, scope: "complete_task", title: group.taskTitle }); setShareRecipient(""); setSharePermission("view"); setShareState(null); }}>{zh ? "分享完整任务" : "Share complete task"}</button><button type="button" data-testid="reusable-task-save" onClick={() => setReusableSaveDraft({ sourceTaskId: group.taskId, name: group.taskTitle })}>{zh ? "保存为可复用任务" : "Save as reusable task"}</button></div>
              </header>
              <ul>
                {group.artifacts.map((artifact, artifactIndex) => (
                  <li key={artifact.id} data-artifact-id={artifact.id} data-artifact-kind={artifact.kind} data-artifact-path={artifact.path} data-source-task-id={artifact.sourceTaskId}>
                    <div>
                      <span className="results-kind-badge">{kindLabel(artifact.kind)}</span>
                      <strong>{artifact.label}</strong>
                      <small title={artifact.path}>{artifact.path}</small>
                      {artifact.quality ? (
                        <span
                          className="results-quality-badge"
                          data-testid="results-artifact-quality"
                          data-quality-status={artifact.quality.status}
                        >
                          {artifact.quality.status === "passed"
                            ? (zh ? `质量检查已通过 · 事实覆盖 ${artifact.quality.goldenFactCoverage}%` : `Quality passed · ${artifact.quality.goldenFactCoverage}% fact coverage`)
                            : (zh ? "质量检查未通过" : "Quality check failed")}
                        </span>
                      ) : null}
                      {artifact.editLineage ? (
                        <span className="results-edit-lineage" data-testid="results-edit-lineage">
                          {zh ? `修改自原成果 · ${artifact.editLineage.scopeLabel}` : `Edited from original · ${artifact.editLineage.scopeLabel}`}
                        </span>
                      ) : null}
                      {artifact.chartQuality ? (
                        <span className="results-chart-quality" data-testid="results-chart-quality" data-quality-status={artifact.chartQuality.status}>
                          {artifact.chartQuality.status === "passed"
                            ? (zh ? `图表数据检查已通过 · 数据点 ${artifact.chartQuality.pointsMatched}/${artifact.chartQuality.pointsExpected}` : `Chart data passed · ${artifact.chartQuality.pointsMatched}/${artifact.chartQuality.pointsExpected} points`)
                            : (zh ? `图表数据检查未通过 · ${artifact.chartQuality.mismatchCount} 项不一致` : `Chart data failed · ${artifact.chartQuality.mismatchCount} mismatches`)}
                        </span>
                      ) : null}
                      {artifact.analysisRoute ? (
                        <span className="results-analysis-route-badge" data-testid="results-analysis-route-badge" data-route-role={artifact.analysisRoute.role}>
                          {artifact.analysisRoute.role === "original" ? (zh ? "原分析路线" : "Original analysis route") : (zh ? "新分析路线" : "Alternative analysis route")} · {artifact.analysisRoute.method}
                        </span>
                      ) : null}
                      {artifact.consistencyCheck ? (
                        <span
                          className={`results-consistency-badge ${artifact.consistencyCheck.status}`}
                          data-testid="results-consistency-badge"
                          data-consistency-status={artifact.consistencyCheck.status}
                          data-expected-issues={artifact.consistencyCheck.expectedIssues}
                          data-detected-issues={artifact.consistencyCheck.detectedIssues}
                        >
                          {artifact.consistencyCheck.status === "passed"
                            ? (zh ? "一致性检查已通过 · 未发现问题" : "Consistency passed · no issues")
                            : (zh ? `一致性检查发现 ${artifact.consistencyCheck.detectedIssues} 项问题` : `Consistency found ${artifact.consistencyCheck.detectedIssues} issues`)}
                        </span>
                      ) : null}
                    </div>
                    <div className="results-artifact-actions">
                      <button type="button" data-testid="results-share-artifact" aria-label={zh ? `分享成果：${artifact.label}` : `Share result: ${artifact.label}`} onClick={(event) => { shareOpenerRef.current = event.currentTarget; setShareDraft({ sourceTaskId: artifact.sourceTaskId, scope: "result_only", artifactId: artifact.id, title: artifact.label }); setShareRecipient(""); setSharePermission("view"); setShareState(null); }}>{zh ? "分享" : "Share"}</button>
                      <button ref={groupIndex === 0 && artifactIndex === 0 ? firstResultActionRef : undefined} type="button" data-testid="results-open-artifact" disabled={openState?.artifactId === artifact.id && openState.state === "opening"} onClick={() => void openArtifact(artifact)}>
                        {zh ? "打开" : "Open"}
                      </button>
                      {artifact.kind !== "folder" ? (
                        <>
                          <button type="button" data-testid="results-preview-artifact" onClick={() => void previewArtifact(artifact)}>
                            {zh ? "预览" : "Preview"}
                          </button>
                          <button type="button" data-testid="results-save-artifact" disabled={saveState?.artifactId === artifact.id && saveState.state === "saving"} onClick={() => void saveArtifactAs(artifact)}>
                            {zh ? "另存为" : "Save as"}
                          </button>
                          {artifact.editLineage ? (
                            <button type="button" data-testid="results-compare-artifact" onClick={() => void compareArtifact(artifact)}>
                              {zh ? "比较" : "Compare"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            data-testid="results-repeat-review"
                            disabled={independentReviewState?.artifactId === artifact.id && independentReviewState.state === "running"}
                            onClick={() => void runIndependentReview(artifact, "repeat")}
                          >
                            {zh ? "再检查一次" : "Check again"}
                          </button>
                          <button
                            type="button"
                            data-testid="results-alternative-review"
                            disabled={independentReviewState?.artifactId === artifact.id && independentReviewState.state === "running"}
                            onClick={() => void runIndependentReview(artifact, "alternative")}
                          >
                            {zh ? "换一种方法验证" : "Verify another way"}
                          </button>
                          {artifact.chartQuality?.status === "passed" && artifact.analysisRoute?.role !== "alternative" ? (
                            <button
                              type="button"
                              data-testid="results-create-analysis-route"
                              disabled={(routeState?.artifactId === artifact.id && (routeState.state === "starting" || routeState.state === "running"))
                                || artifacts.some((candidate) => candidate.analysisRoute?.routeGroupId === (artifact.analysisRoute?.routeGroupId || `analysis-${reviewFingerprint(artifact.chartQuality!.sourcePath)}`) && candidate.analysisRoute?.role === "alternative")}
                              onClick={() => void startAlternativeRoute(artifact)}
                            >
                              {artifacts.some((candidate) => candidate.analysisRoute?.routeGroupId === (artifact.analysisRoute?.routeGroupId || `analysis-${reviewFingerprint(artifact.chartQuality!.sourcePath)}`) && candidate.analysisRoute?.role === "alternative")
                                ? (zh ? "另一路线已保留" : "Alternative route preserved")
                                : (zh ? "保留结果并尝试另一路线" : "Keep result and try another route")}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {artifact.kind === "report" && artifact.quality?.status === "passed" ? (
                        <button
                          type="button"
                          data-testid="results-create-versions"
                          disabled={versionState?.artifactId === artifact.id && (versionState.state === "starting" || versionState.state === "running")}
                          onClick={() => void createArtifactVersions(artifact)}
                        >
                          {zh ? "生成 5 种版本" : "Create 5 versions"}
                        </button>
                      ) : null}
                    </div>
                    {openState?.artifactId === artifact.id ? (
                      <span data-testid="results-open-status" data-state={openState.state} role="status">{openState.message}</span>
                    ) : null}
                    {versionState?.artifactId === artifact.id ? (
                      <span data-testid="results-version-status" data-state={versionState.state} role="status">{versionState.message}</span>
                    ) : null}
                    {saveState?.artifactId === artifact.id ? (
                      <span data-testid="results-save-status" data-state={saveState.state} role="status">{saveState.message}</span>
                    ) : null}
                    {editState?.artifactId === artifact.id ? (
                      <span data-testid="results-edit-status" data-state={editState.state} role="status">{editState.message}</span>
                    ) : null}
                    {chartState?.artifactId === artifact.id ? (
                      <span data-testid="results-chart-status" data-state={chartState.state} role="status">{chartState.message}</span>
                    ) : null}
                    {routeState?.artifactId === artifact.id ? (
                      <span data-testid="results-analysis-route-status" data-state={routeState.state} role="status">{routeState.message}</span>
                    ) : null}
                    {independentReviewState?.artifactId === artifact.id ? (
                      <span
                        data-testid="results-independent-review-status"
                        data-state={independentReviewState.state}
                        data-mode={independentReviewState.mode}
                        role="status"
                      >{independentReviewState.message}</span>
                    ) : null}
                    {artifact.quality ? (
                      <details className="results-quality-details" data-testid="results-quality-details">
                        <summary>{zh ? "查看自动质量检查" : "View automated quality checks"}</summary>
                        <ul>
                          {artifact.quality.checks.map((check) => <li key={check}>{check}</li>)}
                        </ul>
                      </details>
                    ) : null}
                    {artifact.chartQuality ? (
                      <details className="results-quality-details" data-testid="results-chart-quality-details">
                        <summary>{zh ? "查看图表数据核对" : "View chart-data checks"}</summary>
                        <ul>{artifact.chartQuality.checks.map((check) => <li key={check}>{check}</li>)}</ul>
                      </details>
                    ) : null}
                    {(artifact.anomalyDecision || (artifact.chartQuality?.anomaliesExpected ?? 0) > 0) ? (
                      <section
                        className="results-anomaly-decision"
                        data-testid="results-anomaly-decision"
                        data-artifact-id={artifact.id}
                        data-total-rows={artifact.anomalyDecision?.totalRows ?? artifact.chartQuality?.pointsExpected}
                        data-anomaly-rows={artifact.anomalyDecision?.anomalyRows ?? artifact.chartQuality?.anomaliesExpected}
                      >
                        <header>
                          <div><strong>{zh ? "发现异常数据，怎么处理？" : "How should anomalous data be handled?"}</strong><small>{zh ? `原文件保持不变；已识别 ${artifact.anomalyDecision?.anomalyRows ?? artifact.chartQuality?.anomaliesExpected} 行异常。` : `The source stays unchanged; ${artifact.anomalyDecision?.anomalyRows ?? artifact.chartQuality?.anomaliesExpected} anomalous rows were identified.`}</small></div>
                        </header>
                        <fieldset>
                          <legend>{zh ? "选择一种处理方式" : "Choose one handling option"}</legend>
                          {([
                            ["keep", zh ? "保留异常" : "Keep anomalies", zh ? "输出全部数据，便于审计；异常值可能影响整体趋势。" : "Outputs every row for audit; anomalies may affect the overall trend."],
                            ["exclude", zh ? "排除异常" : "Exclude anomalies", zh ? "只输出非异常数据，便于观察基线；原始文件仍保留。" : "Outputs only normal rows for a baseline; the source file remains available."],
                            ["both", zh ? "两种都做" : "Do both", zh ? "生成两份互不覆盖的结果，便于比较异常是否改变结论。" : "Creates two isolated outputs so you can compare whether anomalies change the conclusion."],
                          ] as const).map(([value, label, impact]) => (
                            <label key={value} data-testid={`results-anomaly-option-${value}`}>
                              <input
                                type="radio"
                                name={`anomaly-decision-${artifact.id}`}
                                value={value}
                                checked={anomalyChoices[artifact.id] === value}
                                onChange={() => setAnomalyChoices((current) => ({ ...current, [artifact.id]: value }))}
                              />
                              <span><strong>{label}</strong><small>{impact}</small></span>
                            </label>
                          ))}
                        </fieldset>
                        <button
                          type="button"
                          data-testid="results-apply-anomaly-decision"
                          disabled={!anomalyChoices[artifact.id] || anomalyDecisionState?.artifactId === artifact.id && anomalyDecisionState.state === "applying"}
                          onClick={() => void applyArtifactAnomalyDecision(artifact)}
                        >{zh ? "应用决定并生成结果" : "Apply decision and create results"}</button>
                        {artifact.anomalyDecision?.decision ? (
                          <output data-testid="results-anomaly-record" data-decision={artifact.anomalyDecision.decision} data-output-count={artifact.anomalyDecision.outputs?.length ?? 0}>
                            <strong>{zh ? "已记录的决定" : "Recorded decision"}</strong>
                            <span>{artifact.anomalyDecision.resultSummary}</span>
                          </output>
                        ) : null}
                        {anomalyDecisionState?.artifactId === artifact.id ? <p data-testid="results-anomaly-status" data-state={anomalyDecisionState.state} role="status">{anomalyDecisionState.message}</p> : null}
                      </section>
                    ) : null}
                    {artifact.consistencyCheck ? (
                      <details
                        className={`results-consistency-check ${artifact.consistencyCheck.status}`}
                        data-testid="results-consistency-check"
                        data-status={artifact.consistencyCheck.status}
                        data-expected-issues={artifact.consistencyCheck.expectedIssues}
                        data-detected-issues={artifact.consistencyCheck.detectedIssues}
                      >
                        <summary>{artifact.consistencyCheck.status === "passed"
                          ? (zh ? "查看一致性检查 · 通过" : "View consistency check · passed")
                          : (zh ? `查看一致性检查 · ${artifact.consistencyCheck.detectedIssues}/${artifact.consistencyCheck.expectedIssues}` : `View consistency check · ${artifact.consistencyCheck.detectedIssues}/${artifact.consistencyCheck.expectedIssues}`)}</summary>
                        <p>{artifact.consistencyCheck.summary}</p>
                        {artifact.consistencyCheck.items.length ? (
                          <ul>
                            {artifact.consistencyCheck.items.map((item) => {
                              const decisionKey = `${artifact.id}:${item.id}`;
                              const decision = consistencyDecisions[decisionKey] ?? item.status;
                              return (
                                <li
                                  key={item.id}
                                  data-testid="results-consistency-issue"
                                  data-issue-id={item.id}
                                  data-issue-category={item.category}
                                  data-issue-severity={item.severity}
                                  data-issue-status={decision}
                                  data-observed-value={item.observedValue}
                                  data-expected-value={item.expectedValue}
                                  data-issue-locator={item.locator}
                                  data-issue-source-path={item.sourcePath}
                                  data-issue-evidence={item.evidenceText}
                                  data-issue-recommendation={item.recommendation}
                                >
                                  <header><strong>{item.title}</strong><em>{item.category === "outdated_number" ? (zh ? "过期数字" : "Outdated number") : item.category === "chart_mismatch" ? (zh ? "图表错误" : "Chart mismatch") : (zh ? "来源不一致" : "Source mismatch")}</em></header>
                                  <p>{item.finding}</p>
                                  <dl><div><dt>{zh ? "当前" : "Observed"}</dt><dd>{item.observedValue}</dd></div><div><dt>{zh ? "应为" : "Expected"}</dt><dd>{item.expectedValue}</dd></div></dl>
                                  <small>{zh ? "依据：" : "Evidence: "}{item.evidenceText}</small>
                                  <small><strong>{zh ? "修正建议：" : "Recommendation: "}</strong>{item.recommendation}</small>
                                  <footer>
                                    <button type="button" data-testid="results-open-consistency-source" onClick={() => void openConclusionEvidence(item)}>{zh ? `查看 ${item.locator}` : `Open ${item.locator}`}</button>
                                    <button type="button" data-testid="results-accept-consistency-issue" disabled={decision !== "open"} onClick={() => setConsistencyDecisions((current) => ({ ...current, [decisionKey]: "accepted" }))}>{zh ? "接受修正建议" : "Accept recommendation"}</button>
                                    <button type="button" data-testid="results-ignore-consistency-issue" disabled={decision !== "open"} onClick={() => setConsistencyDecisions((current) => ({ ...current, [decisionKey]: "ignored" }))}>{zh ? "忽略" : "Ignore"}</button>
                                  </footer>
                                  {decision !== "open" ? <output data-testid="results-consistency-decision" data-decision={decision}>{decision === "accepted" ? (zh ? "已接受修正建议" : "Recommendation accepted") : (zh ? "已忽略此项" : "Issue ignored")}</output> : null}
                                  {evidenceOpenState?.evidenceId === item.id ? <output data-testid="results-consistency-open-status" data-state={evidenceOpenState.state}>{evidenceOpenState.message}</output> : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </details>
                    ) : null}
                    {artifact.independentReviews?.length ? (
                      <details className="results-independent-reviews" data-testid="results-independent-reviews" open>
                        <summary>{zh ? `独立复核记录 · ${artifact.independentReviews.length}` : `Independent reviews · ${artifact.independentReviews.length}`}</summary>
                        <div className="results-independent-review-list">
                          {artifact.independentReviews.map((review) => (
                            <article
                              key={review.id}
                              className={`results-independent-review ${review.status}`}
                              data-testid="results-independent-review"
                              data-review-id={review.id}
                              data-review-mode={review.mode}
                              data-review-method={review.method}
                              data-review-status={review.status}
                              data-checked-claims={review.checkedClaimCount}
                              data-checked-sources={review.checkedSourceCount}
                              data-uses-original-answer-text={String(review.usesOriginalAnswerText)}
                              data-evidence-fingerprint={review.evidenceFingerprint}
                            >
                              <header>
                                <div><strong>{review.methodLabel}</strong><small>{review.reviewerLabel}</small></div>
                                <em>{review.status === "passed" ? (zh ? "复核通过" : "Passed") : review.status === "issues_found" ? (zh ? "发现问题" : "Issues found") : (zh ? "信息不足" : "Inconclusive")}</em>
                              </header>
                              <p>{review.summary}</p>
                              <dl>
                                <div><dt>{zh ? "检查事实" : "Claims"}</dt><dd>{review.checkedClaimCount}</dd></div>
                                <div><dt>{zh ? "原始位置" : "Sources"}</dt><dd>{review.checkedSourceCount}</dd></div>
                                <div><dt>{zh ? "复核方式" : "Method difference"}</dt><dd>{review.methodDifference}</dd></div>
                              </dl>
                              <section data-testid="results-review-scope">
                                <strong>{zh ? "检查范围" : "Scope"}</strong>
                                <ul>{review.scope.map((item) => <li key={item}>{item}</li>)}</ul>
                              </section>
                              <section data-testid="results-review-findings">
                                <strong>{zh ? "复核发现" : "Findings"}</strong>
                                <ul>{review.findings.map((finding) => (
                                  <li
                                    key={finding.id}
                                    data-review-finding-id={finding.id}
                                    data-review-finding-outcome={finding.outcome}
                                    data-review-finding-source-path={finding.sourcePath}
                                    data-review-finding-locator={finding.locator}
                                    data-review-finding-evidence={finding.evidenceText}
                                  >
                                    <span><strong>{finding.title}</strong><small>{finding.detail}</small><small>{zh ? "独立依据：" : "Independent evidence: "}{finding.evidenceText}</small></span>
                                    <button type="button" data-testid="results-open-review-source" onClick={() => void openConclusionEvidence(finding)}>{zh ? `查看 ${finding.locator}` : `Open ${finding.locator}`}</button>
                                    {evidenceOpenState?.evidenceId === finding.id ? <output data-testid="results-review-source-status" data-state={evidenceOpenState.state}>{evidenceOpenState.message}</output> : null}
                                  </li>
                                ))}</ul>
                              </section>
                              <section className="results-review-uncovered" data-testid="results-review-uncovered">
                                <strong>{zh ? "本次未覆盖" : "Not covered"}</strong>
                                <ul>{review.uncovered.map((item) => <li key={item}>{item}</li>)}</ul>
                              </section>
                              <footer><small>{zh ? "独立性说明：未读取首次答案文本" : "Independence: original answer text was not read"} · {review.evidenceFingerprint}</small></footer>
                            </article>
                          ))}
                        </div>
                      </details>
                    ) : null}
                    {artifact.keyConclusions?.length ? (
                      <details
                        className="results-conclusion-evidence"
                        data-testid="results-conclusion-evidence"
                        data-traceability-rate={artifact.conclusionTraceabilityRate}
                        data-status={artifact.conclusionTraceabilityRate === 1 ? "passed" : "failed"}
                      >
                        <summary>
                          {zh
                            ? `查看关键结论依据 · ${artifact.keyConclusions.filter((item) => item.verified).length}/${artifact.keyConclusions.length}`
                            : `View conclusion evidence · ${artifact.keyConclusions.filter((item) => item.verified).length}/${artifact.keyConclusions.length}`}
                        </summary>
                        <div>
                          {artifact.keyConclusions.map((evidence) => (
                            <article
                              key={evidence.id}
                              data-testid="results-key-conclusion"
                              data-conclusion-id={evidence.id}
                              data-conclusion-text={evidence.conclusion}
                              data-evidence-text={evidence.evidenceText}
                              data-locator={evidence.locator}
                              data-locator-type={evidence.locatorType}
                              data-source-path={evidence.sourcePath}
                              data-verified={evidence.verified ? "true" : "false"}
                            >
                              <strong>{evidence.conclusion}</strong>
                              <small>{evidence.evidenceText}</small>
                              {evidence.trust ? (
                                <section
                                  className={`results-trust-card ${evidence.trust.status}`}
                                  data-testid="results-trust-card"
                                  data-trust-status={evidence.trust.status}
                                  data-trust-label={evidence.trust.label}
                                  data-trust-icon={evidence.trust.icon}
                                  data-trust-rule={evidence.trust.evidenceRule}
                                  data-trust-rule-satisfied={String(evidence.trust.ruleSatisfied)}
                                  data-trust-evidence-ids={evidence.trust.evidenceIds.join(";")}
                                  data-trust-conclusion-id={evidence.id}
                                  data-trust-source-path={evidence.sourcePath}
                                  data-trust-locator={evidence.locator}
                                  data-trust-evidence-text={evidence.evidenceText}
                                  role="group"
                                  aria-label={`${evidence.trust.label}。${evidence.trust.definition}。建议动作：${evidence.trust.recommendedAction}`}
                                >
                                  <header>
                                    <span className="results-trust-icon" aria-hidden="true">{evidence.trust.icon === "check" ? "✓" : evidence.trust.icon === "question" ? "?" : evidence.trust.icon === "warning" ? "!" : evidence.trust.icon === "compare" ? "⇄" : "≈"}</span>
                                    <strong>{evidence.trust.label}</strong>
                                    <em>{evidence.trust.ruleSatisfied ? (zh ? "证据规则匹配" : "Evidence rule matched") : (zh ? "证据规则不匹配" : "Evidence rule mismatch")}</em>
                                  </header>
                                  <p>{evidence.trust.definition}</p>
                                  <small><strong>{zh ? "为什么：" : "Why: "}</strong>{evidence.trust.reason}</small>
                                  <footer>
                                    <span><strong>{zh ? "建议动作：" : "Next action: "}</strong>{evidence.trust.recommendedAction}</span>
                                    <button type="button" data-testid="results-open-trust-evidence" onClick={() => void openConclusionEvidence(evidence)}>{zh ? `查看 ${evidence.locator} 依据` : `Open evidence ${evidence.locator}`}</button>
                                  </footer>
                                  {evidenceOpenState?.evidenceId === evidence.id ? <output data-testid="results-trust-open-status" data-state={evidenceOpenState.state}>{evidenceOpenState.message}</output> : null}
                                </section>
                              ) : null}
                              {evidence.citations?.length ? (
                                <ul className="results-citation-list">
                                  {evidence.citations.map((citation) => (
                                    <li
                                      key={citation.id}
                                      data-testid="results-citation"
                                      data-citation-id={citation.id}
                                      data-citation-title={citation.title}
                                      data-citation-authors={citation.authors.join(";")}
                                      data-citation-locator={citation.locator}
                                      data-citation-excerpt={citation.excerpt}
                                      data-citation-relation={citation.relation}
                                      data-citation-score={citation.supportScore}
                                      data-citation-source-path={citation.sourcePath}
                                    >
                                      <span><strong>{citation.title}</strong><small>{citation.authors.join("、")} · {citation.locator}</small></span>
                                      <em>{citation.relation === "supports" ? (zh ? "支持结论" : "Supports") : citation.relation === "contradicts" ? (zh ? "与结论冲突" : "Contradicts") : (zh ? "证据不足" : "Insufficient")}</em>
                                      <button type="button" data-testid="results-open-citation" onClick={() => void openConclusionEvidence(citation)}>{zh ? "打开引用" : "Open citation"}</button>
                                      {evidenceOpenState?.evidenceId === citation.id ? <output data-testid="results-citation-open-status" data-state={evidenceOpenState.state}>{evidenceOpenState.message}</output> : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {evidence.numericEvidence?.length ? (
                                <ul className="results-numeric-evidence-list">
                                  {evidence.numericEvidence.map((numeric) => (
                                    <li
                                      key={numeric.id}
                                      data-testid="results-numeric-evidence"
                                      data-numeric-id={numeric.id}
                                      data-numeric-label={numeric.label}
                                      data-display-value={numeric.displayValue}
                                      data-reported-value={numeric.reportedValue}
                                      data-recalculated-value={numeric.recalculatedValue}
                                      data-numeric-unit={numeric.unit}
                                      data-numeric-kind={numeric.kind}
                                      data-numeric-status={numeric.status}
                                      data-numeric-formula={numeric.formula}
                                      data-numeric-locator={numeric.locator}
                                      data-numeric-source-path={numeric.sourcePath}
                                      data-source-values={JSON.stringify(numeric.sourceValues)}
                                    >
                                      <span>
                                        <strong>{numeric.label}：{numeric.displayValue}</strong>
                                        <small>{numeric.formula}</small>
                                        <small>{numeric.explanation}</small>
                                      </span>
                                      <em>{numeric.status === "verified" ? (zh ? "复算一致" : "Recalculated") : (zh ? "无法验证 · 已标记" : "Unverifiable · flagged")}</em>
                                      <button type="button" data-testid="results-open-numeric-source" onClick={() => void openConclusionEvidence(numeric)}>{zh ? `查看 ${numeric.locator}` : `Open ${numeric.locator}`}</button>
                                      {evidenceOpenState?.evidenceId === numeric.id ? <output data-testid="results-numeric-open-status" data-state={evidenceOpenState.state}>{evidenceOpenState.message}</output> : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {evidence.uncertainty ? (
                                <section
                                  className={`results-uncertainty-assessment ${evidence.uncertainty.status}`}
                                  data-testid="results-uncertainty-assessment"
                                  data-uncertainty-status={evidence.uncertainty.status}
                                  data-requires-qualification={evidence.uncertainty.requiresQualification ? "true" : "false"}
                                  data-qualifying-language={evidence.uncertainty.qualifyingLanguage.join(";")}
                                >
                                  <header><strong>{evidence.uncertainty.label}</strong><em>{evidence.uncertainty.status === "source_conflict" ? (zh ? "来源冲突" : "Source conflict") : evidence.uncertainty.status === "insufficient_data" ? (zh ? "数据不足" : "Insufficient data") : (zh ? "推测" : "Inference")}</em></header>
                                  <p>{evidence.uncertainty.explanation}</p>
                                  <ul>
                                    {evidence.uncertainty.claims.map((claim) => (
                                      <li
                                        key={claim.id}
                                        data-testid="results-uncertainty-claim"
                                        data-claim-id={claim.id}
                                        data-claim-position={claim.position}
                                        data-claim-stance={claim.stance}
                                        data-claim-locator={claim.locator}
                                        data-claim-excerpt={claim.excerpt}
                                        data-claim-source-path={claim.sourcePath}
                                      >
                                        <span><strong>{claim.position}</strong><small>{claim.excerpt}</small></span>
                                        <em>{claim.stance === "supports" ? (zh ? "支持" : "Supports") : claim.stance === "contradicts" ? (zh ? "反方" : "Contradicts") : (zh ? "证据不足" : "Insufficient")}</em>
                                        <button type="button" data-testid="results-open-uncertainty-claim" onClick={() => void openConclusionEvidence(claim)}>{zh ? `查看 ${claim.locator}` : `Open ${claim.locator}`}</button>
                                        {evidenceOpenState?.evidenceId === claim.id ? <output data-testid="results-uncertainty-open-status" data-state={evidenceOpenState.state}>{evidenceOpenState.message}</output> : null}
                                      </li>
                                    ))}
                                  </ul>
                                  <footer><strong>{zh ? "建议动作：" : "Next action: "}</strong>{evidence.uncertainty.recommendedAction}</footer>
                                </section>
                              ) : null}
                              <span>
                                <em>{evidence.verified ? (zh ? "依据已核对" : "Verified") : (zh ? "待核对" : "Unverified")}</em>
                                <button
                                  type="button"
                                  data-testid="results-open-conclusion-evidence"
                                  onClick={() => void openConclusionEvidence(evidence)}
                                >
                                  {zh ? `查看 ${evidence.locator}` : `Open ${evidence.locator}`}
                                </button>
                              </span>
                              {evidenceOpenState?.evidenceId === evidence.id ? (
                                <output data-testid="results-conclusion-open-status" data-state={evidenceOpenState.state}>{evidenceOpenState.message}</output>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {previewState ? (
        <div className="results-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewState(null); }}>
          <section className="results-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="results-preview-title" data-testid="results-preview-dialog" data-preview-state={previewState.state}>
            <header>
              <div>
                <h3 id="results-preview-title">{previewState.artifact.label}</h3>
                <small>{previewState.preview ? `${previewState.preview.kind.toUpperCase()} · ${previewState.preview.size} bytes` : previewState.message}</small>
              </div>
              <button type="button" data-testid="results-preview-close" onClick={() => setPreviewState(null)}>{zh ? "关闭" : "Close"}</button>
            </header>
            {previewState.state === "loading" ? <p role="status">{previewState.message}</p> : null}
            {previewState.state === "failed" ? <p role="alert">{previewState.message}</p> : null}
            {previewState.state === "ready" && previewState.preview ? (
              <div className="results-preview-content" data-preview-kind={previewState.preview.kind} onMouseUp={previewState.preview.kind !== "table" && previewState.preview.kind !== "image" ? captureTextSelection : undefined}>
                {previewState.preview.kind === "image" && previewState.preview.dataUrl ? (
                  <img
                    src={previewState.preview.dataUrl}
                    alt={previewState.artifact.chartQuality
                      ? `${previewState.artifact.label}: ${previewState.artifact.chartQuality.xAxis} by ${previewState.artifact.chartQuality.yAxis}, ${previewState.artifact.chartQuality.unit}, ${previewState.artifact.chartQuality.pointsMatched} data points, ${previewState.artifact.chartQuality.legend}`
                      : previewState.artifact.label}
                    data-selected={localEditScope?.type === "image"}
                    onClick={() => setLocalEditScope({ type: "image", label: zh ? "整张图片" : "Entire image" })}
                  />
                ) : previewState.preview.kind === "table" && previewState.preview.columns ? (
                  <div>
                    <button type="button" className="secondary" data-testid="results-select-table" onClick={() => setLocalEditScope({ type: "table", label: zh ? "整个表格" : "Entire table" })}>{zh ? "选择整个表格" : "Select entire table"}</button>
                    <table data-selected={localEditScope?.type === "table"}>
                      <thead><tr>{previewState.preview.columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead>
                      <tbody>{(previewState.preview.rows ?? []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
                    </table>
                    {chartConfig ? (
                      <section className="results-chart-controls" data-testid="results-chart-controls">
                        <strong>{zh ? "生成并核对图表" : "Generate and verify chart"}</strong>
                        <label>{zh ? "横轴" : "X axis"}<select data-testid="results-chart-x" value={chartConfig.xColumn} onChange={(event) => setChartConfig({ ...chartConfig, xColumn: event.target.value })}>{previewState.preview.columns.map((column) => <option key={column}>{column}</option>)}</select></label>
                        <label>{zh ? "纵轴" : "Y axis"}<select data-testid="results-chart-y" value={chartConfig.yColumn} onChange={(event) => setChartConfig({ ...chartConfig, yColumn: event.target.value })}>{previewState.preview.columns.map((column) => <option key={column}>{column}</option>)}</select></label>
                        <label>{zh ? "单位" : "Unit"}<input data-testid="results-chart-unit" value={chartConfig.unit} onChange={(event) => setChartConfig({ ...chartConfig, unit: event.target.value })} /></label>
                        <label>{zh ? "图例" : "Legend"}<input data-testid="results-chart-legend" value={chartConfig.legend} onChange={(event) => setChartConfig({ ...chartConfig, legend: event.target.value })} /></label>
                        <button type="button" data-testid="results-generate-chart" disabled={!chartConfig.xColumn || !chartConfig.yColumn || !chartConfig.unit || !chartConfig.legend || chartState?.state === "running"} onClick={() => void generateCheckedChart()}>{zh ? "生成并自动核对" : "Generate and verify"}</button>
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <pre>{previewState.preview.content || previewState.preview.message || (zh ? "此格式由系统应用打开查看。" : "This format opens in the system application.")}</pre>
                )}
              </div>
            ) : null}
            {previewState.state === "ready" ? (
              <footer className="results-local-edit-controls" data-testid="results-local-edit-controls">
                <div>
                  <strong>{zh ? "局部修改" : "Localized edit"}</strong>
                  <small>{localEditScope?.label || (previewState.preview?.kind === "table" ? (zh ? "请先选择整个表格" : "Select the table first") : previewState.preview?.kind === "image" ? (zh ? "请点击图片选择" : "Click the image to select it") : (zh ? "请在预览中选中文字" : "Select text in the preview"))}</small>
                </div>
                <button type="button" data-testid="results-generate-local-edit" disabled={!localEditScope || editState?.state === "starting" || editState?.state === "running"} onClick={() => void generateLocalEdit()}>
                  {previewState.preview?.kind === "table" ? (zh ? "按数值排序并生成新版" : "Sort numerically and create version") : previewState.preview?.kind === "image" ? (zh ? "改为对数坐标并生成新版" : "Use log scale and create version") : (zh ? "改得更简单并生成新版" : "Simplify and create version")}
                </button>
              </footer>
            ) : null}
            {previewState.preview?.truncated ? <p className="results-preview-note">{zh ? "预览已截取；另存文件仍保持完整。" : "Preview truncated; saved copies remain complete."}</p> : null}
          </section>
        </div>
      ) : null}
      {compareState ? (
        <div className="results-preview-backdrop" role="presentation">
          <section className="results-preview-dialog results-compare-dialog" role="dialog" aria-modal="true" aria-labelledby="results-compare-title" data-testid="results-compare-dialog" data-compare-state={compareState.state}>
            <header><div><h3 id="results-compare-title">{zh ? "原版与修改版比较" : "Original vs edited"}</h3><small>{compareState.artifact.editLineage?.scopeLabel}</small></div><button type="button" data-testid="results-compare-close" onClick={() => setCompareState(null)}>{zh ? "关闭" : "Close"}</button></header>
            {compareState.state === "failed" ? <p role="alert">{compareState.message}</p> : null}
            {compareState.state === "loading" ? <p role="status">{compareState.message}</p> : null}
            {compareState.state === "ready" && compareState.source && compareState.edited ? (
              <div className="results-compare-grid">
                {[{ label: zh ? "原版" : "Original", preview: compareState.source }, { label: zh ? "修改版" : "Edited", preview: compareState.edited }].map((item) => (
                  <article key={item.label} data-version={item.label}>
                    <strong>{item.label}</strong>
                    {item.preview.kind === "image" && item.preview.dataUrl ? <img src={item.preview.dataUrl} alt={item.label} /> : <pre>{item.preview.content || item.preview.message}</pre>}
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function AwaySummaryPanel({
  language,
  summary,
  onDismiss,
  onOpenTask,
}: {
  language: AppLanguage;
  summary: AwaySummary;
  onDismiss: () => void;
  onOpenTask: (task: DesktopBackgroundTask) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const groups: Array<{
    id: "completed" | "failed" | "pending";
    title: string;
    empty: string;
    tasks: DesktopBackgroundTask[];
  }> = [
    { id: "completed", title: zh ? "已完成" : "Completed", empty: zh ? "没有新完成事项" : "No new completions", tasks: summary.completed },
    { id: "failed", title: zh ? "失败" : "Failed", empty: zh ? "没有新失败事项" : "No new failures", tasks: summary.failed },
    { id: "pending", title: zh ? "待确认" : "Needs your decision", empty: zh ? "没有待确认事项" : "Nothing needs a decision", tasks: summary.pending },
  ];
  return (
    <section
      className="away-summary-panel"
      data-away-started-at={summary.startedAt}
      data-testid="away-summary"
      aria-labelledby="away-summary-title"
      aria-live="assertive"
    >
      <header>
        <div>
          <strong id="away-summary-title">{zh ? "欢迎回来，这是你离开期间的进展" : "Welcome back — here is what happened while you were away"}</strong>
          <small>{zh ? "按结果分类，无需翻找完整时间线。" : "Grouped by outcome so you do not need to scan the full timeline."}</small>
        </div>
        <button type="button" className="secondary" onClick={onDismiss}>{zh ? "知道了" : "Dismiss"}</button>
      </header>
      <div className="away-summary-groups">
        {groups.map((group) => (
          <section key={group.id} data-testid={`away-summary-${group.id}`} aria-label={group.title}>
            <h3>{group.title}<span>{group.tasks.length}</span></h3>
            {group.tasks.length === 0 ? <p>{group.empty}</p> : (
              <ul>
                {group.tasks.map((task) => (
                  <li key={task.id} data-target-id={task.targetId}>
                    <div><strong>{redactAwaySummaryText(task.title, zh)}</strong><small>{redactAwaySummaryText(task.message, zh)}</small></div>
                    <button
                      type="button"
                      data-testid={group.id === "pending" ? "away-summary-continue" : "away-summary-open-task"}
                      onClick={() => onOpenTask(task)}
                    >
                      {group.id === "pending" ? zh ? "继续处理" : "Continue" : zh ? "查看任务" : "Open task"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function redactAwaySummaryText(value: string, zh: boolean): string {
  const hidden = zh ? "[已隐藏]" : "[hidden]";
  const hiddenEmail = zh ? "[已隐藏邮箱]" : "[hidden email]";
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, `Bearer ${hidden}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, hidden)
    .replace(/\b(api[_ -]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, (_match, label: string) => `${label}=${hidden}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, hiddenEmail);
}

function TaskDeliverySummaryPanel({
  language,
  task,
  onClose,
  onOpenTask,
}: {
  language: AppLanguage;
  task: DesktopBackgroundTask;
  onClose: () => void;
  onOpenTask: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const summary = task.deliverySummary!;
  const [artifactOpenState, setArtifactOpenState] = useState<{
    artifactId: string;
    state: "opening" | "opened" | "failed";
    message: string;
  } | null>(null);
  const importance = summary.importance === "high"
    ? zh ? "高" : "High"
    : summary.importance === "low" ? zh ? "低" : "Low" : zh ? "中" : "Medium";
  async function openArtifact(artifact: DesktopTaskArtifactLink): Promise<void> {
    setArtifactOpenState({
      artifactId: artifact.id,
      state: "opening",
      message: zh ? `正在打开${artifact.label}…` : `Opening ${artifact.label}…`,
    });
    try {
      const error = await desktopApi.openPath(artifact.path);
      setArtifactOpenState({
        artifactId: artifact.id,
        state: error ? "failed" : "opened",
        message: error
          ? (zh ? `无法打开${artifact.label}：${error}` : `Could not open ${artifact.label}: ${error}`)
          : (zh ? `已打开${artifact.label}` : `Opened ${artifact.label}`),
      });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setArtifactOpenState({
        artifactId: artifact.id,
        state: "failed",
        message: zh ? `无法打开${artifact.label}：${detail}` : `Could not open ${artifact.label}: ${detail}`,
      });
    }
  }
  return (
    <section
      className="task-delivery-summary"
      data-status={task.status}
      data-target-id={task.targetId}
      data-testid="task-delivery-summary"
      aria-labelledby="task-delivery-summary-title"
      aria-live="polite"
    >
      <header>
        <div>
          <strong id="task-delivery-summary-title">{zh ? "任务交付摘要" : "Task delivery summary"}</strong>
          <small>{redactAwaySummaryText(task.title, zh)}</small>
        </div>
        <button type="button" className="secondary" onClick={onClose}>{zh ? "关闭" : "Close"}</button>
      </header>
      <div className="task-delivery-k3-grid">
        <article data-testid="delivery-finding"><strong>{zh ? "发现摘要" : "Finding"}</strong><p>{summary.findingSummary}</p></article>
        <article data-importance={summary.importance} data-testid="delivery-importance"><strong>{zh ? "重要程度" : "Importance"}</strong><p>{importance} · {summary.importanceReason}</p></article>
        <article data-testid="delivery-artifacts">
          <strong>{zh ? "成果入口" : "Results"}</strong>
          {summary.artifacts.length ? summary.artifacts.map((artifact) => (
            <div key={artifact.id} className="delivery-artifact-entry">
              <button
                type="button"
                data-artifact-id={artifact.id}
                data-artifact-path={artifact.path}
                disabled={artifactOpenState?.artifactId === artifact.id && artifactOpenState.state === "opening"}
                onClick={() => void openArtifact(artifact)}
              >
                {zh ? "打开" : "Open"} {artifact.label}
              </button>
              {artifactOpenState?.artifactId === artifact.id ? (
                <span
                  data-artifact-id={artifact.id}
                  data-state={artifactOpenState.state}
                  data-testid="delivery-artifact-open-status"
                  role="status"
                >
                  {artifactOpenState.message}
                </span>
              ) : null}
            </div>
          )) : <p>{zh ? "打开对应任务查看完整结果" : "Open the task for the full result"}</p>}
        </article>
        <article data-testid="delivery-action"><strong>{zh ? "建议操作" : "Suggested action"}</strong><p>{summary.suggestedAction}</p></article>
      </div>
      <details open>
        <summary>{zh ? "完整完成卡" : "Full completion card"}</summary>
        <dl>
          <div data-testid="delivery-work-summary"><dt>{zh ? "工作摘要" : "Work summary"}</dt><dd>{summary.workSummary}</dd></div>
          <div data-testid="delivery-core-conclusion"><dt>{zh ? "核心结论" : "Core conclusion"}</dt><dd>{summary.coreConclusion}</dd></div>
          <div data-testid="delivery-verification"><dt>{zh ? "检查结果" : "Verification"}</dt><dd>{summary.verification}</dd></div>
          <div className="delivery-completion-criteria" data-testid="delivery-completion-criteria">
            <dt>{zh ? "完成标准" : "Completion criteria"}</dt>
            <dd>
              <section data-testid="delivery-checks-passed">
                <strong>{zh ? "已通过的检查" : "Checks passed"}</strong>
                <ul>{(summary.completionCriteria?.passed ?? [summary.verification]).map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul>
              </section>
              <section data-testid="delivery-checks-incomplete">
                <strong>{zh ? "尚未完成" : "Not completed"}</strong>
                <ul>{(summary.completionCriteria?.incomplete ?? [summary.remainingRisks]).map((item) => <li key={item}><span aria-hidden="true">!</span>{item}</li>)}</ul>
              </section>
            </dd>
          </div>
          <div data-testid="delivery-risks"><dt>{zh ? "剩余风险" : "Remaining risks"}</dt><dd>{summary.remainingRisks}</dd></div>
        </dl>
      </details>
      <button type="button" data-testid="delivery-open-task" onClick={onOpenTask}>{zh ? "查看对应任务" : "Open corresponding task"}</button>
    </section>
  );
}

function DesktopStatusPanel({
  actionMessage,
  busy,
  health,
  codexStatus,
  codexEnabled,
  installProgress,
  language,
  onCancelInstall,
  onCancelUpdate,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenPath,
  onRefresh,
  onCodexRefresh,
  onCodexLogin,
  onCodexLogout,
}: {
  actionMessage: string | null;
  busy: boolean;
  health: DesktopHealth | null;
  codexStatus: CodexBackendStatus | null;
  codexEnabled: boolean;
  installProgress: InstallProgress | null;
  language: AppLanguage;
  onCancelInstall: () => void;
  onCancelUpdate: () => void;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onOpenPath: (path: string) => void;
  onRefresh: () => void;
  onCodexRefresh: () => void | Promise<void>;
  onCodexLogin: (type: "chatgpt" | "chatgptDeviceCode") => Promise<CodexBackendLogin>;
  onCodexLogout: () => void | Promise<void>;
}): React.JSX.Element {
  const zh = language === "zh";
  const [codexLogin, setCodexLogin] = useState<CodexBackendLogin | null>(null);
  // The About card describes the Desktop application, not the independently
  // installed Python Runtime. The updater identity is always sourced from
  // Electron's app.getVersion(), including development builds.
  const version = health?.update.currentVersion ?? (zh ? "未知版本" : "unknown");
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
          <dt>{zh ? "运行时服务" : "Runtime service"}</dt>
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

      {codexEnabled && <section className="about-section">
        <div className="about-section-title" data-testid="codex-backend-status">
          <strong>Codex Agent Backend</strong>
          <span data-testid={`codex-state-${codexStatus?.state ?? "loading"}`}>
            {codexStatus ? `${codexStatus.state}${codexStatus.version ? ` · ${codexStatus.version}` : ""}` : (zh ? "正在读取 Runtime capability" : "Reading Runtime capability")}
          </span>
        </div>
        <div className="about-action-grid">
          <button type="button" onClick={() => void onCodexRefresh()}>{zh ? "刷新 Codex" : "Refresh Codex"}</button>
          {codexStatus?.action === "login" && <button type="button" data-testid="codex-login" onClick={() => void onCodexLogin("chatgptDeviceCode").then(setCodexLogin)}>{zh ? "登录 ChatGPT" : "Sign in to ChatGPT"}</button>}
          {codexStatus?.loggedIn && <button type="button" data-testid="codex-logout" onClick={() => void onCodexLogout()}>{zh ? "退出 Codex" : "Sign out of Codex"}</button>}
          {codexStatus?.action === "install" && <span data-testid="codex-install-action">{zh ? "请安装受管 Codex 制品" : "Install the managed Codex artifact"}</span>}
          {codexStatus?.action === "upgrade" && <span data-testid="codex-upgrade-action">{zh ? "请升级 Codex 制品" : "Upgrade the Codex artifact"}</span>}
          {codexStatus?.action === "restart" && <span data-testid="codex-restart-action">{zh ? "请重启 Runtime 后重试" : "Restart Runtime and retry"}</span>}
        </div>
        {codexLogin?.userCode && <div role="status" data-testid="codex-device-code">{zh ? "设备码" : "Device code"}: {codexLogin.userCode}</div>}
      </section>}

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
            (zh ? "未检测到 OpenDrSai 主目录" : "No OpenDrSai home detected")}
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
          {zh ? "运行时服务：" : "Runtime service: "}
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
  if (health.update.phase === "rolled-back")
    return zh
      ? `新版本 ${health.update.version ?? ""} 未能正常启动，已自动恢复到可用版本 ${health.update.currentVersion}。你的账户、任务、工作区和文件未受影响。`
      : `Version ${health.update.version ?? ""} could not start, so OpenDrSai automatically restored working version ${health.update.currentVersion}. Your account, tasks, workspace, and files were not affected.`;
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

type SettingsPane = "general" | "voice" | "agent-defaults" | "agent-task" | "approvals" | "analytics" | "integrations" | "channels" | "other";

function SettingsPanel({
  agents,
  appearance,
  approvalCenterPanel,
  channelsPanel,
  featureCapabilities,
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
  onOpenMobilePairing,
  onOpenBrowserPanel,
  onOpenPath,
  onResetPreferences,
  onRestoreLastSessionChange,
  onRestoreLastWorkspaceChange,
  onRightSidebarComponentsChange,
  onSelectAgent,
  onSelectModel,
  onSessionScopeChange,
  onArchiveThread,
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
  threads,
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
  featureCapabilities?: DesktopPlatformDescriptor["capabilities"]["features"];
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
  onOpenMobilePairing: () => void;
  onOpenBrowserPanel: () => void;
  onOpenPath: (path: string) => void;
  onResetPreferences: () => void;
  onRestoreLastSessionChange: (enabled: boolean) => void;
  onRestoreLastWorkspaceChange: (enabled: boolean) => void;
  onRightSidebarComponentsChange: React.Dispatch<React.SetStateAction<RightSidebarComponentVisibility>>;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (model: string) => void;
  onSessionScopeChange: (scope: "workspace" | "all") => void;
  onArchiveThread: (threadId: string, archived: boolean) => void;
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
  threads: DesktopThread[];
  updateBusy: boolean;
  updateMessage: string | null;
  usageAnalyticsPanel: React.ReactNode;
  user: AuthUser | null;
  workspaceSortMode: WorkspaceSortMode;
}): React.JSX.Element {
  const zh = language === "zh";
  const [activePane, setActivePane] = useState<SettingsPane>("general");
  const [voiceIntegrationState, setVoiceIntegrationState] = useState<string | null>(null);
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences();
  const [voiceRuntimeStatus, setVoiceRuntimeStatus] = useState<DesktopVoiceRuntimeStatus | null>(null);
  const [streamingVoiceCapabilities, setStreamingVoiceCapabilities] = useState<DesktopStreamingVoiceCapabilities | null>(null);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [remoteHostCount, setRemoteHostCount] = useState<number | null>(null);
  const [mobilePairingReadiness, setMobilePairingReadiness] = useState<DesktopMobilePairingReadiness | null>(null);
  const [mobileEnrollmentBusy, setMobileEnrollmentBusy] = useState(false);
  const [mobileEnrollmentError, setMobileEnrollmentError] = useState<string | null>(null);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigMessage, setAgentConfigMessage] = useState<string | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<DesktopDataCleanupPreview | null>(null);
  const [cleanupConfirmation, setCleanupConfirmation] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [archiveSearch, setArchiveSearch] = useState("");
  const archivedThreads = threads.filter((thread) => thread.archived).filter((thread) =>
    thread.title.toLocaleLowerCase().includes(archiveSearch.trim().toLocaleLowerCase()),
  );

  async function openDataCleanup(scope: DesktopDataCleanupScope): Promise<void> {
    setCleanupBusy(true);
    setCleanupStatus(null);
    try {
      setCleanupPreview(await desktopApi.previewLocalDataCleanup(scope));
      setCleanupConfirmation("");
    } catch (error) {
      setCleanupStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCleanupBusy(false);
    }
  }

  async function confirmDataCleanup(): Promise<void> {
    if (!cleanupPreview) return;
    const scope = cleanupPreview.scope;
    if (scope === "all_local_data" && cleanupConfirmation !== cleanupPreview.confirmationPhrase) return;
    setCleanupBusy(true);
    setCleanupStatus(null);
    try {
      const result = await desktopApi.clearLocalData({
        scope,
        confirmation: scope === "sessions" ? "CLEAR_SESSIONS" : "DELETE_LOCAL_DATA",
      });
      if (scope === "sessions") {
        for (const key of [THREAD_SNAPSHOT_STORAGE_KEY, LAST_THREAD_STORAGE_KEY, AWAY_STARTED_AT_STORAGE_KEY]) window.localStorage.removeItem(key);
      } else {
        window.localStorage.clear();
        window.sessionStorage.clear();
      }
      setCleanupPreview(null);
      setCleanupStatus(zh ? result.message : scope === "sessions" ? "Session data cleared; workspace files and results were preserved." : "OpenDrSai app data cleared; workspace files and results were preserved.");
      if (scope === "all_local_data") window.setTimeout(() => void onLogout(), 600);
      else window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setCleanupStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCleanupBusy(false);
    }
  }

  async function updateAgentConfig(updates: { plan_mode?: boolean; workspace_enabled?: boolean }): Promise<void> {
    setAgentConfigSaving(true);
    setAgentConfigMessage(null);
    try {
      await onUpdateAgentConfig(updates);
      setAgentConfigMessage(zh ? "智能体配置已保存。" : "Agent configuration saved.");
    } catch (error) {
      setAgentConfigMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentConfigSaving(false);
    }
  }

  async function revokeMobileEnrollment(): Promise<void> {
    const confirmed = window.confirm(zh
      ? "这会断开所有 Android 设备，并禁止它们继续连接此电脑。确定继续吗？"
      : "This disconnects every Android device and prevents further connections to this computer. Continue?");
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      await desktopApi.revokeMobileRuntimeEnrollment();
      setMobilePairingReadiness({ state: "not_registered", action: "register_runtime" });
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  useEffect(() => {
    if (activePane !== "integrations") return;
    let cancelled = false;
    const refresh = (): void => {
      void Promise.all([
        featureCapabilities?.serialVoice === true || featureCapabilities?.streamingVoice === true
          ? desktopApi.getVoiceRuntimeStatus().catch(() => null)
          : Promise.resolve(null),
        featureCapabilities?.remoteWorkspace === false ? Promise.resolve([]) : desktopApi.listSshHosts().catch(() => []),
        featureCapabilities?.remoteWorkspace === true
          ? desktopApi.getMobilePairingReadiness().catch(() => null)
          : Promise.resolve(null),
      ]).then(([voiceStatus, hosts, readiness]) => {
        if (cancelled) return;
        setVoiceIntegrationState(voiceStatus?.state ?? "unavailable");
        setRemoteHostCount(hosts.length);
        setMobilePairingReadiness(readiness);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activePane, featureCapabilities]);

  useEffect(() => {
    if (activePane !== "voice" || !("speechSynthesis" in window)) return;
    const refreshVoices = (): void => setSystemVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
  }, [activePane]);

  useEffect(() => {
    if (activePane !== "voice") return;
    let cancelled = false;
    void Promise.all([
      desktopApi.getVoiceRuntimeStatus().catch(() => null),
      featureCapabilities?.streamingVoice === false ? Promise.resolve(null) : desktopApi.getStreamingVoiceCapabilities().catch(() => null),
    ]).then(([status, capabilities]) => {
      if (cancelled) return;
      setVoiceRuntimeStatus(status);
      setStreamingVoiceCapabilities(capabilities);
    });
    return () => { cancelled = true; };
  }, [activePane, featureCapabilities]);

  const voiceModeCapabilities = deriveVoiceModeCapabilities(voiceRuntimeStatus, {
    audioWorklet: typeof AudioWorkletNode !== "undefined",
    serialTts: "speechSynthesis" in window,
    streamingTts: false,
    streamingCapabilities: streamingVoiceCapabilities,
  });
  const streamingVoiceAvailability = getVoiceModeAvailability("streaming", voiceModeCapabilities);

  useEffect(() => {
    if (activePane !== "voice" || !systemVoices.length || !voicePreferences.voiceName) return;
    const resolvedName = resolveAvailableVoiceName(
      voicePreferences.voiceName,
      systemVoices.map((voice) => voice.name),
    );
    if (resolvedName !== voicePreferences.voiceName) updateVoicePreferences({ voiceName: resolvedName });
  }, [activePane, systemVoices, updateVoicePreferences, voicePreferences.voiceName]);
  const groups: Array<{
    label: string;
    items: Array<{ id: SettingsPane; label: string; icon: LucideIcon }>;
  }> = [
    {
      label: zh ? "常规" : "General",
      items: [
        { id: "general", label: zh ? "常规" : "General", icon: Settings },
        { id: "voice", label: zh ? "语音" : "Voice", icon: Volume2 },
      ],
    },
    {
      label: zh ? "智能体" : "Agent",
      items: [
        { id: "agent-defaults", label: zh ? "默认配置" : "Defaults", icon: Settings },
        { id: "agent-task", label: zh ? "智能体任务" : "Agent tasks", icon: Bot },
        { id: "approvals", label: zh ? "审批中心" : "Approval Center", icon: ShieldCheck },
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
  const visibleGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.id === "voice") return featureCapabilities?.serialVoice === true || featureCapabilities?.streamingVoice === true;
      if (item.id === "agent-defaults" || item.id === "agent-task") return featureCapabilities?.agents === true;
      if (item.id === "approvals") return featureCapabilities?.approvals === true;
      if (item.id === "analytics") return featureCapabilities?.diagnostics === true;
      if (item.id === "channels") return featureCapabilities?.channels === true;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
  const visiblePaneIds = visibleGroups.flatMap((group) => group.items.map((item) => item.id));
  useEffect(() => {
    if (visiblePaneIds.includes(activePane)) return;
    setActivePane("general");
  }, [activePane, visiblePaneIds.join("|")]);

  return (
    <div className="settings-view">
      <aside className="settings-navigation" aria-label={zh ? "设置分组" : "Settings groups"}>
        <h1>{zh ? "设置" : "Settings"}</h1>
        {visibleGroups.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`settings-pane-${item.id}`}
                  autoFocus={item.id === "general"}
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
            <section className="settings-section" data-testid="archived-threads-settings">
              <div><h2>{zh ? "已归档会话" : "Archived sessions"}</h2><p>{zh ? "归档不会删除消息或工作区内容。" : "Archiving preserves messages and workspace content."}</p></div>
              <div className="settings-component-list">
                <input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder={zh ? "搜索已归档会话" : "Search archived sessions"} />
                {archivedThreads.length === 0 ? <small>{zh ? "没有匹配的已归档会话。" : "No archived sessions match."}</small> : archivedThreads.map((thread) => (
                  <div className="settings-row" key={thread.id}><span><strong>{thread.title}</strong><small>{thread.archiveSource === "codex" ? "Codex" : "OpenDrSai"}</small></span><button type="button" onClick={() => onArchiveThread(thread.id, false)}>{zh ? "取消归档" : "Unarchive"}</button></div>
                ))}
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
              <label className="settings-toggle"><span><strong>{zh ? "任务完成通知" : "Completion notifications"}</strong><small>{zh ? "会话或后台任务完成时发送 Windows 通知，点击可返回对应任务。" : "Send a Windows notification for completed conversations and background tasks; click it to return to the task."}</small></span><input type="checkbox" checked={completionNotifications} onChange={(event) => onCompletionNotificationsChange(event.target.checked)} /></label>
            </section>
          </>
        )}

        {activePane === "voice" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "语音" : "Voice"}</h2>
              <p>{zh ? "配置语音输入、回复朗读和本机系统声音。" : "Configure voice input, response reading, and Windows system voices."}</p>
            </header>
            <section className="settings-section">
              <div>
                <h2>{zh ? "交互模式" : "Interaction mode"}</h2>
                <p>{zh ? "串行模式保持为可靠默认路径；流式模式在运行时能力和验收门禁完成后开放。" : "Serial remains the reliable default; streaming becomes available after runtime capabilities and release gates are complete."}</p>
              </div>
              <div className="settings-row">
                <span>
                  <strong>{zh ? "语音模式" : "Voice mode"}</strong>
                  <small data-testid="voice-mode-status">{voicePreferences.interactionMode === "streaming" ? (zh ? "低延迟流式处理" : "Low-latency streaming") : (zh ? "完整录音与审核" : "Complete recording and review")}</small>
                </span>
                <select
                  data-testid="voice-interaction-mode"
                  value={voicePreferences.interactionMode}
                  onChange={(event) => updateVoicePreferences({ interactionMode: event.target.value as DesktopVoiceInteractionMode })}
                  aria-describedby="voice-streaming-availability"
                >
                  <option value="serial">{zh ? "串行（可靠）" : "Serial (reliable)"}</option>
                  <option value="streaming" disabled={!streamingVoiceAvailability.available}>{zh ? "流式（低延迟）" : "Streaming (low latency)"}</option>
                </select>
              </div>
              <div id="voice-streaming-availability" className="settings-privacy-note" role="note">
                <strong>{zh ? "流式模式状态" : "Streaming mode status"}</strong>
                <p>{streamingVoiceAvailability.available ? (zh ? "当前环境支持流式输入与输出。" : "The current environment supports streaming input and output.") : (zh ? "流式运行链路尚未完成；串行模式继续正常可用。" : "The streaming runtime path is not complete yet; serial mode remains fully available.")}</p>
              </div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "回复朗读" : "Response reading"}</h2>
                <p>{zh ? "朗读只在完整回复生成后开始，录音开始时会自动停止。" : "Reading starts only after a response is complete and stops when recording begins."}</p>
              </div>
              <label className="settings-toggle">
                <span><strong>{zh ? "自动朗读完整回复" : "Automatically read completed responses"}</strong><small>{zh ? "默认关闭；不会朗读流式生成中的内容。" : "Off by default; streaming output is never read."}</small></span>
                <input
                  type="checkbox"
                  data-testid="voice-auto-read"
                  checked={voicePreferences.autoReadResponses}
                  onChange={(event) => updateVoicePreferences({ autoReadResponses: event.target.checked })}
                />
              </label>
              <label className="settings-toggle">
                <span><strong>{zh ? "允许在线朗读" : "Allow online speech synthesis"}</strong><small>{zh ? "允许将回复文本发送给当前配置的语音服务；关闭后仅使用 Windows 本地朗读。" : "Allow response text to be sent to the configured speech provider; when off, only Windows system speech is used."}</small></span>
                <input
                  type="checkbox"
                  data-testid="voice-remote-tts-consent"
                  checked={voicePreferences.remoteTtsConsent}
                  onChange={(event) => updateVoicePreferences({
                    remoteTtsConsent: event.target.checked,
                    ...(event.target.checked ? {} : { synthesisMode: "system" as const }),
                  })}
                />
              </label>
              <div className="settings-row">
                <span><strong>{zh ? "朗读引擎" : "Reading engine"}</strong><small>{zh ? "Provider 不可用时会显示错误；切换到 Windows 系统声音需由你确认。" : "Provider failures are shown explicitly; switching to Windows system speech requires your choice."}</small></span>
                <select
                  data-testid="voice-synthesis-mode"
                  value={voicePreferences.synthesisMode}
                  onChange={(event) => updateVoicePreferences({ synthesisMode: event.target.value as "system" | "provider" })}
                >
                  <option value="system">{zh ? "Windows 系统声音" : "Windows system speech"}</option>
                  <option value="provider" disabled={!voicePreferences.remoteTtsConsent}>{zh ? "语音服务 Provider" : "Speech provider"}</option>
                </select>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "语速" : "Reading speed"}</strong><small>{voicePreferences.playbackRate.toFixed(1)}x</small></span>
                <input
                  type="range"
                  data-testid="voice-playback-rate"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={voicePreferences.playbackRate}
                  onChange={(event) => updateVoicePreferences({ playbackRate: Number(event.target.value) })}
                  aria-label={zh ? "朗读语速" : "Reading speed"}
                />
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "系统声音" : "System voice"}</strong><small>{zh ? "声音由 Windows 和已安装语言包提供。" : "Voices are provided by Windows and installed language packs."}</small></span>
                <select
                  data-testid="voice-system-voice"
                  value={voicePreferences.voiceName}
                  onChange={(event) => updateVoicePreferences({ voiceName: event.target.value })}
                >
                  <option value="">{zh ? "自动选择" : "Automatic"}</option>
                  {systemVoices.map((voice) => (
                    <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} ({voice.lang})</option>
                  ))}
                </select>
              </div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "语音输入" : "Voice input"}</h2>
                <p>{zh ? "只在点击麦克风后采集；停止后才提交整段音频进行识别。" : "Audio is captured only after clicking the microphone and submitted after recording stops."}</p>
              </div>
              <label className="settings-toggle">
                <span><strong>{zh ? "允许在线语音识别" : "Allow online transcription"}</strong><small>{zh ? "允许在停止录音后，将本次音频发送给当前配置的 Voice STT 服务。" : "Allow the recorded audio to be sent to the configured Voice STT provider after recording stops."}</small></span>
                <input
                  type="checkbox"
                  data-testid="voice-remote-stt-consent"
                  checked={voicePreferences.remoteSttConsent}
                  onChange={(event) => updateVoicePreferences({ remoteSttConsent: event.target.checked })}
                />
              </label>
              <div className="settings-row">
                <span><strong>{zh ? "识别语言" : "Transcription language"}</strong><small>{zh ? "自动检测适用于中英文混合输入。" : "Automatic detection works well for mixed Chinese and English."}</small></span>
                <select
                  data-testid="voice-input-language"
                  value={voicePreferences.inputLanguage}
                  onChange={(event) => updateVoicePreferences({ inputLanguage: event.target.value as "auto" | "zh-CN" | "en-US" })}
                >
                  <option value="auto">{zh ? "自动检测" : "Automatic"}</option>
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
              <div className="settings-privacy-note" role="note">
                <strong>{zh ? "数据说明" : "Data handling"}</strong>
                <p>{zh ? "系统朗读在本机完成。语音识别可能按当前 Voice STT Runtime 的配置发送到服务提供方；临时录音按任务生命周期清理。" : "System speech runs locally. Transcription may be sent to the configured Voice STT provider; temporary recordings are cleaned up with the task lifecycle."}</p>
              </div>
            </section>
          </>
        )}

        {activePane === "agent-defaults" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "智能体默认配置" : "Agent defaults"}</h2>
              <p>{zh ? "设置新会话默认使用的智能体、模型和思考强度。" : "Choose the Agent, model, and thinking effort used by new conversations."}</p>
            </header>
            <section className="settings-section">
              <div className="settings-row">
                <span><strong>{zh ? "默认智能体" : "Default Agent"}</strong><small>{zh ? "会同步应用到聊天输入区。" : "Also applies to the chat composer."}</small></span>
                <select value={selectedAgentId ?? ""} onChange={(event) => onSelectAgent(event.target.value)} disabled={agents.length === 0}>
                  {agents.length === 0 && <option value="">{zh ? "暂无可用智能体" : "No Agent available"}</option>}
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "默认模型" : "Default model"}</strong><small>{zh ? "模型列表由当前工作区的 OpenDrSai 配置提供。" : "Models are provided by the current workspace OpenDrSai configuration."}</small></span>
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
              <div><h2>{zh ? "执行与上下文" : "Execution and context"}</h2><p>{zh ? "这些选项保存到当前 OpenDrSai 配置，并受现有审批策略约束。" : "These options are saved to the current OpenDrSai configuration and remain governed by approval policy."}</p></div>
              <label className="settings-toggle"><span><strong>{zh ? "先规划再执行" : "Plan mode"}</strong><small>{zh ? "让智能体先生成计划，再开始执行。" : "Ask the Agent to create a plan before acting."}</small></span><input type="checkbox" checked={Boolean(myDrSaiConfig?.config.plan_mode)} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ plan_mode: event.target.checked })} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "限制在当前工作区" : "Restrict to current workspace"}</strong><small>{zh ? "文件操作优先限制在当前工作区，越界操作继续走审批。" : "Prefer file operations inside the current workspace; out-of-scope actions still require approval."}</small></span><input type="checkbox" checked={myDrSaiConfig?.config.workspace_enabled !== false} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ workspace_enabled: event.target.checked })} /></label>
              {agentConfigMessage && <div className="settings-message">{agentConfigMessage}</div>}
            </section>
          </>
        )}

        {activePane === "agent-task" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "智能体任务" : "Agent tasks"}</h2>
              <p>{zh ? "创建独立的智能体任务，并在会话中继续管理执行过程。" : "Create an isolated Agent task and manage its run from the conversation."}</p>
            </header>
            <section className="settings-section settings-action-section">
              <Bot size={22} />
              <div>
                <h2>{zh ? "新建智能体任务" : "New Agent task"}</h2>
                <p>{zh ? "基于当前工作区创建新的智能体任务会话。" : "Start a new Agent task for the current workspace."}</p>
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
              {featureCapabilities?.channels === true && <div className="settings-integration-row"><MessageSquare size={18} /><span><strong>{zh ? "频道" : "Channels"}</strong><small>{zh ? "连接消息渠道并导入只读上下文。" : "Connect message channels and import reviewed context."}</small></span><button type="button" onClick={() => setActivePane("channels")}>{zh ? "管理" : "Manage"}</button></div>}
              {featureCapabilities?.mcp === true && featureCapabilities?.approvals === true && <div className="settings-integration-row"><Plug size={18} /><span><strong>{zh ? "工具连接" : "MCP"}</strong><small>{zh ? "在审批中心管理外部工具连接和操作确认。" : "Manage MCP sessions and tool approvals in Approval Center."}</small></span><button type="button" onClick={() => setActivePane("approvals")}>{zh ? "管理" : "Manage"}</button></div>}
              <div className="settings-integration-row"><FileText size={18} /><span><strong>IDE</strong><small>{ideContext?.currentFile?.path || (zh ? "当前没有 IDE 文件上下文" : "No IDE file context is active")}</small></span><em>{ideContext ? (zh ? "已连接" : "Connected") : (zh ? "未连接" : "Not connected")}</em></div>
              {featureCapabilities?.browser === true && <div className="settings-integration-row"><Globe2 size={18} /><span><strong>{zh ? "浏览器" : "Browser"}</strong><small>{zh ? "使用右侧浏览器面板查看和附加网页上下文。" : "Use the right browser panel to inspect and attach web context."}</small></span><button type="button" onClick={onOpenBrowserPanel}>{zh ? "打开" : "Open"}</button></div>}
              {(featureCapabilities?.serialVoice === true || featureCapabilities?.streamingVoice === true) && <div className="settings-integration-row"><MessageSquare size={18} /><span><strong>{zh ? "语音" : "Voice"}</strong><small>{zh ? "聊天输入区使用的语音转写运行时。" : "Voice transcription runtime used by the chat composer."}</small></span><em>{voiceIntegrationState === null ? (zh ? "检查中" : "Checking") : voiceIntegrationState}</em></div>}
              {featureCapabilities?.remoteWorkspace === true && <div className="settings-integration-row"><TerminalIcon size={18} /><span><strong>{zh ? "远程计算机" : "Remote computers"}</strong><small>{zh ? "已配置、可用于远程工作区的计算机。" : "Configured computers available to remote workspaces."}</small></span><em>{remoteHostCount === null ? (zh ? "检查中" : "Checking") : zh ? `${remoteHostCount} 台计算机` : `${remoteHostCount} computers`}</em></div>}
              {featureCapabilities?.remoteWorkspace === true && <div className="settings-integration-row" data-testid="android-pairing-entry">
                <Smartphone size={18} />
                <span>
                  <strong>{zh ? "Android 端" : "Android"}</strong>
                  <small>{mobileEnrollmentError ?? (zh ? "让 OpenDrSai Android 安全连接此电脑的 Runtime。" : "Securely connect OpenDrSai for Android to this computer's Runtime.")}</small>
                </span>
                <div className="settings-integration-actions">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={mobilePairingReadiness?.state === "ready"}
                    aria-label={zh ? "允许 Android 连接此电脑" : "Allow Android to connect to this computer"}
                    title={mobilePairingReadiness?.state === "ready"
                      ? (zh ? "已启用；关闭将撤销此电脑" : "Enabled; turn off to revoke this computer")
                      : (zh ? "未启用；打开以连接 Android" : "Disabled; turn on to connect Android")}
                    className={`settings-connection-switch ${mobilePairingReadiness?.state === "ready" ? "is-enabled" : ""}`}
                    data-testid="mobile-connection-toggle"
                    disabled={mobileEnrollmentBusy || mobilePairingReadiness === null}
                    onClick={() => {
                      if (mobilePairingReadiness?.state === "ready") void revokeMobileEnrollment();
                      else onOpenMobilePairing();
                    }}
                  ><span aria-hidden="true" /></button>
                  <button type="button" onClick={onOpenMobilePairing}>{zh ? "连接 Android" : "Connect Android"}</button>
                </div>
              </div>}
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
                <div><dt>{zh ? "OpenDrSai 主目录" : "OpenDrSai home"}</dt><dd>{health?.install.home || (zh ? "未知" : "unknown")}</dd>{health?.install.home && <button type="button" onClick={() => onOpenPath(health.install.home)}>{zh ? "打开" : "Open"}</button>}</div>
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
              <div><h2>{zh ? "数据与隐私" : "Data and privacy"}</h2><p>{zh ? "导出数据、清除 OpenDrSai 应用数据，或仅重置桌面偏好。" : "Export data, clear OpenDrSai app data, or reset desktop preferences only."}</p></div>
              <div className="settings-data-boundary" data-testid="data-cleanup-boundary">
                <p><strong>{zh ? "应用数据" : "App data"}</strong>{zh ? "：账户登录、会话、缓存、记忆、任务和设置，可以在这里清除。" : ": sign-in, conversations, cache, memory, tasks, and settings can be cleared here."}</p>
                <p><strong>{zh ? "用户原始材料" : "Your original files"}</strong>{zh ? "：工作区中的 PDF、PPT、数据文件和生成成果。清理应用数据或从 Windows 卸载 OpenDrSai 都不会删除这些文件。" : ": PDFs, presentations, data files, and generated results in your workspaces. Clearing app data or uninstalling OpenDrSai from Windows does not delete them."}</p>
              </div>
              <div className="settings-button-row"><button type="button" onClick={onExportLocalData}>{zh ? "导出本地数据" : "Export local data"}</button><button type="button" onClick={() => { if (window.confirm(zh ? "重置所有桌面偏好？本地会话内容会保留。" : "Reset all desktop preferences? Local conversation content will be preserved.")) onResetPreferences(); }}>{zh ? "重置偏好" : "Reset preferences"}</button></div>
              <div className="settings-button-row settings-danger-actions"><button type="button" data-testid="clear-session-data" disabled={cleanupBusy} onClick={() => void openDataCleanup("sessions")}>{zh ? "清除会话" : "Clear conversations"}</button><button type="button" className="danger" data-testid="clear-all-local-data" disabled={cleanupBusy} onClick={() => void openDataCleanup("all_local_data")}>{zh ? "清除全部应用数据" : "Clear all app data"}</button></div>
              {cleanupStatus ? <p className="settings-message" role="status" data-testid="data-cleanup-status">{cleanupStatus}</p> : null}
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "日志与诊断" : "Logs and diagnostics"}</h2><p>{zh ? "复制当前运行状态，便于排查桌面端问题。" : "Copy the current runtime state for desktop troubleshooting."}</p></div>
              <div className="settings-button-row"><button type="button" onClick={onCopyDiagnostics}>{zh ? "复制诊断信息" : "Copy diagnostics"}</button>{health?.install.home && <button type="button" onClick={() => onOpenPath(health.install.home)}>{zh ? "打开 OpenDrSai 目录" : "Open OpenDrSai home"}</button>}</div>
            </section>
            {developerModeAvailable && <section className="settings-section"><div><h2>{zh ? "开发者选项" : "Developer options"}</h2><p>{zh ? "切换后会重新加载桌面界面。" : "Changing this option reloads the desktop interface."}</p></div><label className="settings-toggle"><span><strong>{zh ? "开发者模式" : "Developer mode"}</strong><small>{zh ? "显示详细状态和调试输出。" : "Show detailed status and debugging output."}</small></span><input type="checkbox" checked={developerMode} onChange={(event) => onDeveloperModeChange(event.target.checked)} /></label></section>}
          </>
        )}
        {cleanupPreview ? (
          <section className="data-cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="data-cleanup-title" data-scope={cleanupPreview.scope} data-testid="data-cleanup-dialog">
            <h2 id="data-cleanup-title">{cleanupPreview.scope === "sessions" ? (zh ? "清除会话？" : "Clear conversations?") : (zh ? "清除全部应用数据？" : "Clear all app data?")}</h2>
            <p>{zh ? "将清除以下 OpenDrSai 应用数据：" : "The following OpenDrSai app data will be removed:"}</p>
            <ul data-testid="data-cleanup-categories">{cleanupPreview.applicationData.map((item) => <li key={item.category}><strong>{item.label}</strong><span>{item.description}</span></li>)}</ul>
            <p className="data-cleanup-preserved" data-testid="data-cleanup-preserved"><strong>{zh ? "不会删除用户原始材料" : "Your original files will not be deleted"}</strong>{zh ? `。已登记 ${cleanupPreview.preservedUserMaterials.length} 个工作区；其中的 PDF、PPT、数据文件和成果都会保留。` : `. Files and results in ${cleanupPreview.preservedUserMaterials.length} registered workspace(s) are preserved.`}</p>
            {cleanupPreview.scope === "all_local_data" ? <label><span>{zh ? `输入“${cleanupPreview.confirmationPhrase}”确认；完成后需要重新登录。` : `Type “${cleanupPreview.confirmationPhrase}” to confirm; you will need to sign in again.`}</span><input data-testid="data-cleanup-confirmation" value={cleanupConfirmation} onChange={(event) => setCleanupConfirmation(event.target.value)} /></label> : null}
            <div className="settings-button-row"><button type="button" data-testid="data-cleanup-cancel" onClick={() => setCleanupPreview(null)}>{zh ? "取消" : "Cancel"}</button><button type="button" className="danger" data-testid="data-cleanup-confirm" disabled={cleanupBusy || (cleanupPreview.scope === "all_local_data" && cleanupConfirmation !== cleanupPreview.confirmationPhrase)} onClick={() => void confirmDataCleanup()}>{cleanupBusy ? (zh ? "正在清除…" : "Clearing…") : (zh ? "确认清除" : "Confirm clear")}</button></div>
          </section>
        ) : null}
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
          ? "该面板功能正在准备中。"
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

function getAgentModelOptions(
  catalog: MyDrSaiModelConfig[],
  agent: DesktopAgent | undefined,
  selectedModel: string | null,
): MyDrSaiModelConfig[] {
  const byIdentity = new Map<string, MyDrSaiModelConfig>();
  for (const model of catalog) {
    for (const identity of [model.alias, model.model]) {
      if (identity?.trim()) byIdentity.set(identity.trim().toLowerCase(), model);
    }
  }

  const requested = agent?.models?.length
    ? agent.models
    : catalog.map((model) => model.alias || model.model || "").filter(Boolean);
  const fallbackIds = [agent?.model, selectedModel]
    .filter((value): value is string => Boolean(value?.trim()));
  const result: MyDrSaiModelConfig[] = [];
  const seen = new Set<string>();
  for (const id of [...requested, ...fallbackIds]) {
    const normalized = id.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    const configured = byIdentity.get(normalized);
    const model = configured ?? { alias: id.trim(), display_name: id.trim(), model: id.trim() };
    const identity = (model.alias || model.model || normalized).toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(normalized);
    seen.add(identity);
    result.push(model);
  }
  return result;
}

function getServiceUnavailableReason(
  blocker: DesktopBootstrapBlocker | null,
  language: AppLanguage,
): string {
  if (!blocker) {
    return language === "zh" ? "模型服务尚未就绪。" : "Model services are not ready yet.";
  }
  if (language !== "zh") return blocker.message;
  switch (blocker.kind) {
    case "auth_required":
      return "登录状态已失效，请重新登录。";
    case "permission_denied":
      return "当前账号没有可用的模型服务，请检查账号权限或重新登录。";
    case "runtime_missing":
      return "本地运行环境缺失或版本不匹配。";
    case "service_unavailable":
      return "本地模型服务暂不可用，正在后台重试。";
  }
}

export default App;
