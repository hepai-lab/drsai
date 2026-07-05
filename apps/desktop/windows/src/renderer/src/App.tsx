import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bot,
  FileText,
  History,
  Library,
  Lightbulb,
  MessageSquare,
  PanelRight,
  Plug,
  Settings,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthUser, DesktopHealth, DesktopThread, InstallProgress } from "@shared/desktopApi";
import { desktopApi } from "./desktopApi";
import { AuthSplash, LoginScreen } from "./auth/LoginScreen";
import { useAuth } from "./auth/AuthProvider";
import { AgentRunWorkspace } from "./components/AgentRunWorkspace";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { WorkspaceShell, type WorkspaceProject, type WorkspaceThread } from "./components/WorkspaceShell";
import { type ChatThreadSnapshot, useDesktopChatAdapter } from "./adapters/useDesktopChatAdapter";
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
  profile: Settings,
  usage_analytics: History,
  channels: Plug,
  logs: FileText,
  agent_management: Bot,
  user_management: Settings,
};

const rightTabIcons: Record<RightTab, LucideIcon> = {
  files: FileText,
  overview: PanelRight,
  history: History,
  templates: Sparkles,
};

const WORKSPACE_STORAGE_KEY = "opendrsai.workspaces";
const THREAD_SNAPSHOT_STORAGE_KEY = "opendrsai.threadSnapshots";

function App(): React.JSX.Element {
  const auth = useAuth();

  if (auth.loading) return <AuthSplash />;
  if (!auth.session.authenticated) return <LoginScreen />;

  return <AuthenticatedApp user={auth.session.user} onLogout={() => auth.logout(false)} />;
}

