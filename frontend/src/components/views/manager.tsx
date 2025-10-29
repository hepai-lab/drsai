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
import { settingsAPI } from "./api";
import ChatView from "./chat/chat";
import NewChatView from "./chat/NewChatView";
import { SessionEditor } from "./session_editor";
import { Sidebar } from "./sidebar";
import { useSessionManager } from "./hooks/useSessionManager";
import { useWebSocketManager } from "./hooks/useWebSocketManager";
import { useAgentManager } from "./hooks/useAgentManager";
import { useSessionStorage } from "./hooks/useSessionStorage";

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

  // Session management
  const {
    sessions,
    isLoading: isSessionLoading,
    sessionRunStatuses,
    pendingFirstMessage,
    fetchSessions,
    selectSession,
    createDefaultSession,
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

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      if (user?.email) {
        try {
          const settings = await settingsAPI.getSettings(user.email);
          const parsed = parse(settings.model_configs);
          const baseUrl = parsed.model_config.config.base_url;
          setBaseUrl(baseUrl);
        } catch (error) {
          console.error("Failed to load settings");
        }
      }
    };
    loadSettings();
  }, [user?.email]);

  // Fetch sessions and agents on mount
  useEffect(() => {
    if (user?.email) {
      fetchAgentList();
    }
  }, [user?.email, fetchAgentList]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Restore selected agent from localStorage on mount
  useEffect(() => {
    if (!selectedAgent && agents && agents.length > 0) {
      const storedAgent = getSelectedAgent();
      if (storedAgent) {
        // Verify the stored agent still exists in the agent list
        const agentExists = agents.find(a => a.mode === storedAgent.mode);
        if (agentExists) {
          setSelectedAgent(storedAgent);
          if (storedAgent.mode) {
            setConfig({ mode: storedAgent.mode });
          }
        } else {
          // Stored agent no longer exists, use default
          const defaultAgent = agents.find(agent => agent.mode === "magentic-one");
          if (defaultAgent) {
            setSelectedAgent(defaultAgent);
          }
        }
      } else {
        // No stored agent, use default
        const defaultAgent = agents.find(agent => agent.mode === "magentic-one");
        if (defaultAgent) {
          setSelectedAgent(defaultAgent);
        }
      }
    }
  }, [agents, selectedAgent, getSelectedAgent, setSelectedAgent, setConfig]);

  // Save selected agent to localStorage when it changes
  useEffect(() => {
    if (selectedAgent) {
      saveSelectedAgent(selectedAgent);
    }
  }, [selectedAgent, saveSelectedAgent]);

  // Handle agent click
  const handleAgentClick = useCallback(async (agent: Agent) => {
    if (!user?.email) return;

    const isDifferentAgent = selectedAgent?.mode !== agent.mode;

    setSelectedAgent(agent);
    setConfig({ mode: agent.mode });

    // 只有在切换到不同智能体时才清空当前会话
    if (isDifferentAgent) {
      clearCurrentSession();
    }

    setActiveSubMenuItem("current_session");
  }, [user?.email, selectedAgent, setSelectedAgent, setConfig, clearCurrentSession]);

  // Handle logo click
  const handleLogoClick = useCallback(() => {
    setActiveSubMenuItem("current_session");

    // 设置默认agent为 Dr.Sai General (magentic-one)
    if (Array.isArray(agents) && agents.length > 0) {
      const defaultAgent = agents.find(agent => agent.mode === "magentic-one");
      if (defaultAgent) {
        setSelectedAgent(defaultAgent);
      }
    }

    // 创建新会话
    handleEditSession();
  }, [agents, setSelectedAgent]);

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

  // Handle save session
  const handleSaveSession = useCallback(async (sessionData: Partial<Session>) => {
    await updateSession(sessionData);
    setIsEditorOpen(false);
    setEditingSession(undefined);
  }, [updateSession]);

  // Handle delete session
  const handleDeleteSession = useCallback(async (sessionId: number) => {
    await deleteSession(sessionId, closeSocket);
  }, [deleteSession, closeSocket]);

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

  // Listen for switchToCurrentSession event
  useEffect(() => {
    const handleSwitchToCurrentSession = async (event: CustomEvent) => {
      const { agent, newSession } = event.detail;

      setActiveSubMenuItem("current_session");
      setSelectedAgent(agent);

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
  }, [setSelectedAgent, sessions, setSessions, setSession, saveSessionId]);

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
          onSelectSession={selectSession}
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
              onSelectSession={selectSession}
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

