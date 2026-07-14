import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Cloud,
  Monitor,
  FolderCode,
  FolderPlus,
  HelpCircle,
  IdCard,
  LogOut,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AuthUser,
  CreateWorkspaceRequest,
  DesktopForkLifecycleAction,
  DesktopThreadContentSearchResult,
  DesktopThreadForkMetadata,
  WorkspaceProject,
} from "@shared/desktopApi";
import drsaiLogo from "../assets/drsai-transparent.png";
import { MENU_IDS, type AppLanguage, type NavId, type NavSection, type RightTab } from "../navigation";
import {
  getConflictMarkerCount,
  getForkConflictFileKind,
  getForkConflictHunkTestSuggestions,
  getForkConflictRepoTestGraphSuggestions,
  getForkConflictStructureDiff,
  getForkConflictTestSuggestions,
  getLineCount,
  parseForkConflictDraftHunks,
  splitConflictDraftLines,
  type ForkConflictDraftHunk,
  type ForkConflictSemanticPreview,
} from "./forkConflictAnalysis";

export interface WorkspaceThread {
  id: string;
  title: string;
  timeLabel: string;
  workspaceId: string;
  workspacePath?: string;
  fork?: DesktopThreadForkMetadata;
  active?: boolean;
  pinned?: boolean;
  archived?: boolean;
  unread?: boolean;
}

export interface ForkConflictFile {
  path: string;
  status: string;
}

export interface ForkConflictContentPreviewResult {
  baseContent: string;
  baseRef: string;
  baseMissing?: boolean;
  sourceContent: string;
  forkContent: string;
  diff: string;
  diffHash?: string;
  truncated?: boolean;
}

export interface ForkConflictStageResult {
  diff: string;
  diffHash?: string;
  message: string;
  approvalQueued?: boolean;
  staged?: boolean;
}

export interface ForkConflictDraftWriteResult {
  path: string;
  message: string;
  approvalQueued?: boolean;
  written?: boolean;
}

interface WorkspaceShellProps {
  activeNav: NavId;
  activeRightTab: RightTab;
  activeWorkspaceId: string;
  activeWorkspaceName: string;
  canGoBack: boolean;
  canGoForward: boolean;
  desktopStatusPanel: React.ReactNode;
  language: AppLanguage;
  mainContent: React.ReactNode;
  navIcons: Record<NavId, LucideIcon>;
  navSections: NavSection[];
  recentThreads: WorkspaceThread[];
  searchableThreads: WorkspaceThread[];
  rightPanel: React.ReactNode;
  rightPanelCollapsed: boolean;
  rightTabIcons: Record<RightTab, LucideIcon>;
  rightTabs: Array<{ id: RightTab; label: string }>;
  sessionScope: "workspace" | "all";
  sidebarCollapsed: boolean;
  sidebarComponents: {
    square: boolean;
    agents: boolean;
    skills: boolean;
  };
  user: AuthUser | null;
  workspaceSortMode: "recent" | "name" | "created";
  workspaces: WorkspaceProject[];
  onGoBack: () => void;
  onGoForward: () => void;
  onAddWorkspace: () => void | Promise<void>;
  onCreateWorkspace: (request: CreateWorkspaceRequest) => void | Promise<void>;
  onPickWorkspaceFolder: () => Promise<string | null>;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onLoadForkConflictContent: (
    thread: WorkspaceThread,
    file: ForkConflictFile,
  ) => Promise<ForkConflictContentPreviewResult>;
  onNavChange: (id: NavId) => void;
  onNewChat: () => void;
  onOpenWorkspacePath: (path: string) => void | Promise<void>;
  onRefreshWorkspaces: () => void | Promise<void>;
  onRemoveWorkspace: (id: string) => void | Promise<void>;
  onRequestForkLifecycle: (threadId: string, action: DesktopForkLifecycleAction) => void | Promise<void>;
  onRightTabChange: (id: RightTab) => void;
  onStageForkConflictFile: (
    thread: WorkspaceThread,
    file: ForkConflictFile,
  ) => Promise<ForkConflictStageResult>;
  onWriteForkConflictDraft: (
    thread: WorkspaceThread,
    file: ForkConflictFile,
    draft: string,
    expectedDiffHash?: string,
  ) => Promise<ForkConflictDraftWriteResult>;
  onThreadSelect: (threadId: string) => void;
  onSearchThreadMessages: (
    query: string,
    threadIds: string[],
  ) => Promise<DesktopThreadContentSearchResult[]>;
  onThreadUpdate: (threadId: string, updates: { title?: string; pinned?: boolean; archived?: boolean; unread?: boolean; fork?: DesktopThreadForkMetadata }) => void | Promise<void>;
  onToggleSessionScope: () => void;
  onToggleRightPanel: () => void;
  onToggleSidebar: () => void;
  onUpdateWorkspace: (id: string, updates: Partial<Pick<WorkspaceProject, "name" | "description" | "trusted" | "pinned">>) => void | Promise<void>;
  onWorkspaceChange: (workspaceId: string) => void;
  onWorkspaceSortModeChange: (mode: "recent" | "name" | "created") => void;
}

