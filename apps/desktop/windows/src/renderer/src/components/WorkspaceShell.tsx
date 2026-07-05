import { useEffect, useRef, useState } from "react";
import {
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
  MessageSquarePlus,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthUser, CreateWorkspaceRequest, WorkspaceProject } from "@shared/desktopApi";
import drsaiLogo from "../assets/drsai-transparent.png";
import { MENU_IDS, type AppLanguage, type NavId, type NavSection, type RightTab } from "../navigation";

export interface WorkspaceThread {
  id: string;
  title: string;
  timeLabel: string;
  workspaceId: string;
  active?: boolean;
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
  main: React.ReactNode;
  navIcons: Record<NavId, LucideIcon>;
  navSections: NavSection[];
  recentThreads: WorkspaceThread[];
  rightPanel: React.ReactNode;
  rightPanelCollapsed: boolean;
  rightTabIcons: Record<RightTab, LucideIcon>;
  rightTabs: Array<{ id: RightTab; label: string }>;
  sessionScope: "workspace" | "all";
  sidebarCollapsed: boolean;
  user: AuthUser | null;
  workspaces: WorkspaceProject[];
  onGoBack: () => void;
  onGoForward: () => void;
  onAddWorkspace: () => void | Promise<void>;
  onCreateWorkspace: (request: CreateWorkspaceRequest) => void | Promise<void>;
  onPickWorkspaceFolder: () => Promise<string | null>;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onNavChange: (id: NavId) => void;
  onNewChat: () => void;
  onOpenWorkspacePath: (path: string) => void | Promise<void>;
  onRefreshWorkspaces: () => void | Promise<void>;
  onRemoveWorkspace: (id: string) => void | Promise<void>;
  onRightTabChange: (id: RightTab) => void;
  onSearch: () => void;
  onThreadSelect: (threadId: string) => void;
  onToggleSessionScope: () => void;
  onToggleRightPanel: () => void;
  onToggleSidebar: () => void;
  onUpdateWorkspace: (id: string, updates: Partial<Pick<WorkspaceProject, "name" | "description" | "trusted" | "pinned">>) => void | Promise<void>;
  onWorkspaceChange: (workspaceId: string) => void;
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
  main,
  navIcons,
  navSections,
  recentThreads,
  rightPanel,
  rightPanelCollapsed,
  rightTabIcons,
  rightTabs,
  sessionScope,
  sidebarCollapsed,
  user,
  workspaces,
  onGoBack,
  onGoForward,
  onAddWorkspace,
  onCreateWorkspace,
  onPickWorkspaceFolder,
  onLanguageChange,
  onLogout,
  onNavChange,
  onNewChat,
  onOpenWorkspacePath,
  onRefreshWorkspaces,
  onRemoveWorkspace,
  onRightTabChange,
  onSearch,
  onThreadSelect,
  onToggleSessionScope,
  onToggleRightPanel,
  onToggleSidebar,
  onUpdateWorkspace,
  onWorkspaceChange,
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
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const helpMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const zh = language === "zh";
  const userInitials = getUserInitials(user, zh);
  const workbenchMenus = zh ? ["文件", "编辑", "视图"] : ["File", "Edit", "View"];
  const agentItems = getEnabledNavItems(navSections, "agents");
  const agentSectionLabel = navSections.find((section) => section.id === "agents")?.label ?? (zh ? "广场" : "Square");
  const workspaceItems = getEnabledNavItems(navSections, "workspace");
  const settingsItems = getEnabledNavItems(navSections, "settings");
  const workspaceDetails = workspaces.find((workspace) => workspace.id === workspaceDetailsId) ?? null;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (!helpMenuRef.current?.contains(event.target as Node)) {
        setHelpMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setDesktopStatusOpen(false);
        setHelpMenuOpen(false);
        closeWorkspaceDetails();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{userInitials}</span>}
          </button>
          {userMenuOpen && (
            <div className="titlebar-user-menu" role="menu">
              <div className="titlebar-user-card">
                <div className="titlebar-user-avatar">
                  {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{userInitials}</span>}
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
            <SidebarButton icon={Search} label={zh ? "搜索" : "Search"} onClick={onSearch} />
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
                      title={workspace.path}
                    >
                      <FolderCode size={15} />
                      <span>
                        <strong>{workspace.name}</strong>
                        {workspace.description && <small>{workspace.description}</small>}
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
                  >
                    <span>{thread.title}</span>
                    <time>{thread.timeLabel}</time>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        <nav className="nav-list nav-list-bottom" aria-label={zh ? "OpenDrSai 设置导航" : "OpenDrSai settings navigation"}>
          {settingsItems.map(({ id, label }) => {
            const Icon = navIcons[id];
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
        <section className={`content-grid ${rightPanelCollapsed ? "right-collapsed" : ""}`}>
          <section className="conversation-panel">{main}</section>
          {!rightPanelCollapsed && (
            <div
              className="right-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={zh ? "调整右侧栏宽度" : "Resize right panel"}
              onPointerDown={startRightPanelResize}
            />
          )}

          {!rightPanelCollapsed && (
            <aside className="right-panel">
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
              </div>
              {rightPanel}
            </aside>
          )}
        </section>
      </main>
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

function getEnabledNavItems(navSections: NavSection[], sectionId: NavSection["id"]): NavSection["items"] {
  return navSections.filter((section) => section.id === sectionId)[0]?.items.filter((item) => item.enabled) ?? [];
}

function getUserInitials(user: AuthUser | null, zh: boolean): string {
  const source = user?.name?.trim() || user?.email?.trim() || (zh ? "本地用户" : "Local user");
  const emailName = source.includes("@") ? source.split("@")[0] : source;
  const parts = emailName
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : emailName.slice(0, 2);
  return initials.toUpperCase();
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
