import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { applyThreadSnapshotPatchBatch } from "./threadSnapshotPatch";
import { ThreadPatchFrameBatcher } from "./threadPatchFrameBatcher";
import { executeRecoveryActionOnce } from "./recoveryActionCoordinator";
import { ThreadSnapshotStore } from "./threadSnapshotStore";
import { ThreadSnapshotCoordinator } from "./threadSnapshotCoordinator";
import { threadSyncMetrics } from "./threadSyncMetrics";
import { CompletionDeliveryTracker } from "./completionDeliveryTracker";
import { verifyResultProvenance } from "../../api/resultProvenance";
import {
  Archive,
  AudioLines,
  Bot,
  Bug,
  Copy,
  FileText,
  Globe2,
  History,
  Image as ImageIcon,
  Library,
  ListTree,
  PackageOpen,
  Pencil,
  Lightbulb,
  MessageSquare,
  Plug,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal as TerminalIcon,
  Trash2,
  Type,
  Video,
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
  DesktopMobileAssociation,
  DesktopMobilePairingReadiness,
  DesktopThread,
  DesktopWorktreeSummary,
  ExperimentReleaseGateState,
  InstallProgress,
  AgentModelSelection,
  AgentModelCapabilityStatus,
  AgentSkillPolicy,
  AgentSkillPreview,
  AgentKnowledgePolicy,
  AgentKnowledgePreview,
  AgentToolPolicy,
  AgentToolPreview,
  MyDrSaiModelConfig,
  MyDrSaiModelApiProtocol,
  MyDrSaiModelCapability,
  MyDrSaiModelModality,
  MyDrSaiProviderModelConfig,
  MyDrSaiAgentModelPolicy,
  MyDrSaiModelConnection,
  MyDrSaiProviderPreset,
  MyDrSaiConfig,
  RemoteSshHost,
  RemoteSshHostKey,
  RemoteDirectoryEntry,
  RunInspectionOpenRequest,
  RuntimeModelOperation,
  WorkspaceFilePreview,
  WorkspaceProject,
} from "@shared/desktopApi";
import { desktopApi } from "./desktopApi";
import { copyTextSafely } from "./clipboard";
import { describeUserFacingError, type UserFacingRecoveryAction } from "./userFacingErrors";
import { userFacingFailureMessage } from "./userFacingLanguage";
import { isSelectableModelAvailability, modelCatalogRecoveryCopy } from "./modelCatalogRecovery";
import { normalizeRuntimeErrorEnvelope } from "../../api/errorEnvelope";
import { LoginScreen } from "./auth/LoginScreen";
import { useAuth } from "./auth/AuthProvider";
import { deriveOperationalRunState, deriveOperationalState, shouldShowOperationalStateBar, type OperationalStateFacts } from "@shared/operationalState";
import { AgentSquareView } from "./components/AgentSquareView";
import { AgentRunWorkspace } from "./components/AgentRunWorkspace";
import { ApprovalCenterView } from "./components/ApprovalCenterView";
import { ChannelsView } from "./components/ChannelsView";
import { ChatWorkspace, type ThinkingEffort } from "./components/ChatWorkspace";
import { PreviewBrowserPanel } from "./components/PreviewBrowserPanel";
import { ProviderAnalyticsView } from "./components/ProviderAnalyticsView";
import { BackgroundTaskQueue } from "./components/SkillSquareView";
// Temporarily hide Skills management UI — keep for later reuse.
// import { SkillSquareView } from "./components/SkillSquareView";
// import { SkillsManager } from "./components/SkillsManager";
// Temporarily hide GFS cloud UI — keep for later reuse.
// import { GfsView } from "./components/GfsView";
import { TaskCenterView } from "./components/TaskCenterView";
import { MobilePairingDialog, mobilePairingErrorText } from "./components/MobilePairingDialog";
import { TerminalPanel } from "./components/TerminalPanel";
import { DebugPanel } from "./components/DebugPanel";
import { RunInspectorPanel } from "./components/RunInspectorPanel";
import { AppDecisionDialogHost, requestAppDecision, showAppNotice } from "./components/AppDecisionDialog";
import { FilesContextPanel } from "./components/files/FilesContextPanel";
import {
  createAgentRunContextTraceEvents,
  createTraceEventFromAgentFileEvent,
  type AgentFileTraceEvent,
} from "./components/files/AgentFileActivityPanel";
import type {
  ForkConflictContentPreviewResult,
  ForkConflictDraftWriteResult,
  ForkConflictFile,
  ForkConflictStageResult,
  WorkspaceThread,
} from "./components/WorkspaceShell";
import { ModelSettingsContainer, type ModelSettingsDraftController } from "./containers/ModelSettingsContainer";
import { ResultsContainer, useResultsContainerController } from "./containers/ResultsContainer";
import { TaskShellContainer } from "./containers/TaskShellContainer";
import { DiagnosticsContainer } from "./containers/DiagnosticsContainer";
import {
  type ChatThreadSnapshot,
  useDesktopChatAdapter,
} from "./adapters/useDesktopChatAdapter";
import { stripAttachmentContextFromUserContent } from "@shared/attachmentContextDisplay";
// Temporarily hide Skills management entry — keep for later reuse.
// import type { ChatCommandAction } from "./chatCommands";
import type { DesktopPlatformDescriptor } from "@shared/platform";
import { redactSensitiveData } from "../../api/sensitiveData";
import { buildLocalDesktopDataExport } from "./localDataExport";
import { useDesktopHealthAdapter } from "./adapters/useDesktopHealthAdapter";
import {
  deriveThreadActivity,
  indexBackgroundTasksByThread,
} from "./threadActivity";
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
  run: ListTree,
  files: FileText,
  templates: Sparkles,
  browser: Globe2,
  terminal: TerminalIcon,
  debug: Bug,
};

const WORKSPACE_SORT_STORAGE_KEY = "opendrsai.workspaceSortMode";
const DEVELOPER_MODE_STORAGE_KEY = "opendrsai.developerMode";
const LANGUAGE_STORAGE_KEY = "opendrsai.language";
const SESSION_SCOPE_STORAGE_KEY = "opendrsai.sessionScope";
const DEFAULT_AGENT_STORAGE_KEY = "opendrsai.defaultAgent";
const WORKSPACE_AGENT_STORAGE_KEY = "opendrsai.workspaceDefaultAgents";
const THINKING_EFFORT_STORAGE_KEY = "opendrsai.thinkingEffort";
const AGENT_CONFIGURATIONS_STORAGE_KEY = "opendrsai.agentConfigurations";
const AGENT_MODEL_POLICY_MIGRATION_KEY = "opendrsai.agentModelPolicyMigration.v1";
const AGENT_MODEL_POLICY_MIGRATION_BACKUP_KEY = "opendrsai.agentConfigurations.preModelPolicy.v1.backup";
const DEFAULT_AGENT_TEXT_MODEL = "deepseek-v4-pro";
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
type AgentConfigurationTab = "opendrsai" | "codex" | "platform";
type AgentCapabilityModelRole = "image_understanding_model" | "image_generation_model" | "text_to_speech_model" | "speech_to_text_model";
interface AgentConfigurationPreference {
  model?: string;
  modelRef?: { provider_id: string; model_id: string };
  imageModel?: string;
  thinkingEffort?: ThinkingEffort;
}

