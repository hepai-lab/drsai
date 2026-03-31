import { appContext } from "@/hooks/provider";
import { message, Spin } from "antd";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { useConfigStore } from "../../hooks/store";
import { useModeConfigStore } from "../../store/modeConfig";
import { Agent } from "../../types/common";
import { AgentSquare } from "../features/Agents/AgentSquare";
import { useAgentInfo } from "../features/Agents/useAgentInfo";
import PlanList from "../features/Plans/PlanList";
import { GeneralConfig, useSettingsStore } from "../store";
import type { Session } from "../types/datamodel";
import { settingsAPI } from "./api";
import ChatView from "./chat/chat";
import NewChatView from "./chat/NewChatView";
import { useAgentManager } from "./hooks/useAgentManager";
import { useLocation, useNavigate } from "../../hooks/useRouter";
import { useSessionManager } from "./hooks/useSessionManager";
import { useSessionStorage } from "./hooks/useSessionStorage";
import { useWebSocketManager } from "./hooks/useWebSocketManager";
import AgentManagementPage from "./pages/AgentManagementPage";
import ChannelsPage from "./pages/ChannelsPage";
import FilePreviewPage from "./pages/FilePreviewPage";
import LogsPage from "./pages/LogsPage";
import ProfilePage from "./pages/ProfilePage";
import SkillsSquarePage from "./pages/SkillsSquarePage";
import UserManagementPage from "./pages/UserManagementPage";
import {
  MENU_LABELS,
  MENU_IDS,
  type CanvasViewId,
  type MenuId,
  createSearchWithMenu,
  createSearchWithView,
  getCanvasViewFromSearch,
  getMenuIdFromSearch,
} from "./menuRoutes";
import { SessionEditor } from "./session_editor";
import { AppLayout } from "../../layout";

