import { message, Spin } from "antd";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { appContext } from "@/hooks/provider";
import { useConfigStore } from "../../hooks/store";
import { useModeConfigStore } from "../../store/modeConfig";
import { Agent } from "../../types/common";
import type { Session } from "../types/datamodel";
import ContentHeader from "../contentheader";
import { AgentSquare } from "../features/Agents/AgentSquare";
import PlanList from "../features/Plans/PlanList";
import { settingsAPI, agentAPI } from "./api";
import ChatView from "./chat/chat";
import NewChatView from "./chat/NewChatView";
import { SessionEditor } from "./session_editor";
import { Sidebar } from "./sidebar";
import { useSessionManager } from "./hooks/useSessionManager";
import { useWebSocketManager } from "./hooks/useWebSocketManager";
import { useAgentManager } from "./hooks/useAgentManager";
import { useSessionStorage } from "./hooks/useSessionStorage";
import { useSettingsStore, GeneralConfig } from "../store";

export const SessionManager: React.FC = () => {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeSubMenuItem, setActiveSubMenuItem] = useState("current_session");
  const [baseUrl, setBaseUrl] = useState<string | undefined>();

  const { user } = useContext(appContext);
  const { session, setSession, setSessions } = useConfigStore();
  const { selectedAgent, setSelectedAgent, setConfig } = useModeConfigStore();
  const { saveSessionId, saveSelectedAgent, getSelectedAgent } = useSessionStorage();
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
  const { sessionSockets, getSessionSocket, closeSocket, stopSession } = useWebSocketManager();

  // Agent management
  const { agents, fetchAgentList, deleteAgent } = useAgentManager(user?.email);

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
    fetchSessions();
  }, [fetchSessions]);

  // Helper function to fetch and merge agent config
  const fetchAndSetAgent = useCallback(async (agent: Agent) => {
    if (!user?.email || !agent.mode) {
      setSelectedAgent(agent);
      return;
    }

    // 对于自定义智能体（type === "add"），如果已经有完整的 config，直接使用
    if (agent.type === "add" && agent.config && Object.keys(agent.config).length > 0) {
      console.log("Using existing config for custom agent:", agent);
      setSelectedAgent(agent);
      setConfig(agent.config);
      return;
    }

    try {
      const agentConfig = await agentAPI.getAgentConfig(user.email, agent.mode);
      if (agentConfig) {
        const fullAgent = {
          ...agent,
          config: agentConfig.config,
          mode: agentConfig.mode || agent.mode,
          logo: agent.logo,
        };
        setSelectedAgent(fullAgent);
        setConfig(agentConfig.config);
      } else {
        // 如果 API 返回空，但 agent 本身有 config，使用 agent 的 config
        if (agent.config && Object.keys(agent.config).length > 0) {
          setSelectedAgent(agent);
          setConfig(agent.config);
        } else {
          setSelectedAgent(agent);
          setConfig({ mode: agent.mode });
        }
      }
    } catch (error) {
      console.warn("Failed to load agent config:", error);
      // 如果 API 调用失败，但 agent 本身有 config，使用 agent 的 config
      if (agent.config && Object.keys(agent.config).length > 0) {
        setSelectedAgent(agent);
        setConfig(agent.config);
      } else {
        setSelectedAgent(agent);
        setConfig({ mode: agent.mode });
      }
    }
  }, [user?.email, setSelectedAgent, setConfig]);

  // Restore selected agent from localStorage on mount
  useEffect(() => {
    if (!selectedAgent && agents && agents.length > 0 && user?.email) {
      const storedAgent = getSelectedAgent();
      if (storedAgent) {
        // Verify the stored agent still exists in the agent list
        const agentExists = agents.find(a => a.mode === storedAgent.mode);
        if (agentExists) {
          // Fetch and set agent with full config
          fetchAndSetAgent(storedAgent);
        } else {
          // Stored agent no longer exists, use default
          const defaultAgent = agents.find(agent => agent.mode === "magentic-one");
          if (defaultAgent) {
            fetchAndSetAgent(defaultAgent);
          }
        }
      } else {
        // No stored agent, use default
        const defaultAgent = agents.find(agent => agent.mode === "magentic-one");
        if (defaultAgent) {
          fetchAndSetAgent(defaultAgent);
        }
      }
    }
  }, [agents, selectedAgent, getSelectedAgent, fetchAndSetAgent, user?.email]);

  // Save selected agent to localStorage when it changes
  useEffect(() => {
    if (selectedAgent) {
      saveSelectedAgent(selectedAgent);
    }
  }, [selectedAgent, saveSelectedAgent]);

  // Handle agent click
  const handleAgentClick = useCallback(async (agent: Agent) => {
    if (!user?.email) return;

    // 对于 type === "add" 的自定义智能体，使用 id 或 name 来判断是否为不同智能体
    // 对于非自定义智能体，使用 mode 来判断
    const isDifferentAgent = agent.type === "add"
      ? (selectedAgent?.id !== agent.id && selectedAgent?.name !== agent.name)
      : (selectedAgent?.mode !== agent.mode);

    // 保存当前settings配置用于回滚
    const previousSettingsConfig = { ...settingsConfig };

    try {
      // 乐观更新store（UI立即响应）- fetchAndSetAgent会立即更新UI
      await fetchAndSetAgent(agent);

      // 只有在切换到不同智能体时才清空当前会话（不创建新会话，会话在发送消息时创建）
      if (isDifferentAgent) {
        clearCurrentSession();
      }

      setActiveSubMenuItem("current_session");

      // 通过API更新数据库(settingsAPI.updateSettings)
      // 将当前的全局settings配置同步到数据库
      try {
        const currentSettings = useSettingsStore.getState().config;
        await settingsAPI.updateSettings(user.email, currentSettings);
      } catch (updateError) {
        // 如果失败则回滚store
        console.error("Failed to update settings:", updateError);
        updateSettingsConfig(previousSettingsConfig);
        messageApi.error("更新设置失败，已回滚");
      }
    } catch (error) {
      // 如果fetchAndSetAgent失败，回滚settings配置
      console.error("Failed to set agent:", error);
      updateSettingsConfig(previousSettingsConfig);
      messageApi.error("切换智能体失败");
    }
  }, [user?.email, selectedAgent, fetchAndSetAgent, clearCurrentSession, settingsConfig, updateSettingsConfig, messageApi]);

  // Handle edit session
  const handleEditSession = useCallback(async (sessionData?: Session) => {
    setActiveSubMenuItem("current_session");

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
    setActiveSubMenuItem("current_session");

    // 设置默认agent为 Dr.Sai General (magentic-one)
    if (Array.isArray(agents) && agents.length > 0) {
      const defaultAgent = agents.find(agent => agent.mode === "magentic-one");
      if (defaultAgent) {
        await fetchAndSetAgent(defaultAgent);
      }
    }

    // 创建新会话
    handleEditSession();
  }, [agents, fetchAndSetAgent, handleEditSession]);

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
      setActiveSubMenuItem("current_session");
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
    (selectedSession: Session) => {
      setActiveSubMenuItem("current_session");
      selectSession(selectedSession);
    },
    [selectSession]
  );

  // Listen for switchToCurrentSession event
  useEffect(() => {
    const handleSwitchToCurrentSession = async (event: CustomEvent) => {
      const { agent, newSession, config, clearSession } = event.detail || {};

      setActiveSubMenuItem("current_session");
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
      setActiveSubMenuItem("current_session");
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
      setActiveSubMenuItem("current_session");
    }
  }, [session, selectedAgent]);

  // Chat views
  const chatViews = useMemo(() => {
    if (!Array.isArray(sessions) || !session) {
      return [];
    }

    return sessions.map((s: Session) => {
      if (!s.id) return null;

      const status = sessionRunStatuses[s.id];
      const isSessionPotentiallyActive = ["active", "awaiting_input", "pausing", "paused"].includes(status);

      if (!isSessionPotentiallyActive && session?.id !== s.id) return null;

      return (
        <div key={s.id} className={`${session?.id === s.id ? "block" : "hidden"} relative`}>
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
    sessionRunStatuses,
    updateSessionName,
    getSessionSocket,
    updateSessionRunStatus,
    pendingFirstMessage,
  ]);

  return (
    <div className="relative flex flex-1 w-full h-full">
      {contextHolder}

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed lg:relative left-0 top-0 h-full transition-smooth z-50 lg:z-auto overflow-hidden bg-gray-50/95 dark:bg-secondary/80 border-r border-gray-200/50 dark:border-border-primary/50 ${isSidebarOpen
          ? "w-72 lg:w-56 translate-x-0"
          : "w-72 lg:w-0 -translate-x-full lg:translate-x-0"
          }`}
      >
        <Sidebar
          isOpen={isSidebarOpen}
          sessions={sessions}
          currentSession={session}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          onSelectSession={handleSelectSession}
          onEditSession={handleEditSession}
          onDeleteSession={handleDeleteSession}
          isLoading={isSessionLoading}
          sessionRunStatuses={sessionRunStatuses}
          activeSubMenuItem={activeSubMenuItem}
          onSubMenuChange={setActiveSubMenuItem}
          onLogoClick={handleLogoClick}
          onStopSession={handleStopSession}
          agents={agents}
          selectedAgentMode={selectedAgent?.mode}
          selectedAgent={selectedAgent}
          onAgentClick={handleAgentClick}
          onDeleteAgent={handleDeleteAgent}
        />
      </div>

      {/* Main content area */}
      <div className={`flex flex-col flex-1 min-h-0 transition-smooth ${isSidebarOpen ? "ml-0 lg:ml-0" : "ml-0"}`}>
        <ContentHeader
          isMobileMenuOpen={isMobileMenuOpen}
          onMobileMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onNewSession={() => handleEditSession()}
          agentSelector={null}
          activeSubMenuItem={activeSubMenuItem}
        />

        {activeSubMenuItem === "current_session" ? (
          (() => {
            if (session) {
              return <div className="h-full">{chatViews}</div>;
            } else if (selectedAgent && selectedAgent.name) {
              return (
                <NewChatView
                  agent={selectedAgent as Agent}
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
        ) : activeSubMenuItem === "agent_square" ? (
          <div className="h-full overflow-hidden">
            <AgentSquare agents={[]} handleAgentList={fetchAgentList} existingAgents={agents} />
          </div>
        ) : (
          <div className="h-full overflow-hidden">
            <PlanList
              onTabChange={setActiveSubMenuItem}
              onSelectSession={handleSelectSession}
              onCreateSessionFromPlan={handleCreateSessionFromPlan}
            />
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
      </div>
    </div>
  );
};