function getAgentConfigurationTab(agent: DesktopAgent): AgentConfigurationTab {
  if (agent.id === "my-codex") return "codex";
  if (agent.source === "remote") return "platform";
  return "opendrsai";
}
interface SidebarComponentVisibility {
  square: boolean;
  agents: boolean;
  skills: boolean;
}
interface RightSidebarComponentVisibility {
  run: boolean;
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
  const [mobilePairingRefreshToken, setMobilePairingRefreshToken] = useState(0);
  const [awaySummary, setAwaySummary] = useState<AwaySummary | null>(null);
  const [deliveryTask, setDeliveryTask] = useState<DesktopBackgroundTask | null>(null);
  const completionDeliveryTrackerRef = useRef(new CompletionDeliveryTracker());
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
  // Temporarily hide Skills management entry — keep for later reuse.
  // const [skillSquareCommandTarget, setSkillSquareCommandTarget] =
  //   useState<Extract<ChatCommandAction, { type: "open-view" }>["target"] | null>(null);
  const [navHistory, setNavHistory] = useState<NavId[]>([
    MENU_IDS.currentSession,
  ]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(0);
  const [activeRightTab, setActiveRightTab] = useState<RightTab>("files");
  const [debugViewRequest, setDebugViewRequest] = useState<{ view: "activity"; nonce: number } | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => loadRestoredWorkspaceId());
  const [storedWorkspaces, setStoredWorkspaces] = useState<WorkspaceProject[]>(
    [],
  );
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const workspaceRefreshPromiseRef = useRef<Promise<WorkspaceProject[]> | null>(null);
  const chatChoicesPromiseRef = useRef(new Map<string, Promise<{
    agents: DesktopAgent[];
    myDrSaiConfig: MyDrSaiConfig;
    agentModelPolicy: MyDrSaiAgentModelPolicy;
  }>>());
  const chatChoicesGenerationRef = useRef(0);
  const [chatChoicesRefreshNonce, setChatChoicesRefreshNonce] = useState(0);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [workspaceLocationChoice, setWorkspaceLocationChoice] = useState<"remote" | null>(null);
  const [remoteWorkspaceStep, setRemoteWorkspaceStep] = useState<"computer" | "directory">("computer");
  const [remoteHosts, setRemoteHosts] = useState<RemoteSshHost[]>([]);
  const [remoteHostAlias, setRemoteHostAlias] = useState("");
  const [remotePath, setRemotePath] = useState("/home/vscode");
  const [remoteDialogError, setRemoteDialogError] = useState("");
  const [remoteConnecting, setRemoteConnecting] = useState(false);
  const [workspaceSessionSyncMessage, setWorkspaceSessionSyncMessage] = useState<string | null>(null);
  const [workspaceSessionSyncing, setWorkspaceSessionSyncing] = useState(false);
  const workspaceSessionSyncGenerationRef = useRef(0);
  const workspaceSessionSyncRequestRef = useRef<string | null>(null);
  const recoveryActionInFlightRef = useRef(new Set<string>());
  useEffect(() => desktopApi.onCodexWorkspaceSessionSyncProgress((progress) => {
    if (progress.requestId !== workspaceSessionSyncRequestRef.current) return;
    const names = language === "zh"
      ? { discovered: "正在发现会话", read: "已读取会话", projected: "正在整理会话", persisted: "正在保存会话", cancelled: "同步已取消" }
      : { discovered: "Discovering sessions", read: "Sessions read", projected: "Organizing sessions", persisted: "Saving sessions", cancelled: "Sync cancelled" };
    const count = progress.total > 0 ? ` ${progress.completed}/${progress.total}` : "";
    setWorkspaceSessionSyncMessage(`${names[progress.phase]}${count}`);
  }), [language]);
  const [remoteNeedsHostTrust, setRemoteNeedsHostTrust] = useState(false);
  const [remoteHostKeys, setRemoteHostKeys] = useState<RemoteSshHostKey[]>([]);
  const [remoteDirectories, setRemoteDirectories] = useState<RemoteDirectoryEntry[]>([]);
  const [remoteShowHidden, setRemoteShowHidden] = useState(false);
  const [remoteRecentPaths, setRemoteRecentPaths] = useState<string[]>(() => loadRemoteRecentPaths());
  const [threads, setThreads] = useState<DesktopThread[]>([]);
  const [threadBackgroundTasks, setThreadBackgroundTasks] = useState<DesktopBackgroundTask[]>([]);
  const [operationalE2eFacts, setOperationalE2eFacts] = useState<OperationalStateFacts | null>(null);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(() => loadRestoredThreadId());
  const activeThreadIdRef = useRef(activeThreadId);
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);
  const threadSnapshotStoreRef = useRef<ThreadSnapshotStore | null>(null);
  if (!threadSnapshotStoreRef.current) threadSnapshotStoreRef.current = new ThreadSnapshotStore();
  const threadSnapshotStore = threadSnapshotStoreRef.current;
  const subscribeActiveThreadSnapshot = useCallback(
    (listener: () => void) => threadSnapshotStore.subscribe(activeThreadId, listener),
    [activeThreadId, threadSnapshotStore],
  );
  const subscribedThreadSnapshot = useSyncExternalStore(
    subscribeActiveThreadSnapshot,
    () => threadSnapshotStore.get(activeThreadId),
    () => null,
  );
  const threadSnapshotCoordinatorRef = useRef(new ThreadSnapshotCoordinator());
  const threadHydrationsRef = useRef(new Map<string, { generation: number; requestId: string; promise: Promise<void> }>());
  useEffect(() => {
    for (const [threadId, hydration] of threadHydrationsRef.current) {
      if (threadId !== activeThreadId) {
        void desktopApi.cancelThreadSnapshotHydration(hydration.requestId).catch(() => false);
      }
    }
  }, [activeThreadId]);
  const [hydratingThreadId, setHydratingThreadId] = useState<string | null>(null);
  const [threadHydrationError, setThreadHydrationError] = useState<{ threadId: string; message: string } | null>(null);
  const [workspaceSortMode, setWorkspaceSortMode] = useState<WorkspaceSortMode>(
    () => loadWorkspaceSortMode(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [runInspectionRequest, setRunInspectionRequest] = useState<(RunInspectionOpenRequest & { focusedItemId?: string }) | null>(null);
  const [experimentReleaseGate, setExperimentReleaseGate] = useState<ExperimentReleaseGateState>({
    schema_version: "opendrsai.experiment-release-gate/1",
    enabled: false,
    required_features: ["M31-02", "M31-03", "M31-04", "M31-05"],
    passed_features: [],
    blocking_features: ["M31-02", "M31-03", "M31-04", "M31-05"],
    source_ledger_sha256: null,
    reason: "release_gate_resource_missing",
  });

  useEffect(() => {
    let disposed = false;
    void desktopApi.getExperimentReleaseGate()
      .then((gate) => { if (!disposed) setExperimentReleaseGate(gate); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    function openRunInspection(event: Event): void {
      const detail = (event as CustomEvent<Partial<RunInspectionOpenRequest> & { focusedItemId?: string }>).detail;
      if (!detail || typeof detail.runId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(detail.runId)) return;
      if (typeof detail.workspacePath !== "string" || !detail.workspacePath.trim()) return;
      setRunInspectionRequest({
        workspacePath: detail.workspacePath,
        ...(typeof detail.workspaceId === "string" && detail.workspaceId ? { workspaceId: detail.workspaceId } : {}),
        runId: detail.runId,
        ...(detail.createExperiment === true && experimentReleaseGate.enabled ? { createExperiment: true } : {}),
        ...(typeof detail.focusedItemId === "string" ? { focusedItemId: detail.focusedItemId } : {}),
      });
      setActiveRightTab("run");
      setRightPanelCollapsed(false);
    }
    window.addEventListener("opendrsai:open-run-inspection", openRunInspection);
    return () => window.removeEventListener("opendrsai:open-run-inspection", openRunInspection);
  }, [experimentReleaseGate.enabled]);
  const [sessionScope, setSessionScope] = useState<"workspace" | "all">(() => loadSessionScope());
  const [availableChatAgents, setAvailableChatAgents] = useState<DesktopAgent[]>([]);
  const [availableChatModels, setAvailableChatModels] = useState<MyDrSaiModelConfig[]>([]);
  const [selectedChatAgentId, setSelectedChatAgentId] = useState<string | null>(() => loadOptionalSetting(DEFAULT_AGENT_STORAGE_KEY));
  const [selectedChatAgentName, setSelectedChatAgentName] = useState("OpenDrSai");
  const [selectedChatModel, setSelectedChatModel] = useState<string | null>(null);
  const [defaultThinkingEffort, setDefaultThinkingEffort] = useState<ThinkingEffort>(() => loadThinkingEffort());
  const [agentConfigurations, setAgentConfigurations] = useState<Record<string, AgentConfigurationPreference>>(() => loadAgentConfigurations());
  const [restoreLastSession, setRestoreLastSession] = useState(() => loadBooleanSetting(RESTORE_SESSION_STORAGE_KEY, true));
  const [restoreLastWorkspace, setRestoreLastWorkspace] = useState(() => loadBooleanSetting(RESTORE_WORKSPACE_STORAGE_KEY, true));
  const [completionNotifications, setCompletionNotifications] = useState(() => loadBooleanSetting(COMPLETION_NOTIFICATION_STORAGE_KEY, false));
  const [appearance, setAppearance] = useState<AppearanceMode>(() => loadAppearance());
  const [sidebarComponents, setSidebarComponents] = useState<SidebarComponentVisibility>(() => loadSidebarComponents());
  const [rightSidebarComponents, setRightSidebarComponents] = useState<RightSidebarComponentVisibility>(() => loadRightSidebarComponents());
  const [myDrSaiConfig, setMyDrSaiConfig] = useState<MyDrSaiConfig | null>(null);
  const [myDrSaiAgentModelPolicy, setMyDrSaiAgentModelPolicy] = useState<MyDrSaiAgentModelPolicy | null>(null);
  const myDrSaiConfigRef = useRef<MyDrSaiConfig | null>(null);
  const [myDrSaiConfigLoaded, setMyDrSaiConfigLoaded] = useState(false);
  const [requestedSettingsPane, setRequestedSettingsPane] = useState<SettingsPane | null>(null);
  const [selectedChatExamples, setSelectedChatExamples] = useState<
    DesktopAgent["examples"]
  >();
  const selectedChatAgent = availableChatAgents.find((agent) => agent.id === selectedChatAgentId);
  const chatModelOptions = useMemo(
    () => getAgentModelOptions(
      availableChatModels,
      selectedChatAgent,
      selectedChatModel,
    ),
    [availableChatModels, selectedChatAgent, selectedChatModel],
  );
  const [pendingChatInput, setPendingChatInput] = useState<string | null>(null);
  const resultsContainer = useResultsContainerController();
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
  const workspaces = storedWorkspaces;
  const sortedWorkspaces = sortWorkspacesForSidebar(workspaces, workspaceSortMode);
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    EMPTY_WORKSPACE;
  const activeWorkspacePathKey = getComparablePath(activeWorkspace.path);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeThreadInCatalog = Boolean(activeThread);
  const rawActiveSnapshot = subscribedThreadSnapshot;
  // Suppress localStorage ghosts until/unless the thread exists in the sidebar catalog.
  const activeThreadSnapshot =
    !threadsLoaded
      ? null
      : activeThreadInCatalog
        ? rawActiveSnapshot
        : (rawActiveSnapshot?.messages?.length ?? 0) > 0
          ? null
          : rawActiveSnapshot;
  const activeThreadWorkspacePath = activeThread?.workspacePath?.trim();
  const matchedThreadWorkspace = activeThreadWorkspacePath
    ? workspaces.find((workspace) =>
      getComparablePath(workspace.path) === getComparablePath(activeThreadWorkspacePath))
    : undefined;
  // Historical Threads could persist the display label "Local workspace" as
  // a relative path. Only a Runtime-issued canonical path or a registered
  // Workspace path may override the active Workspace.
  const effectiveWorkspacePath = activeThread?.execution?.canonicalPath
    || matchedThreadWorkspace?.path
    || activeWorkspace.path;
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
  const backgroundTaskByThreadId = useMemo(
    () => indexBackgroundTasksByThread(threads, threadBackgroundTasks),
    [threadBackgroundTasks, threads],
  );
  const toWorkspaceThread = (thread: DesktopThread): WorkspaceThread => ({
    id: thread.id,
    title: thread.title,
    timeLabel: formatThreadTime(thread.updatedAt, language),
    workspaceId: resolveThreadWorkspaceId(thread, workspaces),
    workspacePath: thread.workspacePath,
    fork: thread.fork,
    active: thread.id === activeThreadId,
    pinned: thread.pinned,
    archived: thread.archived,
    unread: thread.unread,
    activity: deriveThreadActivity({
      thread,
      snapshot: thread.id === activeThreadId ? activeThreadSnapshot ?? undefined : undefined,
      backgroundTask: backgroundTaskByThreadId.get(thread.id),
    }),
    source: workspaces.find((workspace) => getComparablePath(workspace.path) === getComparablePath(thread.workspacePath || ""))?.location === "remote"
      ? "remote"
      : thread.archiveSource === "codex" || thread.boundAgentId === "my-codex" ? "codex" : "opendrsai",
  });
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
    .map(toWorkspaceThread);
  const searchableThreads: WorkspaceThread[] = visibleThreads.map(toWorkspaceThread);
  const workspaceThreads: WorkspaceThread[] = threads
    .filter((thread) => !thread.archived)
    .map(toWorkspaceThread);
  const remotePlatformChatAvailable = Boolean(
    selectedChatAgent?.source === "remote"
    && selectedChatAgent.available !== false
    && selectedChatAgent.status === "running",
  );
  const servicePreparing = !remotePlatformChatAvailable && (auth.serviceBusy || !auth.serviceReady);
  const runtimeAvailable = remotePlatformChatAvailable || Boolean(health?.installed || health?.gateway?.externalReady);
  const chatUnavailableReason = remotePlatformChatAvailable
    ? undefined
    : auth.serviceBusy
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
          : !effectiveWorkspacePath
            ? language === "zh"
              ? "请先创建或打开一个工作区。"
              : "Create or open a workspace first."
            : !workspaceTrusted
              ? language === "zh"
                ? "请先信任当前工作区。"
                : "Trust this workspace before sending."
              : undefined;
  function recordSuccessfulModelUsage(): void {
    if (selectedChatAgentId !== myDrSaiAgentModelPolicy?.agent_id) return;
    const ref = myDrSaiAgentModelPolicy.effective_ref;
    if (!ref) return;
    const testedAt = new Date().toISOString();
    setMyDrSaiConfig((current) => {
      if (!current?.modelConnection) return current;
      const success = {
        provider: ref.provider_id,
        model: ref.model_id,
        mode: "model" as const,
        ok: true,
        tested_at: testedAt,
      };
      const updated = {
        ...current,
        modelConnection: {
          ...current.modelConnection,
          last_test: { ...success, last_success: success },
        },
      };
      myDrSaiConfigRef.current = updated;
      return updated;
    });
  }
  const chat = useDesktopChatAdapter({
    availableAgents: availableChatAgents,
    availableModels: availableChatModels,
    canChat: Boolean(
      !sessionRestoring
        && !servicePreparing
        && runtimeAvailable
        && effectiveWorkspacePath
        && workspaceTrusted,
    ),
    developerMode,
    onChatComplete: (successful) => {
      if (successful) recordSuccessfulModelUsage();
      void desktop.refreshHealth();
      showCompletionNotification(completionNotifications, language, false);
    },
    onForkThreadCreated: handleForkThreadCreated,
    // Temporarily hide Skills management entry — keep for later reuse.
    // onOpenSkillsSquare: (target) => {
    //   setSkillSquareCommandTarget(target ?? null);
    //   setActiveNav(MENU_IDS.skillsSquare);
    // },
    onOpenSkillsSquare: () => undefined,
    onSelectAgent: handleChatAgentSelect,
    onSelectModel: handleChatModelSelect,
    onThreadUpdated: handleThreadUpdated,
    language,
    threadId: activeThreadId,
    threadSnapshot: activeThreadSnapshot,
    workspaceInstructions: effectiveWorkspaceInstructions,
    workspaceId: effectiveRuntimeWorkspaceId,
    workspaceName: effectiveWorkspace.name,
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
    effectiveWorkspacePath &&
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

  // Cold start / empty list: retry after the gateway is ready so Runtime can
  // create or rebind the user-writable default workspace.
  useEffect(() => {
    if (!workspacesLoaded || !health?.gatewayReady || storedWorkspaces.length > 0) return;
    let cancelled = false;
    void refreshWorkspaces().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [health?.gatewayReady, storedWorkspaces.length, workspacesLoaded]);

  // Selection must always reference an id returned by listWorkspaces().
  useEffect(() => {
    if (!workspacesLoaded) return;
    if (storedWorkspaces.length === 0) {
      if (activeWorkspaceId) setActiveWorkspaceId("");
      return;
    }
    const selectedExists = storedWorkspaces.some((workspace) => workspace.id === activeWorkspaceId);
    if (!selectedExists || activeWorkspaceId === "current") {
      setActiveWorkspaceId(storedWorkspaces[0].id);
    }
  }, [activeWorkspaceId, storedWorkspaces, workspacesLoaded]);

  useEffect(() => desktopApi.onRemoteWorkspaceStatus((status) => {
    setStoredWorkspaces((current) => current.map((workspace) => workspace.id === status.workspaceId ? { ...workspace, remote: status, updatedAt: new Date().toISOString() } : workspace));
  }), []);
  useEffect(() => {
    const batcher = new ThreadPatchFrameBatcher((events) => {
      const p9StartedAt = performance.now();
      const byThread = new Map<string, typeof events>();
      for (const event of events) byThread.set(event.threadId, [...(byThread.get(event.threadId) ?? []), event]);
      for (const [threadId, threadEvents] of byThread) {
        const snapshot = threadSnapshotStore.get(threadId);
        if (!snapshot) { void scheduleThreadResync(threadId); continue; }
        try {
          const result = applyThreadSnapshotPatchBatch(
            snapshot,
            threadEvents,
            threadSnapshotCoordinatorRef.current.get(threadId)?.generation ?? -1,
          );
          const estimatedByteDelta = threadEvents.reduce((total, event) => event.patch.kind === "item.delta"
            ? total + event.patch.delta.text.length * 2 : total, 0);
          threadSnapshotStore.set(threadId, result.snapshot, estimatedByteDelta);
          threadSnapshotCoordinatorRef.current.markApplied(threadId, result.appliedSequence);
        } catch (error) {
          threadSnapshotCoordinatorRef.current.rejectPending(threadId);
          console.error("thread_snapshot_patch_batch_failed", { threadId, error });
          void scheduleThreadResync(threadId);
        }
      }
      threadSyncMetrics.observe("apply", performance.now() - p9StartedAt);
      requestAnimationFrame(() => threadSyncMetrics.observe("render", performance.now() - p9StartedAt));
      const p9Metrics = (window as unknown as { __OPENDRSAI_P9_RENDER_METRICS?: {
        applyMs: number[]; renderMs: number[]; lastThreadId?: string; finalContentLength?: number;
      } }).__OPENDRSAI_P9_RENDER_METRICS;
      if (p9Metrics) {
        p9Metrics.applyMs.push(performance.now() - p9StartedAt);
        const measuredThreadId = events.at(-1)?.threadId;
        requestAnimationFrame(() => {
          p9Metrics.renderMs.push(performance.now() - p9StartedAt);
          p9Metrics.lastThreadId = measuredThreadId;
          p9Metrics.finalContentLength = measuredThreadId
            ? (threadSnapshotStore.get(measuredThreadId)?.messages.at(-1)?.content.length ?? 0) : 0;
        });
      }
    });
    const removeSnapshot = desktopApi.onThreadSnapshot((event) => {
      const snapshot = mergeThreadSnapshotForDisplay(event.snapshot, threadSnapshotStore.get(event.threadId) ?? undefined);
      if (!threadSnapshotCoordinatorRef.current.commitEnvelope(event, () => threadSnapshotStore.set(event.threadId, snapshot))) return;
      batcher.clearThread(event.threadId);
    });
    const removePatch = desktopApi.onThreadSnapshotPatch((event) => {
      threadSyncMetrics.observe("transport", Math.max(0, Date.now() - event.patch.updatedAt));
      const waterline = threadSnapshotCoordinatorRef.current.get(event.threadId);
      if (!threadSnapshotCoordinatorRef.current.acceptPatch(event)) {
        batcher.clearThread(event.threadId);
        console.error("thread_snapshot_patch_rejected", {
          threadId: event.threadId, generation: event.generation, expectedGeneration: waterline?.generation,
          baseSequence: event.baseSequence, expectedSequence: waterline?.acceptedSequence,
        });
        void scheduleThreadResync(event.threadId, {
          minimumSequence: event.sessionSequence,
          expectedGeneration: event.generation,
        });
        return;
      }
      batcher.enqueue(event);
    });
    return () => {
      removeSnapshot();
      removePatch();
      batcher.dispose();
    };
  }, []);
  useEffect(() => desktopApi.onThreadCatalogUpdate((event) => {
    setThreads((current) => sortThreadsForSidebar([
      event.thread,
      ...current.filter((item) => item.id !== event.thread.id),
    ]));
  }), []);
  useEffect(() => {
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    async function refreshThreadBackgroundTasks(): Promise<void> {
      try {
        const next = await desktopApi.listBackgroundTasks({ limit: 100 });
        if (disposed) return;
        setThreadBackgroundTasks((current) =>
          haveSameThreadTaskActivity(current, next) ? current : next,
        );
      } catch {
        // Thread snapshots and persisted thread status remain valid fallbacks.
      } finally {
        if (!disposed) {
          refreshTimer = setTimeout(
            () => void refreshThreadBackgroundTasks(),
            document.visibilityState === "visible" ? 1_000 : 15_000,
          );
        }
      }
    }

    function refreshWhenVisible(): void {
      if (document.visibilityState !== "visible") return;
      if (refreshTimer) clearTimeout(refreshTimer);
      void refreshThreadBackgroundTasks();
    }

    void refreshThreadBackgroundTasks();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);
  useEffect(() => {
    const newlyCompleted = completionDeliveryTrackerRef.current.observe(
      threadBackgroundTasks,
      activeThreadId ?? undefined,
    );
    if (newlyCompleted) setDeliveryTask((current) => current ?? newlyCompleted);
  }, [activeThreadId, threadBackgroundTasks]);
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
    window.localStorage.setItem(THINKING_EFFORT_STORAGE_KEY, defaultThinkingEffort);
  }, [defaultThinkingEffort]);

  useEffect(() => {
    const compatibilityOnly = Object.fromEntries(Object.entries(agentConfigurations).map(([agentId, preference]) => {
      if (agentId !== myDrSaiAgentModelPolicy?.agent_id && agentId !== "my-drsai") return [agentId, preference];
      const { modelRef: _modelRef, ...withoutStructuredRef } = preference;
      if (window.localStorage.getItem(AGENT_MODEL_POLICY_MIGRATION_KEY) !== "complete") return [agentId, withoutStructuredRef];
      const { model: _model, imageModel: _imageModel, ...legacyCompatibility } = withoutStructuredRef;
      return [agentId, legacyCompatibility];
    }));
    window.localStorage.setItem(AGENT_CONFIGURATIONS_STORAGE_KEY, JSON.stringify(compatibilityOnly));
  }, [agentConfigurations]);

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
      const pathKey = getComparablePath(event.target.workspacePath);
      setStoredWorkspaces((current) => {
        const match = current.find((workspace) => getComparablePath(workspace.path) === pathKey);
        if (match) setActiveWorkspaceId(match.id);
        return current;
      });
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
    if (restoreLastWorkspace && activeWorkspaceId) {
      window.localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, activeWorkspaceId);
    }
  }, [activeWorkspaceId, restoreLastWorkspace]);

  useEffect(() => {
    void refreshThreads();
  }, []);

  // One-shot: drop restored localStorage ghosts that are not in the thread catalog.
  const restoredSessionValidatedRef = useRef(false);
  useEffect(() => {
    if (!threadsLoaded || !workspacesLoaded || restoredSessionValidatedRef.current) return;
    restoredSessionValidatedRef.current = true;
    const catalogThread = threads.find((thread) => thread.id === activeThreadId);
    if (!catalogThread) {
      const orphan = threadSnapshotStore.get(activeThreadId);
      if ((orphan?.messages?.length ?? 0) > 0 || (orphan?.messageCount ?? 0) > 0) {
        threadSnapshotStore.delete(activeThreadId);
        setActiveThreadId(createLocalThreadId());
        window.localStorage.removeItem(LAST_THREAD_STORAGE_KEY);
      }
      return;
    }
    if (!activeWorkspace.id || !activeWorkspace.path || !catalogThread.workspacePath) return;
    const sameWorkspace =
      catalogThread.execution?.workspaceId === activeWorkspace.id
      || getComparablePath(catalogThread.workspacePath) === getComparablePath(activeWorkspace.path);
    if (!sameWorkspace) {
      setActiveThreadId(createLocalThreadId());
    }
  }, [
    activeThreadId,
    activeWorkspace.id,
    activeWorkspace.path,
    threadSnapshotStore,
    threads,
    threadsLoaded,
    workspacesLoaded,
  ]);

  // When switching workspaces, do not keep showing a conversation from another path.
  useEffect(() => {
    if (!threadsLoaded || !workspacesLoaded || !activeWorkspace.id || !activeWorkspace.path) return;
    if (!activeThreadId) return;
    const catalogThread = threads.find((thread) => thread.id === activeThreadId);
    if (!catalogThread?.workspacePath) return;
    const sameWorkspace =
      catalogThread.execution?.workspaceId === activeWorkspace.id
      || getComparablePath(catalogThread.workspacePath) === getComparablePath(activeWorkspace.path);
    if (!sameWorkspace) {
      setActiveThreadId(createLocalThreadId());
    }
  }, [activeWorkspace.id, activeWorkspace.path, threadsLoaded, workspacesLoaded]);

  useEffect(() => {
    const thread = threads.find((item) => item.id === activeThreadId);
    if (!thread || activeThreadSnapshot) return;
    // Restore/open only the active body. Blank sessions have no body to read;
    // all other directory entries stay as lightweight DesktopThread metadata.
    if ((thread.messageCount ?? 0) <= 0 && !thread.runtimeSessionId) return;
    void hydrateThreadSnapshot(activeThreadId);
  }, [activeThreadId, activeThreadSnapshot, threads]);

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
    let retryTimer: number | undefined;
    const generation = chatChoicesGenerationRef.current;
    if (!myDrSaiConfigRef.current) setMyDrSaiConfigLoaded(false);
    const scheduleRetry = (): void => {
      if (cancelled || retryTimer !== undefined) return;
      retryTimer = window.setTimeout(() => {
        if (!cancelled) setChatChoicesRefreshNonce((current) => current + 1);
      }, 1_000);
    };
    async function loadChatChoices(): Promise<void> {
      try {
        const key = `${user?.id || "signed-out"}::${getComparablePath(effectiveWorkspacePath) || "default"}`;
        let request = chatChoicesPromiseRef.current.get(key);
        if (!request) {
          request = Promise.all([
            desktopApi.listAgents(),
            desktopApi.getMyDrSaiConfig(effectiveWorkspacePath || undefined),
            desktopApi.getMyDrSaiAgentModelPolicy(),
          ]).then(([agents, myDrSaiConfig, agentModelPolicy]) => ({ agents, myDrSaiConfig, agentModelPolicy }));
          chatChoicesPromiseRef.current.set(key, request);
          void request.finally(() => {
            if (chatChoicesPromiseRef.current.get(key) === request) {
              chatChoicesPromiseRef.current.delete(key);
            }
          }).catch(() => undefined);
        }
        let { agents, myDrSaiConfig, agentModelPolicy } = await request;
        if (cancelled || generation !== chatChoicesGenerationRef.current) return;
        const legacyModel = loadAgentConfigurations()["my-drsai"]?.model;
        const localAgentName = agentModelPolicy.agent_id;
        if (window.localStorage.getItem(AGENT_MODEL_POLICY_MIGRATION_KEY) !== "complete") {
          if (legacyModel) agentModelPolicy = await desktopApi.migrateMyDrSaiAgentModelPolicy(localAgentName, legacyModel, agentModelPolicy.revision);
          const legacyConfigurations = window.localStorage.getItem(AGENT_CONFIGURATIONS_STORAGE_KEY);
          if (legacyConfigurations !== null && window.localStorage.getItem(AGENT_MODEL_POLICY_MIGRATION_BACKUP_KEY) === null) {
            window.localStorage.setItem(AGENT_MODEL_POLICY_MIGRATION_BACKUP_KEY, legacyConfigurations);
          }
          window.localStorage.setItem(AGENT_MODEL_POLICY_MIGRATION_KEY, "complete");
          setAgentConfigurations((current) => {
            const preference = current["my-drsai"];
            if (!preference) return current;
            const { model: _model, modelRef: _modelRef, imageModel: _imageModel, ...retained } = preference;
            const { "my-drsai": _legacy, ...withoutLegacy } = current;
            return { ...withoutLegacy, [localAgentName]: { ...current[localAgentName], ...retained } };
          });
        }
        setMyDrSaiAgentModelPolicy(agentModelPolicy);
        setAgentConfigurations((current) => ({
          ...current,
          [agentModelPolicy.agent_id]: {
            ...current[agentModelPolicy.agent_id],
            ...(agentModelPolicy.effective_ref
              ? { model: agentModelPolicy.effective_ref.model_id, modelRef: agentModelPolicy.effective_ref }
              : { model: undefined, modelRef: undefined }),
            ...(agentModelPolicy.reasoning_effort ? { thinkingEffort: agentModelPolicy.reasoning_effort } : {}),
          },
        }));
        if (agentModelPolicy.reasoning_effort) setDefaultThinkingEffort(agentModelPolicy.reasoning_effort);
        setAvailableChatAgents(agents);
        if (myDrSaiConfig.ready || !myDrSaiConfigRef.current) {
          setAvailableChatModels(myDrSaiConfig.models ?? []);
          myDrSaiConfigRef.current = myDrSaiConfig;
          setMyDrSaiConfig(myDrSaiConfig);
        }
        setMyDrSaiConfigLoaded(true);
        if (!myDrSaiConfig.ready) scheduleRetry();
        if (cancelled || agents.length === 0) return;
        const defaultAgent =
          agents.find((agent) => agent.isDefault) ??
          agents.find((agent) => agent.id === agentModelPolicy.agent_id) ??
          agents.find((agent) => agent.status === "running") ??
          agents[0];
        const workspaceAgentId = loadWorkspaceAgentPreference(activeWorkspaceId);
        const preferredAgent = agents.find((agent) => agent.id === workspaceAgentId)
          ?? agents.find((agent) => agent.id === selectedChatAgentId)
          ?? defaultAgent;
        setSelectedChatAgentId(preferredAgent.id);
        setSelectedChatAgentName(preferredAgent.name);
        setSelectedChatModel((current) => {
          const preferredModel = preferredAgent.id === agentModelPolicy.agent_id
            ? agentModelPolicy.effective_ref?.model_id ?? null
            : preferredAgent.model ?? preferredAgent.models?.[0] ?? null;
          if (preferredAgent.id === agentModelPolicy.agent_id) return preferredModel;
          return current ?? preferredModel;
        });
        setSelectedChatExamples(preferredAgent.examples);
      } catch {
        // A transient startup/config read failure must not erase the last known-good
        // model state or turn it into a permanent "unconfigured" result.
        if (!cancelled) {
          setMyDrSaiConfigLoaded(myDrSaiConfigRef.current !== null);
          scheduleRetry();
        }
      }
    }
    void loadChatChoices();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [activeWorkspaceId, chatChoicesRefreshNonce, effectiveWorkspacePath, health?.gatewayReady, user?.id]);

  useEffect(() => {
    if (selectedChatAgentId !== myDrSaiAgentModelPolicy?.agent_id || !myDrSaiAgentModelPolicy?.effective_ref?.model_id) return;
    const primaryModel = myDrSaiAgentModelPolicy.effective_ref.model_id;
    setSelectedChatModel((current) => current === primaryModel ? current : primaryModel);
  }, [myDrSaiAgentModelPolicy?.effective_ref?.model_id, selectedChatAgentId]);

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
      setRemoteDialogError(userFacingFailureMessage(error, language, "connection"));
    } finally {
      setRemoteConnecting(false);
    }
  }

  async function browseRemotePath(path = remotePath): Promise<void> {
    if (!remoteHostAlias || !path.trim()) return;
    try {
      const entries = await desktopApi.listRemoteDirectories(remoteHostAlias, path.trim());
      setRemoteDirectories(entries); setRemotePath(path.trim()); setRemoteDialogError("");
    } catch (error) { setRemoteDialogError(userFacingFailureMessage(error, language, "connection")); }
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

  async function syncWorkspaceSessions(workspace: WorkspaceProject): Promise<void> {
    if (workspace.location === "remote") return;
    const generation = ++workspaceSessionSyncGenerationRef.current;
    const requestId = crypto.randomUUID();
    workspaceSessionSyncRequestRef.current = requestId;
    setWorkspaceSessionSyncing(true);
    setWorkspaceSessionSyncMessage(language === "zh" ? "正在同步 Codex 会话…" : "Syncing Codex sessions…");
    try {
      const sync = await desktopApi.syncCodexWorkspaceSessions(workspace.id, workspace.path, requestId);
      if (generation !== workspaceSessionSyncGenerationRef.current) return;
      if (sync.cancelled) {
        setWorkspaceSessionSyncMessage(language === "zh" ? "已取消本次 Codex 会话同步。" : "Codex session sync cancelled.");
        return;
      }
      if (sync.threads.length) {
        setThreads((current) => sortThreadsForSidebar([
          ...sync.threads,
          ...current.filter((thread) => !sync.threads.some((imported) => imported.id === thread.id)),
        ]));
      }
      setWorkspaceSessionSyncMessage(language === "zh"
        ? `Codex 会话同步完成：${sync.active} 个活跃，${sync.archived} 个归档，${sync.skipped} 个跳过${sync.conflicts ? `，保留 ${sync.conflicts} 个较新的本机归档操作` : ""}。`
        : `Codex session sync complete: ${sync.active} active, ${sync.archived} archived, ${sync.skipped} skipped${sync.conflicts ? `; kept ${sync.conflicts} newer local archive action(s)` : ""}.`);
    } catch (error) {
      if (generation !== workspaceSessionSyncGenerationRef.current) return;
      const friendly = describeUserFacingError(error, language);
      setWorkspaceSessionSyncMessage(language === "zh"
        ? `工作区已添加；${friendly.title}${friendly.action}`
        : `Workspace added. ${friendly.title} ${friendly.action}`);
    } finally {
      if (workspaceSessionSyncRequestRef.current === requestId) workspaceSessionSyncRequestRef.current = null;
      if (generation === workspaceSessionSyncGenerationRef.current) setWorkspaceSessionSyncing(false);
    }
  }

  function cancelWorkspaceSessionSync(): void {
    const requestId = workspaceSessionSyncRequestRef.current;
    if (requestId) void desktopApi.cancelCodexWorkspaceSessionSync(requestId);
    workspaceSessionSyncRequestRef.current = null;
    workspaceSessionSyncGenerationRef.current += 1;
    setWorkspaceSessionSyncing(false);
    setWorkspaceSessionSyncMessage(language === "zh" ? "已取消本次 Codex 会话同步。" : "Codex session sync cancelled.");
  }

  async function handlePickWorkspaceFolder(): Promise<string | null> {
    const result = await desktopApi.pickFolder();
    if (result.canceled || result.paths.length === 0) return null;
    return result.paths[0];
  }

  async function handleWorkspaceChange(workspaceId: string): Promise<void> {
    setActiveWorkspaceId(workspaceId);
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
    navigateTo(MENU_IDS.currentSession);
  }

  async function handleRemoveWorkspace(workspaceId: string): Promise<void> {
    const workspace = storedWorkspaces.find((item) => item.id === workspaceId);
    if (workspace?.location === "remote") {
      await desktopApi.disconnectRemoteWorkspace(workspaceId).catch(() => false);
    }
    await desktopApi.deleteWorkspace(workspaceId);
    const remaining = storedWorkspaces.filter((item) => item.id !== workspaceId);
    setStoredWorkspaces(remaining);
    if (activeWorkspaceId === workspaceId) {
      setActiveWorkspaceId(remaining[0]?.id ?? "");
      navigateTo(MENU_IDS.currentSession);
    }
  }

  async function handleUpdateWorkspace(
    workspaceId: string,
    updates: Partial<
      Pick<WorkspaceProject, "name" | "description" | "trusted" | "pinned">
    >,
  ): Promise<void> {
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
    let request = workspaceRefreshPromiseRef.current;
    if (!request) {
      request = desktopApi.listWorkspaces();
      workspaceRefreshPromiseRef.current = request;
    }
    try {
      setStoredWorkspaces(await request);
    } finally {
      if (workspaceRefreshPromiseRef.current === request) {
        workspaceRefreshPromiseRef.current = null;
      }
      setWorkspacesLoaded(true);
    }
  }

  async function handleNewChat(): Promise<void> {
    setRightPanelCollapsed(true);
    setActiveThreadId(createLocalThreadId());
    navigateTo(MENU_IDS.currentSession);
  }

  async function handleLogout(): Promise<void> {
    await chat.abort();
    // Re-login should open 新建任务 (empty chat), not the pre-logout conversation/page.
    window.localStorage.removeItem(LAST_THREAD_STORAGE_KEY);
    setActiveThreadId(createLocalThreadId());
    navigateTo(MENU_IDS.currentSession);
    await onLogout();
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
        setSelectedChatModel(boundAgent.id === myDrSaiAgentModelPolicy?.agent_id
          ? myDrSaiAgentModelPolicy?.effective_ref?.model_id ?? boundAgent.model ?? boundAgent.models?.[0] ?? null
          : boundAgent.model || boundAgent.models?.[0] || null);
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
    if ((thread?.messageCount ?? 0) > 0 || thread?.runtimeSessionId) {
      void hydrateThreadSnapshot(threadId);
    }
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

  async function hydrateThreadSnapshot(
    threadId: string,
    options: { forceFresh?: boolean; minimumSequence?: number; expectedGeneration?: number; historyCursor?: string } = {},
  ): Promise<void> {
    const generation = threadSnapshotCoordinatorRef.current.get(threadId)?.generation ?? 0;
    const active = threadHydrationsRef.current.get(threadId);
    if (active?.generation === generation) return active.promise;
    if (active) void desktopApi.cancelThreadSnapshotHydration(active.requestId).catch(() => false);
    const requestId = globalThis.crypto?.randomUUID?.() ?? `hydrate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const hydrate = hydrateThreadSnapshotOnce(threadId, generation, requestId, options);
    threadHydrationsRef.current.set(threadId, { generation, requestId, promise: hydrate });
    try { await hydrate; } finally {
      if (threadHydrationsRef.current.get(threadId)?.promise === hydrate) threadHydrationsRef.current.delete(threadId);
    }
  }

  async function hydrateThreadSnapshotOnce(
    threadId: string, generation: number, requestId: string,
    options: { forceFresh?: boolean; minimumSequence?: number; expectedGeneration?: number; historyCursor?: string },
  ): Promise<void> {
    setHydratingThreadId(threadId);
    const resyncStartedAt = performance.now();
    setThreadHydrationError((current) => current?.threadId === threadId ? null : current);
    try {
      const envelope = await desktopApi.getThreadSnapshotEnvelope(threadId, requestId, options);
      if ((threadSnapshotCoordinatorRef.current.get(threadId)?.generation ?? 0) !== generation) return;
      if (!envelope) throw new Error(language === "zh" ? "未能读取该会话的历史内容。" : "The session history could not be loaded.");
      const snapshot = mergeThreadSnapshotForDisplay(envelope.snapshot, threadSnapshotStore.get(threadId) ?? undefined);
      if (!threadSnapshotCoordinatorRef.current.commitEnvelope(envelope, () => threadSnapshotStore.set(threadId, snapshot))) return;
    } catch (error) {
      if ((error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && /abort|cancel/i.test(error.name))) return;
      const state = threadSnapshotCoordinatorRef.current.noteResyncFailure(threadId);
      const friendly = describeUserFacingError(error, language);
      setThreadHydrationError({
        threadId,
        message: state.actionRequired
          ? (language === "zh" ? "会话连续同步失败 3 次，需要重新连接 Runtime 或手动重试。" : "Session sync failed three times. Reconnect Runtime or retry manually.")
          : `${friendly.title} ${friendly.action}`,
      });
    } finally {
      threadSyncMetrics.observe("resync", performance.now() - resyncStartedAt);
      setHydratingThreadId((current) => current === threadId ? null : current);
    }
  }

  async function scheduleThreadResync(
    threadId: string,
    options: { minimumSequence?: number; expectedGeneration?: number } = {},
  ): Promise<void> {
    if (!threadSnapshotCoordinatorRef.current.canResync(threadId)) {
      setThreadHydrationError({ threadId, message: language === "zh"
        ? "会话同步需要处理：请重新连接 Runtime 或手动重试。"
        : "Session sync needs attention. Reconnect Runtime or retry manually." });
      return;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (activeThreadIdRef.current !== threadId) return;
      await hydrateThreadSnapshot(threadId, { ...options, forceFresh: true });
      const state = threadSnapshotCoordinatorRef.current.get(threadId);
      if (!state || state.consecutiveResyncFailures === 0 || state.actionRequired) return;
      await new Promise((resolve) => window.setTimeout(resolve, 150 * 2 ** attempt));
    }
  }

  async function handleChatRecoveryAction(
    assistantMessageId: string,
    action: UserFacingRecoveryAction["id"],
  ): Promise<void> {
    const key = `${assistantMessageId}:${action}`;
    await executeRecoveryActionOnce(recoveryActionInFlightRef.current, key, async () => {
      if (action === "diagnostics") {
        setDebugViewRequest((current) => ({ view: "activity", nonce: (current?.nonce ?? 0) + 1 }));
        setActiveRightTab("debug"); setRightPanelCollapsed(false); return;
      }
      if (action === "abandon") {
        chat.dismissRecoveryActions(assistantMessageId);
        return;
      }
      if (action === "login_codex") {
        await desktopApi.startCodexBackendLogin("chatgptDeviceCode");
        setCodexStatus(await desktopApi.getCodexBackendStatus(true));
        return;
      }
      if (action === "resync_workspace") {
        await syncWorkspaceSessions(activeWorkspace);
        if (activeThreadId) await hydrateThreadSnapshot(activeThreadId);
        return;
      }
      if (action === "repair_codex") {
        await desktopApi.restartCodexBackend();
        await syncWorkspaceSessions(activeWorkspace);
        if (activeThreadId) await hydrateThreadSnapshot(activeThreadId);
        return;
      }
      if (action === "reconnect") {
        setCodexStatus(await desktopApi.restartCodexBackend());
        if (activeThreadId) await hydrateThreadSnapshot(activeThreadId);
        return;
      }
      if (action === "remove_resource" && activeThreadId) {
        setWorkspaceContextAttachmentsByThread((current) => ({ ...current, [activeThreadId]: [] }));
      }
      const assistantIndex = chat.messages.findIndex((message) => message.id === assistantMessageId);
      let originalInput = "";
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        const message = chat.messages[index];
        if (message?.role === "user" && message.content.trim()) { originalInput = message.content; break; }
      }
      if (action === "continue") {
        chat.dismissRecoveryActions(assistantMessageId);
        chat.setInput(language === "zh"
          ? "请基于这个任务已经保留的内容和文件继续完成目标。先核对已完成步骤，不要重复已经发生的副作用。"
          : "Continue from the content and files preserved by this task. Verify completed steps first and do not repeat side effects that already occurred.");
        return;
      }
      if (action === "redo") {
        chat.dismissRecoveryActions(assistantMessageId);
        if (originalInput) chat.setInput(originalInput);
        return;
      }
      if (action === "retry" || action === "select_model" || action === "remove_resource") {
        if (originalInput) chat.setInput(originalInput);
        return;
      }
      if (action === "new_task") await handleNewChat();
      if (originalInput) chat.setInput(originalInput);
    });
  }

  function applyChatAgent(agent: DesktopAgent): void {
    const configuration = agentConfigurations[agent.id];
    setSelectedChatAgentId(agent.id);
    setSelectedChatAgentName(agent.name);
    setSelectedChatModel(configuration?.model || agent.model || agent.models?.[0] || selectedChatModel);
    setDefaultThinkingEffort(configuration?.thinkingEffort || loadThinkingEffort());
    setSelectedChatExamples(agent.examples);
    persistWorkspaceAgentPreference(activeWorkspaceId, agent.id);
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
    resultsContainer.requestWorkspaceScope();
    navigateTo(MENU_IDS.results);
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

  async function selectChatAgent(
    agentId: string,
    options: { persistInBackground?: boolean; agent?: DesktopAgent } = {},
  ): Promise<boolean> {
    const agent = options.agent ?? availableChatAgents.find((item) => item.id === agentId);
    if (!agent) return false;
    if (options.agent) {
      setAvailableChatAgents((current) => [
        agent,
        ...current.filter((item) => item.id !== agent.id),
      ]);
    }
    const activeThread = threads.find((thread) => thread.id === activeThreadId);
    const snapshotCount = activeThreadSnapshot?.messageCount ?? 0;
    const hasConversation = (activeThread?.messageCount ?? 0) > 0 || snapshotCount > 0;
    const changesBoundAgent = Boolean(activeThread?.boundAgentId && activeThread.boundAgentId !== agent.id);
    if (hasConversation && changesBoundAgent) {
      const createNew = await requestAppDecision({
        id: "switch-bound-agent",
        title: language === "zh" ? "新建会话并切换智能体？" : "Start a new conversation?",
        description: language === "zh"
          ? `当前会话已绑定 ${activeThread?.boundAgentName || "其他智能体"}。`
          : `This conversation is bound to ${activeThread?.boundAgentName || "another agent"}.`,
        impact: language === "zh" ? `将保留当前会话，并新建与 ${agent.name} 的会话。` : `The current conversation will be preserved and a new one will start with ${agent.name}.`,
        confirmLabel: language === "zh" ? "新建并切换" : "Start and switch",
      });
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
      const persistSelection = desktopApi
        .updateThread({ id: activeThread.id, boundAgentId: agent.id, boundAgentName: agent.name })
        .then((updated) => {
          setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
        });
      if (options.persistInBackground) {
        void persistSelection.catch(() => {
          // Keep navigation responsive; the selected agent remains applied in renderer state.
        });
      } else {
        await persistSelection;
      }
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
    const snapshotCount = activeThreadSnapshot?.messageCount ?? 0;
    const hasConversation = (thread?.messageCount ?? 0) > 0 || snapshotCount > 0;
    if (thread && !hasConversation) {
      const updated = await desktopApi.updateThread({ id: thread.id, workspacePath: workspace.path });
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
    }
    void desktopApi.updateWorkspace({ id: workspace.id, lastOpenedAt: new Date().toISOString() })
      .then((updated) => setStoredWorkspaces((current) => [updated, ...current.filter((item) => item.id !== updated.id)]))
      .catch(() => undefined);
  }

  function handleChatModelSelect(model: string, providerId?: string): void {
    if (selectedChatAgentId === myDrSaiAgentModelPolicy?.agent_id) {
      void configureAgentModel(selectedChatAgentId, model, providerId);
      return;
    }
    setSelectedChatModel(model);
    if (selectedChatAgentId) {
      setAgentConfigurations((current) => ({
        ...current,
        [selectedChatAgentId]: { ...current[selectedChatAgentId], model },
      }));
    }
  }

  async function configureAgentModel(agentId: string, model: string, providerId?: string): Promise<void> {
    if (agentId === myDrSaiAgentModelPolicy?.agent_id) {
      const activeProvider = myDrSaiConfig?.modelConnection?.model_provider;
      const candidates = availableChatModels.filter((item) => item.alias === model && item.provider_id);
      const selected = candidates.find((item) => item.provider_id === providerId)
        ?? candidates.find((item) => item.provider_id === activeProvider)
        ?? candidates[0];
      if (!selected?.provider_id) throw new Error("The selected OpenDrSai model is not in the Provider catalog.");
      const currentEffort = myDrSaiAgentModelPolicy?.reasoning_effort;
      const selectedEfforts = selected.reasoning_efforts ?? [];
      const reasoningEffort = currentEffort && selectedEfforts.includes(currentEffort)
        ? currentEffort
        : selectedEfforts.includes("high") ? "high" : selectedEfforts[0] ?? null;
      const updated = await desktopApi.updateMyDrSaiAgentModelPolicy(agentId, {
        agent_id: agentId,
        primary_model: { mode: "explicit", ref: { provider_id: selected.provider_id, model_id: selected.alias } },
        image_understanding_model: myDrSaiAgentModelPolicy?.image_understanding_model ?? null,
        image_generation_model: myDrSaiAgentModelPolicy?.image_generation_model ?? myDrSaiAgentModelPolicy?.image_model ?? null,
        text_to_speech_model: myDrSaiAgentModelPolicy?.text_to_speech_model ?? null,
        speech_to_text_model: myDrSaiAgentModelPolicy?.speech_to_text_model ?? null,
        reasoning_effort: reasoningEffort,
        expected_revision: myDrSaiAgentModelPolicy?.revision,
      });
      if (!updated.valid || !updated.effective_ref) {
        throw new Error(updated.error || "The Agent primary model configuration is invalid.");
      }
      const effectiveRef = updated.effective_ref;
      setMyDrSaiAgentModelPolicy(updated);
      setAgentConfigurations((current) => ({
        ...current,
        [agentId]: { ...current[agentId], model: effectiveRef.model_id, modelRef: effectiveRef },
      }));
      if (agentId === selectedChatAgentId) setSelectedChatModel(effectiveRef.model_id);
      return;
    }
    setAgentConfigurations((current) => ({
      ...current,
      [agentId]: { ...current[agentId], model },
    }));
    if (agentId === selectedChatAgentId) setSelectedChatModel(model);
  }

  async function configureAgentCapabilityModel(role: AgentCapabilityModelRole, modelId?: string, providerId?: string): Promise<void> {
    const policy = myDrSaiAgentModelPolicy ?? await desktopApi.getMyDrSaiAgentModelPolicy();
    const selection = modelId && providerId
      ? { mode: "explicit" as const, ref: { provider_id: providerId, model_id: modelId } }
      : null;
    const updated = await desktopApi.updateMyDrSaiAgentModelPolicy(policy.agent_id, {
      agent_id: policy.agent_id,
      primary_model: policy.primary_model,
      image_understanding_model: role === "image_understanding_model" ? selection : policy.image_understanding_model ?? null,
      image_generation_model: role === "image_generation_model" ? selection : policy.image_generation_model ?? policy.image_model ?? null,
      text_to_speech_model: role === "text_to_speech_model" ? selection : policy.text_to_speech_model ?? null,
      speech_to_text_model: role === "speech_to_text_model" ? selection : policy.speech_to_text_model ?? null,
      reasoning_effort: policy.reasoning_effort ?? null,
      expected_revision: policy.revision,
    });
    setMyDrSaiAgentModelPolicy(updated);
  }

  async function configureAgentThinkingEffort(agentId: string, effort: ThinkingEffort): Promise<void> {
    if (agentId === myDrSaiAgentModelPolicy?.agent_id) {
      const policy = myDrSaiAgentModelPolicy ?? await desktopApi.getMyDrSaiAgentModelPolicy(agentId);
      const updated = await desktopApi.updateMyDrSaiAgentModelPolicy(agentId, {
        agent_id: agentId,
        primary_model: policy.primary_model,
        image_understanding_model: policy.image_understanding_model ?? null,
        image_generation_model: policy.image_generation_model ?? policy.image_model ?? null,
        text_to_speech_model: policy.text_to_speech_model ?? null,
        speech_to_text_model: policy.speech_to_text_model ?? null,
        reasoning_effort: effort,
        expected_revision: policy.revision,
      });
      setMyDrSaiAgentModelPolicy(updated);
    }
    setAgentConfigurations((current) => ({
      ...current,
      [agentId]: { ...current[agentId], thinkingEffort: effort },
    }));
    if (agentId === selectedChatAgentId) setDefaultThinkingEffort(effort);
  }

  async function handleDeleteThread(threadId: string): Promise<void> {
    await desktopApi.deleteThread(threadId);
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (activeThreadId === threadId) {
      void handleNewChat();
    }
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
    threadSnapshotStore.set(snapshot.threadId, snapshot);
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
    try {
      setThreads(await desktopApi.listThreads());
    } finally {
      setThreadsLoaded(true);
    }
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

  const selectedSetupWorkspace = storedWorkspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const configuredModelConnection = myDrSaiConfig?.modelConnection;
  // The operational model is authoritative only when it comes from the
  // current Agent policy configured in Settings > Agent configuration.
  const operationalSelectedModelRef = myDrSaiAgentModelPolicy?.effective_ref;
  const lastModelTest = configuredModelConnection?.last_test;
  const lastSuccessfulModelTest = lastModelTest?.last_success
    ?? (lastModelTest?.ok ? lastModelTest : undefined);
  const selectedModelIsVerified = Boolean(
    operationalSelectedModelRef
    && lastSuccessfulModelTest?.ok === true
    && lastSuccessfulModelTest.mode === "model"
    && lastSuccessfulModelTest.provider === operationalSelectedModelRef.provider_id
    && (lastSuccessfulModelTest.model
      ? lastSuccessfulModelTest.model === operationalSelectedModelRef.model_id
      : configuredModelConnection?.model_provider === operationalSelectedModelRef.provider_id
        && configuredModelConnection.model === operationalSelectedModelRef.model_id),
  );
  const actualOperationalFacts = {
    identity: auth.loading ? "loading" : user ? "authenticated" : "anonymous",
    runtime: auth.serviceBlocker && !auth.serviceBusy
      ? "blocked"
      : auth.serviceReady && health?.gatewayReady
        ? "ready"
        : auth.serviceBusy || !health
          ? "preparing"
          : "unknown",
    model: !myDrSaiConfigLoaded
      ? "unknown"
      : !operationalSelectedModelRef
        ? "unconfigured"
        : selectedModelIsVerified
          ? "ready"
          : "untested",
    workspace: !workspacesLoaded || !selectedSetupWorkspace
      ? "none"
      : selectedSetupWorkspace.trusted
        ? "trusted"
        : "untrusted",
    run: deriveOperationalRunState(threadBackgroundTasks, chat.activeRequestId),
  } as const;
  const operationalFacts = operationalE2eFacts ?? actualOperationalFacts;
  const operationalDecision = deriveOperationalState(operationalFacts);
  const automaticAgentModelVerificationsRef = useRef(new Set<string>());
  useEffect(() => {
    const ref = myDrSaiAgentModelPolicy?.effective_ref;
    if (
      actualOperationalFacts.identity !== "authenticated"
      || actualOperationalFacts.runtime !== "ready"
      || actualOperationalFacts.model !== "untested"
      || !myDrSaiAgentModelPolicy?.agent_id
      || !ref
    ) return;
    const key = [
      myDrSaiAgentModelPolicy.agent_id,
      myDrSaiAgentModelPolicy.revision,
      ref.provider_id,
      ref.model_id,
    ].join("::");
    if (automaticAgentModelVerificationsRef.current.has(key)) return;
    automaticAgentModelVerificationsRef.current.add(key);
    void desktopApi.testMyDrSaiModelProvider(ref.provider_id, ref.model_id).then(async (result) => {
      if (!result.ok) return;
      const refreshed = await desktopApi.getMyDrSaiConfig(effectiveWorkspacePath || undefined);
      myDrSaiConfigRef.current = refreshed;
      setMyDrSaiConfig(refreshed);
      setAvailableChatModels(refreshed.models ?? []);
    }).catch(() => {
      // Automatic verification is intentionally quiet. The collapsed status
      // retains a manual retry action and Settings provides full diagnostics.
    });
  }, [
    actualOperationalFacts.identity,
    actualOperationalFacts.model,
    actualOperationalFacts.runtime,
    effectiveWorkspacePath,
    myDrSaiAgentModelPolicy?.agent_id,
    myDrSaiAgentModelPolicy?.effective_ref?.model_id,
    myDrSaiAgentModelPolicy?.effective_ref?.provider_id,
    myDrSaiAgentModelPolicy?.revision,
  ]);
  useEffect(() => {
    if (!desktopApi.isOperationalStateE2eEnabled()) return;
    document.documentElement.dataset.operationalE2eDecision = `${operationalDecision.currentLayer}:${operationalDecision.state}:${operationalDecision.blockingLayer ?? "none"}`;
    return () => {
      delete document.documentElement.dataset.operationalE2eDecision;
    };
  }, [operationalDecision.blockingLayer, operationalDecision.currentLayer, operationalDecision.state]);

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
            recordSuccessfulModelUsage();
            void desktop.refreshHealth();
          }}
          threadId={activeThreadId}
          workspaceInstructions={effectiveWorkspaceInstructions}
          workspacePath={effectiveWorkspacePath}
          workspaceTrusted={workspaceTrusted}
        />
      ) : (
        <section className="conversation-panel" data-thread-id={activeThreadId}>
        {threadHydrationError?.threadId === activeThreadId ? (
          <div className="conversation-history-error" role="alert">
            <span>{threadHydrationError.message}</span>
            <button type="button" onClick={() => void hydrateThreadSnapshot(activeThreadId)}>{language === "zh" ? "重试" : "Retry"}</button>
          </div>
        ) : null}
        <ChatWorkspace
          activeRequestId={chat.activeRequestId}
          cancellingRequestId={chat.cancellingRequestId}
          canChat={canChat}
          chatUnavailableReason={chatUnavailableReason}
          conversationId={activeThreadId}
          conversationTitle={activeThread?.title}
          conversationSource={activeThread?.boundAgentId === "my-codex" || activeThread?.archiveSource === "codex" ? "codex" : "opendrsai"}
          conversationHistoryPending={Boolean(
            hydratingThreadId === activeThreadId
            || ((activeThread?.messageCount ?? 0) > 0 && !activeThreadSnapshot),
          )}
          conversationHistory={activeThreadSnapshot?.history}
          operationalStateControl={shouldShowOperationalStateBar(operationalDecision) ? (
            <DiagnosticsContainer
              decision={operationalDecision}
              language={language}
              formatError={(error) => userFacingFailureMessage(error, language)}
              onRecover={performOperationalRecovery}
              report={() => ({
                product: "OpenDrSai Windows App",
                currentLayer: operationalDecision.currentLayer,
                blockingLayer: operationalDecision.blockingLayer,
                state: operationalDecision.state,
                layers: operationalDecision.layers,
                runtimeReady: health?.gatewayReady ?? false,
                generatedAt: new Date().toISOString(),
              })}
            />
          ) : null}
          onLoadEarlierHistory={activeThreadSnapshot?.history?.nextCursor ? async () => {
            await hydrateThreadSnapshot(activeThreadId, {
              forceFresh: true,
              historyCursor: activeThreadSnapshot.history?.nextCursor ?? undefined,
            });
          } : undefined}
          continuesExistingTask={Boolean(
            activeThread?.runtimeSessionId
            && (activeThread.boundAgentId === "my-codex" || activeThread.archiveSource === "codex")
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
          selectedModelProviderId={selectedChatAgentId === myDrSaiAgentModelPolicy?.agent_id
            ? myDrSaiAgentModelPolicy?.effective_ref?.provider_id
            : selectedChatAgentId ? agentConfigurations[selectedChatAgentId]?.modelRef?.provider_id : undefined}
          agentOptions={availableChatAgents}
          modelOptions={chatModelOptions}
          samplePrompts={selectedChatAgent?.examples ?? selectedChatExamples}
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
            setDebugViewRequest((current) => ({ view: "activity", nonce: (current?.nonce ?? 0) + 1 }));
            setActiveRightTab("debug");
            setRightPanelCollapsed(false);
          }}
          onOpenRun={platformDescriptor?.capabilities.features.runtime !== true ? undefined : (runId, itemId) => {
            setRunInspectionRequest({
              workspacePath: effectiveWorkspacePath,
              workspaceId: effectiveRuntimeWorkspaceId,
              runId,
              ...(itemId ? { focusedItemId: itemId } : {}),
            });
            setActiveRightTab("run");
            setRightPanelCollapsed(false);
          }}
          onCreateRunExperiment={platformDescriptor?.capabilities.features.runtime !== true || !experimentReleaseGate.enabled ? undefined : (runId, itemId) => {
            setRunInspectionRequest({
              workspacePath: effectiveWorkspacePath,
              workspaceId: effectiveRuntimeWorkspaceId,
              runId,
              createExperiment: true,
              ...(itemId ? { focusedItemId: itemId } : {}),
            });
            setActiveRightTab("run");
            setRightPanelCollapsed(false);
          }}
          onRetryMessage={async (assistantMessageId, mode) => {
            const assistantIndex = chat.messages.findIndex((message) => message.id === assistantMessageId);
            let originalInput = "";
            for (let index = assistantIndex - 1; index >= 0; index -= 1) {
              const message = chat.messages[index];
              if (message?.role === "user" && message.content.trim()) { originalInput = message.content; break; }
            }
            if (!originalInput) return;
            if (mode === "new_session") await handleNewChat();
            chat.setInput(originalInput);
          }}
          onRecoveryAction={handleChatRecoveryAction}
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
      <ResultsContainer>
        <ResultsCenterView
          language={language}
          scopeRequestKey={resultsContainer.scopeRequestKey}
          workspaceName={activeWorkspace.name}
          workspacePath={activeWorkspace.path}
          onOpenSourceTask={(task) => {
            setDeliveryTask(task);
          }}
          onOpenSourceRun={(task, runId) => {
            const sourceWorkspacePath = task.workspacePath || effectiveWorkspacePath;
            const sourceWorkspaceId = sortedWorkspaces.find((workspace) =>
              getComparablePath(workspace.path) === getComparablePath(sourceWorkspacePath),
            )?.id || effectiveRuntimeWorkspaceId;
            setRunInspectionRequest({ workspacePath: sourceWorkspacePath, workspaceId: sourceWorkspaceId, runId });
            setActiveRightTab("run");
            setRightPanelCollapsed(false);
          }}
          onContinueQuestion={(question) => {
            setPendingChatInput(question);
            navigateTo(MENU_IDS.currentSession);
          }}
        />
      </ResultsContainer>
    ) : activeNav === MENU_IDS.agentSquare ? (
      <section className="agent-square-panel">
        <AgentSquareView
          language={language}
          user={user}
          userGroups={user?.groups ?? []}
          workspacePath={effectiveWorkspacePath}
          selectedAgentId={selectedChatAgentId}
          onStartChat={(agent) => {
            void selectChatAgent(agent.id, {
              persistInBackground: true,
              agent,
            }).then((selected) => {
              if (!selected) return;
              setRightPanelCollapsed(true);
              navigateTo(MENU_IDS.currentSession);
            });
          }}
        />
      </section>
    ) : activeNav === MENU_IDS.skillsSquare ? (
      // Temporarily hide Skills management page — keep for later reuse.
      // <section className="skills-square-panel skills-manager-panel">
      //   <SkillsManager
      //     activeThreadId={activeThreadId}
      //     language={language}
      //   />
      // </section>
      null
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
          recordSuccessfulModelUsage();
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
    ) : activeNav === MENU_IDS.library ? (
      // Temporarily hide GFS cloud page — keep for later reuse.
      // <GfsView language={language} />
      null
    ) : activeNav === MENU_IDS.profile ? (
      <ModelSettingsContainer
        initialProvider={myDrSaiConfig?.modelConnection?.model_provider}
        requestedPane={requestedSettingsPane}
      >{(modelSettings) => <SettingsPanel
        modelSettings={modelSettings}
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
        myDrSaiAgentModelPolicy={myDrSaiAgentModelPolicy}
        onCheckUpdates={() => void desktop.checkUpdates()}
        onAppearanceChange={setAppearance}
        onCompletionNotificationsChange={(enabled) => {
          setCompletionNotifications(enabled);
        }}
        onCopyDiagnostics={() => void copyTextSafely(JSON.stringify({
          generatedAt: new Date().toISOString(),
          desktop: { version: health?.version ?? "unknown", installed: health?.installed ?? false },
          runtime: { ready: health?.gatewayReady ?? false, externalReady: health?.gateway?.externalReady ?? false },
          codex: codexStatus ? {
            available: codexStatus.available,
            connectionState: codexStatus.state,
            version: codexStatus.version,
            loggedIn: codexStatus.loggedIn,
            authMode: codexStatus.authMode,
          } : null,
          correlation: { workspaceId: effectiveRuntimeWorkspaceId, threadId: activeThreadId },
          privacy: "Prompts, credentials, user identity, logs, and absolute workspace paths are intentionally excluded.",
        }, null, 2))}
        onDeveloperModeChange={(enabled) => {
          window.localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, String(enabled));
          window.location.reload();
        }}
        onExportLocalData={() => exportLocalDesktopData(threadSnapshotStore.all())}
        onLanguageChange={setLanguage}
        onLogout={handleLogout}
        onNewAgentTask={() => void handleNewAgentTask()}
        onOpenMobilePairing={() => setMobilePairingOpen(true)}
        mobilePairingRefreshToken={mobilePairingRefreshToken}
        onOpenBrowserPanel={() => {
          setActiveRightTab("browser");
          setRightPanelCollapsed(false);
        }}
        onOpenPath={(path) => void desktopApi.openPath(path)}
        onResetPreferences={() => resetDesktopPreferences()}
        onRestoreLastSessionChange={setRestoreLastSession}
        onRestoreLastWorkspaceChange={setRestoreLastWorkspace}
        onRightSidebarComponentsChange={setRightSidebarComponents}
        onConfigureAgentModel={configureAgentModel}
        onConfigureAgentCapabilityModel={(role, modelId, providerId) => void configureAgentCapabilityModel(role, modelId, providerId)}
        onRefreshAgentModels={() => setChatChoicesRefreshNonce((current) => current + 1)}
        onSessionScopeChange={setSessionScope}
        threads={threads}
        onArchiveThread={(threadId, archived) => handleThreadUpdate(threadId, { archived })}
        workspaces={sortedWorkspaces}
        onSyncWorkspaceSessions={syncWorkspaceSessions}
        onSidebarComponentsChange={setSidebarComponents}
        onConfigureAgentThinkingEffort={configureAgentThinkingEffort}
        onWorkspaceSortModeChange={setWorkspaceSortMode}
        onUpdateAgentConfig={async (updates) => {
          const next = await desktopApi.updateMyDrSaiConfig(updates);
          setMyDrSaiConfig(next);
        }}
        onModelConnectionUpdated={(connection) => {
          chatChoicesGenerationRef.current += 1;
          chatChoicesPromiseRef.current.clear();
          setMyDrSaiConfig((current) => {
            const next: MyDrSaiConfig = current
              ? { ...current, ready: true, modelConnection: connection, modelCatalog: { state: "stale", message: "Refreshing the model catalog after configuration changed." } }
              : {
                  ready: true,
                  baseUrl: "",
                  config: {},
                  models: availableChatModels,
                  modelConnection: connection,
                  modelCatalog: { state: "stale", message: "Refreshing the model catalog after configuration changed." },
                };
            myDrSaiConfigRef.current = next;
            return next;
          });
          setMyDrSaiConfigLoaded(true);
          setSelectedChatModel(connection.model);
          setChatChoicesRefreshNonce((current) => current + 1);
        }}
        developerMode={developerMode}
        developerModeAvailable={import.meta.env.DEV}
        restoreLastSession={restoreLastSession}
        restoreLastWorkspace={restoreLastWorkspace}
        rightSidebarComponents={rightSidebarComponents}
        agentConfigurations={agentConfigurations}
        selectedAgentId={selectedChatAgentId}
        selectedModel={selectedChatModel}
        sessionScope={sessionScope}
        sidebarComponents={sidebarComponents}
        updateBusy={desktop.busy}
        updateMessage={desktop.actionMessage}
        user={user}
        usageAnalyticsPanel={<ProviderAnalyticsView language={language} />}
        workspaceSortMode={workspaceSortMode}
      />}</ModelSettingsContainer>
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
      onCodexRestart={async () => setCodexStatus(await desktopApi.restartCodexBackend())}
      onCodexRepair={() => desktop.startInstall(false)}
      onCodexLogin={async (type) => desktopApi.startCodexBackendLogin(type)}
      onCodexLogout={async () => { await desktopApi.logoutCodexBackend(); setCodexStatus(await desktopApi.getCodexBackendStatus(true)); }}
    />
  );

  const rightPanelContent =
    activeRightTab === "run" ? (
      <RunInspectorPanel
        language={language}
        request={runInspectionRequest}
        focusedItemId={runInspectionRequest?.focusedItemId}
        onOpenRun={(runId) => setRunInspectionRequest((current) => current ? {
          workspacePath: current.workspacePath,
          ...(current.workspaceId ? { workspaceId: current.workspaceId } : {}),
          runId,
        } : current)}
        onOpenDebug={platformDescriptor?.capabilities.features.debugger !== true ? undefined : () => {
          setDebugViewRequest((current) => ({ view: "activity", nonce: (current?.nonce ?? 0) + 1 }));
          setActiveRightTab("debug");
        }}
      />
    ) : activeRightTab === "debug" ? (
      <DebugPanel
        language={language}
        requestedView={debugViewRequest}
        onSelectTurn={(turnId) => setStructuredTurnFocus((current) => ({ turnId, nonce: (current?.nonce ?? 0) + 1 }))}
        onPrepareRerun={(runId) => {
          const turnIndex = chat.messages.findIndex((message) => message.structuredTurn?.turnId === runId);
          const searchFrom = turnIndex >= 0 ? turnIndex - 1 : chat.messages.length - 1;
          let originalInput = "";
          for (let index = searchFrom; index >= 0; index -= 1) {
            const message = chat.messages[index];
            if (message?.role === "user" && message.content.trim()) { originalInput = message.content; break; }
          }
          if (!originalInput) return false;
          chat.setInput(originalInput);
          navigateTo(MENU_IDS.currentSession);
          setRightPanelCollapsed(true);
          return true;
        }}
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

  useEffect(() => {
    if (!desktopApi.isAppDialogE2eEnabled()) return;
    const handleDialogRequest = (event: Event): void => {
      const detail = (event as CustomEvent<{
        id?: string;
        title?: string;
        description?: string;
        impact?: string;
        tone?: "normal" | "danger";
      }>).detail ?? {};
      const id = detail.id || `e2e-app-dialog-${Date.now()}`;
      void requestAppDecision({
        id,
        title: detail.title || "Confirm this action",
        description: detail.description || "Review the action before continuing.",
        impact: detail.impact || "The action runs only after confirmation.",
        tone: detail.tone || "danger",
      }).then((approved) => {
        const state = window as typeof window & { __opendrsaiDialogE2eEffects?: number };
        if (approved) state.__opendrsaiDialogE2eEffects = (state.__opendrsaiDialogE2eEffects ?? 0) + 1;
        window.dispatchEvent(new CustomEvent("drsai:e2e-app-dialog-result", {
          detail: { id, approved, effects: state.__opendrsaiDialogE2eEffects ?? 0 },
        }));
      });
    };
    window.addEventListener("drsai:e2e-request-app-dialog", handleDialogRequest);
    return () => window.removeEventListener("drsai:e2e-request-app-dialog", handleDialogRequest);
  }, []);

  useEffect(() => {
    if (!desktopApi.isOperationalStateE2eEnabled()) return;
    const handleOperationalState = (event: Event): void => {
      const facts = (event as CustomEvent<OperationalStateFacts>).detail;
      document.documentElement.dataset.operationalE2eState = `${facts.identity}:${facts.runtime}:${facts.model}:${facts.workspace}:${facts.run}`;
      setOperationalE2eFacts(facts);
    };
    window.addEventListener("drsai:e2e-operational-state", handleOperationalState);
    return () => {
      delete document.documentElement.dataset.operationalE2eState;
      window.removeEventListener("drsai:e2e-operational-state", handleOperationalState);
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
      // Temporarily hide Skills management entry — keep for later reuse.
      // setSkillSquareCommandTarget({ query: task.targetId || task.title, source: "slash_command" });
      // navigateTo(MENU_IDS.skillsSquare);
      navigateTo(MENU_IDS.currentSession);
    }
    setAwaySummary(null);
  }

  async function performOperationalRecovery(): Promise<string | void> {
    switch (operationalDecision.currentLayer) {
        case "identity":
          await onLogout();
          break;
        case "runtime":
          await auth.retryBootstrap();
          await desktop.refreshHealth();
          break;
        case "model":
          {
            const selectedRef = myDrSaiAgentModelPolicy?.effective_ref;
            if (!selectedRef) {
              setRequestedSettingsPane("agent-defaults");
              navigateTo(MENU_IDS.profile);
              return;
            }
            let config = myDrSaiConfig;
            if (!config?.modelConnection) {
              try {
                config = await desktopApi.getMyDrSaiConfig(effectiveWorkspacePath || undefined);
              } catch {
                config = null;
              }
            }
            if (!config?.modelConnection?.model || !config.modelConnection.model_provider) {
              setRequestedSettingsPane("model-providers");
              navigateTo(MENU_IDS.profile);
              return;
            }

            const provider = selectedRef.provider_id;
            const model = selectedRef.model_id;
            const result = await desktopApi.testMyDrSaiModelProvider(provider, model);
            if (!result.ok) {
              const localizedGuidance = result.guidance?.localizations?.[language];
              throw new Error(
                localizedGuidance?.message
                || result.guidance?.message
                || (language === "zh"
                  ? `模型 ${model} 验证失败：${result.error || "未知错误"}`
                  : `Model ${model} verification failed: ${result.error || "unknown error"}`),
              );
            }

            const verifiedConfig: MyDrSaiConfig = {
              ...config,
              modelConnection: {
                ...config.modelConnection,
                last_test: {
                  provider,
                  model,
                  mode: "model",
                  ok: true,
                  tested_at: new Date().toISOString(),
                },
              },
            };
            myDrSaiConfigRef.current = verifiedConfig;
            setMyDrSaiConfig(verifiedConfig);
            setMyDrSaiConfigLoaded(true);
            setAvailableChatModels(verifiedConfig.models ?? []);
            try {
              const refreshed = await desktopApi.getMyDrSaiConfig(effectiveWorkspacePath || undefined);
              myDrSaiConfigRef.current = refreshed;
              setMyDrSaiConfig(refreshed);
              setAvailableChatModels(refreshed.models ?? []);
            } catch {
              // The bounded model call already succeeded. A transient config
              // refresh failure must not turn that success into a false error.
            }
            await desktop.refreshHealth();
            return language === "zh"
              ? `已使用 ${model} 完成最小调用，模型连接正常。`
              : `The minimal call to ${model} succeeded.`;
          }
        case "workspace":
          if (operationalDecision.state === "untrusted" && selectedSetupWorkspace) {
            await handleUpdateWorkspace(selectedSetupWorkspace.id, { trusted: true });
          } else {
            await handleAddLocalWorkspace();
          }
          break;
        case "run":
          navigateTo(operationalDecision.state === "waiting_approval" ? MENU_IDS.approvalCenter : MENU_IDS.savedPlan);
          break;
    }
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
    <TaskShellContainer
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
      onLogout={() => {
        void handleLogout();
      }}
      onNavChange={navigateTo}
      onNewChat={() => {
        void handleNewChat();
      }}
      onOpenWorkspaceResults={handleOpenWorkspaceResults}
      onOpenWorkspacePath={handleOpenWorkspacePath}
      onPickWorkspaceFolder={handlePickWorkspaceFolder}
      onRefreshWorkspaces={refreshWorkspaces}
      onSyncWorkspaceSessions={syncWorkspaceSessions}
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
      onDeleteThread={handleDeleteThread}
      onToggleRightPanel={() => setRightPanelCollapsed((current) => !current)}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      onUpdateWorkspace={handleUpdateWorkspace}
      onWorkspaceChange={handleWorkspaceChange}
      onWorkspaceSortModeChange={setWorkspaceSortMode}
    />
    {workspaceSessionSyncMessage ? <div className="workspace-session-sync-status" role="status" data-testid="workspace-session-sync-status">
      <span>{workspaceSessionSyncMessage}</span>
      <button type="button" aria-label={workspaceSessionSyncing ? (language === "zh" ? "取消同步" : "Cancel sync") : (language === "zh" ? "关闭同步提示" : "Dismiss sync status")} onClick={() => workspaceSessionSyncing ? cancelWorkspaceSessionSync() : setWorkspaceSessionSyncMessage(null)}>{workspaceSessionSyncing ? (language === "zh" ? "取消" : "Cancel") : "×"}</button>
    </div> : null}
    <AppDecisionDialogHost language={language} />
    {mobilePairingOpen ? <MobilePairingDialog language={language} onClose={() => setMobilePairingOpen(false)} onConnected={() => setMobilePairingRefreshToken((value) => value + 1)} /> : null}
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

function loadRemoteRecentPaths(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMOTE_RECENT_PATHS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string" && path.length > 0).slice(0, 8) : [];
  } catch {
    return [];
  }
}

/**
 * Runtime conversation journal may contain the model prompt (attachment injection)
 * and fragmented assistant items (reasoning / empty shells). Prefer local attachment
 * chips, strip injection text, coalesce empty assistant shells, and keep a richer
 * local transcript when Runtime only sends thin placeholders.
 */
function mergeThreadSnapshotForDisplay(
  incoming: ChatThreadSnapshot,
  existing?: ChatThreadSnapshot,
): ChatThreadSnapshot {
  const existingUserAttachments = (existing?.messages ?? [])
    .filter((message) => message.role === "user" && Array.isArray(message.attachments) && message.attachments.length)
    .map((message) => message.attachments!);
  let userIndex = 0;
  const scrubbedIncoming = incoming.messages.map((message) => {
    if (message.role !== "user") return message;
    const content = stripAttachmentContextFromUserContent(message.content);
    const attachments = message.attachments?.length
      ? message.attachments
      : existingUserAttachments[userIndex];
    userIndex += 1;
    if (content === message.content && attachments === message.attachments) return message;
    return {
      ...message,
      content,
      ...(attachments?.length ? { attachments } : {}),
    };
  });

  const coalescedIncoming = coalesceAssistantMessagesForDisplay(scrubbedIncoming);
  const existingMessages = existing?.messages?.length
    ? coalesceAssistantMessagesForDisplay(existing.messages.map((message) => (
      message.role === "user"
        ? { ...message, content: stripAttachmentContextFromUserContent(message.content) }
        : message
    )))
    : [];

  const messages = preferRicherTranscript(coalescedIncoming, existingMessages);
  const firstUser = messages.find((message) => message.role === "user");
  const titleFromUser = firstUser?.content.trim().slice(0, 48);
  return {
    ...incoming,
    title: titleFromUser || incoming.title,
    messages,
    messageCount: messages.filter((message) => message.id !== "welcome").length,
    updatedAt: Math.max(incoming.updatedAt, existing?.updatedAt ?? 0),
  };
}

function coalesceAssistantMessagesForDisplay(
  messages: ChatThreadSnapshot["messages"],
): ChatThreadSnapshot["messages"] {
  const merged: ChatThreadSnapshot["messages"] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      merged.push(message);
      continue;
    }
    const body = [message.content, message.reasoningContent, message.statusContent]
      .map((value) => value?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    if (!body && !message.streaming && !message.error && !message.structuredTurn) continue;

    const previous = merged[merged.length - 1];
    const previousThin = previous?.role === "assistant" && !previous.content.trim();
    const currentThin = !message.content.trim();
    if (previous?.role === "assistant" && (previousThin || currentThin)) {
      const preferCurrent = !previous.content.trim() && Boolean(message.content.trim());
      merged[merged.length - 1] = {
        ...previous,
        id: preferCurrent ? message.id : previous.id,
        content: previous.content.trim() || message.content,
        reasoningContent: mergeDisplayText(previous.reasoningContent, message.reasoningContent),
        statusContent: mergeDisplayText(previous.statusContent, message.statusContent),
        streaming: Boolean(previous.streaming || message.streaming),
        error: Boolean(previous.error || message.error),
        attachments: previous.attachments?.length ? previous.attachments : message.attachments,
        structuredTurn: previous.structuredTurn ?? message.structuredTurn,
        startedAt: Math.min(previous.startedAt ?? Number.MAX_SAFE_INTEGER, message.startedAt ?? Number.MAX_SAFE_INTEGER),
        lastEventAt: Math.max(previous.lastEventAt ?? 0, message.lastEventAt ?? 0),
      };
      continue;
    }
    merged.push(message);
  }
  return merged;
}

function mergeDisplayText(left?: string, right?: string): string | undefined {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  if (a.includes(b) || b.includes(a)) return a.length >= b.length ? a : b;
  return `${a}\n\n${b}`;
}

function transcriptRichness(messages: ChatThreadSnapshot["messages"]): number {
  return messages.reduce((score, message) => {
    if (message.role !== "assistant") return score;
    let next = score;
    if (message.content.trim()) next += 4;
    if (message.reasoningContent?.trim()) next += 2;
    if (message.structuredTurn?.parts?.length) next += 3;
    if (message.attachments?.length) next += 1;
    return next;
  }, 0);
}

function preferRicherTranscript(
  incoming: ChatThreadSnapshot["messages"],
  existing: ChatThreadSnapshot["messages"],
): ChatThreadSnapshot["messages"] {
  if (!existing.length) return incoming;
  if (!incoming.length) return existing;
  // Keep the local renderer transcript when Runtime only returns thin shells
  // (empty assistants / detached reasoning) after a successful local stream.
  if (transcriptRichness(existing) > transcriptRichness(incoming)) return existing;
  return incoming;
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
  const body =
      language === "zh"
        ? agentRun
          ? "智能体任务已完成。"
          : "会话任务已完成。"
        : agentRun
          ? "The Agent task has completed."
          : "The conversation task has completed.";
  new Notification("OpenDrSai", { body: redactSensitiveData(body) });
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
    run: true,
    files: true,
    browser: true,
    terminal: true,
    debug: false,
  };
  try {
    const value = JSON.parse(window.localStorage.getItem(RIGHT_SIDEBAR_COMPONENTS_STORAGE_KEY) ?? "null") as Partial<RightSidebarComponentVisibility> | null;
    if (!value || typeof value !== "object") return defaults;
    return {
      run: typeof value.run === "boolean" ? value.run : defaults.run,
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

function loadWorkspaceAgentPreference(workspaceId: string): string | null {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(workspaceId)) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(WORKSPACE_AGENT_STORAGE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const selected = (value as Record<string, unknown>)[workspaceId];
    return typeof selected === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(selected) ? selected : null;
  } catch {
    return null;
  }
}

function persistWorkspaceAgentPreference(workspaceId: string, agentId: string): void {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(workspaceId) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(agentId)) return;
  let preferences: Record<string, string> = {};
  try {
    const value = JSON.parse(window.localStorage.getItem(WORKSPACE_AGENT_STORAGE_KEY) ?? "null") as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      preferences = Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([key, item]) => /^[A-Za-z0-9_.:-]{1,200}$/.test(key) && typeof item === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(item))
        .slice(-100)) as Record<string, string>;
    }
  } catch {
    // Replace malformed preference data with a bounded valid map.
  }
  preferences[workspaceId] = agentId;
  window.localStorage.setItem(WORKSPACE_AGENT_STORAGE_KEY, JSON.stringify(preferences));
}

function loadThinkingEffort(): ThinkingEffort {
  const value = window.localStorage.getItem(THINKING_EFFORT_STORAGE_KEY);
  return value === "none" || value === "low" || value === "high" || value === "xhigh" || value === "max" ? value : "medium";
}

function loadAgentConfigurations(): Record<string, AgentConfigurationPreference> {
  try {
    const localModelCompatibilityEnabled = window.localStorage.getItem(AGENT_MODEL_POLICY_MIGRATION_KEY) !== "complete";
    const value = JSON.parse(window.localStorage.getItem(AGENT_CONFIGURATIONS_STORAGE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const configurations: Record<string, AgentConfigurationPreference> = {};
    for (const [agentId, item] of Object.entries(value as Record<string, unknown>).slice(-100)) {
      if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(agentId) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const model = (agentId !== "my-drsai" || localModelCompatibilityEnabled) && typeof record.model === "string" && record.model.trim().length <= 200 ? record.model.trim() : undefined;
      const imageModel = (agentId !== "my-drsai" || localModelCompatibilityEnabled) && typeof record.imageModel === "string" && record.imageModel.trim().length <= 200 ? record.imageModel.trim() : undefined;
      const thinkingEffort = record.thinkingEffort === "low" || record.thinkingEffort === "medium" || record.thinkingEffort === "high" || record.thinkingEffort === "xhigh" || record.thinkingEffort === "max"
        ? record.thinkingEffort : undefined;
      if (model || imageModel || thinkingEffort) configurations[agentId] = { model, imageModel, thinkingEffort };
    }
    return configurations;
  } catch {
    return {};
  }
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
  if (!loadBooleanSetting(RESTORE_WORKSPACE_STORAGE_KEY, true)) return "";
  const restored = loadOptionalSetting(LAST_WORKSPACE_STORAGE_KEY) ?? "";
  return restored === "current" ? "" : restored;
}

function exportLocalDesktopData(threadSnapshots: Record<string, ChatThreadSnapshot>): void {
  const contentOnlySnapshots = Object.fromEntries(Object.entries(threadSnapshots).map(([threadId, snapshot]) => {
    const { connectionState: _transientConnectionState, ...content } = snapshot;
    return [threadId, content];
  }));
  const payload = buildLocalDesktopDataExport(contentOnlySnapshots, Object.fromEntries(
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("opendrsai."))
        .map((key) => [key, window.localStorage.getItem(key)]),
    ));
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `opendrsai-local-data-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetDesktopPreferences(): void {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("opendrsai.")) window.localStorage.removeItem(key);
  }
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

function haveSameThreadTaskActivity(
  current: DesktopBackgroundTask[],
  next: DesktopBackgroundTask[],
): boolean {
  if (current.length !== next.length) return false;
  return current.every((task, index) => {
    const candidate = next[index];
    return candidate?.id === task.id
      && candidate.updatedAt === task.updatedAt
      && candidate.status === task.status
      && candidate.threadId === task.threadId
      && candidate.targetId === task.targetId
      && candidate.approvalId === task.approvalId
      && (candidate.pendingDecisions?.length ?? 0) === (task.pendingDecisions?.length ?? 0);
  });
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

function resolveThreadWorkspaceId(thread: DesktopThread, workspaces: WorkspaceProject[]): string {
  if (thread.execution?.workspaceId) return thread.execution.workspaceId;
  if (thread.workspacePath) {
    const pathKey = getComparablePath(thread.workspacePath);
    const match = workspaces.find((workspace) => getComparablePath(workspace.path) === pathKey);
    if (match) return match.id;
    return getWorkspaceId(thread.workspacePath);
  }
  return "";
}

const EMPTY_WORKSPACE: WorkspaceProject = {
  id: "",
  name: "",
  path: "",
  location: "local",
  type: "local",
  description: "",
  createdAt: "",
  updatedAt: "",
  lastOpenedAt: "",
  trusted: false,
  pinned: false,
};

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
  onOpenSourceTask,
  onOpenSourceRun,
  onContinueQuestion,
}: {
  language: AppLanguage;
  scopeRequestKey: number;
  workspaceName: string;
  workspacePath: string;
  onOpenSourceTask: (task: DesktopBackgroundTask) => void;
  onOpenSourceRun: (task: DesktopBackgroundTask, runId: string) => void;
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
  const [provenanceState, setProvenanceState] = useState<{
    artifactId: string;
    state: "checking" | "verified" | "failed";
    message: string;
  } | null>(null);

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

  async function verifyArtifactSource(artifact: IndexedTaskArtifact): Promise<void> {
    if (!artifact.provenance) {
      setProvenanceState({ artifactId: artifact.id, state: "failed", message: zh ? "缺少可验证的来源记录。" : "Verifiable provenance is unavailable." });
      return;
    }
    setProvenanceState({ artifactId: artifact.id, state: "checking", message: zh ? "正在核对来源摘要…" : "Checking provenance digest…" });
    try {
      const result = await verifyResultProvenance(artifact.provenance);
      setProvenanceState({
        artifactId: artifact.id,
        state: result.valid ? "verified" : "failed",
        message: result.valid
          ? (zh ? "来源摘要已验证：任务、会话、Run、输入和目标版本一致。" : "Provenance verified: task, session, run, input, and target version match.")
          : (zh ? "来源摘要不一致，请不要依赖此成果并重新执行任务。" : "Provenance mismatch. Do not rely on this result; run the task again."),
      });
    } catch (caught) {
      setProvenanceState({ artifactId: artifact.id, state: "failed", message: caught instanceof Error ? caught.message : String(caught) });
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
                      {artifact.provenance ? (
                        <details
                          className="results-provenance"
                          data-testid="results-provenance"
                          data-source-task-id={artifact.provenance.sourceTaskId}
                          data-source-session-id={artifact.provenance.sourceSessionId}
                          data-source-run-id={artifact.provenance.sourceRunId}
                          data-target-version={artifact.provenance.target.version}
                          data-source-digest={artifact.provenance.sourceDigest}
                        >
                          <summary>{zh ? `来源与版本 · v${artifact.provenance.target.version}` : `Source and version · v${artifact.provenance.target.version}`}</summary>
                          <dl>
                            <div><dt>{zh ? "原任务" : "Task"}</dt><dd>{artifact.sourceTaskTitle}</dd></div>
                            <div><dt>{zh ? "会话" : "Session"}</dt><dd>{artifact.provenance.sourceSessionId}</dd></div>
                            <div><dt>Run</dt><dd>{artifact.provenance.sourceRunId}</dd></div>
                            <div><dt>{zh ? "原始输入" : "Input"}</dt><dd>{artifact.provenance.input.summary}</dd></div>
                            {artifact.provenance.input.attachments.length ? <div><dt>{zh ? "输入材料" : "Input files"}</dt><dd>{artifact.provenance.input.attachments.join("、")}</dd></div> : null}
                            <div><dt>{zh ? "目标版本" : "Target version"}</dt><dd>v{artifact.provenance.target.version} · {artifact.provenance.target.versionId}</dd></div>
                            <div><dt>{zh ? "来源摘要" : "Source digest"}</dt><dd>{artifact.provenance.sourceDigest}</dd></div>
                          </dl>
                          <div className="results-provenance-actions">
                            <button type="button" data-testid="results-open-source-task" onClick={() => {
                              const sourceTask = tasks.find((task) => task.id === artifact.sourceTaskId);
                              if (sourceTask) onOpenSourceTask(sourceTask);
                            }}>{zh ? "返回原任务" : "Open source task"}</button>
                            <button type="button" data-testid="results-open-source-run" onClick={() => {
                              const sourceTask = tasks.find((task) => task.id === artifact.sourceTaskId);
                              if (sourceTask) onOpenSourceRun(sourceTask, artifact.provenance!.sourceRunId);
                            }}>{zh ? "查看 Run" : "Open Run"}</button>
                            <button type="button" data-testid="results-verify-provenance" disabled={provenanceState?.artifactId === artifact.id && provenanceState.state === "checking"} onClick={() => void verifyArtifactSource(artifact)}>{zh ? "验证来源" : "Verify source"}</button>
                          </div>
                          {provenanceState?.artifactId === artifact.id ? <output data-testid="results-provenance-status" data-state={provenanceState.state} role="status">{provenanceState.message}</output> : null}
                        </details>
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
  onCodexRestart,
  onCodexRepair,
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
  onCodexRestart: () => void | Promise<void>;
  onCodexRepair: () => void | Promise<void>;
  onCodexLogin: (type: "chatgpt" | "chatgptDeviceCode") => Promise<CodexBackendLogin>;
  onCodexLogout: () => void | Promise<void>;
}): React.JSX.Element {
  const zh = language === "zh";
  const [codexLogin, setCodexLogin] = useState<CodexBackendLogin | null>(null);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  async function copyCodexDiagnostic(): Promise<void> {
    const report = {
      product: "OpenDrSai Desktop",
      desktopVersion: health?.update.currentVersion ?? "unknown",
      runtimeReady: health?.gatewayReady ?? false,
      runtimeMode: health?.mode ?? "local",
      codex: codexStatus ? {
        state: codexStatus.state,
        version: codexStatus.version,
        loggedIn: codexStatus.loggedIn,
        appServerState: codexStatus.appServerState,
        connectionState: codexStatus.connectionState,
        transport: codexStatus.transport,
        adapterVersion: codexStatus.adapterVersion,
        retryable: codexStatus.retryable,
      } : null,
      generatedAt: new Date().toISOString(),
    };
    await copyTextSafely(JSON.stringify(report, null, 2));
    setDiagnosticCopied(true);
    window.setTimeout(() => setDiagnosticCopied(false), 2_000);
  }

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
        <dl className="codex-health-layers" data-testid="codex-health-layers">
          <div><dt>Desktop → Runtime</dt><dd>{health?.gatewayReady ? (zh ? "已连接" : "Connected") : (zh ? "未连接" : "Disconnected")}</dd></div>
          <div><dt>Runtime → Codex</dt><dd>{codexStatus?.available ? (zh ? "可用" : "Available") : (codexStatus?.reason || (zh ? "不可用" : "Unavailable"))}</dd></div>
          <div><dt>{zh ? "Codex → 账号/模型" : "Codex → account/model"}</dt><dd>{codexStatus?.loggedIn && codexStatus.state === "available" ? (zh ? "账号已登录，模型可用" : "Signed in; models available") : (zh ? "需要检查账号或模型" : "Account or model check required")}</dd></div>
          <div><dt>App Server</dt><dd>{codexStatus?.appServerState === "running" ? (zh ? "运行中" : "Running") : (zh ? "按需启动" : "Starts on demand")}</dd></div>
          <div><dt>{zh ? "连接方式" : "Transport"}</dt><dd>{codexStatus?.transport === "ssh" ? (zh ? "远程 SSH" : "Remote SSH") : (zh ? "本机进程" : "Local process")}</dd></div>
          <div><dt>{zh ? "适配器" : "Adapter"}</dt><dd>{codexStatus?.adapterVersion || (zh ? "等待检测" : "Pending check")}</dd></div>
        </dl>
        <div className="about-action-grid">
          <button type="button" onClick={() => void onCodexRefresh()}>{zh ? "刷新 Codex" : "Refresh Codex"}</button>
          {codexStatus?.action === "login" && <button type="button" data-testid="codex-login" onClick={() => void onCodexLogin("chatgptDeviceCode").then(setCodexLogin)}>{zh ? "登录 ChatGPT" : "Sign in to ChatGPT"}</button>}
          {codexStatus?.loggedIn && <button type="button" data-testid="codex-logout" onClick={() => void onCodexLogout()}>{zh ? "退出 Codex" : "Sign out of Codex"}</button>}
          {codexStatus?.action === "install" && <button type="button" disabled={busy} data-testid="codex-install-action" onClick={() => void onCodexRepair()}>{zh ? "安装并修复 Codex" : "Install and repair Codex"}</button>}
          {codexStatus?.action === "upgrade" && <button type="button" disabled={busy} data-testid="codex-upgrade-action" onClick={() => void onCodexRepair()}>{zh ? "升级 Codex Backend" : "Upgrade Codex Backend"}</button>}
          {codexStatus?.action === "restart" && <button type="button" data-testid="codex-restart-action" onClick={() => void onCodexRestart()}>{zh ? "重启 Codex Backend" : "Restart Codex Backend"}</button>}
          <button type="button" data-testid="copy-codex-diagnostic" onClick={() => void copyCodexDiagnostic()}>{diagnosticCopied ? (zh ? "已复制" : "Copied") : (zh ? "复制脱敏诊断" : "Copy redacted diagnostics")}</button>
        </div>
        <ol className="codex-setup-steps" data-testid="codex-setup-steps" aria-label={zh ? "Codex 首次使用向导" : "Codex first-use setup"}>
          <li data-state={codexStatus?.state === "not_installed" ? "current" : "complete"}>
            <strong>{zh ? "1. 检查或安装 Codex" : "1. Check or install Codex"}</strong>
            <span>{codexStatus?.version ? `${zh ? "已找到版本" : "Found version"} ${codexStatus.version}` : (zh ? "等待检查" : "Waiting for check")}</span>
          </li>
          <li data-state={codexStatus?.loggedIn ? "complete" : codexStatus?.available ? "current" : "pending"}>
            <strong>{zh ? "2. 登录 ChatGPT" : "2. Sign in to ChatGPT"}</strong>
            <span>{codexStatus?.loggedIn ? (codexStatus.accountLabel || (zh ? "已登录" : "Signed in")) : (zh ? "需要登录后才能对话" : "Sign in before chatting")}</span>
          </li>
          <li data-state={codexStatus?.state === "available" ? "complete" : "pending"}>
            <strong>{zh ? "3. 新建 Codex 会话" : "3. Start a Codex conversation"}</strong>
            <span>{codexStatus?.state === "available" ? (zh ? "已就绪，可返回工作区新建会话" : "Ready; return to a workspace and start a conversation") : (zh ? "完成前两步后自动就绪" : "Ready automatically after the first two steps")}</span>
          </li>
        </ol>
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

type SettingsPane = "general" | "voice" | "agent-defaults" | "model-providers" | "agent-task" | "approvals" | "analytics" | "integrations" | "remote-workspace" | "channels" | "archived-sessions" | "other";

function modelProviderRuntimeSummary(connection: MyDrSaiModelConnection, zh: boolean): string | undefined {
  switch (connection.runtime?.runtime_status) {
    case "applied": return connection.runtime.active_runtime_count > 0 ? (zh ? "运行中" : "Active") : undefined;
    case "pending_next_turn": return zh ? "下次会话生效" : "Applies next session";
    case "partially_applied": return zh ? "部分会话待更新" : "Some sessions pending";
    default: return undefined;
  }
}

function modelProviderTestSummary(connection: MyDrSaiModelConnection, zh: boolean): string | undefined {
  const test = connection.last_test;
  if (!test) return undefined;
  const kind = test.mode === "model" ? (zh ? "模型调用" : "Model call") : (zh ? "连接检查" : "Connection check");
  const outcome = test.ok ? (zh ? "已通过" : " passed") : (zh ? "失败" : " failed");
  const testedAt = new Date(test.tested_at);
  const timestamp = Number.isNaN(testedAt.getTime()) ? "" : testedAt.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${kind}${outcome}${timestamp ? ` · ${timestamp}` : ""}`;
}
type AndroidDeviceLoadState = "idle" | "loading" | "ready" | "runtime-offline" | "platform-offline" | "management-unavailable" | "failed";

function isPermissionError(reason: unknown): boolean {
  const raw = reason instanceof Error ? reason.message : String(reason);
  return /401|403|forbidden|permission|unauthorized|oidc|auth/i.test(raw);
}

function classifyAndroidDeviceError(reason: unknown, readiness: DesktopMobilePairingReadiness | null): AndroidDeviceLoadState {
  if (readiness?.state === "offline") return "platform-offline";
  if (readiness?.state === "not_registered" || readiness?.state === "credential_invalid") return "runtime-offline";
  if (isPermissionError(reason)) return "management-unavailable";
  return "failed";
}

function androidRelativeTime(raw: string | null | undefined, language: AppLanguage): string {
  if (!raw) return language === "zh" ? "从未在线" : "never seen";
  const then = Date.parse(raw);
  if (!Number.isFinite(then)) return language === "zh" ? "时间未知" : "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return language === "zh" ? "刚刚" : "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return language === "zh" ? `${minutes}分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === "zh" ? `${hours}小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return language === "zh" ? "昨天" : "yesterday";
  return language === "zh" ? `${days}天前` : `${days}d ago`;
}

const bundledModelProviderLogos: Record<string, string> = {
  deepseek: new URL("../../../legacy/drsai-desktop/src/renderer/src/assets/logos/deepseek-color.svg", import.meta.url).href,
  openai: new URL("../../../legacy/drsai-desktop/src/renderer/src/assets/logos/openai.svg", import.meta.url).href,
  gemini: new URL("../../../legacy/drsai-desktop/src/renderer/src/assets/logos/gemini-color.svg", import.meta.url).href,
  openrouter: new URL("../../../legacy/drsai-desktop/src/renderer/src/assets/logos/openrouter.svg", import.meta.url).href,
};

const BUILTIN_MODEL_PROVIDER_PRESETS: MyDrSaiProviderPreset[] = [
  { id: "hepai", label: "HepAI", base_url: "https://aiapi.ihep.ac.cn/apiv2", default_model: "deepseek-v4-pro", wire_api: "openai", requires_api_key: false, base_url_editable: false, supports_model_discovery: true, auth_mode: "oidc" },
  { id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/v1", default_model: "deepseek-chat", wire_api: "openai", requires_api_key: true, api_key_env: "DEEPSEEK_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", default_model: "gpt-5.4", wire_api: "openai", requires_api_key: true, api_key_env: "OPENAI_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "anthropic", label: "Anthropic", base_url: "https://api.anthropic.com/v1", anthropic_base_url: "https://api.anthropic.com/v1", default_model: "claude-sonnet-4-6", wire_api: "anthropic", requires_api_key: true, api_key_env: "ANTHROPIC_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "gemini", label: "Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta", google_base_url: "https://generativelanguage.googleapis.com/v1beta", default_model: "gemini-3.6-flash", wire_api: "gemini", requires_api_key: true, api_key_env: "GEMINI_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", default_model: "openai/gpt-5.4", wire_api: "openai", requires_api_key: true, api_key_env: "OPENROUTER_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "zhizengzeng", label: "Zhizengzeng", base_url: "https://api.zhizengzeng.com/v1", anthropic_base_url: "https://api.zhizengzeng.com/anthropic", google_base_url: "https://api.zhizengzeng.com/google", default_model: "deepseek-v4-pro", wire_api: "openai", requires_api_key: true, api_key_env: "ZHIZENGZENG_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "ollama", label: "Ollama", base_url: "http://127.0.0.1:11434/v1", wire_api: "openai", requires_api_key: false, base_url_editable: true, supports_model_discovery: true, auth_mode: "none" },
];

const MODEL_PROVIDER_TAB_ORDER = BUILTIN_MODEL_PROVIDER_PRESETS.map((preset) => preset.id);

function modelProviderDisplayLabel(provider: { id: string; label: string }, zh: boolean): string {
  if (provider.id === "hepai") return "HepAI";
  if (provider.id === "zhizengzeng") return zh ? "智增增" : "Zhizengzeng";
  if (provider.id === "ollama") return zh ? "Ollama（本地）" : "Ollama (local)";
  return provider.label;
}

function ModelProviderLogo({ provider }: { provider: string }) {
  const normalized = provider.toLowerCase();
  const kind = normalized === "zhizengzeng" ? "zhizz" : normalized.startsWith("custom") ? "custom" : normalized;
  const bundledLogo = bundledModelProviderLogos[kind];
  if (bundledLogo) return <span className={`model-provider-logo model-provider-logo-${kind}`} aria-hidden="true"><img src={bundledLogo} alt="" /></span>;
  if (kind === "hepai") return <span className="model-provider-logo model-provider-logo-hepai" aria-hidden="true"><svg viewBox="0 0 32 26"><defs><linearGradient id="hepai-provider-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7eaad7" /><stop offset=".52" stopColor="#aa91b8" /><stop offset="1" stopColor="#c54d69" /></linearGradient></defs><rect width="32" height="26" rx="4" fill="url(#hepai-provider-gradient)" /><text x="16" y="18.2" textAnchor="middle" fill="#fff" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="800">HAI</text></svg></span>;
  if (kind === "anthropic") return <span className="model-provider-logo model-provider-logo-anthropic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" fill="currentColor" /></svg></span>;
  if (kind === "zhizz") return <span className="model-provider-logo model-provider-logo-zhizz" aria-hidden="true"><svg viewBox="0 0 128 128"><path d="M5 96 27 58l17 28 27-43 18 29 29-48" fill="none" stroke="#91c8ff" strokeWidth="14" strokeLinejoin="miter" /><path d="M5 96 27 66l17 28 27-43 18 29 34-57" fill="none" stroke="#1769f5" strokeWidth="8" strokeLinejoin="miter" /><path d="m99 9 23 2-4 22z" fill="#51a6ff" /></svg></span>;
  if (kind === "ollama") return <span className="model-provider-logo model-provider-logo-ollama" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z" fill="currentColor" /></svg></span>;
  return <span className="model-provider-logo model-provider-logo-custom" aria-hidden="true"><PackageOpen size={14} /></span>;
}

type ProviderModelModality = "text" | "image" | "audio" | "video";

type ProviderModelEditorDraft = {
  originalId: string;
  modelId: string;
  alias: string;
  inputModalities: MyDrSaiModelModality[];
  outputModalities: MyDrSaiModelModality[];
  apiProtocol: MyDrSaiModelApiProtocol;
  enabled: boolean;
  capabilities: MyDrSaiModelCapability[];
};

function knownTextModelCapabilities(modelId: string): MyDrSaiModelCapability[] {
  const normalized = modelId.trim().toLowerCase().split("/").at(-1);
  return normalized === "deepseek-v4-pro" || normalized === "deepseek-v4-flash" || normalized?.startsWith("deepseek-v4-flash-")
    ? ["chat", "tool_calling", "reasoning"]
    : [];
}

function defaultTextModelCapabilities(modelId: string): MyDrSaiModelCapability[] {
  const known = knownTextModelCapabilities(modelId);
  return known.length ? known : ["chat"];
}

function providerModelConfigFor(
  modelId: string,
  provider: { wire_api: MyDrSaiModelApiProtocol; model_configs?: Record<string, MyDrSaiProviderModelConfig>; model_aliases?: Record<string, string>; model_operations?: Record<string, RuntimeModelOperation[]> } | undefined,
): MyDrSaiProviderModelConfig {
  const configured = provider?.model_configs?.[modelId];
  if (configured) {
    const legacy = (configured as unknown as { modalities?: MyDrSaiModelModality[] }).modalities;
    const capabilities = [...new Set([
      ...(configured.capabilities ?? ["chat"]),
      ...knownTextModelCapabilities(modelId),
    ])];
    const output = legacy ? [
      ...(["chat", "tool_calling", "reasoning", "speech_to_text"].some((capability) => capabilities.includes(capability as MyDrSaiModelCapability)) ? ["text" as const] : []),
      ...(["image_generation", "image_edit"].some((capability) => capabilities.includes(capability as MyDrSaiModelCapability)) ? ["image" as const] : []),
      ...(capabilities.includes("text_to_speech") ? ["audio" as const] : []),
      ...(capabilities.includes("video_generation") ? ["video" as const] : []),
    ] : configured.output_modalities;
    return {
      ...configured,
      input_modalities: configured.input_modalities ?? legacy ?? ["text"],
      output_modalities: output?.length ? [...new Set(output)] : ["text"],
      api_protocol: (configured.api_protocol as string) === "google" ? "gemini" : configured.api_protocol,
    };
  }
  const operations = provider?.model_operations?.[modelId] ?? [];
  const normalizedId = modelId.toLowerCase().split("/").at(-1);
  const speechToText = normalizedId === "whisper-1";
  const textToSpeech = normalizedId === "tts-1";
  return {
    ...(provider?.model_aliases?.[modelId] ? { alias: provider.model_aliases[modelId] } : {}),
    input_modalities: speechToText ? ["audio"] : operations.includes("image_edit") ? ["text", "image"] : ["text"],
    output_modalities: speechToText ? ["text"] : textToSpeech ? ["audio"] : operations.some((operation) => operation === "image_generation" || operation === "image_edit") ? ["image"] : ["text"],
    api_protocol: provider?.wire_api ?? "openai",
    enabled: true,
    capabilities: speechToText ? ["speech_to_text"] : textToSpeech ? ["text_to_speech"] : [...new Set([...defaultTextModelCapabilities(modelId), ...operations])],
  };
}

function providerModelConfigsFor(
  modelIds: string[],
  provider: Parameters<typeof providerModelConfigFor>[1],
): Record<string, MyDrSaiProviderModelConfig> {
  return Object.fromEntries(modelIds.map((modelId) => [modelId, providerModelConfigFor(modelId, provider)]));
}

function providerModelDescriptor(modelId: string, providerId: string, catalogModels: MyDrSaiModelConfig[]): MyDrSaiModelConfig | undefined {
  const normalizedId = modelId.trim().toLowerCase();
  return catalogModels.find((candidate) => {
    if (candidate.provider_id && candidate.provider_id !== providerId) return false;
    return [candidate.model, candidate.alias, candidate.alias?.split("/").at(-1)]
      .some((value) => value?.trim().toLowerCase() === normalizedId);
  });
}

function providerModelModalities(
  modelId: string,
  providerId: string,
  catalogModels: MyDrSaiModelConfig[],
  declaredOperations: RuntimeModelOperation[],
): { input: ProviderModelModality[]; output: ProviderModelModality[] } {
  const normalizedId = modelId.trim().toLowerCase();
  const descriptor = providerModelDescriptor(modelId, providerId, catalogModels);
  const input = new Set<ProviderModelModality>();
  const output = new Set<ProviderModelModality>();
  for (const modality of descriptor?.input_modalities ?? []) if (["text", "image", "audio", "video"].includes(modality)) input.add(modality as ProviderModelModality);
  for (const modality of descriptor?.output_modalities ?? []) if (["text", "image", "audio", "video"].includes(modality)) output.add(modality as ProviderModelModality);
  if (descriptor?.vision) input.add("image");
  if (declaredOperations.includes("image_edit")) input.add("image");
  if (declaredOperations.some((operation) => operation === "image_generation" || operation === "image_edit")) output.add("image");
  if (normalizedId === "whisper-1" || normalizedId.endsWith("/whisper-1")) {
    input.add("audio");
    output.add("text");
  }
  if (normalizedId === "tts-1" || normalizedId.endsWith("/tts-1")) {
    input.add("text");
    output.add("audio");
  }
  if (input.size === 0) input.add("text");
  if (output.size === 0) output.add("text");
  const ordered = ["text", "image", "audio", "video"] as const;
  return { input: ordered.filter((modality) => input.has(modality)), output: ordered.filter((modality) => output.has(modality)) };
}

function ModelModalityBadges({ modalities, direction, zh = false, onClick }: { modalities: ProviderModelModality[]; direction: "input" | "output"; zh?: boolean; onClick?: () => void }) {
  const entries: Record<ProviderModelModality, { label: string; icon: LucideIcon }> = {
    text: { label: "Text", icon: Type },
    image: { label: "Image", icon: ImageIcon },
    audio: { label: "Audio", icon: AudioLines },
    video: { label: "Video", icon: Video },
  };
  return <div className={`model-modality-badges ${onClick ? "is-editable" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}>{modalities.map((modality) => {
    const entry = entries[modality];
    const Icon = entry.icon;
    const supported = modalities.includes(modality);
    const stateLabel = zh ? (supported ? "支持" : "不支持") : (supported ? "Supported" : "Not supported");
    const directionLabel = direction === "input" ? (zh ? "输入" : "Input") : (zh ? "输出" : "Output");
    const label = `${directionLabel} ${entry.label} · ${stateLabel}`;
    return <span key={modality} className={`model-modality-badge modality-${modality} ${supported ? "is-supported" : "is-unsupported"}`} title={label} aria-label={label}><Icon size={14} aria-hidden /></span>;
  })}</div>;
}

function ModelApiProtocolBadge({ protocol, zh, onClick }: { protocol: string; zh: boolean; onClick?: () => void }) {
  // Legacy copy marker retained for migration-contract verification: "Google API 兼容".
  const normalized = protocol.toLowerCase();
  const kind = normalized === "anthropic" ? "anthropic" : normalized === "google" || normalized === "gemini" ? "google" : "openai";
  const labels = zh
    ? { openai: "OpenAI API 兼容", anthropic: "Anthropic API 兼容", google: "Gemini 原生 API" } as const
    : { openai: "OpenAI API compatible", anthropic: "Anthropic API compatible", google: "Gemini native API" } as const;
  const marks = { openai: "OA", anthropic: "A", google: "G" } as const;
  const label = labels[kind];
  return <div className={`model-api-protocols ${onClick ? "is-editable" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}><span className={`model-api-protocol protocol-${kind} is-supported`} title={label} aria-label={label}><i aria-hidden>{marks[kind]}</i></span></div>;
}

function agentToolLabel(toolId: string, zh: boolean): string {
  if (toolId === "builtin.web-search") return zh ? "网络搜索" : "Web search";
  if (toolId === "builtin.image_generation") return zh ? "图像生成" : "Image generation";
  if (toolId === "builtin.image_edit") return zh ? "图像编辑" : "Image editing";
  return toolId;
}

function agentToolStatusLabel(status: string, zh: boolean): string {
  if (!zh) return status;
  return ({
    available: "可用",
    disabled: "已禁用",
    runtime_unavailable: "运行环境不可用",
    network_unavailable: "网络不可用",
    unsupported_platform: "当前平台不支持",
  } as Record<string, string>)[status] ?? status;
}

function AgentResourcesSettings({ agentId, zh }: { agentId: string; zh: boolean }) {
  const [tab, setTab] = useState<"tools" | "skills" | "knowledge">("tools");
  const [toolPolicy, setToolPolicy] = useState<AgentToolPolicy | null>(null);
  const [toolPreview, setToolPreview] = useState<AgentToolPreview | null>(null);
  const [skillPolicy, setSkillPolicy] = useState<AgentSkillPolicy | null>(null);
  const [skillPreview, setSkillPreview] = useState<AgentSkillPreview | null>(null);
  const [knowledgePolicy, setKnowledgePolicy] = useState<AgentKnowledgePolicy | null>(null);
  const [knowledgePreview, setKnowledgePreview] = useState<AgentKnowledgePreview | null>(null);
  const [knowledgeDraft, setKnowledgeDraft] = useState({ id: "", name: "", type: "local-files" as "local-files" | "ragflow", location: "", dataset: "", credential: "" });
  const [knowledgeQuery, setKnowledgeQuery] = useState<Record<string, string>>({});
  const [knowledgeEvidence, setKnowledgeEvidence] = useState<Record<string, Array<{ source: string; score: number; content?: string }>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [tools, toolsPreview, skills, skillsPreview, knowledge, knowledgePreviewResult] = await Promise.all([
        desktopApi.getMyDrSaiAgentToolPolicy(agentId),
        desktopApi.previewMyDrSaiAgentTools(agentId),
        desktopApi.getMyDrSaiAgentSkillPolicy(agentId),
        desktopApi.previewMyDrSaiAgentSkills(agentId),
        desktopApi.getMyDrSaiAgentKnowledgePolicy(agentId),
        desktopApi.previewMyDrSaiAgentKnowledge(agentId),
      ]);
      setToolPolicy(tools); setToolPreview(toolsPreview); setSkillPolicy(skills); setSkillPreview(skillsPreview);
      setKnowledgePolicy(knowledge); setKnowledgePreview(knowledgePreviewResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleTool = async (toolId: string, checked: boolean) => {
    if (!toolPolicy || !toolPreview) return;
    setBusy(true); setError(null);
    try {
      const current = new Set(toolPreview.tools.filter((row) => row.selected).map((row) => row.tool_id));
      if (checked) current.add(toolId); else current.delete(toolId);
      await desktopApi.updateMyDrSaiAgentToolPolicy(agentId, { ...toolPolicy, mode: "explicit", enabled: [...current], disabled: [], expected_revision: toolPolicy.revision });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  const toggleSkill = async (skillId: string, checked: boolean) => {
    if (!skillPolicy || !skillPreview) return;
    setBusy(true); setError(null);
    try {
      const current = new Set(skillPreview.enabled_ids);
      if (checked) current.add(skillId); else current.delete(skillId);
      await desktopApi.updateMyDrSaiAgentSkillPolicy(agentId, { ...skillPolicy, mode: "explicit", enabled: [...current], disabled: [], expected_revision: skillPolicy.revision });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  const toggleKnowledge = async (knowledgeId: string, checked: boolean) => {
    if (!knowledgePolicy || !knowledgePreview) return;
    setBusy(true); setError(null);
    try {
      const current = new Set(knowledgePreview.sources);
      if (checked) current.add(knowledgeId); else current.delete(knowledgeId);
      await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, { ...knowledgePolicy, mode: "explicit", sources: [...current], expected_revision: knowledgePolicy.revision });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  return <section className="settings-section agent-resource-settings" data-testid="agent-resource-settings">
    <div><h2>{zh ? "工具、技能与知识库" : "Tools, skills, and knowledge"}</h2><p>{zh ? "按智能体选择真正进入运行时的工具、技能和知识库。" : "Choose the tools, skills, and knowledge bases that enter this Agent's runtime."}</p></div>
    <div className="agent-configuration-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "tools"} className={tab === "tools" ? "active" : ""} onClick={() => setTab("tools")}>{zh ? "工具" : "Tools"}</button>
      <button type="button" role="tab" aria-selected={tab === "skills"} className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>{zh ? "技能" : "Skills"}</button>
      <button type="button" role="tab" aria-selected={tab === "knowledge"} className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}>{zh ? "知识库" : "Knowledge"}</button>
      <button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {tab === "tools" && <div role="tabpanel">
      {(toolPreview?.tools ?? []).map((tool) => <div className="settings-toggle" key={tool.tool_id} data-testid={`agent-tool-${tool.tool_id}`}>
        <span><strong>{agentToolLabel(tool.tool_id, zh)}</strong><small>{agentToolStatusLabel(tool.status, zh)}{tool.error ? ` · ${tool.error}` : ""}</small></span>
        <div className="settings-model-control"><button type="button" disabled={busy || ["unsupported_platform", "runtime_unavailable"].includes(tool.status)} onClick={async () => { try { setBusy(true); setError(null); await desktopApi.testAgentTool(tool.tool_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "测试" : "Test"}</button><input aria-label={agentToolLabel(tool.tool_id, zh)} type="checkbox" checked={tool.selected} disabled={busy || ["unsupported_platform", "runtime_unavailable"].includes(tool.status)} onChange={(event) => void toggleTool(tool.tool_id, event.target.checked)} /></div>
      </div>)}
      {!busy && (toolPreview?.tools.length ?? 0) === 0 && <p>{zh ? "没有可配置工具。" : "No configurable tools."}</p>}
    </div>}
    {tab === "skills" && <div role="tabpanel">
      {(skillPreview?.skills ?? []).map((skill) => <label className="settings-toggle" key={skill.name} data-testid={`agent-skill-${skill.name}`}>
        <span><strong>{skill.name}</strong><small>{skill.description || (zh ? "已安装技能" : "Installed skill")}</small></span>
        <input type="checkbox" checked={skill.enabled_for_agent} disabled={busy} onChange={(event) => void toggleSkill(skill.name, event.target.checked)} />
      </label>)}
      {!busy && (skillPreview?.skills.length ?? 0) === 0 && <p>{zh ? "尚未安装技能，请前往技能广场。" : "No skills installed. Open Skills to install one."}</p>}
      {skillPolicy && <label className="settings-toggle"><span><strong>{zh ? "允许会话临时技能" : "Allow per-task skill overrides"}</strong><small>{zh ? "允许在输入框中为单次任务增加技能。" : "Allow the composer to add skills for one task."}</small></span><input type="checkbox" checked={skillPolicy.allow_thread_override} disabled={busy} onChange={async (event) => { try { setBusy(true); await desktopApi.updateMyDrSaiAgentSkillPolicy(agentId, { ...skillPolicy, allow_thread_override: event.target.checked, expected_revision: skillPolicy.revision }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }} /></label>}
    </div>}
    {tab === "knowledge" && <div role="tabpanel">
      <div className="settings-row agent-knowledge-create">
        <span><strong>{zh ? "添加知识库" : "Add Knowledge Base"}</strong><small>{zh ? "本地路径建立 SQLite 索引；RAGFlow 使用远程数据集。" : "Local paths use a SQLite index; RAGFlow uses a remote dataset."}</small></span>
        <div className="settings-model-control">
          <input aria-label={zh ? "知识库 ID" : "Knowledge Base ID"} placeholder="product-docs" value={knowledgeDraft.id} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, id: event.target.value }))} />
          <input aria-label={zh ? "知识库名称" : "Knowledge Base name"} placeholder={zh ? "产品文档" : "Product docs"} value={knowledgeDraft.name} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, name: event.target.value }))} />
          <select value={knowledgeDraft.type} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, type: event.target.value as "local-files" | "ragflow" }))}><option value="local-files">Local files</option><option value="ragflow">RAGFlow</option></select>
          <input aria-label={knowledgeDraft.type === "local-files" ? (zh ? "根目录" : "Root path") : "RAGFlow URL"} placeholder={knowledgeDraft.type === "local-files" ? "C:\\workspace\\docs" : "https://rag.example.com"} value={knowledgeDraft.location} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, location: event.target.value }))} />
          {knowledgeDraft.type === "ragflow" && <><input aria-label="RAGFlow dataset ID" placeholder="dataset-id" value={knowledgeDraft.dataset} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, dataset: event.target.value }))} /><input aria-label="RAGFlow token" type="password" autoComplete="off" placeholder="Token" value={knowledgeDraft.credential} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, credential: event.target.value }))} /></>}
          <button type="button" disabled={busy || !knowledgeDraft.id || !knowledgeDraft.name || !knowledgeDraft.location} onClick={async () => { try { setBusy(true); setError(null); await desktopApi.createKnowledgeBase({ knowledge_id: knowledgeDraft.id, display_name: knowledgeDraft.name, type: knowledgeDraft.type, enabled: true, config: knowledgeDraft.type === "local-files" ? { root_path: knowledgeDraft.location, paths: ["."], chunk_size: 800, chunk_overlap: 120 } : { base_url: knowledgeDraft.location, dataset_ids: [knowledgeDraft.dataset] }, ...(knowledgeDraft.credential ? { credential: knowledgeDraft.credential } : {}) }); setKnowledgeDraft({ id: "", name: "", type: "local-files", location: "", dataset: "", credential: "" }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "添加" : "Add"}</button>
        </div>
      </div>
      {(knowledgePreview?.knowledge_bases ?? []).map((knowledge) => <div className="settings-row" key={knowledge.knowledge_id} data-testid={`agent-knowledge-${knowledge.knowledge_id}`}>
        <span><strong>{knowledge.display_name}</strong><small>{knowledge.type} · {knowledge.status ?? "configured"}{knowledge.document_count !== undefined ? ` · ${knowledge.document_count} docs / ${knowledge.chunk_count ?? 0} chunks` : ""}</small></span>
        <div className="settings-model-control">
          {knowledge.type === "local-files" && <button type="button" disabled={busy} onClick={async () => { try { setBusy(true); await desktopApi.indexKnowledgeBase(knowledge.knowledge_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "建立索引" : "Index"}</button>}
          <button type="button" disabled={busy} onClick={async () => { try { setBusy(true); await desktopApi.testKnowledgeBase(knowledge.knowledge_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "测试连接" : "Test"}</button>
          <input aria-label={`${knowledge.display_name} ${zh ? "检索测试" : "search preview"}`} placeholder={zh ? "输入检索问题" : "Search query"} value={knowledgeQuery[knowledge.knowledge_id] ?? ""} onChange={(event) => setKnowledgeQuery((value) => ({ ...value, [knowledge.knowledge_id]: event.target.value }))} />
          <button type="button" disabled={busy || !(knowledgeQuery[knowledge.knowledge_id] ?? "").trim()} onClick={async () => { try { setBusy(true); setError(null); const result = await desktopApi.searchKnowledgeBase(knowledge.knowledge_id, knowledgeQuery[knowledge.knowledge_id] ?? ""); setKnowledgeEvidence((value) => ({ ...value, [knowledge.knowledge_id]: result.evidence })); setBusy(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "检索" : "Search"}</button>
          {!knowledge.selected && <button type="button" disabled={busy} onClick={async () => { try { setBusy(true); await desktopApi.deleteKnowledgeBase(knowledge.knowledge_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}><Trash2 size={14} />{zh ? "删除" : "Delete"}</button>}
          <input aria-label={knowledge.display_name} type="checkbox" checked={Boolean(knowledge.selected)} disabled={busy || knowledge.status === "credential_required"} onChange={(event) => void toggleKnowledge(knowledge.knowledge_id, event.target.checked)} />
        </div>
      </div>)}
      {Object.entries(knowledgeEvidence).map(([knowledgeId, rows]) => rows.length > 0 && <div className="settings-row" key={`evidence-${knowledgeId}`}><span><strong>{zh ? "检索证据" : "Search evidence"}</strong>{rows.map((row, index) => <small key={`${row.source}-${index}`}>{row.source} · {row.score.toFixed(3)}{row.content ? ` · ${row.content.slice(0, 160)}` : ""}</small>)}</span></div>)}
      {!busy && (knowledgePreview?.knowledge_bases.length ?? 0) === 0 && <p>{zh ? "尚未配置知识库。" : "No Knowledge Base configured."}</p>}
      {knowledgePolicy && <>
        <div className="settings-row"><span><strong>{zh ? "检索策略" : "Retrieval policy"}</strong></span><select value={knowledgePolicy.retrieval_policy} disabled={busy} onChange={async (event) => { try { setBusy(true); await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, { ...knowledgePolicy, retrieval_policy: event.target.value as AgentKnowledgePolicy["retrieval_policy"], expected_revision: knowledgePolicy.revision }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}><option value="auto">Auto</option><option value="always">Always</option><option value="never">Never</option></select></div>
        <label className="settings-toggle"><span><strong>{zh ? "要求引用" : "Require citations"}</strong><small>{zh ? "知识库回答必须保留来源证据。" : "Knowledge-grounded answers must retain source evidence."}</small></span><input type="checkbox" checked={knowledgePolicy.require_citations} disabled={busy} onChange={async (event) => { try { setBusy(true); await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, { ...knowledgePolicy, require_citations: event.target.checked, expected_revision: knowledgePolicy.revision }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }} /></label>
      </>}
    </div>}
  </section>;
}

function SettingsPanel({
  modelSettings,
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
  mobilePairingRefreshToken,
  myDrSaiConfig,
  myDrSaiAgentModelPolicy,
  agentConfigurations,
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
  onConfigureAgentModel,
  onConfigureAgentCapabilityModel,
  onRefreshAgentModels,
  onSessionScopeChange,
  onArchiveThread,
  workspaces,
  onSyncWorkspaceSessions,
  onSidebarComponentsChange,
  onConfigureAgentThinkingEffort,
  onWorkspaceSortModeChange,
  onUpdateAgentConfig,
  onModelConnectionUpdated,
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
  modelSettings: ModelSettingsDraftController;
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
  mobilePairingRefreshToken: number;
  myDrSaiConfig: MyDrSaiConfig | null;
  myDrSaiAgentModelPolicy: MyDrSaiAgentModelPolicy | null;
  agentConfigurations: Record<string, AgentConfigurationPreference>;
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
  onConfigureAgentModel: (agentId: string, model: string, providerId?: string) => void;
  onConfigureAgentCapabilityModel: (role: AgentCapabilityModelRole, modelId?: string, providerId?: string) => void;
  onRefreshAgentModels: () => void;
  onSessionScopeChange: (scope: "workspace" | "all") => void;
  onArchiveThread: (threadId: string, archived: boolean) => void | Promise<void>;
  workspaces: WorkspaceProject[];
  onSyncWorkspaceSessions: (workspace: WorkspaceProject) => void | Promise<void>;
  onSidebarComponentsChange: React.Dispatch<React.SetStateAction<SidebarComponentVisibility>>;
  onConfigureAgentThinkingEffort: (agentId: string, effort: ThinkingEffort) => void;
  onWorkspaceSortModeChange: (mode: WorkspaceSortMode) => void;
  onUpdateAgentConfig: (updates: { plan_mode?: boolean; workspace_enabled?: boolean }) => Promise<void>;
  onModelConnectionUpdated: (connection: MyDrSaiModelConnection) => void;
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
  const {
    activePane, setActivePane,
    modelDraft, setModelDraft, providerDraft, setProviderDraft, baseUrlDraft, setBaseUrlDraft,
    anthropicBaseUrlDraft, setAnthropicBaseUrlDraft, geminiBaseUrlDraft, setGeminiBaseUrlDraft,
    apiKeyDraft, setApiKeyDraft, apiKeyEnvDraft, setApiKeyEnvDraft,
    wireApiDraft, setWireApiDraft, keySourceDraft, setKeySourceDraft,
    modelConfigBusy, setModelConfigBusy, modelConfigMessage, setModelConfigMessage,
    modelTestOutput, setModelTestOutput, modelConfigConflict, setModelConfigConflict,
    providerPendingDeletion, setProviderPendingDeletion, providerDeletePreflight, setProviderDeletePreflight,
    modelTestConfirmationOpen, setModelTestConfirmationOpen,
    modelDoctorResult, setModelDoctorResult, modelProviderPresets, setModelProviderPresets,
    activeModelProviderTab, setActiveModelProviderTab,
    recentOverflowModelProviderTab, setRecentOverflowModelProviderTab,
    discoveredModels, setDiscoveredModels, providerModelsDraft, setProviderModelsDraft,
    providerModelAliasesDraft, setProviderModelAliasesDraft,
    providerModelOperationsDraft, setProviderModelOperationsDraft,
    providerModelConfigsDraft, setProviderModelConfigsDraft,
    newProviderModelDraft, setNewProviderModelDraft,
  } = modelSettings;
  const zh = language === "zh";
  const [providerModelEditor, setProviderModelEditor] = useState<ProviderModelEditorDraft | null>(null);
  const [providerModelEditorError, setProviderModelEditorError] = useState<string | null>(null);
  const [addedProviderProtocols, setAddedProviderProtocols] = useState<Set<MyDrSaiModelApiProtocol>>(new Set());
  const providerTabAfterProviderSaveRef = useRef<string | null>(null);
  const selectedSettingsAgent = agents.find((agent) => agent.id === selectedAgentId);
  const [activeAgentConfigurationTab, setActiveAgentConfigurationTab] = useState<AgentConfigurationTab>(() =>
    selectedSettingsAgent ? getAgentConfigurationTab(selectedSettingsAgent) : "opendrsai");
  const [platformConfigurationAgentId, setPlatformConfigurationAgentId] = useState(() =>
    selectedSettingsAgent?.source === "remote" ? selectedSettingsAgent.id : "");
  const openDrSaiConfigurationAgent = agents.find((agent) => agent.source === "local" && agent.id !== "my-codex");
  const codexConfigurationAgent = agents.find((agent) => agent.id === "my-codex");
  const platformConfigurationAgents = agents.filter((agent) => agent.source === "remote");
  const platformConfigurationAgent = platformConfigurationAgents.find((agent) => agent.id === platformConfigurationAgentId)
    ?? platformConfigurationAgents[0];
  const activeConfigurationAgent = activeAgentConfigurationTab === "opendrsai"
    ? openDrSaiConfigurationAgent
    : activeAgentConfigurationTab === "codex"
      ? codexConfigurationAgent
      : platformConfigurationAgent;
  const activeAgentPreference = activeConfigurationAgent ? agentConfigurations[activeConfigurationAgent.id] : undefined;
  const activeAgentModels = getAgentModelOptions(
    models, activeConfigurationAgent, activeAgentPreference?.model ?? null, activeAgentPreference?.modelRef,
  );
  const activeAgentModel = activeAgentConfigurationTab === "opendrsai" && activeAgentPreference?.modelRef
    ? `${encodeURIComponent(activeAgentPreference.modelRef.provider_id)}::${encodeURIComponent(activeAgentPreference.modelRef.model_id)}`
    : activeAgentPreference?.model || activeConfigurationAgent?.model || activeConfigurationAgent?.models?.[0]
      || (activeAgentConfigurationTab === "opendrsai" ? "" : DEFAULT_AGENT_TEXT_MODEL);
  const activeAgentThinkingEffort = activeAgentPreference?.thinkingEffort
    ?? (activeConfigurationAgent?.id === selectedAgentId ? defaultThinkingEffort : "medium");
  const activeAgentModelDescriptor = activeAgentConfigurationTab === "opendrsai"
    ? activeAgentModels.find((model) => model.provider_id === activeAgentPreference?.modelRef?.provider_id && model.alias === activeAgentPreference?.modelRef?.model_id)
      ?? activeAgentModels.find((model) => model.alias === activeAgentPreference?.model)
    : undefined;
  const activeAgentModelGroups = activeAgentModels.reduce<Record<string, MyDrSaiModelConfig[]>>((groups, model) => {
    const provider = model.provider_id || (zh ? "其他来源" : "Other sources");
    (groups[provider] ??= []).push(model);
    return groups;
  }, {});
  const activeAgentModelUnavailable = activeAgentConfigurationTab === "opendrsai"
    && activeAgentModelDescriptor
    && !isSelectableModelAvailability(activeAgentModelDescriptor.availability);
  const activeAgentModelProvider = activeAgentConfigurationTab === "opendrsai"
    ? activeAgentPreference?.modelRef?.provider_id || activeAgentModelDescriptor?.provider_id
    : undefined;
  const modelCatalogState = myDrSaiConfig?.modelCatalog?.state
    ?? (myDrSaiConfig?.ready ? (models.length ? "fresh" : "empty") : "offline");
  const activeAgentThinkingEfforts: ThinkingEffort[] = activeAgentConfigurationTab === "opendrsai"
    ? activeAgentModelDescriptor?.operations?.includes("reasoning")
      ? (activeAgentModelDescriptor.reasoning_efforts ?? [])
      : []
    : ["low", "medium", "high", "xhigh", "max"];
  const selectableCapabilityModels = (input: MyDrSaiModelModality, output: MyDrSaiModelModality) => models.filter((model) =>
    model.provider_id
      && ["available", "configured_unverified"].includes(model.availability ?? "")
      && model.input_modalities?.includes(input)
      && model.output_modalities?.includes(output),
  );
  const capabilityModelSettings: Array<{
    role: AgentCapabilityModelRole;
    testId: string;
    label: string;
    description: string;
    models: MyDrSaiModelConfig[];
    selection: AgentModelSelection | null | undefined;
  }> = [
    { role: "image_understanding_model", testId: "agent-image-understanding-model-setting", label: zh ? "图像理解" : "Image understanding", description: zh ? "接收图片并输出文字理解结果。" : "Accepts images and returns a text understanding.", models: selectableCapabilityModels("image", "text"), selection: myDrSaiAgentModelPolicy?.image_understanding_model },
    { role: "image_generation_model", testId: "agent-image-generation-model-setting", label: zh ? "图像生成" : "Image generation", description: zh ? "根据文字或图片生成图像。" : "Generates images from text or image input.", models: models.filter((model) => model.provider_id && ["available", "configured_unverified"].includes(model.availability ?? "") && model.output_modalities?.includes("image")), selection: myDrSaiAgentModelPolicy?.image_generation_model ?? myDrSaiAgentModelPolicy?.image_model },
    { role: "text_to_speech_model", testId: "agent-text-to-speech-model-setting", label: zh ? "文字转语音" : "Text to speech", description: zh ? "将文字合成为语音。" : "Synthesizes speech from text.", models: selectableCapabilityModels("text", "audio"), selection: myDrSaiAgentModelPolicy?.text_to_speech_model },
    { role: "speech_to_text_model", testId: "agent-speech-to-text-model-setting", label: zh ? "语音转文字" : "Speech to text", description: zh ? "将语音识别为文字。" : "Transcribes speech into text.", models: selectableCapabilityModels("audio", "text"), selection: myDrSaiAgentModelPolicy?.speech_to_text_model },
  ];
  useEffect(() => {
    if (!selectedSettingsAgent) return;
    const tab = getAgentConfigurationTab(selectedSettingsAgent);
    setActiveAgentConfigurationTab(tab);
    if (tab === "platform") setPlatformConfigurationAgentId(selectedSettingsAgent.id);
  }, [selectedAgentId, selectedSettingsAgent?.id, selectedSettingsAgent?.source]);
  const [voiceIntegrationState, setVoiceIntegrationState] = useState<string | null>(null);
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences();
  const [voiceRuntimeStatus, setVoiceRuntimeStatus] = useState<DesktopVoiceRuntimeStatus | null>(null);
  const [streamingVoiceCapabilities, setStreamingVoiceCapabilities] = useState<DesktopStreamingVoiceCapabilities | null>(null);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [remoteHostCount, setRemoteHostCount] = useState<number | null>(null);
  const [mobilePairingReadiness, setMobilePairingReadiness] = useState<DesktopMobilePairingReadiness | null>(null);
  const [mobileAssociations, setMobileAssociations] = useState<DesktopMobileAssociation[]>([]);
  const [mobileAssociationsState, setMobileAssociationsState] = useState<AndroidDeviceLoadState>("idle");
  const [mobileEnrollmentBusy, setMobileEnrollmentBusy] = useState(false);
  const [mobileEnrollmentError, setMobileEnrollmentError] = useState<string | null>(null);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigMessage, setAgentConfigMessage] = useState<string | null>(null);
  const [modelCapabilityStatus, setModelCapabilityStatus] = useState<AgentModelCapabilityStatus | null>(null);
  const [modelCapabilityStatusError, setModelCapabilityStatusError] = useState<string | null>(null);
  const [modelCapabilityStatusBusy, setModelCapabilityStatusBusy] = useState(false);
  const refreshModelCapabilityStatus = useCallback(async () => {
    setModelCapabilityStatusBusy(true);
    setModelCapabilityStatusError(null);
    try {
      setModelCapabilityStatus(await desktopApi.getMyDrSaiAgentModelCapabilityStatus(openDrSaiConfigurationAgent?.id));
    } catch (error) {
      const friendly = describeUserFacingError(error, language);
      setModelCapabilityStatusError(`${friendly.title} ${friendly.action}`);
    } finally {
      setModelCapabilityStatusBusy(false);
    }
  }, [language, openDrSaiConfigurationAgent?.id]);
  useEffect(() => {
    if (activePane === "agent-defaults" && activeAgentConfigurationTab === "opendrsai") void refreshModelCapabilityStatus();
  }, [activeAgentConfigurationTab, activePane, refreshModelCapabilityStatus]);
  const effectiveModelProviderPresets = useMemo(() => {
    const byId = new Map(BUILTIN_MODEL_PROVIDER_PRESETS.map((preset) => [preset.id, preset]));
    for (const preset of modelProviderPresets) {
      const fallback = byId.get(preset.id);
      byId.set(preset.id, fallback ? { ...fallback, ...preset, label: fallback.label } : preset);
    }
    return [...byId.values()];
  }, [modelProviderPresets]);
  const [cleanupPreview, setCleanupPreview] = useState<DesktopDataCleanupPreview | null>(null);
  const [cleanupConfirmation, setCleanupConfirmation] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [archiveSearch, setArchiveSearch] = useState("");
  const archivedThreads = threads.filter((thread) => thread.archived).filter((thread) =>
    thread.title.toLocaleLowerCase().includes(archiveSearch.trim().toLocaleLowerCase()),
  );

  const modelConnectionRevision = myDrSaiConfig?.modelConnection?.revision;
  const configuredModelProvider = myDrSaiConfig?.modelConnection?.model_provider;
  useEffect(() => {
    const connection = myDrSaiConfig?.modelConnection;
    if (!connection) return;
    const providerTabAfterSave = providerTabAfterProviderSaveRef.current;
    if (providerTabAfterSave) {
      providerTabAfterProviderSaveRef.current = null;
      setActiveModelProviderTab(providerTabAfterSave);
      if (!["hepai", "deepseek", "openai", "anthropic"].includes(providerTabAfterSave)) setRecentOverflowModelProviderTab(providerTabAfterSave);
      return;
    }
    setActiveModelProviderTab(connection.model_provider);
    if (!["hepai", "deepseek", "openai", "anthropic"].includes(connection.model_provider)) setRecentOverflowModelProviderTab(connection.model_provider);
    setModelDraft(connection.model);
    setProviderDraft(connection.model_provider);
    setBaseUrlDraft(connection.provider.base_url);
    setAnthropicBaseUrlDraft(connection.provider.anthropic_base_url ?? "");
    setGeminiBaseUrlDraft(connection.provider.google_base_url ?? "");
    setAddedProviderProtocols(new Set());
    setApiKeyDraft("");
    setApiKeyEnvDraft(connection.provider.api_key_source?.startsWith("env:") ? connection.provider.api_key_source.slice(4) : "");
    setWireApiDraft(connection.provider.wire_api);
    setKeySourceDraft(connection.provider.requires_api_key ? (connection.provider.api_key_source?.startsWith("env:") ? "env" : "secure") : "none");
    const configuredModels = connection.provider.models?.length ? connection.provider.models : [connection.model];
    setProviderModelsDraft(configuredModels);
    setProviderModelAliasesDraft(connection.provider.model_aliases ?? {});
    setProviderModelOperationsDraft(connection.provider.model_operations ?? {});
    setProviderModelConfigsDraft(providerModelConfigsFor(configuredModels, connection.provider));
  // Probe refreshes replace the connection object without changing its
  // configuration revision. Keep unsaved Provider drafts in that case.
  }, [modelConnectionRevision, configuredModelProvider]);

  useEffect(() => {
    void desktopApi.listMyDrSaiModelProviderPresets().then(setModelProviderPresets).catch(() => setModelProviderPresets([]));
  }, []);

  useEffect(() => {
    if (activePane !== "model-providers") return;
    const connection = myDrSaiConfig?.modelConnection;
    if (!connection) return;
    const provider = (connection.providers ?? []).find((item) => item.name === activeModelProviderTab)
      ?? (connection.provider.name === activeModelProviderTab ? connection.provider : undefined);
    if (!provider) return;
    const configuredModels = provider.models?.length
      ? provider.models
      : connection.model_provider === provider.name ? [connection.model] : [];
    setProviderDraft(provider.name);
    setBaseUrlDraft(provider.base_url);
    setAnthropicBaseUrlDraft(provider.anthropic_base_url ?? "");
    setGeminiBaseUrlDraft(provider.google_base_url ?? "");
    setAddedProviderProtocols(new Set());
    setWireApiDraft(provider.wire_api);
    setKeySourceDraft(provider.requires_api_key ? (provider.api_key_source?.startsWith("env:") ? "env" : "secure") : "none");
    setApiKeyDraft("");
    setApiKeyEnvDraft(provider.api_key_source?.startsWith("env:") ? provider.api_key_source.slice(4) : "");
    setProviderModelsDraft(configuredModels);
    setProviderModelAliasesDraft(provider.model_aliases ?? {});
    setProviderModelOperationsDraft(provider.model_operations ?? {});
    setProviderModelConfigsDraft(providerModelConfigsFor(configuredModels, provider));
    setModelDraft((current) => configuredModels.includes(current) ? current : configuredModels[0] ?? "");
    setNewProviderModelDraft(null);
  }, [activePane, activeModelProviderTab, modelConnectionRevision]);

  function applyModelProviderPreset(presetId: string): void {
    const preset = effectiveModelProviderPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setModelDraft(preset.default_model || "");
    setProviderModelsDraft(preset.default_model ? [preset.default_model] : []);
    setProviderModelAliasesDraft({});
    setProviderModelOperationsDraft({});
    setProviderModelConfigsDraft(preset.default_model ? { [preset.default_model]: { input_modalities: ["text"], output_modalities: ["text"], api_protocol: preset.wire_api, enabled: true, capabilities: defaultTextModelCapabilities(preset.default_model) } } : {});
    setProviderDraft(preset.id.startsWith("custom-") ? "custom" : preset.id);
    setBaseUrlDraft(preset.base_url);
    setAnthropicBaseUrlDraft(preset.anthropic_base_url ?? "");
    setGeminiBaseUrlDraft(preset.google_base_url ?? "");
    setAddedProviderProtocols(new Set());
    setWireApiDraft(preset.wire_api);
    setKeySourceDraft(preset.requires_api_key ? "secure" : "none");
    setApiKeyDraft("");
    setApiKeyEnvDraft("");
    setDiscoveredModels([]);
  }

  function selectModelProviderTab(presetId: string): void {
    setActiveModelProviderTab(presetId);
    setNewProviderModelDraft(null);
    if (!["hepai", "deepseek", "openai", "anthropic"].includes(presetId)) setRecentOverflowModelProviderTab(presetId);
    setModelConfigMessage(null);
    setModelTestOutput(null);
    setModelConfigConflict(false);
    setDiscoveredModels([]);
    const connection = myDrSaiConfig?.modelConnection;
    const preset = effectiveModelProviderPresets.find((item) => item.id === presetId);
    if (connection?.model_provider === presetId) {
      setModelDraft(connection.model);
      setProviderDraft(connection.model_provider);
      setBaseUrlDraft(connection.provider.base_url);
      setAnthropicBaseUrlDraft(connection.provider.anthropic_base_url ?? "");
      setGeminiBaseUrlDraft(connection.provider.google_base_url ?? "");
      setAddedProviderProtocols(new Set());
      setWireApiDraft(connection.provider.wire_api);
      setKeySourceDraft(connection.provider.requires_api_key ? (connection.provider.api_key_source?.startsWith("env:") ? "env" : "secure") : "none");
      setApiKeyDraft("");
      setApiKeyEnvDraft(connection.provider.api_key_source?.startsWith("env:") ? connection.provider.api_key_source.slice(4) : "");
      const configuredModels = connection.provider.models?.length ? connection.provider.models : [connection.model];
      setProviderModelsDraft(configuredModels);
      setProviderModelAliasesDraft(connection.provider.model_aliases ?? {});
      setProviderModelOperationsDraft(connection.provider.model_operations ?? {});
      setProviderModelConfigsDraft(providerModelConfigsFor(configuredModels, connection.provider));
      return;
    }
    const configuredProvider = connection?.providers?.find((provider) => provider.name === presetId);
    if (configuredProvider) {
      const configuredModels = configuredProvider.models?.length ? configuredProvider.models : preset?.default_model ? [preset.default_model] : [];
      setModelDraft(configuredModels[0] ?? "");
      setProviderDraft(configuredProvider.name);
      setBaseUrlDraft(configuredProvider.base_url);
      setAnthropicBaseUrlDraft(configuredProvider.anthropic_base_url ?? "");
      setGeminiBaseUrlDraft(configuredProvider.google_base_url ?? "");
      setAddedProviderProtocols(new Set());
      setWireApiDraft(configuredProvider.wire_api);
      setKeySourceDraft(configuredProvider.requires_api_key ? (configuredProvider.api_key_source?.startsWith("env:") ? "env" : "secure") : "none");
      setApiKeyDraft("");
      setApiKeyEnvDraft(configuredProvider.api_key_source?.startsWith("env:") ? configuredProvider.api_key_source.slice(4) : "");
      setProviderModelsDraft(configuredModels);
      setProviderModelAliasesDraft(configuredProvider.model_aliases ?? {});
      setProviderModelOperationsDraft(configuredProvider.model_operations ?? {});
      setProviderModelConfigsDraft(providerModelConfigsFor(configuredModels, configuredProvider));
      return;
    }
    applyModelProviderPreset(presetId);
  }

  function addCustomModelProvider(): void {
    setActiveModelProviderTab("custom");
    setRecentOverflowModelProviderTab("custom");
    setProviderDraft("custom");
    setModelDraft("");
    setBaseUrlDraft("");
    setAnthropicBaseUrlDraft("");
    setGeminiBaseUrlDraft("");
    setAddedProviderProtocols(new Set());
    setWireApiDraft("openai");
    setKeySourceDraft("secure");
    setApiKeyDraft("");
    setApiKeyEnvDraft("");
    setDiscoveredModels([]);
    setProviderModelsDraft([]);
    setProviderModelAliasesDraft({});
    setProviderModelOperationsDraft({});
    setProviderModelConfigsDraft({});
    setNewProviderModelDraft(null);
    setModelConfigMessage(null);
  }

  function addProviderModel(): void {
    setNewProviderModelDraft("");
    setModelConfigMessage(null);
  }

  function commitProviderModel(): void {
    const value = newProviderModelDraft?.trim() ?? "";
    if (!value || value.length > 256 || /[\r\n\0]/.test(value)) {
      setModelConfigMessage(zh ? "请输入有效的模型 ID。" : "Enter a valid model ID.");
      return;
    }
    const existing = providerModelsDraft.find((model) => model.toLowerCase() === value.toLowerCase());
    if (existing) {
      setModelDraft(existing);
      setNewProviderModelDraft(null);
      setModelConfigMessage(zh ? `模型“${existing}”已在列表中。` : `Model “${existing}” is already in the list.`);
      return;
    }
    setProviderModelsDraft((current) => [...current, value]);
    setProviderModelConfigsDraft((current) => ({ ...current, [value]: { input_modalities: ["text"], output_modalities: ["text"], api_protocol: wireApiDraft, enabled: true, capabilities: defaultTextModelCapabilities(value) } }));
    setModelDraft(value);
    setNewProviderModelDraft(null);
    setModelConfigMessage(null);
  }

  function removeProviderModel(model: string): void {
    setProviderModelsDraft((current) => {
      const next = current.filter((item) => item !== model);
      if (modelDraft === model) setModelDraft(next[0] ?? "");
      return next;
    });
    setProviderModelAliasesDraft((current) => {
      const next = { ...current };
      delete next[model];
      return next;
    });
    setProviderModelOperationsDraft((current) => {
      const next = { ...current };
      delete next[model];
      return next;
    });
    setProviderModelConfigsDraft((current) => {
      const next = { ...current };
      delete next[model];
      return next;
    });
  }

  function openProviderModelEditor(model: string): void {
    const config = providerModelConfigsDraft[model] ?? providerModelConfigFor(model, { wire_api: wireApiDraft, model_aliases: providerModelAliasesDraft, model_operations: providerModelOperationsDraft });
    setProviderModelEditor({
      originalId: model,
      modelId: model,
      alias: config.alias ?? "",
      inputModalities: [...config.input_modalities],
      outputModalities: [...config.output_modalities],
      apiProtocol: config.api_protocol,
      enabled: config.enabled,
      capabilities: [...config.capabilities],
    });
    setProviderModelEditorError(null);
  }

  function duplicateProviderModel(model: string): void {
    const base = `${model}-copy`;
    let copyId = base;
    let suffix = 2;
    while (providerModelsDraft.some((candidate) => candidate.toLowerCase() === copyId.toLowerCase())) copyId = `${base}-${suffix++}`;
    const sourceIndex = providerModelsDraft.indexOf(model);
    const nextModels = [...providerModelsDraft];
    nextModels.splice(sourceIndex + 1, 0, copyId);
    setProviderModelsDraft(nextModels);
    const config = providerModelConfigsDraft[model] ?? providerModelConfigFor(model, { wire_api: wireApiDraft, model_aliases: providerModelAliasesDraft, model_operations: providerModelOperationsDraft });
    const alias = config.alias ?? "";
    if (alias) setProviderModelAliasesDraft((current) => ({ ...current, [copyId]: alias }));
    const operations = [...(providerModelOperationsDraft[model] ?? [])];
    if (operations.length) setProviderModelOperationsDraft((current) => ({ ...current, [copyId]: operations }));
    const copiedConfig = { ...config, input_modalities: [...config.input_modalities], output_modalities: [...config.output_modalities], capabilities: [...config.capabilities] };
    setProviderModelConfigsDraft((current) => ({ ...current, [copyId]: copiedConfig }));
    setProviderModelEditor({ originalId: copyId, modelId: copyId, alias, inputModalities: [...copiedConfig.input_modalities], outputModalities: [...copiedConfig.output_modalities], apiProtocol: copiedConfig.api_protocol, enabled: copiedConfig.enabled, capabilities: [...copiedConfig.capabilities] });
    setProviderModelEditorError(null);
  }

  function saveProviderModelEditor(): void {
    if (!providerModelEditor) return;
    const nextId = providerModelEditor.modelId.trim();
    if (!nextId || nextId.length > 256 || /[\r\n\0]/.test(nextId)) {
      setProviderModelEditorError(zh ? "请输入有效的模型 ID。" : "Enter a valid model ID.");
      return;
    }
    if (providerModelEditor.inputModalities.length === 0 || providerModelEditor.outputModalities.length === 0) {
      setProviderModelEditorError(zh ? "至少选择一种模态。" : "Select at least one modality.");
      return;
    }
    const protocolHasHost = providerModelEditor.apiProtocol === wireApiDraft
      || (providerModelEditor.apiProtocol === "anthropic" && Boolean(anthropicBaseUrlDraft.trim()))
      || (providerModelEditor.apiProtocol === "gemini" && Boolean(geminiBaseUrlDraft.trim()));
    if (!protocolHasHost) {
      setProviderModelEditorError(zh ? "请先在“主机与协议”中添加该 API 协议的主机。" : "Add a host for this API protocol under Hosts and protocols first.");
      return;
    }
    const duplicate = providerModelsDraft.find((model) => model !== providerModelEditor.originalId && model.toLowerCase() === nextId.toLowerCase());
    if (duplicate) {
      setProviderModelEditorError(zh ? `模型“${duplicate}”已在列表中。` : `Model “${duplicate}” is already in the list.`);
      return;
    }
    setProviderModelsDraft((current) => current.map((model) => model === providerModelEditor.originalId ? nextId : model));
    setProviderModelAliasesDraft((current) => {
      const next = { ...current };
      delete next[providerModelEditor.originalId];
      const alias = providerModelEditor.alias.trim();
      if (alias && alias !== nextId) next[nextId] = alias;
      return next;
    });
    setProviderModelOperationsDraft((current) => {
      const next = { ...current };
      delete next[providerModelEditor.originalId];
      const operations: RuntimeModelOperation[] = [];
      if (providerModelEditor.capabilities.includes("image_generation")) operations.push("image_generation");
      if (providerModelEditor.capabilities.includes("image_edit")) operations.push("image_edit");
      if (operations.length) next[nextId] = operations;
      return next;
    });
    setProviderModelConfigsDraft((current) => {
      const next = { ...current };
      delete next[providerModelEditor.originalId];
      next[nextId] = {
        ...(providerModelEditor.alias.trim() ? { alias: providerModelEditor.alias.trim() } : {}),
        input_modalities: providerModelEditor.inputModalities,
        output_modalities: providerModelEditor.outputModalities,
        api_protocol: providerModelEditor.apiProtocol,
        enabled: providerModelEditor.enabled,
        capabilities: providerModelEditor.capabilities,
      };
      return next;
    });
    if (modelDraft === providerModelEditor.originalId) setModelDraft(nextId);
    if (!providerModelEditor.enabled && modelDraft === providerModelEditor.originalId) {
      const fallback = providerModelsDraft.find((model) => model !== providerModelEditor.originalId && (providerModelConfigsDraft[model]?.enabled ?? true));
      setModelDraft(fallback ?? "");
    }
    setProviderModelEditor(null);
    setProviderModelEditorError(null);
  }

  function toggleProviderModelEditorModality(direction: "input" | "output", modality: MyDrSaiModelModality, enabled: boolean): void {
    setProviderModelEditor((current) => {
      if (!current) return current;
      const key = direction === "input" ? "inputModalities" : "outputModalities";
      const nextModalities = enabled ? [...new Set([...current[key], modality])] : current[key].filter((item) => item !== modality);
      const input = direction === "input" ? nextModalities : current.inputModalities;
      const output = direction === "output" ? nextModalities : current.outputModalities;
      const capabilities = current.capabilities.filter((capability) => {
        if (capability === "image_generation") return output.includes("image");
        if (capability === "image_edit") return input.includes("image") && output.includes("image");
        if (capability === "speech_to_text") return input.includes("audio") && output.includes("text");
        if (capability === "text_to_speech") return input.includes("text") && output.includes("audio");
        if (capability === "video_generation") return output.includes("video");
        return true;
      });
      return { ...current, [key]: nextModalities, capabilities };
    });
  }

  function toggleProviderModelEditorCapability(capability: MyDrSaiModelCapability, enabled: boolean): void {
    setProviderModelEditor((current) => {
      if (!current) return current;
      const capabilities = enabled ? [...new Set([...current.capabilities, capability, ...(["tool_calling", "reasoning"].includes(capability) ? ["chat" as const] : [])])] : current.capabilities.filter((item) => item !== capability);
      const requiredInput: MyDrSaiModelModality[] = capability === "image_edit" ? ["image"] : capability === "speech_to_text" ? ["audio"] : capability === "text_to_speech" || ["chat", "tool_calling", "reasoning", "image_generation", "video_generation"].includes(capability) ? ["text"] : [];
      const requiredOutput: MyDrSaiModelModality[] = ["image_generation", "image_edit"].includes(capability) ? ["image"] : capability === "speech_to_text" || ["chat", "tool_calling", "reasoning"].includes(capability) ? ["text"] : capability === "text_to_speech" ? ["audio"] : capability === "video_generation" ? ["video"] : [];
      return { ...current, capabilities, inputModalities: enabled ? [...new Set([...current.inputModalities, ...requiredInput])] : current.inputModalities, outputModalities: enabled ? [...new Set([...current.outputModalities, ...requiredOutput])] : current.outputModalities };
    });
  }

  function resetProviderModels(): void {
    const preset = effectiveModelProviderPresets.find((item) => item.id === activeModelProviderTab);
    const next = preset?.default_model ? [preset.default_model] : [];
    setProviderModelsDraft(next);
    setProviderModelAliasesDraft({});
    setProviderModelOperationsDraft({});
    setProviderModelConfigsDraft(next[0] ? { [next[0]]: { input_modalities: ["text"], output_modalities: ["text"], api_protocol: preset?.wire_api ?? "openai", enabled: true, capabilities: defaultTextModelCapabilities(next[0]) } } : {});
    setModelDraft(next[0] ?? "");
    setDiscoveredModels([]);
    setNewProviderModelDraft(null);
  }

  async function discoverModels(): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null);
    try {
      const usesHepAiAccount = providerDraft.trim() === "hepai";
      const result = await desktopApi.discoverMyDrSaiProviderModels(providerDraft.trim(), true, {
        base_url: baseUrlDraft.trim(),
        ...(anthropicBaseUrlDraft.trim() ? { anthropic_base_url: anthropicBaseUrlDraft.trim() } : {}),
        ...(geminiBaseUrlDraft.trim() ? { google_base_url: geminiBaseUrlDraft.trim() } : {}),
        ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}),
        wire_api: wireApiDraft,
        requires_api_key: !usesHepAiAccount && keySourceDraft !== "none",
      });
      setDiscoveredModels(result.models);
      if (result.ok && result.models.length) {
        setProviderModelsDraft(result.models);
        setProviderModelAliasesDraft((current) => Object.fromEntries(Object.entries(current).filter(([model]) => result.models.includes(model))));
        setProviderModelOperationsDraft((current) => Object.fromEntries(Object.entries(current).filter(([model]) => result.models.includes(model))));
        setProviderModelConfigsDraft((current) => Object.fromEntries(result.models.map((model) => [model, current[model] ?? { input_modalities: ["text"], output_modalities: ["text"], api_protocol: wireApiDraft, enabled: true, capabilities: defaultTextModelCapabilities(model) }])));
        setNewProviderModelDraft(null);
        if (!result.models.includes(modelDraft.trim())) setModelDraft(result.models[0]);
      }
      setModelConfigMessage(result.ok ? `${result.models.length} ${zh ? "个模型可用" : "models discovered"}` : `${zh ? "模型发现失败，可继续手工输入" : "Discovery failed; manual model entry remains available"}: ${result.error || "unknown"}`);
    } catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  function modelAliasesForSave(): Record<string, string> {
    return Object.fromEntries(providerModelsDraft.flatMap((model) => {
      const alias = providerModelAliasesDraft[model]?.trim();
      return alias && alias !== model ? [[model, alias]] : [];
    }));
  }

  function modelConfigsForSave(): Record<string, MyDrSaiProviderModelConfig> {
    return Object.fromEntries(providerModelsDraft.map((model) => {
      const inferredModalities = providerModelModalities(model, providerDraft, models, providerModelOperationsDraft[model] ?? []);
      const configured = providerModelConfigsDraft[model] ?? {
        ...(providerModelAliasesDraft[model]?.trim() ? { alias: providerModelAliasesDraft[model].trim() } : {}),
        input_modalities: inferredModalities.input,
        output_modalities: inferredModalities.output,
        api_protocol: wireApiDraft,
        enabled: true,
        capabilities: [...new Set([...defaultTextModelCapabilities(model), ...(providerModelOperationsDraft[model] ?? [])])],
      };
      return [model, {
        ...configured,
        api_protocol: (configured.api_protocol as string) === "google" ? "gemini" : configured.api_protocol,
      }];
    }));
  }

  async function runModelDoctor(online = false): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null);
    try {
      const result = await desktopApi.diagnoseMyDrSaiModelConnection(online);
      setModelDoctorResult(result);
      setModelConfigMessage(result.ok
        ? (zh ? "模型配置检查完成，未发现阻断问题。" : "Model Doctor completed without blocking issues.")
        : (zh ? "模型配置需要处理，请查看检查结果。" : "Model configuration needs attention; review the checks below."));
    } catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  async function restoreLastKnownGoodModelConnection(): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null); setModelConfigConflict(false);
    try {
      const connection = await desktopApi.restoreMyDrSaiModelConnection(myDrSaiConfig?.modelConnection?.revision);
      onModelConnectionUpdated(connection);
      setModelDoctorResult(null);
      setModelConfigMessage(zh ? "已恢复最后一次可用的模型配置。" : "Restored the last-known-good model configuration.");
    } catch (error) {
      const message = userFacingFailureMessage(error, language, "connection");
      setModelConfigConflict(normalizeRuntimeErrorEnvelope(error).code === "config_conflict");
      setModelConfigMessage(message);
    } finally { setModelConfigBusy(false); }
  }

  async function saveModelProvider(): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null); setModelConfigConflict(false);
    try {
      const provider = providerDraft.trim();
      const usesHepAiAccount = provider === "hepai";
      const connection = await desktopApi.saveMyDrSaiModelProvider(provider, {
        base_url: baseUrlDraft.trim(),
        ...(anthropicBaseUrlDraft.trim() ? { anthropic_base_url: anthropicBaseUrlDraft.trim() } : {}),
        ...(geminiBaseUrlDraft.trim() ? { google_base_url: geminiBaseUrlDraft.trim() } : {}),
        ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}),
        wire_api: wireApiDraft,
        requires_api_key: !usesHepAiAccount && keySourceDraft !== "none",
        models: modelConfigsForSave(),
        ...(myDrSaiConfig?.modelConnection?.revision ? { expected_revision: myDrSaiConfig.modelConnection.revision } : {}),
      });
      providerTabAfterProviderSaveRef.current = provider;
      onModelConnectionUpdated(connection);
      setActiveModelProviderTab(provider);
      if (!["hepai", "deepseek", "openai", "anthropic"].includes(provider)) setRecentOverflowModelProviderTab(provider);
      setApiKeyDraft("");
      setModelConfigMessage(apiKeyDraft.trim() || connection.providers?.some((item) => item.name === provider && item.has_api_key)
        ? (zh ? "模型提供方和 API 密钥已安全保存。" : "Model provider and API key saved securely.")
        : (zh ? "模型提供方已保存。" : "Model provider saved."));
    } catch (error) {
      const message = userFacingFailureMessage(error, language, "connection");
      setModelConfigConflict(normalizeRuntimeErrorEnvelope(error).code === "config_conflict");
      setModelConfigMessage(message);
    } finally { setModelConfigBusy(false); }
  }

  async function reloadModelConnectionAfterConflict(): Promise<void> {
    setModelConfigBusy(true);
    try {
      const refreshed = await desktopApi.getMyDrSaiConfig();
      if (refreshed.modelConnection) {
        onModelConnectionUpdated(refreshed.modelConnection);
        setModelConfigConflict(false);
        setModelConfigMessage(zh ? "已重新加载最新模型服务配置，请检查后再次保存。" : "Latest model service configuration reloaded. Review it before saving again.");
      }
    } catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  async function testModelConnection(mode: "basic" | "model"): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null); setModelTestOutput(null);
    try {
      const usesHepAiAccount = providerDraft.trim() === "hepai";
      const selectedProtocol = providerModelConfigsDraft[modelDraft.trim()]?.api_protocol ?? wireApiDraft;
      const selectedBaseUrl = selectedProtocol === wireApiDraft ? baseUrlDraft.trim() : selectedProtocol === "anthropic" ? anthropicBaseUrlDraft.trim() : selectedProtocol === "gemini" ? geminiBaseUrlDraft.trim() : "";
      const testingSavedModel = mode === "model" && !modelProviderDirty;
      const result = testingSavedModel
        ? await desktopApi.testMyDrSaiModelProvider(providerDraft.trim(), modelDraft.trim())
        : await desktopApi.testMyDrSaiModelDraft({ model: modelDraft.trim(), model_provider: providerDraft.trim(), ...(selectedBaseUrl ? { base_url: selectedBaseUrl } : {}), ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}), wire_api: selectedProtocol, requires_api_key: !usesHepAiAccount && keySourceDraft !== "none" }, mode);
      const refreshed = await desktopApi.getMyDrSaiConfig();
      if (refreshed.modelConnection) onModelConnectionUpdated(refreshed.modelConnection);
      const localizedGuidance = result.guidance?.localizations?.[zh ? "zh" : "en"];
      if (mode === "model" && result.output) setModelTestOutput(result.output);
      setModelConfigMessage(result.ok
        ? mode === "model"
          ? testingSavedModel
            ? (zh ? "模型调用成功，当前运行配置已验证。" : "Model call succeeded and the active configuration is verified.")
            : (zh ? "草稿模型调用成功；保存后才会更新当前运行状态。" : "Draft model call succeeded; save it before the active status changes.")
          : (zh ? "连接成功。" : "Connection succeeded.")
        : `${localizedGuidance?.title || result.guidance?.title || (zh ? "连接测试失败" : "Connection test failed")}: ${localizedGuidance?.actions?.join(" / ") || result.guidance?.actions?.join(" / ") || result.error || "unknown"}`);
      if (mode === "model") setModelTestConfirmationOpen(false);
    }
    catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  async function requestModelProviderDeletion(): Promise<void> {
    const provider = providerDraft.trim();
    if (!provider || provider === "hepai") return;
    setModelConfigBusy(true); setModelConfigMessage(null);
    try {
      const preflight = await desktopApi.preflightMyDrSaiModelProviderDeletion(provider);
      setProviderDeletePreflight(preflight);
      setProviderPendingDeletion(provider);
    } catch (error) {
      setModelConfigMessage(userFacingFailureMessage(error, language, "connection"));
    } finally { setModelConfigBusy(false); }
  }

  async function deleteModelProvider(deleteCredential: boolean): Promise<void> {
    const provider = providerPendingDeletion;
    if (!provider || provider === "hepai") return;
    if (!providerDeletePreflight?.can_delete) return;
    setModelConfigBusy(true); setModelConfigMessage(null);
    try {
      const result = await desktopApi.deleteMyDrSaiModelProvider(provider, deleteCredential);
      const next = await desktopApi.getMyDrSaiConfig();
      if (next.modelConnection) onModelConnectionUpdated(next.modelConnection);
      if (recentOverflowModelProviderTab === provider) setRecentOverflowModelProviderTab(null);
      setProviderPendingDeletion(null);
      setProviderDeletePreflight(null);
      const active = result.active || next.modelConnection?.model_provider;
      const activeMessage = active === "hepai"
        ? (zh ? "当前连接已切换为 HepAI。" : "HepAI is now active.")
        : (zh ? `当前连接仍为 ${active || "原 Provider"}。` : `The active connection remains ${active || "the previous Provider"}.`);
      setModelConfigMessage(deleteCredential
        ? (zh ? `Provider“${provider}”及其安全凭据已删除。${activeMessage}` : `Provider “${provider}” and its secure credential were deleted. ${activeMessage}`)
        : (zh ? `Provider“${provider}”已删除，安全凭据已保留。${activeMessage}` : `Provider “${provider}” was deleted and its secure credential was retained. ${activeMessage}`));
    }
    catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  async function openDataCleanup(scope: DesktopDataCleanupScope): Promise<void> {
    setCleanupBusy(true);
    setCleanupStatus(null);
    try {
      setCleanupPreview(await desktopApi.previewLocalDataCleanup(scope));
      setCleanupConfirmation("");
    } catch (error) {
      setCleanupStatus(userFacingFailureMessage(error, language, "operation"));
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
        for (const key of [LAST_THREAD_STORAGE_KEY, AWAY_STARTED_AT_STORAGE_KEY]) window.localStorage.removeItem(key);
      } else {
        window.localStorage.clear();
        window.sessionStorage.clear();
      }
      setCleanupPreview(null);
      setCleanupStatus(zh ? result.message : scope === "sessions" ? "Session data cleared; workspace files and results were preserved." : "OpenDrSai app data cleared; workspace files and results were preserved.");
      if (scope === "all_local_data") window.setTimeout(() => void onLogout(), 600);
      else window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setCleanupStatus(userFacingFailureMessage(error, language, "operation"));
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
      setAgentConfigMessage(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setAgentConfigSaving(false);
    }
  }

  async function revokeMobileEnrollment(): Promise<void> {
    const confirmed = await requestAppDecision({ id: "revoke-mobile-enrollment", tone: "danger", title: zh ? "关闭所有移动设备访问？" : "Disable all mobile access?", description: zh ? "这会断开所有 Android 设备，并禁止它们继续连接此电脑。" : "This disconnects every Android device and prevents further connections to this computer.", impact: zh ? "需要重新启用和配对后才能恢复。" : "Access requires enabling and pairing again.", confirmLabel: zh ? "关闭访问" : "Disable access" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      await desktopApi.revokeMobileRuntimeEnrollment();
      setMobilePairingReadiness({ state: "not_registered", action: "register_runtime" });
      setMobileAssociations([]);
      setMobileAssociationsState("runtime-offline");
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function pauseMobileRemoteAccess(): Promise<void> {
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      await desktopApi.pauseMobileRemoteAccess();
      setMobilePairingReadiness((current) => ({
        state: "paused",
        action: "resume",
        runtime_id: current?.runtime_id,
        gateway_runtime_id: current?.gateway_runtime_id,
        environment: current?.environment,
      }));
      setMobileAssociationsState("ready");
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function enableMobileRemoteAccess(): Promise<void> {
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const before = await desktopApi.getMobilePairingReadiness().catch(() => null);
      if (before?.state === "paused") await desktopApi.resumeMobileRemoteAccess();
      const readiness = before?.state === "paused"
        ? await desktopApi.getMobilePairingReadiness()
        : await desktopApi.enableMobileRemoteAccess();
      setMobilePairingReadiness(readiness);
      setMobileAssociationsState(readiness.state === "ready" ? "ready" : "runtime-offline");
      if (readiness.state === "ready") {
        await refreshAndroidDevices();
      }
    } catch (reason) {
      setMobileAssociationsState("runtime-offline");
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function refreshAndroidDevices(): Promise<void> {
    setMobileAssociationsState("loading");
    setMobileEnrollmentError(null);
    let readiness: DesktopMobilePairingReadiness | null = null;
    try {
      readiness = await desktopApi.getMobilePairingReadiness();
      setMobilePairingReadiness(readiness);
      if (readiness.state !== "ready" && readiness.state !== "paused") {
        setMobileAssociations([]);
        setMobileAssociationsState(readiness.state === "offline" ? "platform-offline" : "runtime-offline");
        return;
      }
      const rows = await desktopApi.listMobileAssociations();
      setMobileAssociations(rows.filter((item) => item.status === "active"));
      setMobileAssociationsState("ready");
    } catch (reason) {
      setMobileAssociations([]);
      const state = classifyAndroidDeviceError(reason, readiness);
      setMobileAssociationsState(state);
      setMobileEnrollmentError(state === "management-unavailable" ? null : mobilePairingErrorText(reason, language));
    }
  }

  async function revokeAndroidDevice(association: DesktopMobileAssociation): Promise<void> {
    const confirmed = await requestAppDecision({ id: "revoke-mobile-device", tone: "danger", title: zh ? "撤销设备访问？" : "Revoke device access?", description: zh ? `设备：${association.device_name}` : `Device: ${association.device_name}`, impact: zh ? "该设备会立即断开，重新访问需要再次配对。" : "The device will disconnect immediately and must pair again to return.", confirmLabel: zh ? "撤销访问" : "Revoke access" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      await desktopApi.revokeMobileAssociation(association.association_id);
      setMobileAssociations((items) => items.filter((item) => item.association_id !== association.association_id));
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function makeAndroidDeviceReadOnly(association: DesktopMobileAssociation): Promise<void> {
    const confirmed = await requestAppDecision({ id: "mobile-device-read-only", title: zh ? "将设备改为只读？" : "Change device to read-only?", description: zh ? `设备：${association.device_name}` : `Device: ${association.device_name}`, impact: zh ? "正在打开的实时流会断开，并按只读权限重新验证。" : "Open live streams will close and re-authorize with read-only access.", confirmLabel: zh ? "改为只读" : "Make read-only" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const updated = await desktopApi.shrinkMobileAssociation(
        association.association_id,
        ["read"],
      );
      setMobileAssociations((items) => items.map((item) =>
        item.association_id === updated.association_id ? updated : item));
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function revokeAllAndroidDevices(): Promise<void> {
    const confirmed = await requestAppDecision({ id: "revoke-all-mobile-devices", tone: "danger", title: zh ? "撤销所有设备访问？" : "Revoke every device?", description: zh ? "所有已配对 Android 设备会立即失去访问权限。" : "Every paired Android device will immediately lose access.", impact: zh ? "此电脑仍可配对；每台设备需要重新配对。" : "This computer remains pairable; each device must pair again.", confirmLabel: zh ? "全部撤销" : "Revoke all" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      for (const association of activeAndroidAssociations) {
        await desktopApi.revokeMobileAssociation(association.association_id);
      }
      setMobileAssociations([]);
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
      await refreshAndroidDevices();
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function renameAndroidRuntime(): Promise<void> {
    const proposed = window.prompt(zh ? "输入此电脑的新显示名称" : "Enter a new display name for this computer");
    if (proposed === null) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const result = await desktopApi.renameMobileRuntime(proposed);
      setMobileEnrollmentError(zh ? `此电脑已重命名为 ${result.display_name}` : `This computer is now named ${result.display_name}`);
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function diagnoseAndroidRuntime(): Promise<void> {
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const result = await desktopApi.diagnoseMobileRemoteAccess();
      const labels = zh ? {
        none: "连接正常", start_runtime: "请启动 OpenDrSai Runtime", sign_in: "请重新登录",
        retry_relay: "请稍后重试平台连接", reconnect_runtime: "请重新连接 Runtime", update_runtime: "请更新 OpenDrSai Runtime",
      } : {
        none: "Connection is healthy", start_runtime: "Start OpenDrSai Runtime", sign_in: "Sign in again",
        retry_relay: "Retry the platform connection", reconnect_runtime: "Reconnect Runtime", update_runtime: "Update OpenDrSai Runtime",
      };
      setMobileEnrollmentError(labels[result.action]);
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  useEffect(() => {
    if (activePane !== "remote-workspace") return;
    let cancelled = false;
    const refresh = (): void => {
      void (featureCapabilities?.remoteWorkspace === false
        ? Promise.resolve([])
        : desktopApi.listSshHosts().catch(() => [])
      ).then((hosts) => {
        if (cancelled) return;
        setRemoteHostCount(hosts.length);
        if (featureCapabilities?.remoteWorkspace === true) void refreshAndroidDevices();
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activePane, featureCapabilities]);

  useEffect(() => {
    if (mobilePairingRefreshToken <= 0 || activePane !== "remote-workspace") return;
    void refreshAndroidDevices();
  }, [mobilePairingRefreshToken, activePane]);

  useEffect(() => {
    if (activePane !== "integrations") return;
    if (featureCapabilities?.serialVoice !== true && featureCapabilities?.streamingVoice !== true) return;
    let cancelled = false;
    void desktopApi.getVoiceRuntimeStatus().then((status) => {
      if (!cancelled) setVoiceIntegrationState(status.state);
    }).catch(() => {
      if (!cancelled) setVoiceIntegrationState("unavailable");
    });
    return () => {
      cancelled = true;
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
        { id: "agent-defaults", label: zh ? "智能体配置" : "Agent configuration", icon: Settings },
        { id: "model-providers", label: zh ? "模型提供方" : "Model providers", icon: PackageOpen },
        { id: "agent-task", label: zh ? "智能体任务" : "Agent tasks", icon: Bot },
        { id: "approvals", label: zh ? "审批中心" : "Approval Center", icon: ShieldCheck },
        { id: "analytics", label: zh ? "使用分析" : "Usage analytics", icon: History },
      ],
    },
    {
      label: zh ? "集成" : "Integrations",
      items: [
        { id: "integrations", label: zh ? "集成概览" : "Overview", icon: Plug },
        { id: "remote-workspace", label: zh ? "远程工作区" : "Remote Workspace", icon: TerminalIcon },
        { id: "channels", label: zh ? "频道" : "Channels", icon: MessageSquare },
      ],
    },
    {
      label: zh ? "更多" : "Misc",
      items: [
        { id: "archived-sessions", label: zh ? "已归档会话" : "Archived sessions", icon: Archive },
        { id: "other", label: zh ? "系统与路径" : "System and paths", icon: FileText },
      ],
    },
  ];
  const visibleGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.id === "voice") return featureCapabilities?.serialVoice === true || featureCapabilities?.streamingVoice === true;
      if (item.id === "agent-defaults" || item.id === "model-providers" || item.id === "agent-task") return featureCapabilities?.agents === true;
      if (item.id === "approvals") return featureCapabilities?.approvals === true;
      if (item.id === "analytics") return featureCapabilities?.diagnostics === true;
      if (item.id === "remote-workspace") return featureCapabilities?.remoteWorkspace === true;
      if (item.id === "channels") return featureCapabilities?.channels === true;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
  const visiblePaneIds = visibleGroups.flatMap((group) => group.items.map((item) => item.id));
  useEffect(() => {
    if (visiblePaneIds.includes(activePane)) return;
    setActivePane("general");
  }, [activePane, visiblePaneIds.join("|")]);
  const presetModelProviderTabs = effectiveModelProviderPresets
    .filter((preset) => !preset.id.startsWith("custom-"))
    .sort((left, right) => {
      const leftIndex = MODEL_PROVIDER_TAB_ORDER.indexOf(left.id);
      const rightIndex = MODEL_PROVIDER_TAB_ORDER.indexOf(right.id);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    });
  const presetModelProviderIds = new Set(presetModelProviderTabs.map((preset) => preset.id));
  const customModelProviderTabs = (myDrSaiConfig?.modelConnection?.providers ?? [])
    .filter((provider) => !presetModelProviderIds.has(provider.name))
    .map((provider) => ({ id: provider.name, label: provider.name }));
  const modelProviderTabs: Array<{ id: string; label: string }> = [...presetModelProviderTabs, ...customModelProviderTabs];
  const primaryModelProviderIds = new Set(["hepai", "deepseek", "openai", "anthropic"]);
  const compactModelProviderTabs = modelProviderTabs.map((provider) => ({
    ...provider,
    label: modelProviderDisplayLabel(provider, zh),
  }));
  const recentOverflowModelProviderTabEntry = compactModelProviderTabs.find((provider) => provider.id === recentOverflowModelProviderTab)
    ?? (recentOverflowModelProviderTab ? { id: recentOverflowModelProviderTab, label: recentOverflowModelProviderTab === "custom" ? (zh ? "自定义" : "Custom") : recentOverflowModelProviderTab } : null);
  const activeModelProviderTabEntry = compactModelProviderTabs.find((provider) => provider.id === activeModelProviderTab)
    ?? { id: activeModelProviderTab, label: activeModelProviderTab === "custom" ? (zh ? "自定义" : "Custom") : activeModelProviderTab };
  const visibleModelProviderTabs = compactModelProviderTabs.filter((provider) => primaryModelProviderIds.has(provider.id));
  const recentVisibleEntry = recentOverflowModelProviderTabEntry ?? (!primaryModelProviderIds.has(activeModelProviderTab) ? activeModelProviderTabEntry : null);
  if (recentVisibleEntry && !visibleModelProviderTabs.some((provider) => provider.id === recentVisibleEntry.id)) visibleModelProviderTabs.push(recentVisibleEntry);
  const visibleModelProviderIds = new Set(visibleModelProviderTabs.map((provider) => provider.id));
  const overflowModelProviderTabs = compactModelProviderTabs.filter((provider) => !primaryModelProviderIds.has(provider.id) && !visibleModelProviderIds.has(provider.id));
  const activeModelProviderPreset = effectiveModelProviderPresets.find((preset) => preset.id === activeModelProviderTab);
  const providersWithConfiguredKeys = new Set((myDrSaiConfig?.modelConnection?.providers ?? []).filter((provider) => provider.has_api_key).map((provider) => provider.name));
  if (myDrSaiConfig?.modelConnection?.provider.has_api_key) providersWithConfiguredKeys.add(myDrSaiConfig.modelConnection.provider.name);
  const selectedProviderConfig = (myDrSaiConfig?.modelConnection?.providers ?? []).find((provider) => provider.name === providerDraft)
    ?? (myDrSaiConfig?.modelConnection?.provider.name === providerDraft ? myDrSaiConfig.modelConnection.provider : undefined);
  const selectedProviderConfigured = Boolean(selectedProviderConfig);
  const selectedProviderHasSavedKey = Boolean(selectedProviderConfig?.has_api_key);
  const savedProviderModels = selectedProviderConfig?.models?.length
    ? selectedProviderConfig.models
    : selectedProviderConfig && myDrSaiConfig?.modelConnection?.model_provider === selectedProviderConfig.name
      ? [myDrSaiConfig.modelConnection.model]
      : [];
  const providerModelsChanged = savedProviderModels.length !== providerModelsDraft.length
    || savedProviderModels.some((model, index) => model !== providerModelsDraft[index]);
  const normalizedProviderModelAliases = modelAliasesForSave();
  const savedProviderModelAliases = selectedProviderConfig?.model_aliases ?? {};
  const providerAliasesChanged = Object.keys(savedProviderModelAliases).length !== Object.keys(normalizedProviderModelAliases).length
    || Object.entries(savedProviderModelAliases).some(([model, alias]) => normalizedProviderModelAliases[model] !== alias);
  const savedProviderModelOperations = selectedProviderConfig?.model_operations ?? {};
  const providerOperationsChanged = JSON.stringify(savedProviderModelOperations) !== JSON.stringify(providerModelOperationsDraft);
  const savedProviderModelConfigs = selectedProviderConfig?.model_configs ?? providerModelConfigsFor(savedProviderModels, selectedProviderConfig);
  const providerModelConfigsChanged = JSON.stringify(savedProviderModelConfigs) !== JSON.stringify(modelConfigsForSave());
  const modelProviderDirty = !selectedProviderConfig
    || providerDraft.trim() !== selectedProviderConfig.name
    || baseUrlDraft.trim() !== selectedProviderConfig.base_url
    || anthropicBaseUrlDraft.trim() !== (selectedProviderConfig.anthropic_base_url ?? "")
    || geminiBaseUrlDraft.trim() !== (selectedProviderConfig.google_base_url ?? "")
    || wireApiDraft !== selectedProviderConfig.wire_api
    || Boolean(apiKeyDraft.trim())
    || providerModelsChanged
    || providerAliasesChanged
    || providerOperationsChanged
    || providerModelConfigsChanged;
  const hepAiAccountName = user?.name?.trim() || user?.email?.trim() || (zh ? "当前账号" : "current account");
  const usesOidcProviderAuth = activeModelProviderPreset?.auth_mode === "oidc" || providerDraft === "hepai";
  const providerDiscoveryCredentialReady = usesOidcProviderAuth
    || keySourceDraft === "none"
    || Boolean(apiKeyDraft.trim())
    || selectedProviderHasSavedKey;
  const activeAndroidAssociations = mobileAssociations.filter((item) => item.status === "active");
  const androidOnlineDeviceCount = new Set(
    activeAndroidAssociations
      .filter((item) => item.access_state === "online" || item.access_state === "accessing")
      .map((item) => item.device_summary),
  ).size;
  const androidRemoteEnabled = mobilePairingReadiness?.state === "ready"
    || (mobilePairingReadiness?.state === "offline" && Boolean(mobilePairingReadiness.runtime_id));
  const androidDeviceStateText: Record<DesktopMobileAssociation["access_state"], string> = zh ? {
    accessing: "正在访问",
    online: "在线",
    offline: "离线",
    revoked: "已撤销",
  } : {
    accessing: "Accessing",
    online: "Online",
    offline: "Offline",
    revoked: "Revoked",
  };
  const androidPanelMessage = mobileAssociationsState === "loading"
    ? null
    : mobilePairingReadiness?.state === "paused"
      ? (zh ? "已暂停远程访问；现有授权会保留，恢复后无需重新扫码。" : "Remote access is paused. Existing authorizations are preserved and resume without pairing again.")
    : mobileAssociationsState === "runtime-offline"
      ? (!androidRemoteEnabled
          ? (zh ? "Android 远程连接已关闭。" : "Android remote connection is disabled.")
          : (zh ? "Runtime Host enrollment 暂时不可用。" : "Runtime Host enrollment is temporarily unavailable."))
      : mobileAssociationsState === "platform-offline"
        ? (zh ? "暂时无法连接 HepAI Platform Relay，请稍后重试。" : "HepAI Platform Relay is currently unreachable. Try again later.")
        : mobileAssociationsState === "management-unavailable"
          ? (zh ? "已允许 Android 连接，但当前 Relay 暂不支持查看和管理设备列表。" : "Android connections are allowed, but the current Relay does not support viewing or managing the device list.")
          : mobileAssociationsState === "failed"
            ? (mobileEnrollmentError ?? (zh ? "请求 Android 设备列表失败。" : "Could not load Android devices."))
            : activeAndroidAssociations.length === 0
               ? (zh ? "暂无已授权 Android 设备。" : "No authorized Android devices yet.")
               : null;
  const activeModelProviderStatusSummary = myDrSaiConfig?.modelConnection
    ? [
        modelProviderRuntimeSummary(myDrSaiConfig.modelConnection, zh),
        modelProviderTestSummary(myDrSaiConfig.modelConnection, zh),
      ].filter((item): item is string => Boolean(item)).join(" · ")
    : "";

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
        {(activePane === "general" || activePane === "model-providers") && (
          <>
            <header className="settings-content-header">
              <h2>{activePane === "model-providers" ? (zh ? "模型提供方" : "Model providers") : (zh ? "常规" : "General")}</h2>
              <p>{activePane === "model-providers"
                ? (zh ? "管理智能体可使用的模型来源、连接凭据和服务协议。" : "Manage the model sources, credentials, and service protocols available to Agents.")
                : (zh ? "管理账户和桌面端的基础偏好。" : "Manage your account and desktop preferences.")}</p>
            </header>
            {activePane === "model-providers" && (
              <>
            <div className="model-provider-tabs" aria-label={zh ? "模型提供方" : "Model providers"}>
              <div className="model-provider-tablist" role="tablist">
                {visibleModelProviderTabs.map((provider) => (
                  <button key={provider.id} type="button" role="tab" aria-selected={activeModelProviderTab === provider.id} className={activeModelProviderTab === provider.id ? "active" : ""} onClick={() => selectModelProviderTab(provider.id)}><ModelProviderLogo provider={provider.id} /><span>{provider.label}</span>{providersWithConfiguredKeys.has(provider.id) && <i className="model-provider-configured-dot" title={zh ? "API 密钥已配置" : "API key configured"} aria-label={zh ? "API 密钥已配置" : "API key configured"} />}</button>
                ))}
              </div>
              {overflowModelProviderTabs.length > 0 && <details className="model-provider-overflow">
                <summary>{zh ? "更多" : "More"}<span aria-hidden="true">⌄</span></summary>
                <div className="model-provider-overflow-menu" role="menu">
                  {overflowModelProviderTabs.map((provider) => (
                    <button key={provider.id} type="button" role="menuitemradio" aria-checked={activeModelProviderTab === provider.id} className={activeModelProviderTab === provider.id ? "selected" : ""} onClick={(event) => { selectModelProviderTab(provider.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}><ModelProviderLogo provider={provider.id} /><span>{provider.label}</span>{providersWithConfiguredKeys.has(provider.id) && <i className="model-provider-configured-dot" title={zh ? "API 密钥已配置" : "API key configured"} aria-label={zh ? "API 密钥已配置" : "API key configured"} />}{activeModelProviderTab === provider.id && <b aria-hidden="true">✓</b>}</button>
                  ))}
                </div>
              </details>}
              <button type="button" className="model-provider-add-tab" aria-label={zh ? "添加模型提供方" : "Add model provider"} title={zh ? "添加模型提供方" : "Add model provider"} onClick={addCustomModelProvider}>＋</button>
            </div>
            <section className="settings-section model-provider-settings" data-testid="model-provider-settings">
              <div><h2>{activeModelProviderPreset ? modelProviderDisplayLabel(activeModelProviderPreset, zh) : (zh ? "自定义提供方" : "Custom provider")}<span className={`model-provider-configuration-indicator ${selectedProviderConfigured ? "configured" : "unconfigured"}`} data-testid="model-provider-configuration-indicator">{selectedProviderConfigured ? (zh ? "已配置" : "Configured") : (zh ? "未配置" : "Not configured")}</span>{selectedProviderConfigured && modelProviderDirty && <span className="model-provider-dirty-indicator" data-testid="model-provider-dirty-indicator">{zh ? "有未保存更改" : "Unsaved changes"}</span>}</h2><p>{usesOidcProviderAuth ? (zh ? "HepAI 使用当前已登录账号的 access token 获取模型并调用服务，不使用 API Key。" : "HepAI uses the current signed-in account access token for model discovery and calls; no API key is used.") : (zh ? "预设信息可编辑；保存后写入 ~/.drsai/config.toml。API Key 不会返回到界面。" : "Preset values are editable and saved to ~/.drsai/config.toml. API keys are never returned to the UI.")}</p></div>
              {myDrSaiConfig?.modelConnection?.model_provider === activeModelProviderTab && <div className="model-provider-status-card" data-testid="model-provider-status-card">
                <strong>{myDrSaiConfig.modelConnection.model} · {myDrSaiConfig.modelConnection.model_provider}</strong>
                <span>{zh ? "API 主机：" : "API host: "}{myDrSaiConfig.modelConnection.provider.base_url}</span>
                {activeModelProviderStatusSummary && <span className="model-provider-status-summary">{activeModelProviderStatusSummary}</span>}
              </div>}
              <div className="model-provider-grid">
                <label><span>{zh ? "提供方名称" : "Provider name"}</span><input data-testid="model-provider-name" value={providerDraft} readOnly={usesOidcProviderAuth} onChange={(event) => setProviderDraft(event.target.value)} placeholder="custom" /></label>
                {usesOidcProviderAuth ? <>
                  <div className="model-provider-account-auth model-provider-wide" data-testid="model-provider-account-auth"><span>{zh ? "身份验证" : "Authentication"}</span><strong>{zh ? `已登录账号（${hepAiAccountName}）` : `Signed-in account (${hepAiAccountName})`}</strong><small>{zh ? "获取模型、检查连接和模型调用均使用当前登录会话的 access token。" : "Model discovery, connection checks, and model calls all use the current session access token."}</small></div>
                </> : <>
                  <label><span className="model-provider-field-label"><span>{zh ? "API 密钥" : "API key"}</span>{selectedProviderHasSavedKey && <em data-testid="model-provider-key-configured"><ShieldCheck size={13} />{zh ? "已安全保存" : "Saved securely"}</em>}</span><input data-testid="model-provider-api-key" type="password" disabled={keySourceDraft === "none"} value={apiKeyDraft} onChange={(event) => { setKeySourceDraft("secure"); setApiKeyDraft(event.target.value); }} placeholder={keySourceDraft === "none" ? (zh ? "无需 API Key" : "No API key required") : selectedProviderHasSavedKey ? (zh ? "已配置；留空表示不修改" : "Configured; leave blank to keep") : "sk-..."} /></label>
                </>}
              </div>
              <section className="model-provider-endpoints" data-testid="model-provider-endpoints">
                <div className="model-provider-endpoints-header"><h3>{zh ? "主机与协议" : "Hosts and protocols"}</h3><button type="button" aria-label={zh ? "添加协议主机" : "Add protocol host"} title={zh ? "添加协议主机" : "Add protocol host"} disabled={(wireApiDraft === "anthropic" || Boolean(anthropicBaseUrlDraft) || addedProviderProtocols.has("anthropic")) && (wireApiDraft === "gemini" || Boolean(geminiBaseUrlDraft) || addedProviderProtocols.has("gemini"))} onClick={() => setAddedProviderProtocols((current) => { const next = new Set(current); if (wireApiDraft !== "anthropic" && !anthropicBaseUrlDraft && !next.has("anthropic")) next.add("anthropic"); else if (wireApiDraft !== "gemini" && !geminiBaseUrlDraft && !next.has("gemini")) next.add("gemini"); return next; })}>＋</button></div>
                <div className="model-provider-endpoint-row model-provider-endpoint-default">
                  <label><span>{zh ? "API 协议" : "API protocol"}</span><select value={wireApiDraft} disabled={usesOidcProviderAuth} onChange={(event) => setWireApiDraft(event.target.value as MyDrSaiModelApiProtocol)}><option value="openai">OpenAI API</option><option value="anthropic">Anthropic API</option><option value="gemini">Google API</option></select></label>
                  <label><span>{zh ? "API 主机" : "API host"}</span><input data-testid="model-provider-api-host" value={baseUrlDraft} readOnly={usesOidcProviderAuth} onChange={(event) => setBaseUrlDraft(event.target.value)} placeholder="https://api.example.com/v1" /></label>
                  <span className="model-provider-endpoint-action-spacer" aria-hidden="true" />
                </div>
                {(Boolean(anthropicBaseUrlDraft) || addedProviderProtocols.has("anthropic")) && wireApiDraft !== "anthropic" && <div className="model-provider-endpoint-row">
                  <label><span>{zh ? "API 协议" : "API protocol"}</span><select value="anthropic" onChange={(event) => { if (event.target.value !== "gemini") return; const url = anthropicBaseUrlDraft; setAnthropicBaseUrlDraft(""); setGeminiBaseUrlDraft(url); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("anthropic"); next.add("gemini"); return next; }); }}><option value="anthropic">Anthropic API</option><option value="gemini" disabled={wireApiDraft === "gemini" || Boolean(geminiBaseUrlDraft) || addedProviderProtocols.has("gemini")}>Google API</option></select></label>
                  <label><span>{zh ? "API 主机" : "API host"}</span><input data-testid="model-provider-anthropic-api-host" value={anthropicBaseUrlDraft} onChange={(event) => setAnthropicBaseUrlDraft(event.target.value)} placeholder="https://api.example.com/anthropic" /></label>
                  <button type="button" className="model-provider-endpoint-remove" aria-label={zh ? "移除 Anthropic API 主机" : "Remove Anthropic API host"} onClick={() => { setAnthropicBaseUrlDraft(""); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("anthropic"); return next; }); }}>−</button>
                </div>}
                {(Boolean(geminiBaseUrlDraft) || addedProviderProtocols.has("gemini")) && wireApiDraft !== "gemini" && <div className="model-provider-endpoint-row">
                  <label><span>{zh ? "API 协议" : "API protocol"}</span><select value="gemini" onChange={(event) => { if (event.target.value !== "anthropic") return; const url = geminiBaseUrlDraft; setGeminiBaseUrlDraft(""); setAnthropicBaseUrlDraft(url); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("gemini"); next.add("anthropic"); return next; }); }}><option value="anthropic" disabled={wireApiDraft === "anthropic" || Boolean(anthropicBaseUrlDraft) || addedProviderProtocols.has("anthropic")}>Anthropic API</option><option value="gemini">Google API</option></select></label>
                  <label><span>{zh ? "API 主机" : "API host"}</span><input data-testid="model-provider-gemini-api-host" value={geminiBaseUrlDraft} onChange={(event) => setGeminiBaseUrlDraft(event.target.value)} placeholder="https://api.example.com/google" /></label>
                  <button type="button" className="model-provider-endpoint-remove" aria-label={zh ? "移除 Google API 主机" : "Remove Google API host"} onClick={() => { setGeminiBaseUrlDraft(""); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("gemini"); return next; }); }}>−</button>
                </div>}
              </section>
              <div className="model-provider-models" data-testid="model-provider-models">
                <div className="model-provider-models-header">
                  <div><h3>{zh ? "模型" : "Models"}</h3><small>{zh ? "可为模型设置显示别名；留空时使用原模型名称。" : "Set an optional display alias; an empty alias uses the original model name."}</small></div>
                  <div><button type="button" onClick={addProviderModel}>＋ {zh ? "新建" : "New"}</button><button type="button" onClick={resetProviderModels}>↶ {zh ? "重置" : "Reset"}</button><button type="button" title={!providerDiscoveryCredentialReady ? (zh ? "请先输入并保存 API Key" : "Enter and save an API Key first") : (zh ? "发现模型" : "Discover models")} disabled={modelConfigBusy || !providerDraft.trim() || !baseUrlDraft.trim() || !providerDiscoveryCredentialReady} onClick={() => void discoverModels()}>↻ {zh ? "获取" : "Fetch"}</button></div>
                </div>
                <datalist id="discovered-model-options">{discoveredModels.map((model) => <option key={model} value={model} />)}</datalist>
                <div className="model-provider-model-list">
                  <div className="model-provider-model-table-header" role="row">
                    <span>{zh ? "模型 ID" : "Model ID"}</span>
                    <span>{zh ? "别名" : "Alias"}</span>
                    <span>{zh ? "输入与输出模态" : "Input and output modalities"}</span>
                    <span>{zh ? "API 协议" : "API protocol"}</span>
                    <span>{zh ? "操作" : "Actions"}</span>
                  </div>
                  {providerModelsDraft.length === 0 && newProviderModelDraft === null ? <p>{zh ? "尚未添加模型。可以手工新建，或从提供方获取。" : "No models yet. Add one manually or fetch from the provider."}</p> : providerModelsDraft.map((model) => {
                    const config = providerModelConfigsDraft[model] ?? providerModelConfigFor(model, { wire_api: wireApiDraft, model_aliases: providerModelAliasesDraft, model_operations: providerModelOperationsDraft });
                    return <div className="model-provider-model-row" key={model}>
                      <code className="model-provider-model-id" title={model}>{model}</code>
                      <button type="button" className={`model-provider-model-alias ${config.alias ? "" : "is-placeholder"}`} data-testid={`model-provider-model-alias-${model}`} title={zh ? "点击编辑别名" : "Click to edit alias"} onClick={() => openProviderModelEditor(model)}>{config.alias || model}</button>
                      <div className="model-modality-directional"><ModelModalityBadges zh={zh} direction="input" modalities={config.input_modalities} onClick={() => openProviderModelEditor(model)} /><span className="model-modality-separator" aria-hidden>→</span><ModelModalityBadges zh={zh} direction="output" modalities={config.output_modalities} onClick={() => openProviderModelEditor(model)} /></div>
                      <ModelApiProtocolBadge protocol={config.api_protocol} zh={zh} onClick={() => openProviderModelEditor(model)} />
                      <div className="model-provider-model-operations" data-testid={`model-provider-model-operations-${model}`}>
                        <label className="model-provider-model-enabled" title={config.enabled ? (zh ? "点击停用" : "Click to disable") : (zh ? "点击启用" : "Click to enable")}><input type="checkbox" checked={config.enabled} onChange={(event) => { const enabled = event.target.checked; setProviderModelConfigsDraft((current) => ({ ...current, [model]: { ...config, enabled } })); if (!enabled && modelDraft === model) { const fallback = providerModelsDraft.find((candidate) => candidate !== model && (providerModelConfigsDraft[candidate]?.enabled ?? true)); setModelDraft(fallback ?? ""); } else if (enabled && !modelDraft) setModelDraft(model); }} aria-label={zh ? `${config.enabled ? "停用" : "启用"}模型 ${model}` : `${config.enabled ? "Disable" : "Enable"} model ${model}`} /><span aria-hidden /></label>
                        <button type="button" className="model-provider-model-action" data-testid={`model-provider-model-edit-${model}`} title={zh ? "编辑模型信息" : "Edit model information"} aria-label={zh ? `编辑模型 ${model}` : `Edit model ${model}`} onClick={() => openProviderModelEditor(model)}><Pencil size={14} aria-hidden /></button>
                        <button type="button" className="model-provider-model-action" data-testid={`model-provider-model-copy-${model}`} title={zh ? "复制模型" : "Copy model"} aria-label={zh ? `复制模型 ${model}` : `Copy model ${model}`} onClick={() => duplicateProviderModel(model)}><Copy size={14} aria-hidden /></button>
                        <button type="button" className="model-provider-model-remove" title={zh ? "删除模型" : "Delete model"} aria-label={zh ? `移除模型 ${model}` : `Remove model ${model}`} onClick={() => removeProviderModel(model)}><Trash2 size={14} aria-hidden /></button>
                      </div>
                    </div>;
                  })}
                  {newProviderModelDraft !== null && <div className="model-provider-model-row model-provider-model-new" data-testid="model-provider-model-new">
                    <input autoFocus data-testid="model-provider-model-new-input" value={newProviderModelDraft} maxLength={256} placeholder={zh ? "输入模型 ID" : "Enter model ID"} onChange={(event) => setNewProviderModelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitProviderModel(); } else if (event.key === "Escape") setNewProviderModelDraft(null); }} />
                    <span /><span /><span />
                    <div><button type="button" data-testid="model-provider-model-new-confirm" aria-label={zh ? "添加模型" : "Add model"} onClick={commitProviderModel}>✓</button><button type="button" aria-label={zh ? "取消新建模型" : "Cancel new model"} onClick={() => setNewProviderModelDraft(null)}>×</button></div>
                  </div>}
                </div>
              </div>
              {providerModelEditor && (() => {
                const modalityOptions: MyDrSaiModelModality[] = ["text", "image", "audio", "video"];
                const protocolOptions: Array<{ id: MyDrSaiModelApiProtocol; label: string }> = [{ id: "openai", label: "OpenAI" }, { id: "anthropic", label: "Anthropic" }, { id: "gemini", label: "Gemini" }];
                const capabilityOptions: MyDrSaiModelCapability[] = ["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"];
                return <div className="model-provider-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProviderModelEditor(null); }} onKeyDown={(event) => { if (event.key === "Escape") setProviderModelEditor(null); }}>
                  <section className="model-provider-model-editor" role="dialog" aria-modal="true" aria-labelledby="model-provider-model-editor-title" data-testid="model-provider-model-editor">
                    <header><div><h2 id="model-provider-model-editor-title">{zh ? "编辑模型信息" : "Edit model information"}</h2><p>{zh ? "这些设置按模型保存到 config.toml，并由 Runtime 直接使用。" : "These settings are stored per model in config.toml and consumed directly by the Runtime."}</p></div></header>
                    <div className="model-provider-model-editor-grid">
                      <label><span>{zh ? "模型 ID" : "Model ID"}</span><input autoFocus value={providerModelEditor.modelId} maxLength={256} onChange={(event) => { setProviderModelEditor((current) => current ? { ...current, modelId: event.target.value } : current); setProviderModelEditorError(null); }} /></label>
                      <label><span>{zh ? "别名" : "Alias"}</span><input value={providerModelEditor.alias} maxLength={256} placeholder={providerModelEditor.modelId} onChange={(event) => setProviderModelEditor((current) => current ? { ...current, alias: event.target.value } : current)} /></label>
                      <fieldset><legend>{zh ? "输入模态" : "Input modalities"}</legend><div className="model-provider-capability-options">{modalityOptions.map((modality) => <label key={modality}><input type="checkbox" checked={providerModelEditor.inputModalities.includes(modality)} onChange={(event) => toggleProviderModelEditorModality("input", modality, event.target.checked)} /><span>{modality}</span></label>)}</div></fieldset>
                      <fieldset><legend>{zh ? "输出模态" : "Output modalities"}</legend><div className="model-provider-capability-options">{modalityOptions.map((modality) => <label key={modality}><input type="checkbox" checked={providerModelEditor.outputModalities.includes(modality)} onChange={(event) => toggleProviderModelEditorModality("output", modality, event.target.checked)} /><span>{modality}</span></label>)}</div></fieldset>
                      <fieldset><legend>{zh ? "API 协议" : "API protocol"}</legend><div className="model-provider-capability-options">{protocolOptions.map((protocol) => <label key={protocol.id}><input type="radio" name="model-api-protocol" checked={providerModelEditor.apiProtocol === protocol.id} onChange={() => setProviderModelEditor((current) => current ? { ...current, apiProtocol: protocol.id } : current)} /><span>{protocol.label}</span></label>)}</div></fieldset>
                      <fieldset className="model-provider-model-editor-wide"><legend>{zh ? "能力" : "Capabilities"}</legend><div className="model-provider-capability-options">{capabilityOptions.map((capability) => <label key={capability}><input type="checkbox" checked={providerModelEditor.capabilities.includes(capability)} onChange={(event) => toggleProviderModelEditorCapability(capability, event.target.checked)} /><span>{capability}</span></label>)}</div></fieldset>
                      <label className="model-provider-model-editor-enabled"><input type="checkbox" checked={providerModelEditor.enabled} onChange={(event) => setProviderModelEditor((current) => current ? { ...current, enabled: event.target.checked } : current)} /><span>{zh ? "启用此模型" : "Enable this model"}</span></label>
                    </div>
                    {providerModelEditorError && <p className="settings-message" role="alert">{providerModelEditorError}</p>}
                    <footer className="model-provider-delete-actions"><button type="button" onClick={() => setProviderModelEditor(null)}>{zh ? "取消" : "Cancel"}</button><button type="button" data-testid="model-provider-model-editor-save" onClick={saveProviderModelEditor}>{zh ? "保存" : "Save"}</button></footer>
                  </section>
                </div>;
              })()}
              {myDrSaiConfig?.modelConnection?.model_provider === activeModelProviderTab && myDrSaiConfig.modelConnection.metadata?.known_model === false && <p className="model-provider-hint" data-testid="model-provider-unknown-model-warning">{zh ? "该模型未登记，能力参数尚未校准；将使用安全的通用默认值。" : "This model is not registered; capabilities are uncalibrated and safe generic defaults will be used."}</p>}
              <div className="model-provider-actions"><button type="button" className="model-provider-button-primary" data-testid="model-provider-save" disabled={modelConfigBusy || !modelProviderDirty || !providerDraft.trim() || !baseUrlDraft.trim()} onClick={() => void saveModelProvider()}>{modelConfigBusy ? (zh ? "处理中…" : "Working…") : (zh ? "保存提供方" : "Save provider")}</button><button type="button" disabled={modelConfigBusy || !providerDraft.trim()} data-testid="model-provider-test-basic" onClick={() => void testModelConnection("basic")}>{zh ? "检查连接" : "Check connection"}</button><button type="button" disabled={modelConfigBusy || !modelDraft.trim() || !providerDraft.trim()} data-testid="model-provider-test-model" onClick={() => setModelTestConfirmationOpen(true)}>{zh ? "测试模型调用" : "Test model call"}</button><button type="button" className="model-provider-button-danger" disabled={modelConfigBusy || providerDraft === "hepai"} onClick={requestModelProviderDeletion}>{zh ? "删除 Provider" : "Delete Provider"}</button>{myDrSaiConfig?.modelConnection?.path && <button type="button" className="model-provider-button-quiet" onClick={() => onOpenPath(myDrSaiConfig.modelConnection!.path!)}>{zh ? "打开配置文件" : "Open config"}</button>}</div>
              {modelConfigMessage && <div className="settings-message">{modelConfigMessage}{modelConfigConflict && <button type="button" data-testid="model-provider-conflict-reload" disabled={modelConfigBusy} onClick={() => void reloadModelConnectionAfterConflict()}>{zh ? "重新加载配置" : "Reload configuration"}</button>}</div>}
              {modelTestOutput && <div className="model-provider-test-output" data-testid="model-provider-test-output" role="status" aria-live="polite"><span>{zh ? "模型回复" : "Model reply"}</span><pre>{modelTestOutput}</pre></div>}
            </section>
            <section className="settings-section model-provider-recovery" data-testid="model-provider-recovery">
              <div>
                <h3>{zh ? "模型配置诊断与恢复" : "Model configuration diagnosis and recovery"}</h3>
                <p>{zh ? "检查配置、凭据和最后可用快照；在线检查会真实调用当前模型。" : "Check configuration, credentials, and the last-known-good snapshot. Online diagnosis calls the current model."}</p>
              </div>
              <div className="model-provider-actions">
                <button type="button" disabled={modelConfigBusy} data-testid="model-provider-doctor" onClick={() => void runModelDoctor(false)}>{zh ? "运行检查" : "Run Doctor"}</button>
                <button type="button" className="model-provider-button-accent" disabled={modelConfigBusy} data-testid="model-provider-doctor-online" onClick={() => void runModelDoctor(true)}>{zh ? "在线检查" : "Online check"}</button>
                <button type="button" className="model-provider-button-quiet" disabled={modelConfigBusy || modelDoctorResult?.last_known_good_available !== true} data-testid="model-provider-restore-last-good" onClick={() => void restoreLastKnownGoodModelConnection()}>{zh ? "恢复最后可用配置" : "Restore last-known-good"}</button>
              </div>
              {modelDoctorResult && <ul data-testid="model-provider-doctor-result">{modelDoctorResult.checks.map((check) => <li key={check.id} data-status={check.status}><strong>{check.id}</strong><span>{check.message}</span></li>)}</ul>}
            </section>
            {providerPendingDeletion && (
              <div className="model-provider-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !modelConfigBusy) { setProviderPendingDeletion(null); setProviderDeletePreflight(null); } }} onKeyDown={(event) => { if (event.key === "Escape" && !modelConfigBusy) { setProviderPendingDeletion(null); setProviderDeletePreflight(null); } }}>
                <section className="model-provider-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="model-provider-delete-title" aria-describedby="model-provider-delete-description" data-testid="model-provider-delete-dialog">
                  <h2 id="model-provider-delete-title">{zh ? `删除 Provider“${providerPendingDeletion}”？` : `Delete Provider “${providerPendingDeletion}”?`}</h2>
                  <p id="model-provider-delete-description">{zh ? "请选择是否同时删除系统安全存储中的凭据。取消不会修改 Provider、凭据或当前连接。" : "Choose whether to remove its credential from secure storage. Cancel leaves the Provider, credential, and active connection unchanged."}</p>
                  {providerDeletePreflight && providerDeletePreflight.references.length > 0 && (
                    <div className="settings-message" data-testid="model-provider-delete-references">
                      <p>{zh ? "此 Provider 仍被以下配置引用。请先迁移引用；当前操作不会修改任何配置。" : "This Provider is still referenced. Migrate these selections first; nothing has been changed."}</p>
                      <ul>{providerDeletePreflight.references.map((reference) => <li key={`${reference.kind}:${reference.id}`}>{reference.label}: {reference.model_id}</li>)}</ul>
                    </div>
                  )}
                  <div className="model-provider-delete-actions">
                    <button type="button" className="danger" disabled={modelConfigBusy || !providerDeletePreflight?.can_delete} data-testid="model-provider-delete-with-credential" onClick={() => void deleteModelProvider(true)}>{zh ? "删除 Provider 和凭据" : "Delete Provider and credential"}</button>
                    <button type="button" disabled={modelConfigBusy || !providerDeletePreflight?.can_delete} data-testid="model-provider-delete-keep-credential" onClick={() => void deleteModelProvider(false)}>{zh ? "仅删除 Provider" : "Delete Provider only"}</button>
                    <button type="button" autoFocus disabled={modelConfigBusy} data-testid="model-provider-delete-cancel" onClick={() => { setProviderPendingDeletion(null); setProviderDeletePreflight(null); }}>{zh ? "取消" : "Cancel"}</button>
                  </div>
                </section>
              </div>
            )}
            {modelTestConfirmationOpen && (
              <div className="model-provider-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !modelConfigBusy) setModelTestConfirmationOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" && !modelConfigBusy) setModelTestConfirmationOpen(false); }}>
                <section className="model-provider-test-dialog" role="dialog" aria-modal="true" aria-labelledby="model-provider-test-title" aria-describedby="model-provider-test-description" data-testid="model-provider-test-dialog">
                  <h2 id="model-provider-test-title">{zh ? `调用模型“${modelDraft.trim()}”？` : `Call model “${modelDraft.trim()}”?`}</h2>
                  <p id="model-provider-test-description">{modelProviderDirty
                    ? (zh ? "这会向服务商发送一次最小模型请求，可能产生少量费用。当前有未保存更改，因此只测试草稿，不会更新运行状态。" : "This sends one minimal request and may incur a small charge. Because there are unsaved changes, it tests only the draft and does not update runtime status.")
                    : (zh ? "这会向服务商发送一次最小模型请求，可能产生少量费用。成功后会把当前已保存配置标记为已验证。" : "This sends one minimal request and may incur a small charge. Success marks the current saved configuration as verified.")}</p>
                  <div className="model-provider-delete-actions">
                    <button type="button" disabled={modelConfigBusy} data-testid="model-provider-test-model-confirm" onClick={() => void testModelConnection("model")}>{modelConfigBusy ? (zh ? "测试中…" : "Testing…") : (zh ? "确认并测试" : "Confirm and test")}</button>
                    <button type="button" autoFocus disabled={modelConfigBusy} data-testid="model-provider-test-model-cancel" onClick={() => setModelTestConfirmationOpen(false)}>{zh ? "取消" : "Cancel"}</button>
                  </div>
                </section>
              </div>
            )}
              </>
            )}
            {activePane === "general" && (
              <>
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
            <section className="settings-section" data-testid="codex-workspace-sync-settings">
              <div><h2>{zh ? "Codex 会话同步" : "Codex session sync"}</h2><p>{zh ? "按工作区路径重新读取 Codex 的活跃与已归档会话。" : "Reload active and archived Codex sessions matched by workspace path."}</p></div>
              <div className="settings-component-list">
                {workspaces.filter((workspace) => workspace.location !== "remote").map((workspace) => (
                  <div className="settings-row" key={workspace.id}>
                    <span><strong>{workspace.name}</strong><small>{workspace.path}</small></span>
                    <button type="button" onClick={() => void onSyncWorkspaceSessions(workspace)}>{zh ? "重新同步" : "Resync"}</button>
                  </div>
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
                {/* Temporarily hide Skills management entry — keep for later reuse.
                <label className="settings-toggle"><span><strong>{zh ? "技能" : "Skills"}</strong><small>{zh ? "在广场分组中显示技能入口。" : "Show Skills inside the Square group."}</small></span><input type="checkbox" checked={sidebarComponents.skills} onChange={(event) => onSidebarComponentsChange((current) => ({ ...current, skills: event.target.checked }))} /></label>
                */}
              </div>
              <div className="settings-component-list">
                <strong>{zh ? "右侧栏组件" : "Right sidebar components"}</strong>
                {(["run", "files", "browser", "terminal", "debug"] as Array<keyof RightSidebarComponentVisibility>).map((component) => {
                  const label = component === "run"
                    ? (zh ? "运行" : "Run")
                    : component === "files"
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
              <h2>{zh ? "智能体配置" : "Agent configuration"}</h2>
              <p>{zh ? "分别配置本机 OpenDrSai、本机 Codex 和 AI 平台智能体。" : "Configure local OpenDrSai, local Codex, and AI platform Agents independently."}</p>
            </header>
            <div className="agent-configuration-tabs" role="tablist" aria-label={zh ? "智能体运行来源" : "Agent runtime source"}>
              {([
                { id: "opendrsai" as const, label: zh ? "本机 OpenDrSai" : "Local OpenDrSai" },
                { id: "codex" as const, label: zh ? "本机 Codex" : "Local Codex" },
                { id: "platform" as const, label: zh ? "AI 平台" : "AI platform" },
              ]).map((tab) => (
                <button key={tab.id} type="button" role="tab" aria-selected={activeAgentConfigurationTab === tab.id} className={activeAgentConfigurationTab === tab.id ? "active" : ""} onClick={() => setActiveAgentConfigurationTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
            <section className="settings-section agent-configuration-panel" role="tabpanel">
              <div>
                <h2>{activeAgentConfigurationTab === "opendrsai" ? (zh ? "本机 OpenDrSai" : "Local OpenDrSai") : activeAgentConfigurationTab === "codex" ? (zh ? "本机 Codex" : "Local Codex") : (zh ? "AI 平台智能体" : "AI platform Agent")}</h2>
                <p>{activeConfigurationAgent?.description || (zh ? "当前环境中尚未发现此类智能体。" : "No Agent of this type was found in the current environment.")}</p>
              </div>
              {activeAgentConfigurationTab === "platform" && (
                <div className="settings-row">
                  <span><strong>{zh ? "平台智能体" : "Platform Agent"}</strong><small>{zh ? "选择需要独立配置的 AI 平台智能体。" : "Choose the AI platform Agent to configure independently."}</small></span>
                  <select value={platformConfigurationAgent?.id ?? ""} onChange={(event) => setPlatformConfigurationAgentId(event.target.value)} disabled={platformConfigurationAgents.length === 0}>
                    {platformConfigurationAgents.length === 0 && <option value="">{zh ? "暂无平台智能体" : "No platform Agent"}</option>}
                    {platformConfigurationAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                </div>
              )}
              <div className="settings-row">
                <span><strong>{zh ? "主模型" : "Primary model"}</strong><small>{zh ? "与聊天输入框使用同一个模型，用于对话、推理和工具调用。" : "Shared with the chat composer for conversations, reasoning, and tool calls."}</small></span>
                <div className="settings-model-control">
                  <select data-testid="agent-text-model-select" aria-label={zh ? "主模型" : "Primary model"} value={activeAgentModel} onChange={(event) => {
                    if (!activeConfigurationAgent) return;
                    if (activeAgentConfigurationTab !== "opendrsai") { onConfigureAgentModel(activeConfigurationAgent.id, event.target.value); return; }
                    const [providerId, modelId] = event.target.value.split("::").map(decodeURIComponent);
                    onConfigureAgentModel(activeConfigurationAgent.id, modelId, providerId);
                  }} disabled={!activeConfigurationAgent || activeAgentModels.length === 0}>
                    {activeAgentModels.length === 0 && <option value="">{zh ? "暂无可用模型" : "No model available"}</option>}
                    {Object.entries(activeAgentModelGroups).map(([provider, providerModels]) => <optgroup key={provider} label={provider}>
                      {providerModels.map((model) => {
                        const selected = model.provider_id === activeAgentPreference?.modelRef?.provider_id && model.alias === activeAgentPreference?.modelRef?.model_id;
                        const usable = isSelectableModelAvailability(model.availability);
                        const status = usable ? "" : ` · ${model.availability}`;
                        return <option key={`${model.provider_id || "backend"}:${model.alias}`} disabled={!usable && !selected} value={activeAgentConfigurationTab === "opendrsai" ? `${encodeURIComponent(model.provider_id || "") }::${encodeURIComponent(model.alias)}` : model.alias}>{`${model.display_name || model.alias}${status}`}</option>;
                      })}
                    </optgroup>)}
                  </select>
                  {activeAgentModelProvider && <small className="settings-model-provider" data-testid="agent-text-model-provider">{zh ? `提供方：${activeAgentModelProvider}` : `Provider: ${activeAgentModelProvider}`}</small>}
                </div>
              </div>
              {activeAgentConfigurationTab === "opendrsai" && (activeAgentModels.length === 0 || activeAgentModelUnavailable || modelCatalogState !== "fresh") && <div className="model-catalog-recovery" data-testid="agent-model-catalog-recovery" role="status" aria-live="polite" data-state={activeAgentModelUnavailable ? activeAgentModelDescriptor?.availability : modelCatalogState}>
                <strong>{modelCatalogRecoveryCopy(activeAgentModelUnavailable ? activeAgentModelDescriptor?.availability ?? "error" : modelCatalogState, zh).title}</strong>
                <p>{modelCatalogRecoveryCopy(activeAgentModelUnavailable ? activeAgentModelDescriptor?.availability ?? "error" : modelCatalogState, zh).message}</p>
                <div>
                  <button type="button" data-testid="agent-model-refresh" onClick={onRefreshAgentModels}>{zh ? "刷新模型" : "Refresh models"}</button>
                  {(modelCatalogState === "unauthorized" || activeAgentModelDescriptor?.availability === "unauthorized") && <button type="button" data-testid="agent-model-sign-in" onClick={() => void onLogout()}>{zh ? "重新登录" : "Sign in again"}</button>}
                </div>
              </div>}
              {activeAgentConfigurationTab === "opendrsai" && capabilityModelSettings.map((setting) => {
                const value = setting.selection?.mode === "explicit" && setting.selection.ref
                  ? `${encodeURIComponent(setting.selection.ref.provider_id)}::${encodeURIComponent(setting.selection.ref.model_id)}`
                  : "";
                const groups = setting.models.reduce<Record<string, MyDrSaiModelConfig[]>>((result, model) => {
                  (result[model.provider_id || (zh ? "其他来源" : "Other sources")] ??= []).push(model);
                  return result;
                }, {});
                const selectedProvider = setting.selection?.mode === "explicit" && setting.selection.ref ? setting.selection.ref.provider_id : undefined;
                return <div className="settings-row" data-testid={setting.testId} key={setting.role}>
                  <span><strong>{setting.label}</strong><small>{setting.description}</small></span>
                  <div className="settings-model-control">
                    <select aria-label={setting.label} value={value} onChange={(event) => {
                      if (!event.target.value) { onConfigureAgentCapabilityModel(setting.role); return; }
                      const [providerId, modelId] = event.target.value.split("::").map(decodeURIComponent);
                      onConfigureAgentCapabilityModel(setting.role, modelId, providerId);
                    }} disabled={setting.models.length === 0}>
                      <option value="">{setting.models.length === 0 ? (zh ? "暂无匹配模型" : "No matching model") : (zh ? "未指定" : "Not assigned")}</option>
                      {Object.entries(groups).map(([provider, providerModels]) => <optgroup key={provider} label={provider}>
                        {providerModels.map((model) => <option key={`${model.provider_id}:${model.alias}`} value={`${encodeURIComponent(model.provider_id || "")}::${encodeURIComponent(model.alias)}`}>{model.display_name || model.alias}</option>)}
                      </optgroup>)}
                    </select>
                    {selectedProvider && <small className="settings-model-provider" data-testid={`agent-${setting.role.replaceAll("_", "-")}-provider`}>{zh ? `提供方：${selectedProvider}` : `Provider: ${selectedProvider}`}</small>}
                  </div>
                </div>;
              })}
              {activeAgentConfigurationTab === "opendrsai" && <div className="model-capability-status" data-testid="agent-model-capability-status" aria-live="polite">
                <div>
                  <strong>{zh ? "模型能力验证" : "Model capability verification"}</strong>
                  <small>{zh ? "区分已声明、Provider 已验证和 Runtime 已验证；未验证状态不会放行回归测试。" : "Distinguishes declared, Provider-verified, and Runtime-verified capabilities. Unverified states do not pass regression preflight."}</small>
                </div>
                <button type="button" disabled={modelCapabilityStatusBusy} onClick={() => void refreshModelCapabilityStatus()}>{modelCapabilityStatusBusy ? (zh ? "读取中…" : "Loading…") : (zh ? "刷新状态" : "Refresh status")}</button>
                {modelCapabilityStatusError && <p role="alert">{modelCapabilityStatusError}</p>}
                {!modelCapabilityStatusError && !modelCapabilityStatusBusy && (modelCapabilityStatus?.capabilities.length ?? 0) === 0 && <p>{zh ? "尚无真实能力探针结果。请先运行 P2 模型探针。" : "No real capability probe results yet. Run the P2 model probe first."}</p>}
                {(modelCapabilityStatus?.capabilities ?? []).map((capability) => <div className="model-capability-status-row" key={`${capability.model_id}:${capability.operation}`}>
                  <span><code>{capability.model_id}</code><small>{capability.operation} · {capability.protocol}</small></span>
                  <em data-state={capability.status}>{capability.status === "runtime_verified" ? (zh ? "Runtime 已验证" : "Runtime verified") : capability.status === "verified" ? (zh ? "Provider 已验证" : "Provider verified") : capability.status}</em>
                </div>)}
              </div>}
              <div className="settings-row">
                <span><strong>{zh ? "思考强度" : "Thinking effort"}</strong><small>{zh ? "可在每次发送前从聊天输入区临时调整。" : "Can still be changed in the composer before sending."}</small></span>
                <select value={activeAgentThinkingEfforts.includes(activeAgentThinkingEffort) ? activeAgentThinkingEffort : activeAgentThinkingEfforts.includes("high") ? "high" : activeAgentThinkingEfforts[0] ?? ""} disabled={!activeConfigurationAgent || activeAgentThinkingEfforts.length === 0} onChange={(event) => activeConfigurationAgent && void onConfigureAgentThinkingEffort(activeConfigurationAgent.id, event.target.value as ThinkingEffort)}>
                  {activeAgentThinkingEfforts.length === 0 && <option value="">{zh ? "当前模型不支持" : "Not supported by this model"}</option>}
                  {activeAgentThinkingEfforts.includes("none") && <option value="none">{zh ? "不思考" : "Off"}</option>}
                  {activeAgentThinkingEfforts.includes("low") && <option value="low">{zh ? "低" : "Low"}</option>}
                  {activeAgentThinkingEfforts.includes("medium") && <option value="medium">{zh ? "中" : "Medium"}</option>}
                  {activeAgentThinkingEfforts.includes("high") && <option value="high">{zh ? "高" : "High"}</option>}
                  {activeAgentThinkingEfforts.includes("xhigh") && <option value="xhigh">{zh ? "极高" : "Extra high"}</option>}
                  {activeAgentThinkingEfforts.includes("max") && <option value="max">{zh ? "最大" : "Max"}</option>}
                </select>
              </div>
            </section>
            {activeAgentConfigurationTab === "opendrsai" && <section className="settings-section">
              <div><h2>{zh ? "执行与上下文" : "Execution and context"}</h2><p>{zh ? "这些选项保存到当前 OpenDrSai 配置，并受现有审批策略约束。" : "These options are saved to the current OpenDrSai configuration and remain governed by approval policy."}</p></div>
              <label className="settings-toggle"><span><strong>{zh ? "先规划再执行" : "Plan mode"}</strong><small>{zh ? "让智能体先生成计划，再开始执行。" : "Ask the Agent to create a plan before acting."}</small></span><input type="checkbox" checked={Boolean(myDrSaiConfig?.config.plan_mode)} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ plan_mode: event.target.checked })} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "限制在当前工作区" : "Restrict to current workspace"}</strong><small>{zh ? "文件操作优先限制在当前工作区，越界操作继续走审批。" : "Prefer file operations inside the current workspace; out-of-scope actions still require approval."}</small></span><input type="checkbox" checked={myDrSaiConfig?.config.workspace_enabled !== false} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ workspace_enabled: event.target.checked })} /></label>
              {agentConfigMessage && <div className="settings-message">{agentConfigMessage}</div>}
            </section>}
            {activeAgentConfigurationTab === "opendrsai" && activeConfigurationAgent && <AgentResourcesSettings agentId={activeConfigurationAgent.id} zh={zh} />}
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
            </section>
          </>
        )}

        {activePane === "remote-workspace" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "远程工作区" : "Remote Workspace"}</h2>
              <p>{zh ? "管理可用于远程工作区的计算机，以及 Android 端访问此电脑的连接。" : "Manage computers available to remote workspaces and Android access to this computer."}</p>
            </header>
            <section className="settings-section settings-integration-list" data-testid="remote-workspace-settings">
              <div className="settings-integration-row" data-testid="remote-computers-entry"><TerminalIcon size={18} /><span><strong>{zh ? "远程计算机" : "Remote computers"}</strong><small>{zh ? "已配置、可用于远程工作区的计算机。" : "Configured computers available to remote workspaces."}</small></span><em>{remoteHostCount === null ? (zh ? "检查中" : "Checking") : zh ? `${remoteHostCount} 台计算机` : `${remoteHostCount} computers`}</em></div>
              <div className="android-remote-panel" data-testid="android-remote-panel">
                <div className="android-remote-header">
                  <Smartphone size={18} />
                  <span>
                    <strong>Android</strong>
                    <small>{zh ? "OpenDrSai Android 远程连接与设备管理。" : "OpenDrSai Android remote connection and device management."}</small>
                  </span>
                  <div className="settings-integration-actions">
                    <button type="button" role="switch" aria-checked={androidRemoteEnabled} aria-label={androidRemoteEnabled ? (zh ? "暂停 Android 远程访问" : "Pause Android remote access") : (zh ? "恢复 Android 远程访问" : "Resume Android remote access")} className={`settings-connection-switch ${androidRemoteEnabled ? "is-enabled" : ""}`} data-testid="android-remote-toggle" disabled={mobileEnrollmentBusy || mobileAssociationsState === "loading"} onClick={() => { if (androidRemoteEnabled) void pauseMobileRemoteAccess(); else void enableMobileRemoteAccess(); }}><span aria-hidden="true" /></button>
                    <button type="button" className={`android-refresh-button ${mobileAssociationsState === "loading" ? "is-loading" : ""}`} onClick={() => void refreshAndroidDevices()} disabled={mobileAssociationsState === "loading"} aria-label={zh ? "刷新 Android 设备" : "Refresh Android devices"} aria-busy={mobileAssociationsState === "loading"} title={zh ? "刷新" : "Refresh"} data-testid="android-refresh"><RefreshCw size={15} aria-hidden="true" /></button>
                    <button type="button" onClick={onOpenMobilePairing} disabled={!androidRemoteEnabled || mobileEnrollmentBusy} data-testid="android-connect">{zh ? "连接 Android" : "Connect Android"}</button>
                  </div>
                </div>
                <div className="android-remote-counts" data-testid="android-device-counts">
                  <span>{zh ? `已授权设备 ${activeAndroidAssociations.length}` : `Authorized devices ${activeAndroidAssociations.length}`}</span>
                  <span>{zh ? `当前在线 ${androidOnlineDeviceCount}` : `Online now ${androidOnlineDeviceCount}`}</span>
                </div>
                {androidPanelMessage ? <p className="android-remote-message" data-state={mobileAssociationsState} data-testid="android-device-state">{androidPanelMessage}</p> : null}
                {activeAndroidAssociations.length > 0 ? (
                  <div className="android-device-list" data-testid="android-device-list">
                    {activeAndroidAssociations.map((association) => (
                      <div key={association.association_id} className="android-device-row" data-state={association.access_state} data-testid="android-device-row">
                        <span className="android-device-presence" aria-hidden="true" />
                        <span><strong>{association.device_name}</strong><small>{association.device_type === "android" ? (zh ? "Android 设备" : "Android device") : association.device_type} · {association.workspace_scope === "selected" ? (zh ? "指定工作区" : "Selected workspaces") : (zh ? "全部工作区" : "All workspaces")} · {association.permissions.join(" / ")} · {zh ? "授权于" : "Authorized"} {new Date(association.created_at).toLocaleDateString()}</small></span>
                        <em data-testid="android-device-status">{androidDeviceStateText[association.access_state]}{association.last_seen_at ? ` · ${androidRelativeTime(association.last_seen_at, language)}` : ""}</em>
                        {association.permissions.some((permission) => permission !== "read") ? <button type="button" disabled={mobileEnrollmentBusy} data-testid="android-device-read-only" onClick={() => void makeAndroidDeviceReadOnly(association)}>{zh ? "设为只读" : "Make read-only"}</button> : null}
                        <button type="button" className="danger" disabled={mobileEnrollmentBusy} data-testid="android-device-revoke" onClick={() => void revokeAndroidDevice(association)}>{zh ? "撤销" : "Revoke"}</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="settings-button-row settings-danger-actions" data-testid="android-danger-actions">
                  <button type="button" disabled={mobileEnrollmentBusy || mobilePairingReadiness?.state === "not_registered"} onClick={() => void renameAndroidRuntime()} data-testid="android-runtime-rename">{zh ? "重命名此电脑" : "Rename this computer"}</button>
                  <button type="button" disabled={mobileEnrollmentBusy} onClick={() => void diagnoseAndroidRuntime()} data-testid="android-runtime-diagnose">{zh ? "连接诊断" : "Diagnose connection"}</button>
                  <button type="button" className="danger" disabled={mobileEnrollmentBusy || activeAndroidAssociations.length === 0} onClick={() => void revokeAllAndroidDevices()} data-testid="android-revoke-all">{zh ? "撤销全部设备" : "Revoke all devices"}</button>
                  <button type="button" className="danger" disabled={mobileEnrollmentBusy || mobilePairingReadiness?.state === "not_registered"} onClick={() => void revokeMobileEnrollment()} data-testid="android-revoke-enrollment">{zh ? "注销此电脑" : "Unregister this computer"}</button>
                </div>
              </div>
            </section>
          </>
        )}

        {activePane === "archived-sessions" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "已归档会话" : "Archived sessions"}</h2>
              <p>{zh ? "集中查找和恢复已归档的 OpenDrSai 与 Codex 会话。归档不会删除消息或工作区内容。" : "Find and restore archived OpenDrSai and Codex sessions. Archiving preserves messages and workspace content."}</p>
            </header>
            <section className="settings-section archived-threads-settings" data-testid="archived-threads-settings">
              <div>
                <h2>{zh ? `会话（${archivedThreads.length}）` : `Sessions (${archivedThreads.length})`}</h2>
                <p>{archiveSearch.trim() ? (zh ? "显示与当前搜索匹配的归档会话。" : "Showing archived sessions matching the current search.") : (zh ? "按标题搜索，或取消归档以将会话恢复到侧边栏。" : "Search by title, or unarchive a session to restore it to the sidebar.")}</p>
              </div>
              <div className="settings-component-list">
                <input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder={zh ? "搜索已归档会话" : "Search archived sessions"} aria-label={zh ? "搜索已归档会话" : "Search archived sessions"} />
                {archivedThreads.length === 0 ? <small>{zh ? "没有匹配的已归档会话。" : "No archived sessions match."}</small> : archivedThreads.map((thread) => (
                  <div className="settings-row" key={thread.id}><span><strong>{thread.title}</strong><small>{thread.archiveSource === "codex" ? "Codex" : "OpenDrSai"}</small></span><button type="button" onClick={() => void Promise.resolve(onArchiveThread(thread.id, false)).catch(() => showAppNotice({ id: "unarchive-failed", title: zh ? "无法恢复会话" : "Conversation could not be restored", description: zh ? "取消归档失败，请重试。" : "Unarchive failed. Please retry." }))}>{zh ? "取消归档" : "Unarchive"}</button></div>
                ))}
              </div>
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
              <div className="settings-button-row"><button type="button" data-testid="export-local-data" onClick={onExportLocalData}>{zh ? "导出本地数据" : "Export local data"}</button><button type="button" onClick={() => void requestAppDecision({ id: "reset-desktop-preferences", title: zh ? "重置桌面偏好？" : "Reset desktop preferences?", description: zh ? "将恢复界面、侧边栏和默认选项。" : "Appearance, sidebar, and default choices will be reset.", impact: zh ? "本地会话和工作区文件会保留。" : "Local conversations and workspace files will be preserved.", confirmLabel: zh ? "重置偏好" : "Reset preferences" }).then((confirmed) => { if (confirmed) onResetPreferences(); })}>{zh ? "重置偏好" : "Reset preferences"}</button></div>
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
  selectedModelRef?: { provider_id: string; model_id: string },
): MyDrSaiModelConfig[] {
  if (agent?.source === "local" && agent.id !== "my-codex") {
    const providerAware = new Map<string, MyDrSaiModelConfig>();
    for (const model of catalog) {
      if (!model.provider_id || !model.alias) continue;
      providerAware.set(`${model.provider_id}\0${model.alias}`, model);
    }
    if (providerAware.size > 0) return [...providerAware.values()];
    if (selectedModelRef) return [{
      alias: selectedModelRef.model_id,
      display_name: selectedModelRef.model_id,
      model: selectedModelRef.model_id,
      provider_id: selectedModelRef.provider_id,
      availability: "unavailable",
      capability_source: "unknown",
    }];
    return [];
  }
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