function AuthenticatedApp({
  user,
  onLogout,
}: {
  user: AuthUser | null;
  onLogout: () => Promise<void>;
}): React.JSX.Element {
  const [language, setLanguage] = useState<AppLanguage>("zh");
  const [activeNav, setActiveNav] = useState<NavId>(MENU_IDS.currentSession);
  const [navHistory, setNavHistory] = useState<NavId[]>([MENU_IDS.currentSession]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(0);
  const [activeRightTab, setActiveRightTab] = useState<RightTab>("overview");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("current");
  const [storedWorkspaces, setStoredWorkspaces] = useState<WorkspaceProject[]>(() => loadStoredWorkspaces());
  const [threads, setThreads] = useState<DesktopThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState(() => createLocalThreadId());
  const [threadSnapshots, setThreadSnapshots] = useState<Record<string, ChatThreadSnapshot>>(() =>
    loadThreadSnapshots(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [chatSearchRequestNonce, setChatSearchRequestNonce] = useState(0);
  const desktop = useDesktopHealthAdapter(language);
  const navSections = getNavSections(language);
  const navItems = getNavItems(language);
  const rightTabs = getRightTabs(language);
  const title =
    navItems.find((item) => item.id === activeNav)?.label ??
    (language === "zh" ? "当前会话" : "Chat");
  const { health } = desktop;
  const workspacePath = health?.install.repoPath || health?.install.home || "";
  const currentWorkspace: WorkspaceProject = {
    id: "current",
    name: getWorkspaceName(workspacePath) || "drsai",
    path: workspacePath || "Local workspace",
    description: language === "zh" ? "当前项目" : "Current project",
  };
  const workspaces: WorkspaceProject[] = [
    currentWorkspace,
    ...storedWorkspaces.filter((workspace) => workspace.path !== currentWorkspace.path),
  ];
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? currentWorkspace;
  const recentThreads: WorkspaceThread[] = threads
    .filter((thread) => !thread.workspacePath || thread.workspacePath === activeWorkspace.path)
    .slice(0, 12)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      timeLabel: formatThreadTime(thread.updatedAt, language),
      workspaceId: getWorkspaceId(thread.workspacePath || activeWorkspace.path),
      active: thread.id === activeThreadId,
    }));
  const chat = useDesktopChatAdapter({
    canChat: Boolean(health?.installed && health?.gatewayReady),
    onChatComplete: desktop.refreshHealth,
    onThreadUpdated: handleThreadUpdated,
    language,
    threadId: activeThreadId,
    threadSnapshot: threadSnapshots[activeThreadId] ?? null,
    workspacePath: activeWorkspace.path,
  });
  const canChat = Boolean(health?.installed && health?.gatewayReady && !chat.activeRequestId);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(storedWorkspaces));
  }, [storedWorkspaces]);

  useEffect(() => {
    window.localStorage.setItem(THREAD_SNAPSHOT_STORAGE_KEY, JSON.stringify(threadSnapshots));
  }, [threadSnapshots]);

  useEffect(() => {
    void refreshThreads();
  }, []);

  async function handleSaveApiKey(event: FormEvent): Promise<void> {
    event.preventDefault();
    await desktop.saveApiKey();
  }

  const navigateTo = useCallback((id: NavId): void => {
    setActiveNav((current) => {
      if (current === id) return current;
      setNavHistory((history) => {
        const next = [...history.slice(0, navHistoryIndex + 1), id];
        setNavHistoryIndex(next.length - 1);
        return next;
      });
      return id;
    });
  }, [navHistoryIndex]);

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
    const workspace: WorkspaceProject = {
      id: getWorkspaceId(path),
      name: getWorkspaceName(path) || path,
      path,
      description: language === "zh" ? "本地 Workspace" : "Local project",
    };
    setStoredWorkspaces((current) => {
      const withoutDuplicate = current.filter((item) => item.path !== path);
      return [...withoutDuplicate, workspace];
    });
    setActiveWorkspaceId(workspace.id);
    navigateTo(MENU_IDS.currentSession);
  }

  function handleWorkspaceChange(workspaceId: string): void {
    setActiveWorkspaceId(workspaceId);
    navigateTo(MENU_IDS.currentSession);
  }

  async function handleNewChat(): Promise<void> {
    const thread = await desktopApi.createThread({
      kind: "chat",
      title: language === "zh" ? "新会话" : "New chat",
      workspacePath: activeWorkspace.path,
    });
    setActiveThreadId(thread.id);
    setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
    navigateTo(MENU_IDS.currentSession);
  }

  function handleThreadSelect(threadId: string): void {
    setActiveThreadId(threadId);
    navigateTo(MENU_IDS.currentSession);
  }

  async function handleThreadUpdated(snapshot: ChatThreadSnapshot): Promise<void> {
    setThreadSnapshots((current) => ({ ...current, [snapshot.threadId]: snapshot }));
    const thread = await desktopApi.updateThread({
      id: snapshot.threadId,
      kind: "chat",
      title: snapshot.title,
      workspacePath: activeWorkspace.path,
      status: snapshot.messages.some((message) => message.streaming) ? "running" : "idle",
      messageCount: snapshot.messageCount,
    });
    setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
  }

  async function refreshThreads(): Promise<void> {
    setThreads(await desktopApi.listThreads());
  }

  const handleSearch = useCallback((): void => {
    navigateTo(MENU_IDS.currentSession);
    setChatSearchRequestNonce((current) => current + 1);
  }, [navigateTo]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
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
      <ChatWorkspace
        activeRequestId={chat.activeRequestId}
        canChat={canChat}
        health={health}
        input={chat.input}
        language={language}
        messages={chat.messages}
        searchRequestNonce={chatSearchRequestNonce}
        onAbort={chat.abort}
        onInputChange={chat.setInput}
        onOpenExternal={(url) => desktopApi.openExternal(url)}
        onSubmit={chat.submit}
      />
    ) : activeNav === MENU_IDS.agentSquare ? (
      <AgentRunWorkspace
        health={health}
        language={language}
        threadId={activeThreadId}
        workspacePath={activeWorkspace.path}
      />
    ) : activeNav === MENU_IDS.profile ? (
      <SettingsPanel
        apiKeyInput={desktop.apiKeyInput}
        busy={desktop.busy}
        health={health}
        language={language}
        message={desktop.settingsMessage}
        onApiKeyChange={desktop.setApiKeyInput}
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

  const rightPanelContent =
    activeRightTab === "overview" ? (
      <OverviewPanel
        actionMessage={desktop.actionMessage}
        busy={desktop.busy}
        health={health}
        installProgress={desktop.installProgress}
        language={language}
        onCancelInstall={desktop.cancelInstall}
        onCheckUpdates={desktop.checkUpdates}
        onDownloadUpdate={desktop.downloadUpdate}
        onInstall={() => desktop.startInstall(false)}
        onInstallUpdate={desktop.installUpdate}
        onInstallWithPrerequisites={() => desktop.startInstall(true)}
        onOpenPath={(path) => desktopApi.openPath(path)}
        onOpenSettings={() => navigateTo(MENU_IDS.profile)}
        onRefresh={desktop.refreshHealth}
        onStartGateway={desktop.startGateway}
        onStopGateway={desktop.stopGateway}
      />
    ) : (
      <SidePlaceholder language={language} tab={activeRightTab} />
    );

  return (
    <WorkspaceShell
      activeNav={activeNav}
      activeRightTab={activeRightTab}
      activeWorkspaceId={activeWorkspaceId}
      canGoBack={navHistoryIndex > 0}
      canGoForward={navHistoryIndex < navHistory.length - 1}
      language={language}
      main={mainContent}
      navIcons={navIcons}
      navSections={navSections}
      recentThreads={recentThreads}
      releaseUrl="https://github.com/hepai-lab/drsai"
      rightPanel={rightPanelContent}
      rightPanelCollapsed={rightPanelCollapsed}
      rightTabIcons={rightTabIcons}
      rightTabs={rightTabs}
      sidebarCollapsed={sidebarCollapsed}
      user={user}
      workspaces={workspaces}
      onGoBack={goBack}
      onGoForward={goForward}
      onAddWorkspace={handleAddWorkspace}
      onLanguageChange={setLanguage}
      onLogout={async () => {
        await chat.abort();
        await onLogout();
      }}
      onNavChange={navigateTo}
      onNewChat={() => {
        void handleNewChat();
      }}
      onOpenExternal={(url) => desktopApi.openExternal(url)}
      onRightTabChange={setActiveRightTab}
      onSearch={handleSearch}
      onThreadSelect={handleThreadSelect}
      onToggleRightPanel={() => setRightPanelCollapsed((current) => !current)}
      onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      onWorkspaceChange={handleWorkspaceChange}
    />
  );
}