export const SessionManager: React.FC = () => {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();
  const [baseUrl, setBaseUrl] = useState<string | undefined>();
  const location = useLocation();
  const navigate = useNavigate();
  const activeSubMenuItem = useMemo(
    () => getMenuIdFromSearch(location.search),
    [location.search]
  );
  const activeCanvasView = useMemo(
    () => getCanvasViewFromSearch(location.search),
    [location.search]
  );
  const activeMenuLabel = useMemo(
    () => MENU_LABELS[activeSubMenuItem],
    [activeSubMenuItem]
  );

  const navigateToMenu = useCallback(
    (menuId: MenuId) => {
      const withMenu = createSearchWithMenu(location.search, menuId);
      navigate(createSearchWithView(withMenu, "chat"));
    },
    [location.search, navigate]
  );

  const navigateToView = useCallback(
    (viewId: CanvasViewId) => {
      navigate(createSearchWithView(location.search, viewId));
    },
    [location.search, navigate]
  );

  const { user } = useContext(appContext);
  const { session, setSession, setSessions } = useConfigStore();
  const { selectedAgent, setSelectedAgent, setConfig } = useModeConfigStore();
  const { saveSessionId } = useSessionStorage();
  const { config: settingsConfig, updateConfig: updateSettingsConfig } = useSettingsStore();

  // Session management
  const {
    sessions,
    isLoading: isSessionLoading,
    sessionRunStatuses,
    pendingFirstMessage,
    fetchSessions,
    selectSession,
    createNewChatSession,
    updateSession,
    updateSessionName,
    deleteSession,
    clearCurrentSession,
    updateSessionRunStatus,
    setPendingFirstMessage,
  } = useSessionManager({
    userEmail: user?.email,
    onSuccess: (msg) => messageApi.success(msg),
    onError: (msg) => messageApi.error(msg),
  });

  // WebSocket management
  const { getSessionSocket, closeSocket, stopSession } = useWebSocketManager();

  // Agent management
  const { agents, fetchAgentList, deleteAgent } = useAgentManager(user?.email);

  const { agentInfo } = useAgentInfo(user?.email);

  // Load settings on page refresh
  useEffect(() => {
    const loadSettings = async () => {
      if (user?.email) {
        try {
          // 请求全局setting配置
          const settings = await settingsAPI.getSettings(user.email) as GeneralConfig;

          // 存储到store
          updateSettingsConfig(settings);

          // 更新前端页面渲染（通过store的更新自动触发）
          // 同时提取baseUrl用于其他用途
          if (settings.model_configs) {
            try {
              const parsed = parse(settings.model_configs);
              const baseUrl = parsed.model_config?.config?.base_url;
              if (baseUrl) {
                setBaseUrl(baseUrl);
              }
            } catch (parseError) {
              console.warn("Failed to parse model_configs for baseUrl:", parseError);
            }
          }
        } catch (error) {
          console.error("Failed to load settings:", error);
        }
      }
    };
    loadSettings();
  }, [user?.email, updateSettingsConfig]);

  // Fetch sessions and agents on mount
  useEffect(() => {
    if (user?.email) {
      fetchAgentList();
    }
  }, [user?.email, fetchAgentList]);

  useEffect(() => {
    const handleAgentListChanged = () => {
      fetchAgentList();
    };

    window.addEventListener(
      "agentListChanged",
      handleAgentListChanged as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "agentListChanged",
        handleAgentListChanged as unknown as EventListener
      );
    };
  }, [fetchAgentList]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const { setAgentId } = useModeConfigStore();
  // Handle agent click
  const handleAgentClick = useCallback(async (agent: Agent) => {
    if (!user?.email) return;

    // 更新 agentId（在函数开始时就设置，确保及时触发 useAgentInfo）
    if (agent.id) {
      setAgentId(agent.id);
    } else {
      setAgentId(null);
    }
    // 对于 type === "add" 的自定义智能体，使用 id 或 name 来判断是否为不同智能体
    // 对于非自定义智能体，使用 mode 来判断
    const isDifferentAgent = agent.type === "add"
      ? (selectedAgent?.id !== agent.id && selectedAgent?.name !== agent.name)
      : (selectedAgent?.mode !== agent.mode);
    if (isDifferentAgent) {
      clearCurrentSession();
    }

    navigateToMenu(MENU_IDS.currentSession);

  }, [user?.email, selectedAgent, clearCurrentSession, settingsConfig, updateSettingsConfig, messageApi]);

  // Handle edit session
  const handleEditSession = useCallback(async (sessionData?: Session) => {
    navigateToMenu(MENU_IDS.currentSession);

    if (sessionData) {
      setEditingSession(sessionData);
      setIsEditorOpen(true);
    } else {
      // 不创建新会话，只是清空当前会话
      // 保持当前选中的 agent 不变
      // 会话将在用户发送第一条消息时创建
      clearCurrentSession();
    }
  }, [clearCurrentSession]);

  // Handle logo click
  const handleLogoClick = useCallback(async () => {
    navigateToMenu(MENU_IDS.currentSession);
    // 创建新会话
    handleEditSession();
  }, [agents, handleEditSession]);

  // Handle save session
  const handleSaveSession = useCallback(async (sessionData: Partial<Session>) => {
    await updateSession(sessionData);
    setIsEditorOpen(false);
    setEditingSession(undefined);
  }, [updateSession]);

  // Handle delete session
  const handleDeleteSession = useCallback(async (sessionId: number) => {
    const isDeletingCurrentSession = session?.id === sessionId;
    await deleteSession(sessionId, closeSocket);

    // 如果删除的是当前会话，确保显示 NewChatView
    if (isDeletingCurrentSession) {
      navigateToMenu(MENU_IDS.currentSession);
    }
  }, [deleteSession, closeSocket, session?.id]);

  // Handle delete agent
  const handleDeleteAgent = useCallback(async (id: string) => {
    await deleteAgent(
      id,
      () => messageApi.success("Agent deleted successfully"),
      () => messageApi.error("Failed to delete agent")
    );
  }, [deleteAgent, messageApi]);

  // Handle stop session
  const handleStopSession = useCallback((sessionId: number) => {
    if (sessionId === undefined || sessionId === null) return;

    stopSession(sessionId);
    updateSessionRunStatus(sessionId, "stopped");
  }, [stopSession, updateSessionRunStatus]);

  // Handle create session from plan
  const handleCreateSessionFromPlan = useCallback((sessionId: number, planData: any) => {
    selectSession({ id: sessionId } as Session);

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("planReady", {
          detail: {
            planData: planData,
            sessionId: sessionId,
            messageId: `plan_${Date.now()}`,
          },
        })
      );
    }, 2000);
  }, [selectSession]);

  // Handle selecting a session from sidebar / plan list:
  // always switch back to "current_session" view so the chat is visible.
  const handleSelectSession = useCallback(
    async (selectedSession: Session) => {
      navigateToMenu(MENU_IDS.currentSession);
      selectSession(selectedSession);
    },
    [selectSession]
  );

  // Listen for switchToCurrentSession event
  useEffect(() => {
    const handleSwitchToCurrentSession = async (event: CustomEvent) => {
      const { agent, newSession, config, clearSession } = event.detail || {};

      navigateToMenu(MENU_IDS.currentSession);
      if (agent) {
        setSelectedAgent(agent);
      }
      if (config) {
        setConfig(config);
      }

      if (clearSession) {
        clearCurrentSession();
        return;
      }

      if (newSession) {
        try {
          const currentSessions = Array.isArray(sessions) ? sessions : [];
          setSessions([newSession, ...currentSessions]);
          setSession(newSession);

          window.history.pushState({}, "", `?sessionId=${newSession.id}`);
          saveSessionId(newSession.id);
        } catch (error) {
          console.error("Error setting new session:", error);
        }
      }
    };

    window.addEventListener(
      "switchToCurrentSession",
      handleSwitchToCurrentSession as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "switchToCurrentSession",
        handleSwitchToCurrentSession as unknown as EventListener
      );
    };
  }, [setSelectedAgent, sessions, setSessions, setSession, saveSessionId, setConfig, clearCurrentSession]);

  // Listen for sessionDeleted event and ensure NewChatView is shown
  useEffect(() => {
    const handleSessionDeleted = () => {
      navigateToMenu(MENU_IDS.currentSession);
    };

    window.addEventListener(
      "sessionDeleted",
      handleSessionDeleted as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "sessionDeleted",
        handleSessionDeleted as unknown as EventListener
      );
    };
  }, []);

  // Ensure NewChatView is shown when session becomes null
  useEffect(() => {

    if (!session && selectedAgent && selectedAgent.name) {
      navigateToMenu(MENU_IDS.currentSession);
    }
  }, [session, selectedAgent]);

  // Chat views
  const chatViews = useMemo(() => {
    if (!Array.isArray(sessions) || !session) {
      return [];
    }

    return sessions.map((s: Session) => {
      if (!s.id) return null;

      // Always render ChatView for all sessions to preserve streamed messages when switching.
      // Non-current sessions are hidden via CSS (className="hidden").
      return (
        <div
          key={s.id}
          className={`${session?.id === s.id ? "block" : "hidden"} relative h-full min-h-0`}
        >
          <ChatView
            session={s}
            onSessionNameChange={updateSessionName}
            getSessionSocket={getSessionSocket}
            visible={session?.id === s.id}
            onRunStatusChange={updateSessionRunStatus}
            pendingFirstMessage={session?.id === s.id ? pendingFirstMessage : null}
            onPendingMessageSent={() => setPendingFirstMessage(null)}
          />
        </div>
      );
    });
  }, [
    sessions,
    session,
    updateSessionName,
    getSessionSocket,
    updateSessionRunStatus,
    pendingFirstMessage,
  ]);

  const rightPanelHistory = useMemo(() => {
    const sortedSessions = Array.isArray(sessions)
      ? [...sessions].sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at || 0).getTime() -
          new Date(a.updated_at || a.created_at || 0).getTime()
      )
      : [];

    if (sortedSessions.length === 0) {
      return null;
    }

    return (
      <div className="h-full overflow-y-auto p-3 space-y-1">
        {sortedSessions.map((historySession) => {
          const isCurrent = session?.id === historySession.id;
          const lastTime = historySession.updated_at || historySession.created_at;
          return (
            <button
              key={historySession.id}
              type="button"
              onClick={() => void handleSelectSession(historySession)}
              className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${isCurrent
                  ? "bg-accent/10 text-accent"
                  : "hover:bg-tertiary/20 text-primary"
                }`}
            >
              <div className="text-sm font-medium truncate">
                {historySession.name || `Session ${historySession.id ?? ""}`}
              </div>
              <div className="text-xs text-secondary mt-1">
                {lastTime ? new Date(lastTime).toLocaleString() : "-"}
              </div>
            </button>
          );
        })}
      </div>
    );
  }, [sessions, session?.id, handleSelectSession]);

  return (
    <>
      {contextHolder}

      <AppLayout
        // TopNav
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onLogoClick={handleLogoClick}

        // LeftMenu
        activeSubMenuItem={activeSubMenuItem}
        activeMenuLabel={activeMenuLabel}
        onSubMenuChange={(tabId) => navigateToMenu(tabId as MenuId)}
        canvasActiveView={activeCanvasView}
        onCanvasViewChange={navigateToView}
        canvasFilePreviewContent={<FilePreviewPage />}
        rightPanelHistory={rightPanelHistory}
        onRightPanelTabChange={(tab) => {
          if (tab === "files") {
            navigateToView("file_preview");
            return;
          }
          navigateToView("chat");
        }}
      >
        {/* Canvas content */}
        {activeSubMenuItem === MENU_IDS.currentSession ? (
          (() => {
            if (session) {
              return <div className="h-full min-h-0">{chatViews}</div>;
            } else if (agentInfo) {
              return (
                <NewChatView
                  agent={agentInfo as Agent}
                  onSubmit={async (agent, query, files, plan) => {
                    await createNewChatSession(agent, query, files, plan);
                  }}
                />
              );
            } else {
              return (
                <div className="flex items-center justify-center h-full text-secondary">
                  <div className="text-center">
                    <Spin size="large" />
                    <p className="mt-4 text-sm">Loading...</p>
                  </div>
                </div>
              );
            }
          })()
        ) : activeSubMenuItem === MENU_IDS.agentSquare || activeSubMenuItem === MENU_IDS.myAgents ? (
          <div className="h-full overflow-hidden">
            <AgentSquare agents={[]} handleAgentList={fetchAgentList} />
          </div>
        ) : activeSubMenuItem === MENU_IDS.skillsSquare ? (
          <SkillsSquarePage />
        ) : activeSubMenuItem === MENU_IDS.channels ? (
          <ChannelsPage />
        ) : activeSubMenuItem === MENU_IDS.logs ? (
          <LogsPage />
        ) : activeSubMenuItem === MENU_IDS.agentManagement ? (
          <AgentManagementPage />
        ) : activeSubMenuItem === MENU_IDS.userManagement ? (
          <UserManagementPage />
        ) : activeSubMenuItem === MENU_IDS.profile ? (
          <ProfilePage
            user={user || { name: "", email: "" }}
            onClose={() => navigateToMenu(MENU_IDS.currentSession)}
          />
        ) : activeSubMenuItem === MENU_IDS.savedPlan ? (
          <div className="h-full overflow-hidden">
            <PlanList
              onTabChange={(tabId) => navigateToMenu(tabId as MenuId)}
              onSelectSession={handleSelectSession}
              onCreateSessionFromPlan={handleCreateSessionFromPlan}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-secondary">
            <div className="text-center">
              <p className="text-sm opacity-50">敬请期待</p>
            </div>
          </div>
        )}

        <SessionEditor
          session={editingSession}
          isOpen={isEditorOpen}
          onSave={handleSaveSession}
          onCancel={() => {
            setIsEditorOpen(false);
            setEditingSession(undefined);
          }}
        />
      </AppLayout>
    </>
  );
};