export function WorkspaceShell({
  activeNav,
  activeRightTab,
  activeWorkspaceId,
  activeWorkspaceName,
  canGoBack,
  canGoForward,
  desktopStatusPanel,
  language,
  mainContent,
  navIcons,
  navSections,
  recentThreads,
  searchableThreads,
  rightPanel,
  rightPanelCollapsed,
  rightTabIcons,
  rightTabs,
  sessionScope,
  sidebarCollapsed,
  sidebarComponents,
  user,
  workspaceSortMode,
  workspaces,
  onGoBack,
  onGoForward,
  onAddWorkspace,
  onCreateWorkspace,
  onPickWorkspaceFolder,
  onLanguageChange,
  onLogout,
  onLoadForkConflictContent,
  onNavChange,
  onNewChat,
  onOpenWorkspacePath,
  onRefreshWorkspaces,
  onRemoveWorkspace,
  onRequestForkLifecycle,
  onRightTabChange,
  onStageForkConflictFile,
  onWriteForkConflictDraft,
  onThreadSelect,
  onSearchThreadMessages,
  onThreadUpdate,
  onToggleSessionScope,
  onToggleRightPanel,
  onToggleSidebar,
  onUpdateWorkspace,
  onWorkspaceChange,
  onWorkspaceSortModeChange,
}: WorkspaceShellProps): React.JSX.Element {
  const [desktopStatusOpen, setDesktopStatusOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceDetailsId, setWorkspaceDetailsId] = useState<string | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceDescriptionDraft, setWorkspaceDescriptionDraft] = useState("");
  const [workspaceDeleteConfirm, setWorkspaceDeleteConfirm] = useState(false);
  const [workspaceCreateSource, setWorkspaceCreateSource] = useState<CreateWorkspaceRequest["source"]>("existing");
  const [workspaceCreateName, setWorkspaceCreateName] = useState("");
  const [workspaceCreateParent, setWorkspaceCreateParent] = useState("");
  const [workspaceCreateRepoUrl, setWorkspaceCreateRepoUrl] = useState("");
  const [workspaceCreateError, setWorkspaceCreateError] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteSelectedIndex, setCommandPaletteSelectedIndex] = useState(0);
  const [contentSearchResults, setContentSearchResults] = useState<DesktopThreadContentSearchResult[]>([]);
  const [contentSearchLoading, setContentSearchLoading] = useState(false);
  const [threadMenu, setThreadMenu] = useState<{
    thread: WorkspaceThread;
    x: number;
    y: number;
  } | null>(null);
  const [forkConflictPreview, setForkConflictPreview] = useState<{
    key: string;
    path: string;
    status: "loading" | "ready" | "error";
    message: string;
    baseContent?: string;
    baseRef?: string;
    baseMissing?: boolean;
    sourceContent?: string;
    forkContent?: string;
    diff?: string;
    diffHash?: string;
    truncated?: boolean;
    stageStatus?: "idle" | "loading" | "queued" | "error";
    stageMessage?: string;
    writeStatus?: "idle" | "loading" | "queued" | "written" | "error";
    writeMessage?: string;
  } | null>(null);
  const [forkConflictDrafts, setForkConflictDrafts] = useState<Record<string, string>>({});
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const helpMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const commandPaletteRef = useRef<HTMLDivElement | null>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const commandPaletteResultsRef = useRef<HTMLElement | null>(null);
  const contentSearchRequestRef = useRef(0);
  const zh = language === "zh";
  const userInitials = getUserInitials(user, zh);
  const workbenchMenus = zh ? ["文件", "编辑", "视图"] : ["File", "Edit", "View"];
  const agentItems = sidebarComponents.square
    ? getEnabledNavItems(navSections, "agents").filter((item) =>
        item.id === MENU_IDS.agentSquare
          ? sidebarComponents.agents
          : item.id === MENU_IDS.skillsSquare
            ? sidebarComponents.skills
            : true,
      )
    : [];
  const agentSectionLabel = navSections.find((section) => section.id === "agents")?.label ?? (zh ? "广场" : "Square");
  const workspaceItems = getEnabledNavItems(navSections, "workspace");
  const workspaceDetails = workspaces.find((workspace) => workspace.id === workspaceDetailsId) ?? null;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null;
  const isRightPanelExpanded = rightPanelExpanded && !rightPanelCollapsed;
  const rightPanelExpandLabel = isRightPanelExpanded
    ? zh ? "还原聊天视图" : "Restore chat view"
    : zh ? "展开上下文环境" : "Expand context environment";
  const rightPanelClassName = `right-panel context-right-panel ${
    activeRightTab === "browser" ? "browser-right-panel" : ""
  }`;
  const searchableThreadIds = useMemo(
    () => searchableThreads.map((thread) => thread.id),
    [searchableThreads],
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (!helpMenuRef.current?.contains(event.target as Node)) {
        setHelpMenuOpen(false);
      }
      if (!commandPaletteRef.current?.contains(event.target as Node)) {
        closeCommandPalette();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setDesktopStatusOpen(false);
        setHelpMenuOpen(false);
        setCommandPaletteOpen(false);
        setThreadMenu(null);
        setRightPanelExpanded(false);
        closeWorkspaceDetails();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (rightPanelCollapsed) {
      setRightPanelExpanded(false);
    }
  }, [rightPanelCollapsed]);

  useEffect(() => {
    setForkConflictPreview(null);
  }, [threadMenu?.thread.id]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    commandPaletteInputRef.current?.focus();
    commandPaletteInputRef.current?.select();
  }, [commandPaletteOpen]);

  useEffect(() => {
    setCommandPaletteSelectedIndex(0);
  }, [commandPaletteQuery, commandPaletteOpen]);

  useEffect(() => {
    const query = commandPaletteQuery.trim();
    const requestId = ++contentSearchRequestRef.current;
    if (!commandPaletteOpen || !query) {
      setContentSearchResults([]);
      setContentSearchLoading(false);
      return;
    }

    setContentSearchLoading(true);
    const timer = window.setTimeout(() => {
      void onSearchThreadMessages(query, searchableThreadIds)
        .then((results) => {
          if (contentSearchRequestRef.current === requestId) {
            setContentSearchResults(results);
          }
        })
        .catch(() => {
          if (contentSearchRequestRef.current === requestId) {
            setContentSearchResults([]);
          }
        })
        .finally(() => {
          if (contentSearchRequestRef.current === requestId) {
            setContentSearchLoading(false);
          }
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [commandPaletteOpen, commandPaletteQuery, onSearchThreadMessages, searchableThreadIds]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    commandPaletteResultsRef.current
      ?.querySelector<HTMLElement>("[aria-selected='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [commandPaletteOpen, commandPaletteSelectedIndex]);

  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    startResize((clientX) => {
      setSidebarWidth(clamp(clientX, 204, 380));
    });
  }

  function startRightPanelResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const grid = event.currentTarget.parentElement;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const maxRightPanelWidth = Math.max(420, Math.floor(rect.width * (2 / 3)));
    let collapseRequested = false;
    startResize((clientX) => {
      const nextWidth = rect.right - clientX;
      if (nextWidth < 160) {
        if (!collapseRequested && !rightPanelCollapsed) {
          collapseRequested = true;
          onToggleRightPanel();
        }
        return;
      }
      setRightPanelWidth(clamp(nextWidth, 280, maxRightPanelWidth));
    });
  }

  async function handleCreateLocalWorkspace(): Promise<void> {
    await onAddWorkspace();
    setWorkspaceCreateOpen(false);
  }

  function openWorkspaceCreate(): void {
    setWorkspaceCreateSource("existing");
    setWorkspaceCreateName("");
    setWorkspaceCreateParent("");
    setWorkspaceCreateRepoUrl("");
    setWorkspaceCreateError(null);
    setWorkspaceCreateOpen(true);
  }

  async function chooseWorkspaceParent(): Promise<void> {
    const path = await onPickWorkspaceFolder();
    if (path) setWorkspaceCreateParent(path);
  }

  async function submitWorkspaceCreate(): Promise<void> {
    setWorkspaceCreateError(null);
    try {
      if (workspaceCreateSource === "existing") {
        await handleCreateLocalWorkspace();
        return;
      }
      await onCreateWorkspace({
        source: workspaceCreateSource,
        parentPath: workspaceCreateParent,
        name: workspaceCreateName,
        repoUrl: workspaceCreateSource === "git" ? workspaceCreateRepoUrl : undefined,
        description: zh ? "本地工作区" : "Local workspace",
        trusted: true,
      });
      setWorkspaceCreateOpen(false);
    } catch (error) {
      setWorkspaceCreateError(error instanceof Error ? error.message : String(error));
    }
  }

  function openWorkspaceDetails(workspace: WorkspaceProject): void {
    setWorkspaceDetailsId(workspace.id);
    setWorkspaceNameDraft(workspace.name);
    setWorkspaceDescriptionDraft(workspace.description ?? "");
    setWorkspaceDeleteConfirm(false);
  }

  function closeWorkspaceDetails(): void {
    setWorkspaceDetailsId(null);
    setWorkspaceNameDraft("");
    setWorkspaceDescriptionDraft("");
    setWorkspaceDeleteConfirm(false);
  }

  async function saveWorkspaceDetails(): Promise<void> {
    if (!workspaceDetails || workspaceDetails.id === "current") return;
    await onUpdateWorkspace(workspaceDetails.id, {
      name: workspaceNameDraft,
      description: workspaceDescriptionDraft,
    });
  }

  async function toggleWorkspaceTrusted(): Promise<void> {
    if (!workspaceDetails || workspaceDetails.id === "current") return;
    await onUpdateWorkspace(workspaceDetails.id, { trusted: !workspaceDetails.trusted });
  }

  async function toggleWorkspacePinned(): Promise<void> {
    if (!workspaceDetails || workspaceDetails.id === "current") return;
    await onUpdateWorkspace(workspaceDetails.id, { pinned: !workspaceDetails.pinned });
  }

  async function confirmWorkspaceRemoval(): Promise<void> {
    if (!workspaceDetails || workspaceDetails.id === "current") return;
    if (!workspaceDeleteConfirm) {
      setWorkspaceDeleteConfirm(true);
      return;
    }
    await onRemoveWorkspace(workspaceDetails.id);
    closeWorkspaceDetails();
  }

  type CommandPaletteItem = {
    id: string;
    group: "chats" | "recommendations";
    label: string;
    meta?: string;
    shortcut?: string;
    description?: string;
    icon: LucideIcon;
    run: () => void | Promise<void>;
  };

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const chatItems = recentThreads.map((thread, index) => ({
      id: `thread:${thread.id}`,
      group: "chats" as const,
      label: thread.title,
      meta: activeWorkspaceName,
      shortcut: index < 9 ? `Ctrl+${index + 1}` : undefined,
      icon: Search,
      run: () => onThreadSelect(thread.id),
    }));

    const recommendationItems: CommandPaletteItem[] = [
      {
        id: "command:new-chat",
        group: "recommendations",
        label: zh ? "新对话" : "New chat",
        shortcut: "Ctrl+N",
        icon: MessageSquarePlus,
        run: onNewChat,
      },
      {
        id: "command:open-folder",
        group: "recommendations",
        label: zh ? "打开文件夹" : "Open folder",
        shortcut: "Ctrl+O",
        icon: FolderCode,
        run: () => {
          if (activeWorkspace?.path) void onOpenWorkspacePath(activeWorkspace.path);
        },
      },
    ];

    return [...chatItems, ...recommendationItems];
  }, [activeWorkspace?.path, activeWorkspaceName, onNavChange, onNewChat, onOpenWorkspacePath, onThreadSelect, recentThreads, zh]);

  const searchableChatItems = useMemo<CommandPaletteItem[]>(() => {
    const shortcutByThread = new Map(
      recentThreads.slice(0, 9).map((thread, index) => [thread.id, `Ctrl+${index + 1}`]),
    );
    return searchableThreads.map((thread) => ({
      id: `thread:${thread.id}`,
      group: "chats" as const,
      label: thread.title,
      meta: thread.timeLabel,
      shortcut: shortcutByThread.get(thread.id),
      icon: Search,
      run: () => onThreadSelect(thread.id),
    }));
  }, [onThreadSelect, recentThreads, searchableThreads]);

  const visibleCommandPaletteItems = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase();
    if (!query) return commandPaletteItems;
    const recommendationMatches = commandPaletteItems.filter((item) =>
      item.group === "recommendations" &&
      [item.label, item.meta, item.shortcut]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(query)),
    );
    const contentMatchByThread = new Map(
      contentSearchResults.map((result) => [`thread:${result.threadId}`, result]),
    );
    const titleMatches = searchableChatItems
      .filter((item) => item.label.toLowerCase().includes(query))
      .map((item) => ({
        ...item,
        description: contentMatchByThread.get(item.id)?.snippet,
      }));
    const titleMatchIds = new Set(titleMatches.map((item) => item.id));
    const contentMatches = searchableChatItems
      .filter((item) => contentMatchByThread.has(item.id) && !titleMatchIds.has(item.id))
      .map((item) => ({
        ...item,
        description: contentMatchByThread.get(item.id)?.snippet,
      }));
    return [...titleMatches, ...contentMatches, ...recommendationMatches];
  }, [commandPaletteItems, commandPaletteQuery, contentSearchResults, searchableChatItems]);

  useEffect(() => {
    setCommandPaletteSelectedIndex((index) =>
      Math.min(index, Math.max(0, visibleCommandPaletteItems.length - 1)),
    );
  }, [visibleCommandPaletteItems.length]);

  function closeCommandPalette(): void {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery("");
    setCommandPaletteSelectedIndex(0);
  }

  function openCommandPalette(): void {
    setCommandPaletteOpen(true);
  }

  function runCommandPaletteItem(item: CommandPaletteItem): void {
    closeCommandPalette();
    void item.run();
  }

  function openThreadMenu(event: React.MouseEvent, thread: WorkspaceThread): void {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 260;
    const menuHeight = thread.fork ? 560 : 306;
    setThreadMenu({
      thread,
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - menuWidth - 12)),
      y: Math.min(event.clientY, Math.max(46, window.innerHeight - menuHeight - 12)),
    });
  }

  function closeThreadMenu(): void {
    setThreadMenu(null);
  }

  function renameThread(thread: WorkspaceThread): void {
    const nextTitle = window.prompt(zh ? "重命名对话" : "Rename conversation", thread.title);
    if (!nextTitle || nextTitle.trim() === thread.title) return;
    void onThreadUpdate(thread.id, { title: nextTitle.trim() });
  }

  function copyText(text: string): void {
    void navigator.clipboard.writeText(text);
  }

  function getThreadWorkspacePath(thread: WorkspaceThread): string {
    return thread.workspacePath || activeWorkspace?.path || "";
  }

  function getThreadDeepLink(thread: WorkspaceThread): string {
    return `opendrsai://thread/${encodeURIComponent(thread.id)}`;
  }

  function getThreadForkSummary(thread: WorkspaceThread): string {
    if (!thread.fork) return "";
    return [
      `Branch: ${thread.fork.branch}`,
      `Base: ${thread.fork.baseRef}`,
      `Source: ${thread.fork.sourceWorkspacePath}`,
      `Worktree: ${thread.fork.worktreePath}`,
      `Lifecycle: ${thread.fork.lifecycleStatus}`,
      thread.fork.queueStatus
        ? `Queue: ${thread.fork.queueStatus}${thread.fork.queueIndex && thread.fork.queueSize ? ` (${thread.fork.queueIndex}/${thread.fork.queueSize})` : ""}`
        : "",
      thread.fork.queueApprovalId ? `Queue approval: ${thread.fork.queueApprovalId}` : "",
      thread.fork.queueAgentName ? `Assigned agent: ${thread.fork.queueAgentName}` : "",
      thread.fork.queueAgentHint ? `Agent hint: ${thread.fork.queueAgentHint}` : "",
      thread.fork.queueMessage ? `Queue detail: ${thread.fork.queueMessage}` : "",
      thread.fork.lifecycleMessage ? `Lifecycle detail: ${thread.fork.lifecycleMessage}` : "",
      thread.fork.mergedCommit ? `Merged commit: ${thread.fork.mergedCommit}` : "",
      thread.fork.branchCleanupStatus ? `Branch cleanup: ${thread.fork.branchCleanupStatus}` : "",
      thread.fork.archivedBranch ? `Archived branch: ${thread.fork.archivedBranch}` : "",
      thread.fork.branchCleanupMessage ? `Branch cleanup detail: ${thread.fork.branchCleanupMessage}` : "",
      thread.fork.sourceHasChanges
        ? `Source changes at fork: ${thread.fork.sourceStatusSummary || "dirty worktree"}`
        : "Source was clean at fork creation.",
    ].filter(Boolean).join("\n");
  }

  function getForkRecoveryKind(
    fork?: DesktopThreadForkMetadata,
  ): "conflict" | "dirty-source" | "dirty-fork" | "pending" | null {
    if (!fork || fork.lifecycleStatus !== "merge_pending") return null;
    const message = (fork.lifecycleMessage || "").toLowerCase();
    if (message.includes("conflict")) return "conflict";
    if (message.includes("source workspace has uncommitted changes")) return "dirty-source";
    if (message.includes("fork worktree has uncommitted changes")) return "dirty-fork";
    return "pending";
  }

  function getForkRecoverySummary(fork: DesktopThreadForkMetadata): string {
    const kind = getForkRecoveryKind(fork);
    if (kind === "conflict") {
      return "Merge-back is blocked by conflicts. Inspect source and fork diffs, resolve the branch, then request merge-back again.";
    }
    if (kind === "dirty-source") {
      return "Merge-back is waiting for the source workspace to be clean. Commit, stash, or discard source changes before retrying.";
    }
    if (kind === "dirty-fork") {
      return "Merge-back is waiting for the fork worktree to be clean. Commit or discard fork changes before retrying.";
    }
    return "Merge-back is pending manual recovery. Review both worktrees and retry after the status is clean.";
  }

  function getForkRecoveryStatusItems(fork: DesktopThreadForkMetadata): Array<{ label: string; value: string }> {
    const messageLines = (fork.lifecycleMessage || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const sourceStatusLine = messageLines.find((line) => line.toLowerCase().startsWith("source status:"));
    return [
      { label: "Recovery type", value: getForkRecoveryKind(fork) || "pending" },
      sourceStatusLine ? { label: "Source status", value: sourceStatusLine.replace(/^source status:\s*/i, "") } : null,
      fork.sourceHasChanges
        ? { label: "At fork creation", value: fork.sourceStatusSummary || "source workspace had changes" }
        : null,
      fork.lifecycleUpdatedAt ? { label: "Last update", value: fork.lifecycleUpdatedAt } : null,
    ].filter((item): item is { label: string; value: string } => Boolean(item));
  }

  function getForkConflictFiles(fork: DesktopThreadForkMetadata): ForkConflictFile[] {
    if (getForkRecoveryKind(fork) !== "conflict") return [];
    const sourceStatus = getForkRecoveryStatusItems(fork)
      .find((item) => item.label === "Source status")
      ?.value ?? "";
    return sourceStatus
      .split(";")
      .map((item) => item.trim())
      .map((item) => {
        const match = item.match(/^([ A-Z?]{1,2})\s+(.+)$/);
        if (!match) return null;
        const status = match[1].trim();
        const path = match[2].trim();
        if (!path || !/[AU]/.test(status)) return null;
        return { path, status };
      })
      .filter((item): item is ForkConflictFile => Boolean(item))
      .slice(0, 8);
  }

  function quotePowerShellPath(path: string): string {
    return `'${path.replace(/'/g, "''")}'`;
  }

  function getForkRecoveryCommandSet(thread: WorkspaceThread): string {
    const fork = thread.fork;
    if (!fork) return "";
    const sourcePath = quotePowerShellPath(fork.sourceWorkspacePath);
    const forkPath = quotePowerShellPath(fork.worktreePath);
    const branch = fork.branch;
    return [
      "# Fork recovery inspection commands",
      `git -C ${sourcePath} status --short`,
      `git -C ${forkPath} status --short`,
      `git -C ${sourcePath} diff --check`,
      `git -C ${forkPath} diff --check`,
      `git -C ${sourcePath} diff --stat HEAD...${branch}`,
      `git -C ${sourcePath} diff HEAD...${branch}`,
      "# After manual resolution and verification, request merge-back again in OpenDrSai.",
      "# Approval Center still gates the merge-back operation.",
    ].join("\n");
  }

  function getForkConflictResolutionPlan(thread: WorkspaceThread): string {
    const fork = thread.fork;
    if (!fork) return "";
    const sourcePath = quotePowerShellPath(fork.sourceWorkspacePath);
    const files = getForkConflictFiles(fork);
    return [
      "# Fork conflict resolution workbench",
      `# Thread: ${thread.title}`,
      `# Branch: ${fork.branch}`,
      `git -C ${sourcePath} status --short`,
      "",
      ...(files.length
        ? files.flatMap((file, index) => [
            `# ${index + 1}. ${file.path} (${file.status})`,
            `git -C ${sourcePath} diff -- ${quotePowerShellPath(file.path)}`,
            `# Choose one side only when that is the intended resolution:`,
            `# git -C ${sourcePath} checkout --ours -- ${quotePowerShellPath(file.path)}`,
            `# git -C ${sourcePath} checkout --theirs -- ${quotePowerShellPath(file.path)}`,
            `git -C ${sourcePath} add -- ${quotePowerShellPath(file.path)}`,
            "",
          ])
        : [
            "# No individual conflict files were parsed from the lifecycle status.",
            "# Open the source workspace, inspect conflict markers, then stage resolved files.",
            "",
          ]),
      "# After every conflict file is staged, run the relevant tests.",
      "# Then request merge-back review again; Approval Center still gates the merge.",
    ].join("\n");
  }

  function getForkConflictPreviewKey(thread: WorkspaceThread, file: ForkConflictFile): string {
    return `${thread.id}:${file.path}`;
  }

  async function loadForkConflictContent(thread: WorkspaceThread, file: ForkConflictFile): Promise<void> {
    const fork = thread.fork;
    if (!fork) return;
    const key = getForkConflictPreviewKey(thread, file);
    setForkConflictPreview({
      key,
      path: file.path,
      status: "loading",
      message: "Loading source, fork, and diff preview.",
    });
    try {
      const result = await onLoadForkConflictContent(thread, file);
      setForkConflictDrafts((current) =>
        current[key] !== undefined
          ? current
          : {
              ...current,
              [key]: result.sourceContent,
            },
      );
      setForkConflictPreview({
        key,
        path: file.path,
        status: "ready",
        message: result.truncated
          ? "Preview loaded with truncation. Open the file before final staging."
          : "Preview loaded. Edit the resolved draft here or open the source file for final changes.",
        baseContent: result.baseContent,
        baseRef: result.baseRef,
        baseMissing: result.baseMissing,
        sourceContent: result.sourceContent,
        forkContent: result.forkContent,
        diff: result.diff,
        diffHash: result.diffHash,
        truncated: result.truncated,
        stageStatus: "idle",
      });
    } catch (error) {
      setForkConflictPreview({
        key,
        path: file.path,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function stageForkConflictFile(thread: WorkspaceThread, file: ForkConflictFile): Promise<void> {
    const fork = thread.fork;
    if (!fork) return;
    const key = getForkConflictPreviewKey(thread, file);
    setForkConflictPreview((current) =>
      current?.key === key
        ? { ...current, stageStatus: "loading", stageMessage: "Refreshing diff before approval." }
        : current,
    );
    try {
      const result = await onStageForkConflictFile(thread, file);
      setForkConflictPreview((current) =>
        current?.key === key
          ? {
              ...current,
              diff: result.diff,
              diffHash: result.diffHash,
              stageStatus: result.approvalQueued ? "queued" : result.staged ? "queued" : "idle",
              stageMessage: result.message,
            }
          : current,
      );
    } catch (error) {
      setForkConflictPreview((current) =>
        current?.key === key
          ? {
              ...current,
              stageStatus: "error",
              stageMessage: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  }

  async function writeForkConflictDraft(thread: WorkspaceThread, file: ForkConflictFile): Promise<void> {
    const fork = thread.fork;
    if (!fork) return;
    const key = getForkConflictPreviewKey(thread, file);
    const draft = forkConflictDrafts[key] ?? "";
    setForkConflictPreview((current) =>
      current?.key === key
        ? { ...current, writeStatus: "loading", writeMessage: "Requesting Approval Center write-back." }
        : current,
    );
    try {
      const result = await onWriteForkConflictDraft(thread, file, draft, forkConflictPreview?.diffHash);
      const nextDiff =
        result.written || !result.approvalQueued
          ? await onLoadForkConflictContent(thread, file)
          : null;
      setForkConflictPreview((current) =>
        current?.key === key
          ? {
              ...current,
              ...(nextDiff
                ? {
                    sourceContent: nextDiff.sourceContent,
                    baseContent: nextDiff.baseContent,
                    baseRef: nextDiff.baseRef,
                    baseMissing: nextDiff.baseMissing,
                    forkContent: nextDiff.forkContent,
                    diff: nextDiff.diff,
                    diffHash: nextDiff.diffHash,
                    truncated: nextDiff.truncated,
                    message: "Resolved draft written. Review the refreshed source diff before staging.",
                  }
                : {}),
              writeStatus: result.approvalQueued ? "queued" : result.written ? "written" : "idle",
              writeMessage: result.message,
            }
          : current,
      );
    } catch (error) {
      setForkConflictPreview((current) =>
        current?.key === key
          ? {
              ...current,
              writeStatus: "error",
              writeMessage: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  }

  function setForkConflictDraft(key: string, draft: string): void {
    setForkConflictDrafts((current) => ({
      ...current,
      [key]: draft,
    }));
  }

  function getForkConflictSemanticPreview(
    thread: WorkspaceThread,
    preview: NonNullable<typeof forkConflictPreview>,
    draft: string,
  ): ForkConflictSemanticPreview | null {
    const fork = thread.fork;
    if (!fork || preview.status !== "ready") return null;
    const sourceContent = preview.sourceContent ?? "";
    const baseContent = preview.baseContent ?? "";
    const forkContent = preview.forkContent ?? "";
    const baseMarkers = getConflictMarkerCount(baseContent);
    const sourceMarkers = getConflictMarkerCount(sourceContent);
    const forkMarkers = getConflictMarkerCount(forkContent);
    const draftMarkers = getConflictMarkerCount(draft);
    const draftHunks = parseForkConflictDraftHunks(draft);
    const sourceLines = getLineCount(sourceContent);
    const baseLines = getLineCount(baseContent);
    const forkLines = getLineCount(forkContent);
    const draftLines = getLineCount(draft);
    const sourceBaseDelta = Math.abs(sourceLines - baseLines);
    const forkBaseDelta = Math.abs(forkLines - baseLines);
    const lineDelta = Math.abs(sourceLines - forkLines);
    const structureDiff = getForkConflictStructureDiff(preview.path, baseContent, sourceContent, forkContent, draft);
    const risk: ForkConflictSemanticPreview["risk"] =
      draftMarkers > 0 || draftHunks.length > 0
        ? "high"
        : structureDiff.hasOverlappingStructuralEdits ||
            lineDelta > 40 ||
            sourceBaseDelta > 80 ||
            forkBaseDelta > 80 ||
            preview.truncated ||
            preview.baseMissing
          ? "medium"
          : "low";
    return {
      baseRef: preview.baseRef || fork.baseRef,
      fileKind: getForkConflictFileKind(preview.path),
      sourceSignal: `${sourceLines} lines, ${sourceMarkers} conflict markers, delta ${sourceBaseDelta} from base`,
      forkSignal: `${forkLines} lines, ${forkMarkers} conflict markers, delta ${forkBaseDelta} from base`,
      draftSignal: `${draftLines} lines, ${draftMarkers} conflict markers`,
      risk,
      reviewItems: [
        preview.baseMissing
          ? `Base reference ${fork.baseRef} has no preview for this file`
          : `True merge-base content preview: ${baseLines} lines, ${baseMarkers} conflict markers`,
        lineDelta > 0
          ? `Source/fork size delta: ${lineDelta} lines`
          : "Source and fork previews have matching line counts",
        `Source/base delta: ${sourceBaseDelta} lines; fork/base delta: ${forkBaseDelta} lines`,
        preview.truncated
          ? "One or more previews are truncated; open the file before final approval"
          : "Previews are within the inline review limit",
        draftMarkers > 0
          ? "Resolved draft still contains conflict markers"
          : "Resolved draft has no visible conflict markers",
      ],
      structureItems: structureDiff.items,
      testGraphMatches: getForkConflictRepoTestGraphSuggestions(preview.path, {
        baseContent,
        sourceContent,
        forkContent,
        draft,
      }),
      testSuggestions: getForkConflictTestSuggestions(preview.path, draftMarkers),
    };
  }

  function applyForkConflictDraftHunk(
    key: string,
    hunk: ForkConflictDraftHunk,
    resolution: "source" | "fork" | "both",
  ): void {
    const currentDraft = forkConflictDrafts[key] ?? "";
    const lines = splitConflictDraftLines(currentDraft);
    const liveHunk = parseForkConflictDraftHunks(currentDraft)
      .find((item) => item.id === hunk.id) ?? hunk;
    const replacement =
      resolution === "source"
        ? liveHunk.sourceText
        : resolution === "fork"
          ? liveHunk.forkText
          : `${liveHunk.sourceText}${liveHunk.forkText}`;
    const nextDraft = [
      ...lines.slice(0, liveHunk.startLine - 1),
      replacement,
      ...lines.slice(liveHunk.endLine),
    ].join("");
    setForkConflictDraft(key, nextDraft);
  }

  function applyAllForkConflictDraftHunks(key: string, resolution: "source" | "fork"): void {
    let nextDraft = forkConflictDrafts[key] ?? "";
    let hunks = parseForkConflictDraftHunks(nextDraft);
    while (hunks.length > 0) {
      const hunk = hunks[0];
      const lines = splitConflictDraftLines(nextDraft);
      const replacement = resolution === "source" ? hunk.sourceText : hunk.forkText;
      nextDraft = [
        ...lines.slice(0, hunk.startLine - 1),
        replacement,
        ...lines.slice(hunk.endLine),
      ].join("");
      hunks = parseForkConflictDraftHunks(nextDraft);
    }
    setForkConflictDraft(key, nextDraft);
  }

  function getForkRecoveryChecklist(thread: WorkspaceThread): string {
    const fork = thread.fork;
    if (!fork) return "";
    const kind = getForkRecoveryKind(fork);
    const recoveryStep =
      kind === "dirty-source"
        ? "Clean the source workspace by committing, stashing, or intentionally discarding local changes."
        : kind === "dirty-fork"
          ? "Clean the fork worktree by committing intended changes or intentionally discarding local edits."
          : kind === "conflict"
            ? "Compare the source workspace and fork branch, resolve merge conflicts manually, and make sure the final source state is intentional."
            : "Inspect source and fork git status, then resolve whichever workspace is blocking merge-back.";
    return [
      "Fork recovery checklist",
      `Thread: ${thread.title}`,
      `Lifecycle: ${fork.lifecycleStatus}`,
      `Branch: ${fork.branch}`,
      `Base: ${fork.baseRef}`,
      `Source workspace: ${fork.sourceWorkspacePath}`,
      `Fork worktree: ${fork.worktreePath}`,
      fork.lifecycleMessage ? `Current status: ${fork.lifecycleMessage}` : "",
      "",
      "1. Open the source workspace and inspect git status.",
      "2. Open the fork worktree and inspect git status or branch diff.",
      `3. ${recoveryStep}`,
      "4. Re-run tests or the relevant verification command in the affected workspace.",
      kind === "conflict"
        ? "5. Use the inline conflict workbench to track each parsed conflict file and stage resolved files through the existing review path."
        : "",
      "6. Return to this thread and request merge-back review again; Approval Center still gates the merge.",
    ].filter(Boolean).join("\n");
  }

  function runThreadMenuAction(action: () => void | Promise<void>): void {
    closeThreadMenu();
    void action();
  }

  function handleCommandPaletteKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCommandPaletteSelectedIndex((index) =>
        visibleCommandPaletteItems.length > 0
          ? (index + 1) % visibleCommandPaletteItems.length
          : 0,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCommandPaletteSelectedIndex((index) =>
        visibleCommandPaletteItems.length > 0
          ? (index - 1 + visibleCommandPaletteItems.length) % visibleCommandPaletteItems.length
          : 0,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = visibleCommandPaletteItems[commandPaletteSelectedIndex];
      if (item) runCommandPaletteItem(item);
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      const shortcut =
        key === "n"
          ? "Ctrl+N"
          : key === "o"
            ? "Ctrl+O"
            : null;
      const item = shortcut
        ? visibleCommandPaletteItems.find((candidate) => candidate.shortcut === shortcut)
        : null;
      if (item) {
        event.preventDefault();
        runCommandPaletteItem(item);
        return;
      }
    }
    if (event.ctrlKey && /^[1-9]$/.test(event.key)) {
      const item = visibleCommandPaletteItems[Number(event.key) - 1];
      if (item) {
        event.preventDefault();
        runCommandPaletteItem(item);
      }
    }
  }

  function renderCommandPaletteResults(): React.JSX.Element {
    if (contentSearchLoading && visibleCommandPaletteItems.length === 0) {
      return <div className="command-palette-empty">{zh ? "正在搜索会话内容..." : "Searching conversation content..."}</div>;
    }
    if (visibleCommandPaletteItems.length === 0) {
      return <div className="command-palette-empty">{zh ? "没有匹配结果" : "No matching results"}</div>;
    }

    return (
      <div className="command-palette-results">
        {(["chats", "recommendations"] as const).map((group) => {
          const groupItems = visibleCommandPaletteItems.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div className="command-palette-group" key={group}>
              <div className="command-palette-group-label">
                {group === "chats" ? (zh ? "聊天" : "Chats") : (zh ? "推荐" : "Recommended")}
              </div>
              {groupItems.map((item) => {
                const itemIndex = visibleCommandPaletteItems.findIndex((candidate) => candidate.id === item.id);
                const selected = itemIndex === commandPaletteSelectedIndex;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    id={`titlebar-search-option-${itemIndex}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`command-palette-item ${selected ? "selected" : ""}`}
                    onClick={() => runCommandPaletteItem(item)}
                    onMouseEnter={() => setCommandPaletteSelectedIndex(itemIndex)}
                  >
                    <span className="command-palette-icon"><Icon size={16} /></span>
                    <span className="command-palette-copy">
                      <span className="command-palette-title">
                        {highlightSearchText(item.label, commandPaletteQuery)}
                      </span>
                      {item.description && (
                        <span className="command-palette-description">
                          {highlightSearchText(item.description, commandPaletteQuery)}
                        </span>
                      )}
                    </span>
                    {item.meta && <span className="command-palette-meta">{item.meta}</span>}
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--right-panel-width": `${rightPanelWidth}px`,
      } as React.CSSProperties}
    >
      <div className="workbench-menubar" role="menubar" aria-label={zh ? "应用菜单" : "Application menu"}>
        <button
          className="titlebar-sidebar-toggle"
          type="button"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? (zh ? "显示侧边栏" : "Show sidebar") : (zh ? "隐藏侧边栏" : "Hide sidebar")}
          aria-label={sidebarCollapsed ? (zh ? "显示侧边栏" : "Show sidebar") : (zh ? "隐藏侧边栏" : "Hide sidebar")}
          aria-pressed={!sidebarCollapsed}
        >
          <span aria-hidden />
        </button>
        <div className="workbench-menu-items">
          {workbenchMenus.map((label) => (
            <button key={label} type="button" role="menuitem">
              {label}
            </button>
          ))}
          <div className="workbench-menu-dropdown" ref={helpMenuRef}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={helpMenuOpen}
              onClick={() => setHelpMenuOpen((open) => !open)}
            >
              {zh ? "帮助" : "Help"}
            </button>
            {helpMenuOpen && (
              <div className="workbench-menu-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setHelpMenuOpen(false);
                    setDesktopStatusOpen(true);
                  }}
                >
                  <HelpCircle size={15} />
                  {zh ? "关于 OpenDrSai" : "About OpenDrSai"}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="titlebar-center">
          <div className="titlebar-navigation" aria-label={zh ? "导航" : "Navigation"}>
          <button
            type="button"
            disabled={!canGoBack}
            onClick={onGoBack}
            title={zh ? "后退 (Ctrl+[)" : "Back (Ctrl+[)"}
            aria-label={zh ? "后退" : "Back"}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={onGoForward}
            title={zh ? "前进 (Ctrl+])" : "Forward (Ctrl+])"}
            aria-label={zh ? "前进" : "Forward"}
          >
            <ArrowRight size={15} />
          </button>
          </div>
          <div className="titlebar-search-shell" ref={commandPaletteRef}>
            <div className={`titlebar-search ${commandPaletteOpen ? "open" : ""}`}>
              <Search size={14} aria-hidden />
              <input
                ref={commandPaletteInputRef}
                value={commandPaletteQuery}
                onFocus={openCommandPalette}
                onChange={(event) => setCommandPaletteQuery(event.target.value)}
                onKeyDown={handleCommandPaletteKeyDown}
                placeholder={zh ? "搜索聊天或运行命令" : "Search chats or run commands"}
                aria-label={zh ? "搜索聊天或运行命令" : "Search chats or run commands"}
                aria-expanded={commandPaletteOpen}
                aria-controls="titlebar-search-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  visibleCommandPaletteItems[commandPaletteSelectedIndex]
                    ? `titlebar-search-option-${commandPaletteSelectedIndex}`
                    : undefined
                }
              />
              {commandPaletteQuery && (
                <button
                  className="titlebar-search-clear"
                  type="button"
                  onClick={() => {
                    setCommandPaletteQuery("");
                    commandPaletteInputRef.current?.focus();
                  }}
                  title={zh ? "清除搜索" : "Clear search"}
                  aria-label={zh ? "清除搜索" : "Clear search"}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {commandPaletteOpen && (
              <section
                id="titlebar-search-results"
                ref={commandPaletteResultsRef}
                className="titlebar-search-results"
                role="listbox"
                aria-label={zh ? "搜索结果" : "Search results"}
              >
                {renderCommandPaletteResults()}
              </section>
            )}
          </div>
        </div>
        <div className="workbench-menu-spacer" />
        <div className="titlebar-account" ref={userMenuRef}>
          <button
            className="titlebar-avatar"
            type="button"
            aria-label={zh ? "用户菜单" : "User menu"}
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((open) => !open)}
            title={user?.name ?? (zh ? "本地用户" : "Local user")}
          >
            <UserAvatar user={user} fallback={userInitials} />
          </button>
          {userMenuOpen && (
            <div className="titlebar-user-menu" role="menu">
              <div className="titlebar-user-card">
                <div className="titlebar-user-avatar">
                  <UserAvatar user={user} fallback={userInitials} />
                </div>
                <div>
                  <strong>{user?.name ?? (zh ? "本地用户" : "Local user")}</strong>
                  <span>{user?.email ?? "OpenDrSai Desktop"}</span>
                </div>
              </div>
              <button type="button" role="menuitem" onClick={() => setUserMenuOpen(false)}>
                <IdCard size={15} />
                {zh ? "个人资料" : "Profile"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  onNavChange(MENU_IDS.profile);
                }}
              >
                <Settings size={15} />
                {zh ? "设置" : "Settings"}
              </button>
              <div className="titlebar-language-row">
                <span>{zh ? "语言" : "Language"}</span>
                <div className="language-segment" role="group" aria-label={zh ? "语言" : "Language"}>
                  <button
                    type="button"
                    className={language === "en" ? "active" : ""}
                    onClick={() => onLanguageChange("en")}
                  >
                    {zh ? "英文" : "EN"}
                  </button>
                  <button
                    type="button"
                    className={language === "zh" ? "active" : ""}
                    onClick={() => onLanguageChange("zh")}
                  >
                    {zh ? "中文" : "ZH"}
                  </button>
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout();
                }}
              >
                <LogOut size={15} />
                {zh ? "退出登录" : "Sign out"}
              </button>
            </div>
          )}
        </div>
        <div className="titlebar-window-divider" aria-hidden />
        <button
          className="titlebar-right-panel-toggle"
          type="button"
          onClick={onToggleRightPanel}
          title={rightPanelCollapsed ? (zh ? "显示右侧栏" : "Show right panel") : (zh ? "隐藏右侧栏" : "Hide right panel")}
          aria-label={rightPanelCollapsed ? (zh ? "显示右侧栏" : "Show right panel") : (zh ? "隐藏右侧栏" : "Hide right panel")}
          aria-pressed={!rightPanelCollapsed}
        >
          <span aria-hidden />
        </button>
      </div>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={drsaiLogo} alt="" />
          </div>
          <div>
            <strong>
              Open<span className="brand-accent">Dr</span>Sai
            </strong>
            <span>{zh ? "桌面端" : "Desktop"}</span>
          </div>
        </div>

        <nav className="sidebar-scroll" aria-label={zh ? "OpenDrSai 侧边栏" : "OpenDrSai sidebar"}>
          <div className="sidebar-action-list">
            <SidebarButton active={activeNav === MENU_IDS.currentSession} icon={MessageSquarePlus} label={zh ? "开始聊天" : "New chat"} onClick={onNewChat} />
            <SidebarButton active={activeNav === MENU_IDS.savedPlan} icon={CalendarClock} label={zh ? "已安排" : "Scheduled"} onClick={() => onNavChange(MENU_IDS.savedPlan)} />
          </div>

          {agentItems.length > 0 && (
            <div className="sidebar-section">
              <div
                className="workspace-section-header"
                role="button"
                tabIndex={0}
                aria-expanded={agentsOpen}
                onClick={() => setAgentsOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setAgentsOpen((open) => !open);
                  }
                }}
              >
                <span className="workspace-section-title">{agentSectionLabel}</span>
                <div className="workspace-section-actions">
                  <button
                    className="workspace-section-toggle"
                    type="button"
                    aria-label={agentsOpen ? (zh ? "收起广场" : "Collapse square") : (zh ? "展开广场" : "Expand square")}
                    aria-expanded={agentsOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      setAgentsOpen((open) => !open);
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
              {agentsOpen && (
                <div className="sidebar-nested-list">
                  {agentItems.map(({ id, label }) => {
                    const Icon = navIcons[id];
                    return (
                      <SidebarButton
                        key={id}
                        active={id === activeNav}
                        icon={Icon}
                        label={label}
                        nested
                        onClick={() => onNavChange(id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {workspaceItems.map(({ id, label }) => {
            const Icon = id === MENU_IDS.library ? Cloud : navIcons[id];
            return (
              <SidebarButton
                key={id}
                active={id === activeNav}
                icon={Icon}
                label={label}
                onClick={() => onNavChange(id)}
              />
            );
          })}

          <div className="sidebar-section">
            <div
              className="workspace-section-header"
              role="button"
              tabIndex={0}
              aria-expanded={workspaceOpen}
              onClick={() => setWorkspaceOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setWorkspaceOpen((open) => !open);
                }
              }}
            >
              <span className="workspace-section-title">{zh ? "工作区" : "Workspace"}</span>
              <div className="workspace-section-actions">
                <button
                  className={`workspace-sort-button ${workspaceSortMode !== "recent" ? "active" : ""}`}
                  type="button"
                  aria-label={getWorkspaceSortButtonLabel(workspaceSortMode, zh)}
                  title={getWorkspaceSortButtonLabel(workspaceSortMode, zh)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onWorkspaceSortModeChange(getNextWorkspaceSortMode(workspaceSortMode));
                  }}
                >
                  <ArrowDownAZ size={15} />
                </button>
                <button
                  className="workspace-create-button"
                  type="button"
                  aria-label={zh ? "新建工作区" : "Create workspace"}
                  title={zh ? "新建工作区" : "Create workspace"}
                  onClick={(event) => {
                    event.stopPropagation();
                    openWorkspaceCreate();
                  }}
                >
                  <FolderPlus size={15} />
                </button>
                <button
                  className="workspace-section-toggle"
                  type="button"
                  aria-label={workspaceOpen ? (zh ? "收起工作区" : "Collapse workspace") : (zh ? "展开工作区" : "Expand workspace")}
                  aria-expanded={workspaceOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setWorkspaceOpen((open) => !open);
                  }}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
            {workspaceOpen && (
              <div className="workspace-list">
                {workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className={`workspace-row ${workspace.id === activeWorkspaceId ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="workspace-item"
                      onClick={() => onWorkspaceChange(workspace.id)}
                      title={[workspace.name, workspace.description, workspace.path].filter(Boolean).join("\n")}
                    >
                      <FolderCode size={15} />
                      <span>
                        <strong>{workspace.name}</strong>
                      </span>
                    </button>
                    <button
                      className="workspace-details-button"
                      type="button"
                      aria-label={zh ? "工作区详情" : "Workspace details"}
                      title={zh ? "工作区详情" : "Workspace details"}
                      onClick={() => openWorkspaceDetails(workspace)}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <div
              className="workspace-section-header workspace-session-header"
              role="button"
              tabIndex={0}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setHistoryOpen((open) => !open);
                }
              }}
            >
              <span className="workspace-section-title workspace-session-title">
                <span>{zh ? "会话" : "Sessions"}</span>
                <small>{sessionScope === "all" ? (zh ? "全部" : "All") : activeWorkspaceName}</small>
              </span>
              <div className="workspace-section-actions">
                <button
                  className={`workspace-session-mode-button ${sessionScope === "all" ? "active" : ""}`}
                  type="button"
                  aria-label={
                    sessionScope === "all"
                      ? zh ? "切换为当前工作区会话" : "Show current workspace sessions"
                      : zh ? "切换为全部会话" : "Show all sessions"
                  }
                  title={
                    sessionScope === "all"
                      ? zh ? "当前显示全部会话，点击切回当前工作区" : "Showing all sessions. Click to show this workspace."
                      : zh ? "当前显示当前工作区会话，点击查看全部" : "Showing this workspace. Click to show all sessions."
                  }
                  aria-pressed={sessionScope === "all"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSessionScope();
                  }}
                >
                  <Rows3 size={14} />
                </button>
                <button
                  className="workspace-section-toggle"
                  type="button"
                  aria-label={historyOpen ? (zh ? "收起会话" : "Collapse sessions") : (zh ? "展开会话" : "Expand sessions")}
                  aria-expanded={historyOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setHistoryOpen((open) => !open);
                  }}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
            {historyOpen && (
              <div className="thread-list">
                {recentThreads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={`thread-item ${thread.active ? "active" : ""}`}
                    onClick={() => onThreadSelect(thread.id)}
                    onContextMenu={(event) => openThreadMenu(event, thread)}
                  >
                    <span>
                      {thread.unread && <b className="thread-unread-dot" aria-hidden />}
                      {thread.pinned && <b className="thread-pinned-mark" aria-hidden>◆</b>}
                      {thread.fork && (
                        <b
                          className={`thread-fork-mark ${thread.fork.queueStatus ? `queue-${thread.fork.queueStatus}` : ""}`}
                          title={[
                            `Fork worktree: ${thread.fork.worktreePath}`,
                            thread.fork.queueStatus ? `Queue: ${thread.fork.queueStatus}` : "",
                          ].filter(Boolean).join("\n")}
                        >
                          {thread.fork.queueStatus === "waiting_approval" ? "Wait" : thread.fork.queueStatus === "ready" ? "Ready" : "Fork"}
                        </b>
                      )}
                      {thread.title}
                    </span>
                    <time>{thread.timeLabel}</time>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

      </aside>
      {!sidebarCollapsed && (
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={zh ? "调整侧边栏宽度" : "Resize sidebar"}
          onPointerDown={startSidebarResize}
        />
      )}

      <main className="workspace">
        <section
          className={`content-grid ${rightPanelCollapsed ? "right-collapsed" : ""} ${
            isRightPanelExpanded ? "right-expanded" : ""
          }`}
        >
          <section className="main-content-area">{mainContent}</section>
          {!rightPanelCollapsed && !isRightPanelExpanded && (
            <div
              className="right-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={zh ? "调整右侧栏宽度" : "Resize right panel"}
              onPointerDown={startRightPanelResize}
            />
          )}

          {!rightPanelCollapsed && (
            <aside className={rightPanelClassName}>
              <div className="right-tabs">
                {rightTabs.map(({ id, label }) => {
                  const Icon = rightTabIcons[id];
                  return (
                    <button
                      key={id}
                      className={id === activeRightTab ? "active" : ""}
                      onClick={() => onRightTabChange(id)}
                      title={label}
                      aria-label={label}
                    >
                      <Icon size={15} />
                      <span>{label}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="right-panel-expand-button"
                  onClick={() => setRightPanelExpanded((expanded) => !expanded)}
                  title={rightPanelExpandLabel}
                  aria-label={rightPanelExpandLabel}
                  aria-pressed={isRightPanelExpanded}
                >
                  {isRightPanelExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
              </div>
              {rightPanel}
            </aside>
          )}
        </section>
      </main>
      {threadMenu && (
        <div className="thread-context-layer" role="presentation" onMouseDown={closeThreadMenu}>
          <div
            className="thread-context-menu"
            role="menu"
            style={{ left: threadMenu.x, top: threadMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                runThreadMenuAction(() =>
                  onThreadUpdate(threadMenu.thread.id, { pinned: !threadMenu.thread.pinned }),
                )
              }
            >
              {threadMenu.thread.pinned ? (zh ? "取消置顶对话" : "Unpin conversation") : (zh ? "置顶对话" : "Pin conversation")}
            </button>
            <button type="button" role="menuitem" onClick={() => runThreadMenuAction(() => renameThread(threadMenu.thread))}>
              {zh ? "重命名对话" : "Rename conversation"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                runThreadMenuAction(() =>
                  onThreadUpdate(threadMenu.thread.id, { archived: !threadMenu.thread.archived }),
                )
              }
            >
              {threadMenu.thread.archived ? (zh ? "取消归档对话" : "Unarchive conversation") : (zh ? "归档对话" : "Archive conversation")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                runThreadMenuAction(() =>
                  onThreadUpdate(threadMenu.thread.id, { unread: !threadMenu.thread.unread }),
                )
              }
            >
              {threadMenu.thread.unread ? (zh ? "标记为已读" : "Mark as read") : (zh ? "标记为未读" : "Mark as unread")}
            </button>
            {threadMenu.thread.fork && (
              <>
                <div className="thread-context-separator" />
                <div className="thread-fork-summary" role="group" aria-label="Fork worktree details">
                  <strong>Fork worktree</strong>
                  <span>{threadMenu.thread.fork.branch}</span>
                  <small>{threadMenu.thread.fork.worktreePath}</small>
                  <small>Lifecycle: {threadMenu.thread.fork.lifecycleStatus}</small>
                  {threadMenu.thread.fork.queueStatus && (
                    <small>
                      Queue: {threadMenu.thread.fork.queueStatus}
                      {threadMenu.thread.fork.queueIndex && threadMenu.thread.fork.queueSize
                        ? ` (${threadMenu.thread.fork.queueIndex}/${threadMenu.thread.fork.queueSize})`
                        : ""}
                    </small>
                  )}
                  {threadMenu.thread.fork.queueMessage && (
                    <small>{threadMenu.thread.fork.queueMessage}</small>
                  )}
                  {(threadMenu.thread.fork.queueAgentName || threadMenu.thread.fork.queueAgentHint) && (
                    <small>
                      Assigned agent: {threadMenu.thread.fork.queueAgentName || threadMenu.thread.fork.queueAgentHint}
                    </small>
                  )}
                  {threadMenu.thread.fork.lifecycleMessage && (
                    <small>{threadMenu.thread.fork.lifecycleMessage}</small>
                  )}
                  {threadMenu.thread.fork.branchCleanupStatus && (
                    <small>Branch cleanup: {threadMenu.thread.fork.branchCleanupStatus}</small>
                  )}
                  {threadMenu.thread.fork.archivedBranch && (
                    <small>Archived branch: {threadMenu.thread.fork.archivedBranch}</small>
                  )}
                  {threadMenu.thread.fork.branchCleanupMessage && (
                    <small>{threadMenu.thread.fork.branchCleanupMessage}</small>
                  )}
                </div>
                {getForkRecoveryKind(threadMenu.thread.fork) && (
                  <>
                    <div className="thread-fork-recovery" role="group" aria-label="Fork recovery actions">
                      <strong>Recovery needed</strong>
                      <span>{getForkRecoverySummary(threadMenu.thread.fork)}</span>
                      <div className="thread-fork-recovery-status" aria-label="Fork recovery status detail">
                        {getForkRecoveryStatusItems(threadMenu.thread.fork).map((item) => (
                          <div key={item.label}>
                            <small>{item.label}</small>
                            <code title={item.value}>{item.value}</code>
                          </div>
                        ))}
                      </div>
                      <small>Copy the diff commands below to inspect conflicts before requesting merge-back again.</small>
                    </div>
                    {getForkConflictFiles(threadMenu.thread.fork).length > 0 && (
                      <div className="thread-fork-conflict-workbench" role="group" aria-label="Inline conflict workbench">
                        <strong>Inline conflict workbench</strong>
                        <ol>
                          {getForkConflictFiles(threadMenu.thread.fork).map((file) => (
                            <li key={`${file.status}:${file.path}`}>
                              <code title={file.path}>{file.path}</code>
                              <span>{file.status} - resolve markers, preview diff, stage when reviewed</span>
                              <div className="thread-fork-conflict-actions">
                                <button
                                  type="button"
                                  onClick={() => void loadForkConflictContent(threadMenu.thread, file)}
                                >
                                  Load content merge editor
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void stageForkConflictFile(threadMenu.thread, file)}
                                >
                                  Stage resolved file
                                </button>
                              </div>
                            </li>
                          ))}
                        </ol>
                        {forkConflictPreview && (
                          <div className={`thread-fork-conflict-preview ${forkConflictPreview.status}`}>
                            <div className="thread-fork-conflict-preview-header">
                              <strong title={forkConflictPreview.path}>{forkConflictPreview.path}</strong>
                              <span>{forkConflictPreview.message}</span>
                            </div>
                            {forkConflictPreview.status === "ready" && (
                              <>
                                <div className="thread-fork-conflict-content-grid">
                                  <section>
                                    <small>Merge base ({forkConflictPreview.baseRef})</small>
                                    <pre>
                                      {forkConflictPreview.baseMissing
                                        ? "Base file is missing at this ref."
                                        : forkConflictPreview.baseContent}
                                    </pre>
                                  </section>
                                  <section>
                                    <small>Source workspace</small>
                                    <pre>{forkConflictPreview.sourceContent}</pre>
                                  </section>
                                  <section>
                                    <small>Fork branch</small>
                                    <pre>{forkConflictPreview.forkContent}</pre>
                                  </section>
                                </div>
                                <section className="thread-fork-conflict-diff">
                                  <small>Source diff before staging</small>
                                  <pre>{forkConflictPreview.diff}</pre>
                                </section>
                                {(() => {
                                  const draft = forkConflictDrafts[forkConflictPreview.key] ?? "";
                                  const semanticPreview = getForkConflictSemanticPreview(
                                    threadMenu.thread,
                                    forkConflictPreview,
                                    draft,
                                  );
                                  if (!semanticPreview) return null;
                                  return (
                                    <section
                                      className={`thread-fork-conflict-semantic risk-${semanticPreview.risk}`}
                                      aria-label="Semantic three-way merge preview"
                                    >
                                      <div className="thread-fork-conflict-semantic-header">
                                        <strong>Semantic three-way merge preview</strong>
                                        <span>
                                          {semanticPreview.fileKind} - risk {semanticPreview.risk}
                                        </span>
                                      </div>
                                      <div className="thread-fork-conflict-semantic-grid">
                                        <div>
                                          <small>Base</small>
                                          <code>{semanticPreview.baseRef}</code>
                                        </div>
                                        <div>
                                          <small>Source</small>
                                          <code>{semanticPreview.sourceSignal}</code>
                                        </div>
                                        <div>
                                          <small>Fork</small>
                                          <code>{semanticPreview.forkSignal}</code>
                                        </div>
                                        <div>
                                          <small>Resolved draft</small>
                                          <code>{semanticPreview.draftSignal}</code>
                                        </div>
                                      </div>
                                      <div className="thread-fork-conflict-review-plan">
                                        <small>Review focus</small>
                                        <ul>
                                          {semanticPreview.reviewItems.map((item) => (
                                            <li key={item}>{item}</li>
                                          ))}
                                        </ul>
                                      </div>
                                      <div className="thread-fork-conflict-structure" aria-label="AST-aware structure diff">
                                        <small>AST-aware structure diff</small>
                                        <ul>
                                          {semanticPreview.structureItems.map((item) => (
                                            <li key={item}>{item}</li>
                                          ))}
                                        </ul>
                                      </div>
                                      <div className="thread-fork-conflict-test-suggestions">
                                        <small>Test suggestions</small>
                                        <ul>
                                          {semanticPreview.testSuggestions.map((item) => (
                                            <li key={item}>{item}</li>
                                          ))}
                                        </ul>
                                      </div>
                                      {semanticPreview.testGraphMatches.length > 0 && (
                                        <div className="thread-fork-conflict-test-graph">
                                          <small>Repo test graph matches</small>
                                          <ul>
                                            {semanticPreview.testGraphMatches.map((item) => (
                                              <li key={item}>{item}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                    </section>
                                  );
                                })()}
                                <label className="thread-fork-conflict-draft">
                                  <small>Manual resolved draft</small>
                                  <textarea
                                    value={forkConflictDrafts[forkConflictPreview.key] ?? ""}
                                    spellCheck={false}
                                    onChange={(event) =>
                                      setForkConflictDraft(forkConflictPreview.key, event.target.value)
                                    }
                                  />
                                </label>
                                <div className="thread-fork-conflict-draft-controls" aria-label="Inline hunk controls">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setForkConflictDraft(
                                        forkConflictPreview.key,
                                        forkConflictPreview.sourceContent ?? "",
                                      )
                                    }
                                  >
                                    Use source version
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setForkConflictDraft(
                                        forkConflictPreview.key,
                                        forkConflictPreview.forkContent ?? "",
                                      )
                                    }
                                  >
                                    Use fork version
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setForkConflictDraft(
                                        forkConflictPreview.key,
                                        forkConflictPreview.sourceContent ?? "",
                                      )
                                    }
                                  >
                                    Reset draft
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => applyAllForkConflictDraftHunks(forkConflictPreview.key, "source")}
                                  >
                                    Apply all source hunks
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => applyAllForkConflictDraftHunks(forkConflictPreview.key, "fork")}
                                  >
                                    Apply all fork hunks
                                  </button>
                                </div>
                                <section className="thread-fork-conflict-hunks" aria-label="Inline conflict hunk application">
                                  <small>Conflict hunk application</small>
                                  {(() => {
                                    const hunks = parseForkConflictDraftHunks(
                                      forkConflictDrafts[forkConflictPreview.key] ?? "",
                                    );
                                    if (hunks.length === 0) {
                                      return (
                                        <p>
                                          No conflict markers detected in the draft. Review the diff, then write the draft for approval.
                                        </p>
                                      );
                                    }
                                    return hunks.map((hunk) => (
                                      <article key={hunk.id} className="thread-fork-conflict-hunk">
                                        <header>
                                          <strong>Conflict hunk {hunk.index}</strong>
                                          <span>
                                            Lines {hunk.startLine}-{hunk.endLine}
                                          </span>
                                        </header>
                                        <div className="thread-fork-conflict-hunk-grid">
                                          <section>
                                            <small>Source side: {hunk.sourceLabel}</small>
                                            <pre>{hunk.sourceText || "(empty side)"}</pre>
                                          </section>
                                          <section>
                                            <small>Fork side: {hunk.forkLabel}</small>
                                            <pre>{hunk.forkText || "(empty side)"}</pre>
                                          </section>
                                        </div>
                                        <div className="thread-fork-conflict-hunk-actions">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              applyForkConflictDraftHunk(forkConflictPreview.key, hunk, "source")
                                            }
                                          >
                                            Apply source side
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              applyForkConflictDraftHunk(forkConflictPreview.key, hunk, "fork")
                                            }
                                          >
                                            Apply fork side
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              applyForkConflictDraftHunk(forkConflictPreview.key, hunk, "both")
                                            }
                                          >
                                            Keep both sides
                                          </button>
                                        </div>
                                        <div className="thread-fork-conflict-hunk-tests">
                                          <small>Hunk-level test suggestions</small>
                                          <ul>
                                            {getForkConflictHunkTestSuggestions(forkConflictPreview.path, hunk).map(
                                              (suggestion) => (
                                                <li key={suggestion}>{suggestion}</li>
                                              ),
                                            )}
                                          </ul>
                                        </div>
                                      </article>
                                    ));
                                  })()}
                                </section>
                                <div className="thread-fork-conflict-preview-actions">
                                  <button
                                    type="button"
                                    onClick={() => copyText(forkConflictDrafts[forkConflictPreview.key] ?? "")}
                                  >
                                    Copy resolved draft
                                  </button>
                                  <button
                                    type="button"
                                    disabled={forkConflictPreview.writeStatus === "loading" || !forkConflictPreview.diffHash}
                                    onClick={() => {
                                      const file = getForkConflictFiles(threadMenu.thread.fork!)
                                        .find((item) => item.path === forkConflictPreview.path);
                                      if (file) void writeForkConflictDraft(threadMenu.thread, file);
                                    }}
                                  >
                                    Write draft for approval
                                  </button>
                                  {forkConflictPreview.writeMessage && <span>{forkConflictPreview.writeMessage}</span>}
                                  {forkConflictPreview.stageMessage && <span>{forkConflictPreview.stageMessage}</span>}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        <small>
                          Manual draft write-back and staging both use the existing Approval Center workspace mutation path.
                        </small>
                      </div>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        runThreadMenuAction(() =>
                          onOpenWorkspacePath(threadMenu.thread.fork?.sourceWorkspacePath || ""),
                        )
                      }
                    >
                      Open source workspace
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        runThreadMenuAction(() =>
                          onOpenWorkspacePath(threadMenu.thread.fork?.worktreePath || ""),
                        )
                      }
                    >
                      Open fork worktree
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runThreadMenuAction(() => copyText(getForkRecoveryChecklist(threadMenu.thread)))}
                    >
                      Copy recovery checklist
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runThreadMenuAction(() => copyText(getForkConflictResolutionPlan(threadMenu.thread)))}
                    >
                      Copy conflict resolution plan
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runThreadMenuAction(() => copyText(getForkRecoveryCommandSet(threadMenu.thread)))}
                    >
                      Copy conflict diff commands
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runThreadMenuAction(() => copyText(getThreadForkSummary(threadMenu.thread)))}
                    >
                      Copy fork status summary
                    </button>
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runThreadMenuAction(() => copyText(getThreadForkSummary(threadMenu.thread)))}
                >
                  Copy fork details
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runThreadMenuAction(() => copyText(threadMenu.thread.fork?.sourceWorkspacePath || ""))}
                >
                  Copy fork source path
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runThreadMenuAction(() => copyText(threadMenu.thread.fork?.branch || ""))}
                >
                  Copy fork branch
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    threadMenu.thread.fork.lifecycleStatus === "closed" ||
                    threadMenu.thread.fork.lifecycleStatus === "merged" ||
                    threadMenu.thread.fork.lifecycleStatus === "cleanup_pending"
                  }
                  onClick={() =>
                    runThreadMenuAction(() =>
                      onRequestForkLifecycle(threadMenu.thread.id, "merge_back"),
                    )
                  }
                >
                  Request merge-back review
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={threadMenu.thread.fork.lifecycleStatus === "closed"}
                  onClick={() =>
                    runThreadMenuAction(() =>
                      onRequestForkLifecycle(threadMenu.thread.id, "discard"),
                    )
                  }
                >
                  Request discard review
                </button>
              </>
            )}
            <div className="thread-context-separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                runThreadMenuAction(() => {
                  const path = getThreadWorkspacePath(threadMenu.thread);
                  if (path) void onOpenWorkspacePath(path);
                })
              }
            >
              {zh ? "在资源管理器中打开" : "Open in File Explorer"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runThreadMenuAction(() => copyText(getThreadWorkspacePath(threadMenu.thread)))}
            >
              {zh ? "复制工作目录" : "Copy working directory"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runThreadMenuAction(() => copyText(threadMenu.thread.id))}
            >
              {zh ? "复制会话 ID" : "Copy conversation ID"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runThreadMenuAction(() => copyText(getThreadDeepLink(threadMenu.thread)))}
            >
              {zh ? "复制深度链接" : "Copy deep link"}
            </button>
          </div>
        </div>
      )}
      {desktopStatusOpen && (
        <div className="desktop-status-overlay" role="presentation" onMouseDown={() => setDesktopStatusOpen(false)}>
          <section
            className="desktop-status-modal"
            role="dialog"
            aria-modal="true"
            aria-label={zh ? "关于 OpenDrSai" : "About OpenDrSai"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="desktop-status-modal-header">
              <h2>{zh ? "关于 OpenDrSai" : "About OpenDrSai"}</h2>
              <button type="button" onClick={() => setDesktopStatusOpen(false)} aria-label={zh ? "关闭" : "Close"}>
                ×
              </button>
            </div>
            <div className="desktop-status-modal-body">{desktopStatusPanel}</div>
          </section>
        </div>
      )}
      {workspaceCreateOpen && (
        <div className="workspace-create-overlay" role="presentation" onMouseDown={() => setWorkspaceCreateOpen(false)}>
          <section
            className="workspace-create-modal"
            role="dialog"
            aria-modal="true"
            aria-label={zh ? "创建工作区" : "Create Workspace"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="workspace-create-header">
              <h2>{zh ? "创建工作区" : "Create Workspace"}</h2>
              <button type="button" onClick={() => setWorkspaceCreateOpen(false)} aria-label={zh ? "关闭" : "Close"}>
                <X size={18} />
              </button>
            </div>
            <div className="workspace-create-content">
              <strong>{zh ? "工作区类型" : "Workspace type"}</strong>
              <div className="workspace-type-grid">
                <WorkspaceTypeButton
                  active={workspaceCreateSource === "existing"}
                  icon={FolderCode}
                  title={zh ? "现有文件夹" : "Existing Folder"}
                  description={zh ? "把已有目录加入工作区列表" : "Add an existing folder to your workspace list"}
                  onClick={() => setWorkspaceCreateSource("existing")}
                />
                <WorkspaceTypeButton
                  active={workspaceCreateSource === "empty"}
                  icon={Monitor}
                  title={zh ? "空白本地项目" : "Empty Local Project"}
                  description={zh ? "在你的电脑上创建一个新文件夹" : "Create a new folder on your computer"}
                  onClick={() => setWorkspaceCreateSource("empty")}
                />
              </div>

              {workspaceCreateSource !== "existing" && (
                <div className="workspace-create-form">
                  <label>
                    <span>{zh ? "工作区名称" : "Workspace name"}</span>
                    <input
                      value={workspaceCreateName}
                      onChange={(event) => setWorkspaceCreateName(event.target.value)}
                      placeholder={workspaceCreateSource === "git" ? "drsai-agent" : (zh ? "我的工作区" : "my-workspace")}
                    />
                  </label>
                  <label>
                    <span>{zh ? "创建位置" : "Create in"}</span>
                    <div className="workspace-create-path-row">
                      <input value={workspaceCreateParent} readOnly placeholder={zh ? "选择父文件夹" : "Choose a parent folder"} />
                      <button type="button" onClick={chooseWorkspaceParent}>
                        {zh ? "选择" : "Choose"}
                      </button>
                    </div>
                  </label>
                </div>
              )}
              {workspaceCreateError && <div className="workspace-create-error">{workspaceCreateError}</div>}
            </div>
            <div className="workspace-create-actions">
              <button type="button" onClick={workspaceCreateSource === "existing" ? handleCreateLocalWorkspace : chooseWorkspaceParent}>
                {zh ? "使用现有文件夹" : "Use existing folder"}
              </button>
              <button type="button" onClick={submitWorkspaceCreate}>
                {zh ? "创建" : "Create"}
              </button>
            </div>
          </section>
        </div>
      )}
      {workspaceDetails && (
        <div className="workspace-details-overlay" role="presentation" onMouseDown={closeWorkspaceDetails}>
          <section
            className="workspace-details-modal"
            role="dialog"
            aria-modal="true"
            aria-label={zh ? "工作区详情" : "Workspace Details"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="workspace-details-header">
              <div>
                <span>{zh ? "工作区" : "Workspace"}</span>
                <h2>{workspaceDetails.name}</h2>
              </div>
              <button type="button" onClick={closeWorkspaceDetails} aria-label={zh ? "关闭" : "Close"}>
                <X size={18} />
              </button>
            </div>

            <div className="workspace-details-body">
              <label>
                <span>{zh ? "名称" : "Name"}</span>
                <input
                  value={workspaceNameDraft}
                  disabled={workspaceDetails.id === "current"}
                  onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                />
              </label>
              <label>
                <span>{zh ? "描述" : "Description"}</span>
                <input
                  value={workspaceDescriptionDraft}
                  disabled={workspaceDetails.id === "current"}
                  onChange={(event) => setWorkspaceDescriptionDraft(event.target.value)}
                  placeholder={zh ? "给这个工作区加一句说明" : "Add a short note for this workspace"}
                />
              </label>

              <div className="workspace-path-box">
                <span>{zh ? "路径" : "Path"}</span>
                <code>{workspaceDetails.path}</code>
              </div>

              <dl className="workspace-status-grid">
                <div>
                  <dt>{zh ? "信任" : "Trusted"}</dt>
                  <dd>{workspaceDetails.trusted ? (zh ? "已信任" : "Trusted") : (zh ? "未信任" : "Untrusted")}</dd>
                </div>
                <div>
                  <dt>{zh ? "置顶" : "Pinned"}</dt>
                  <dd>{workspaceDetails.pinned ? (zh ? "是" : "Yes") : (zh ? "否" : "No")}</dd>
                </div>
                <div>
                  <dt>Git</dt>
                  <dd>
                    {workspaceDetails.git?.branch
                      ? `${workspaceDetails.git.branch}${workspaceDetails.git.hasChanges ? (zh ? "，有改动" : ", changed") : ""}`
                      : zh ? "未检测到仓库" : "No repo detected"}
                  </dd>
                </div>
                <div>
                  <dt>{zh ? "项目指令" : "Instructions"}</dt>
                  <dd>{workspaceDetails.hasAgentInstructions ? "AGENTS.md / DRSAI.md" : (zh ? "未找到" : "Not found")}</dd>
                </div>
              </dl>

              {workspaceDetails.instructions?.length ? (
                <div className="workspace-instructions-preview">
                  <strong>{zh ? "已加载的项目指令" : "Loaded Project Instructions"}</strong>
                  {workspaceDetails.instructions.map((instruction) => (
                    <article key={instruction.path}>
                      <span>{instruction.name}{instruction.truncated ? (zh ? "（已截断）" : " (truncated)") : ""}</span>
                      <pre>{instruction.content}</pre>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="workspace-details-actions">
              <button type="button" onClick={() => onOpenWorkspacePath(workspaceDetails.path)}>
                {zh ? "打开文件夹" : "Open Folder"}
              </button>
              <button type="button" onClick={() => onRefreshWorkspaces()}>
                <RefreshCw size={14} />
                {zh ? "刷新状态" : "Refresh"}
              </button>
              {workspaceDetails.id !== "current" && (
                <>
                  <button type="button" onClick={toggleWorkspaceTrusted}>
                    {workspaceDetails.trusted ? (zh ? "取消信任" : "Untrust") : (zh ? "信任" : "Trust")}
                  </button>
                  <button type="button" onClick={toggleWorkspacePinned}>
                    {workspaceDetails.pinned ? (zh ? "取消置顶" : "Unpin") : (zh ? "置顶" : "Pin")}
                  </button>
                  <button type="button" onClick={saveWorkspaceDetails}>
                    {zh ? "保存" : "Save"}
                  </button>
                  <button className="danger" type="button" onClick={confirmWorkspaceRemoval}>
                    <Trash2 size={14} />
                    {workspaceDeleteConfirm ? (zh ? "确认移除" : "Confirm Remove") : (zh ? "移除" : "Remove")}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SidebarButton({
  active,
  icon: Icon,
  label,
  nested,
  onClick,
}: {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  nested?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`sidebar-button ${nested ? "nested" : ""} ${active ? "active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}

function WorkspaceTypeButton({
  active,
  description,
  icon: Icon,
  onClick,
  title,
}: {
  active: boolean;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
  title: string;
}): React.JSX.Element {
  return (
    <button className={`workspace-type-card ${active ? "active" : ""}`} type="button" onClick={onClick}>
      <Icon size={20} />
      <span className="workspace-type-check" aria-hidden />
      <span>
        <b>{title}</b>
        <small>{description}</small>
      </span>
    </button>
  );
}

function getNextWorkspaceSortMode(
  mode: "recent" | "name" | "created",
): "recent" | "name" | "created" {
  if (mode === "recent") return "name";
  if (mode === "name") return "created";
  return "recent";
}

function getWorkspaceSortButtonLabel(
  mode: "recent" | "name" | "created",
  zh: boolean,
): string {
  if (mode === "recent") {
    return zh ? "工作区按最近打开排序，点击切换为按名称排序" : "Workspaces sorted by recent use. Click to sort by name.";
  }
  if (mode === "name") {
    return zh ? "工作区按名称排序，点击切换为按创建时间排序" : "Workspaces sorted by name. Click to sort by created time.";
  }
  return zh ? "工作区按创建时间排序，点击切换为按最近打开排序" : "Workspaces sorted by created time. Click to sort by recent use.";
}

function getEnabledNavItems(navSections: NavSection[], sectionId: NavSection["id"]): NavSection["items"] {
  return navSections.filter((section) => section.id === sectionId)[0]?.items.filter((item) => item.enabled) ?? [];
}

function highlightSearchText(text: string, rawQuery: string): React.ReactNode {
  const query = rawQuery.trim();
  if (!query) return text;
  const matchIndex = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (matchIndex < 0) return text;
  return (
    <>
      {text.slice(0, matchIndex)}
      <mark>{text.slice(matchIndex, matchIndex + query.length)}</mark>
      {text.slice(matchIndex + query.length)}
    </>
  );
}

function UserAvatar({ user, fallback }: { user: AuthUser | null; fallback: string }) {
  const [failed, setFailed] = useState(false);
  const avatarUrl = user?.avatarUrl?.trim() || "";
  const showImage = Boolean(avatarUrl) && !failed && !isDefaultAvatarUrl(avatarUrl);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  if (showImage) {
    return <img src={avatarUrl} alt="" onError={() => setFailed(true)} />;
  }

  return <span>{fallback}</span>;
}

function isDefaultAvatarUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "/user.png" || normalized.endsWith("/user.png")) return true;
  if (normalized.includes("default") && normalized.includes("avatar")) return true;
  if (normalized.includes("placeholder") && normalized.includes("avatar")) return true;
  return false;
}

function getUserInitials(user: AuthUser | null, zh: boolean): string {
  const source = user?.name?.trim() || user?.email?.trim() || (zh ? "本地用户" : "Local user");
  const emailName = source.includes("@") ? source.split("@")[0] : source;
  const parts = emailName
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = Array.from((parts.join("") || emailName).trim()).slice(0, 2).join("");
  return (initials || "?").toLocaleUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function startResize(onMove: (clientX: number) => void): void {
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";

  function handlePointerMove(event: PointerEvent): void {
    onMove(event.clientX);
  }

  function handlePointerUp(): void {
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp, { once: true });
}