function loadStoredWorkspaces(): WorkspaceProject[] {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkspaceProject[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((workspace) => workspace.id && workspace.name && workspace.path);
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

function getWorkspaceName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

function OverviewPanel({
  actionMessage,
  busy,
  health,
  installProgress,
  language,
  onCancelInstall,
  onCheckUpdates,
  onDownloadUpdate,
  onInstall,
  onInstallUpdate,
  onInstallWithPrerequisites,
  onOpenPath,
  onOpenSettings,
  onRefresh,
  onStartGateway,
  onStopGateway,
}: {
  actionMessage: string | null;
  busy: boolean;
  health: DesktopHealth | null;
  installProgress: InstallProgress | null;
  language: AppLanguage;
  onCancelInstall: () => void;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstall: () => void;
  onInstallUpdate: () => void;
  onInstallWithPrerequisites: () => void;
  onOpenPath: (path: string) => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onStartGateway: () => void;
  onStopGateway: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <>
      <div className="panel-title">
        <h2>{zh ? "桌面端状态" : "Desktop Status"}</h2>
        <button onClick={onRefresh}>{zh ? "刷新" : "Refresh"}</button>
      </div>
      <dl>
        <div>
          <dt>{zh ? "安装" : "Install"}</dt>
          <dd>
            {health?.install.backendNeedsRepair
              ? zh ? "需要修复" : "Repair required"
              : health?.install.installed
                ? zh ? "已安装" : "Installed"
                : zh ? "未安装" : "Missing"}
          </dd>
        </div>
        <div>
          <dt>{zh ? "网关" : "Gateway"}</dt>
          <dd>
            {health?.gateway.externalConflict
              ? zh ? "端口冲突" : "Port conflict"
              : health?.gateway.ready
                ? zh ? "就绪" : "Ready"
                : zh ? "已停止" : "Stopped"}
          </dd>
        </div>
        <div>
          <dt>{zh ? "模式" : "Mode"}</dt>
          <dd>{health?.mode === "local" ? (zh ? "本地" : "local") : health?.mode ?? (zh ? "本地" : "local")}</dd>
        </div>
        <div>
          <dt>{zh ? "版本" : "Version"}</dt>
          <dd>{health?.install.version ?? (zh ? "未知" : "unknown")}</dd>
        </div>
      </dl>
      <div className="action-stack">
        <button disabled={busy} onClick={onInstall}>{zh ? "安装 / 修复" : "Install / Repair"}</button>
        <button disabled={busy} onClick={onInstallWithPrerequisites}>{zh ? "自动安装依赖" : "Auto-install Dependencies"}</button>
        <button disabled={busy || !health?.install.installed || health?.gateway.ready} onClick={onStartGateway}>
          {zh ? "恢复网关" : "Recover Gateway"}
        </button>
        <button disabled={busy || !health?.gateway.managed} onClick={onStopGateway}>
          {zh ? "重启前停止" : "Stop for Restart"}
        </button>
        <button disabled={busy} onClick={onCheckUpdates}>{zh ? "检查更新" : "Check Updates"}</button>
        <button disabled={busy || !health?.update.available || health.update.downloaded} onClick={onDownloadUpdate}>{zh ? "下载更新" : "Download Update"}</button>
        <button disabled={busy || !health?.update.downloaded} onClick={onInstallUpdate}>{zh ? "安装更新" : "Install Update"}</button>
        <button disabled={busy} onClick={onOpenSettings}>{zh ? "配置 API Key" : "Configure API Key"}</button>
      </div>
      {actionMessage && <div className="action-message">{actionMessage}</div>}
      <div className="diagnostics">
        <strong>{zh ? "诊断信息" : "Diagnostics"}</strong>
        <span>{health?.install.home ?? (zh ? "未检测到 DrSai 主目录" : "No DrSai home detected")}</span>
        <span>{zh ? "缺失项：" : "Missing: "}{health?.install.missing.length ? health.install.missing.join(", ") : zh ? "无" : "none"}</span>
        <span>{zh ? "后端目标版本：" : "Backend target: "}{health?.install.expectedVersion ?? (zh ? "开发模式" : "development")}</span>
        <span>{zh ? "后端修复：" : "Backend repair: "}{health?.install.backendNeedsRepair ? (zh ? "需要" : "required") : (zh ? "不需要" : "not required")}</span>
        <span>{zh ? "后端来源：" : "Backend source: "}{health?.install.bundledBackendAvailable ? (zh ? "内置源码包" : "bundled archive") : (zh ? "代码仓库" : "repository")}</span>
        <span>
          {zh ? "网关运行时：" : "Gateway runtime: "}
          {health?.gateway.externalConflict
            ? zh ? "端口被其他进程占用" : "port occupied by another process"
            : health?.gateway.externalReady
              ? health.gateway.managed
                ? zh ? "已自动托管并可访问" : "auto-managed and reachable"
                : zh ? "可访问但未托管" : "reachable but unmanaged"
              : zh ? "自动启动中或暂不可用" : "starting automatically or unavailable"}
        </span>
        <span>Python{zh ? "：" : ": "}{health?.install.prerequisites.pythonVersion ?? (zh ? "未找到" : "not found")}</span>
        <span>{zh ? "Python 路径：" : "Python path: "}{health?.install.prerequisites.pythonCommand ?? (zh ? "未找到" : "not found")}</span>
        <span>Git{zh ? "：" : ": "}{health?.install.prerequisites.gitVersion ?? (zh ? "未找到" : "not found")}</span>
        <span>{zh ? "Git 路径：" : "Git path: "}{health?.install.prerequisites.gitCommand ?? (zh ? "未找到" : "not found")}</span>
        <span>API Key{zh ? "：" : ": "}{health?.install.apiKeyConfigured ? (zh ? "已配置" : "configured") : (zh ? "缺失" : "missing")}</span>
        <span>{zh ? "更新：" : "Update: "}{formatUpdateStatus(health, language)}</span>
        {typeof health?.update.progress === "number" && (
          <span>{zh ? "下载进度：" : "Download: "}{Math.round(health.update.progress)}%</span>
        )}
        {health?.install.prerequisites.problems.map((problem) => (
          <span key={problem}>{zh ? "问题：" : "Issue: "}{problem}</span>
        ))}
      </div>
      {installProgress && (
        <div className={`install-log ${installProgress.phase}`}>
          <strong>{localizeInstallMessage(installProgress.message, language)}</strong>
          {installProgress.logFile && (
            <div className="log-path-row">
              <span>{zh ? "日志文件：" : "Log file: "}{installProgress.logFile}</span>
              <button onClick={() => onOpenPath(installProgress.logFile ?? "")}>{zh ? "打开日志" : "Open Log"}</button>
            </div>
          )}
          {installProgress.phase === "running" && (
            <button className="cancel-install-button" onClick={onCancelInstall}>{zh ? "取消安装" : "Cancel Install"}</button>
          )}
          <pre>{installProgress.log || (zh ? "正在等待安装器输出..." : "Waiting for installer output...")}</pre>
        </div>
      )}
    </>
  );
}

function localizeInstallMessage(message: string, language: AppLanguage): string {
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

function formatUpdateStatus(health: DesktopHealth | null, language: AppLanguage): string {
  const zh = language === "zh";
  if (!health) return zh ? "未检查" : "not checked";
  if (health.update.error) return health.update.error;
  if (health.update.downloaded) return zh ? `已下载，待安装 ${health.update.version ?? ""}` : `ready to install ${health.update.version ?? ""}`;
  if (health.update.downloading) return zh ? `正在下载 ${health.update.version ?? ""}` : `downloading ${health.update.version ?? ""}`;
  if (health.update.checking) return zh ? "正在检查" : "checking";
  if (health.update.available) return zh ? `可更新 ${health.update.version ?? ""}` : `available ${health.update.version ?? ""}`;
  return zh ? "未检查" : "not checked";
}

function SettingsPanel({
  apiKeyInput,
  busy,
  health,
  language,
  message,
  onApiKeyChange,
  onLanguageChange,
  onSubmit,
}: {
  apiKeyInput: string;
  busy: boolean;
  health: DesktopHealth | null;
  language: AppLanguage;
  message: string | null;
  onApiKeyChange: (value: string) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onSubmit: (event: FormEvent) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <div className="settings-view">
      <section className="settings-section">
        <div>
          <h2>{zh ? "显示语言" : "Language"}</h2>
          <p>{zh ? "切换 OpenDrSai 桌面端的界面语言。" : "Switch the interface language for OpenDrSai Desktop."}</p>
        </div>
        <div className="settings-language-control">
          <span>{zh ? "界面语言" : "Interface language"}</span>
          <div className="language-segment" role="group" aria-label={zh ? "界面语言" : "Interface language"}>
            <button type="button" className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>{zh ? "英文" : "English"}</button>
            <button type="button" className={language === "zh" ? "active" : ""} onClick={() => onLanguageChange("zh")}>{zh ? "中文" : "Chinese"}</button>
          </div>
        </div>
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
                ? zh ? "已配置 key；输入新值可替换" : "Key is configured; enter a new value to replace it"
                : zh ? "粘贴你的 API key" : "Paste your API key"
            }
          />
          <button disabled={busy || !apiKeyInput.trim()} type="submit">{zh ? "保存 API Key" : "Save API Key"}</button>
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

function SidePlaceholder({ language, tab }: { language: AppLanguage; tab: RightTab }): React.JSX.Element {
  return (
    <div className="side-placeholder">
      <FileText size={20} />
      <strong>{tab}</strong>
      <span>{language === "zh" ? "预留给共享 WebUI 面板内容。" : "Reserved for shared WebUI panel content."}</span>
    </div>
  );
}

export default App;
