import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Cloud,
  FolderCode,
  FolderPlus,
  Grid2X2,
  History,
  IdCard,
  LogOut,
  MessageSquarePlus,
  Plug,
  Search,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthUser } from "@shared/desktopApi";
import drsaiLogo from "../assets/drsai-transparent.png";
import { MENU_IDS, type AppLanguage, type NavId, type NavSection, type RightTab } from "../navigation";

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  description?: string;
}

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
  canGoBack: boolean;
  canGoForward: boolean;
  language: AppLanguage;
  main: React.ReactNode;
  navIcons: Record<NavId, LucideIcon>;
  navSections: NavSection[];
  recentThreads: WorkspaceThread[];
  releaseUrl: string;
  rightPanel: React.ReactNode;
  rightPanelCollapsed: boolean;
  rightTabIcons: Record<RightTab, LucideIcon>;
  rightTabs: Array<{ id: RightTab; label: string }>;
  sidebarCollapsed: boolean;
  user: AuthUser | null;
  workspaces: WorkspaceProject[];
  onGoBack: () => void;
  onGoForward: () => void;
  onAddWorkspace: () => void;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onNavChange: (id: NavId) => void;
  onNewChat: () => void;
  onOpenExternal: (url: string) => void;
  onRightTabChange: (id: RightTab) => void;
  onSearch: () => void;
  onThreadSelect: (threadId: string) => void;
  onToggleRightPanel: () => void;
  onToggleSidebar: () => void;
  onWorkspaceChange: (workspaceId: string) => void;
}

export function WorkspaceShell({
  activeNav,
  activeRightTab,
  activeWorkspaceId,
  canGoBack,
  canGoForward,
  language,
  main,
  navIcons,
  navSections,
  recentThreads,
  releaseUrl,
  rightPanel,
  rightPanelCollapsed,
  rightTabIcons,
  rightTabs,
  sidebarCollapsed,
  user,
  workspaces,
  onGoBack,
  onGoForward,
  onAddWorkspace,
  onLanguageChange,
  onLogout,
  onNavChange,
  onNewChat,
  onOpenExternal,
  onRightTabChange,
  onSearch,
  onThreadSelect,
  onToggleRightPanel,
  onToggleSidebar,
  onWorkspaceChange,
}: WorkspaceShellProps): React.JSX.Element {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [rightPanelWidth, setRightPanelWidth] = useState(340);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const zh = language === "zh";
  const userInitials = getUserInitials(user, zh);
  const workbenchMenus = zh ? ["文件", "编辑", "视图", "帮助"] : ["File", "Edit", "View", "Help"];
  const agentItems = getEnabledNavItems(navSections, "agents");
  const agentSectionLabel = navSections.find((section) => section.id === "agents")?.label ?? (zh ? "广场" : "Square");
  const workspaceItems = getEnabledNavItems(navSections, "workspace");
  const settingsItems = getEnabledNavItems(navSections, "settings");

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
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
      setRightPanelWidth(clamp(nextWidth, 280, 560));
    });
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
              <button
                className="sidebar-section-toggle"
                type="button"
                aria-expanded={agentsOpen}
                onClick={() => setAgentsOpen((open) => !open)}
              >
                <span>
                  <Grid2X2 size={16} />
                  {agentSectionLabel}
                </span>
                <ChevronDown size={15} />
              </button>
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
            <div className="sidebar-section-label">{zh ? "Workspaces" : "Projects"}</div>
            <div className="workspace-list">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className={`workspace-item ${workspace.id === activeWorkspaceId ? "active" : ""}`}
                  onClick={() => onWorkspaceChange(workspace.id)}
                  title={workspace.path}
                >
                  <FolderCode size={15} />
                  <span>
                    <strong>{workspace.name}</strong>
                    {workspace.description && <small>{workspace.description}</small>}
                  </span>
                </button>
              ))}
              <button className="workspace-add" type="button" onClick={onAddWorkspace}>
                <FolderPlus size={15} />
                <span>{zh ? "添加 Workspace" : "Add project"}</span>
              </button>
            </div>
          </div>

          <div className="sidebar-section">
            <button
              className="sidebar-section-toggle"
              type="button"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <span>
                <History size={16} />
                {zh ? "历史会话" : "History"}
              </span>
              <ChevronDown size={15} />
            </button>
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
          <button
            className="installer-link"
            aria-label={zh ? "发布渠道" : "Release channel"}
            title={zh ? "发布渠道" : "Release channel"}
            onClick={() => onOpenExternal(releaseUrl)}
          >
            <Plug size={16} />
            {zh ? "发布渠道" : "Release channel"}
          </button>
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
