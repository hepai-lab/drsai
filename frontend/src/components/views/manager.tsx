import { message, Spin } from "antd";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { appContext } from "../../hooks/provider";
import { useConfigStore } from "../../hooks/store";
import ContentHeader from "../contentheader";
import PlanList from "../features/Plans/PlanList";
import { AgentSquare } from "../features/Agents/AgentSquare";
import type { Session } from "../types/datamodel";
import { RunStatus } from "../types/datamodel";
import { getServerUrl } from "../utils";
import { agentAPI, sessionAPI, settingsAPI } from "./api";
import ChatView from "./chat/chat";
import { SessionEditor } from "./session_editor";
import { Sidebar } from "./sidebar";
import AgentSelectorAdvanced, { Agent } from "../common/AgentSelectorAdvanced";
import { parse } from "yaml";
import { useModeConfigStore } from "../../store/modeConfig";

interface SessionWebSocket {
  socket: WebSocket;
  runId: string;
}

type SessionWebSockets = {
  [sessionId: number]: SessionWebSocket;
};

export const SessionManager: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();
  const [sessionSockets, setSessionSockets] = useState<SessionWebSockets>({});
  const [sessionRunStatuses, setSessionRunStatuses] = useState<{
    [sessionId: number]: RunStatus;
  }>({});
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeSubMenuItem, setActiveSubMenuItem] =
    useState("current_session");

  const { user } = useContext(appContext);
  const { session, setSession, sessions, setSessions } = useConfigStore();
  const [secretKey, setSecretKey] = React.useState<string | undefined>();
  const [baseUrl, setBaseUrl] = React.useState<string | undefined>();
  const { selectedAgent, setSelectedAgent } = useModeConfigStore();
  const [models, setModels] = React.useState<{ id: string }[]>([]);
  const [agents, setAgents] = React.useState<Agent[]>([]);

  // 添加sessionId持久化存储函数
  const saveSessionIdToStorage = (sessionId: number | null) => {
    if (typeof window !== "undefined") {
      if (sessionId) {
        localStorage.setItem(
          "current_session_id",
          sessionId.toString()
        );
      } else {
        localStorage.removeItem("current_session_id");
      }
    }
  };

  const getSessionIdFromStorage = (): number | null => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("current_session_id");
      return stored ? parseInt(stored, 10) : null;
    }
    return null;
  };

  const handleAgentList = async (agents: Agent[]) => {
    try {
      const res = await agentAPI.getAgentList(user?.email || "");
      setAgents(res);

      // 如果用户刚登录且没有持久化的agent选择，设置默认agent为BESIII
      if (user?.email && res.length > 0) {
        const { selectedAgent, setSelectedAgent, setMode, setConfig } = useModeConfigStore.getState();

        // 如果没有选中的agent，设置默认agent为BESIII
        if (!selectedAgent) {
          const besiiiAgent = res.find(agent => agent.mode === "magentic-one");
          if (besiiiAgent) {
            // 设置默认agent为BESIII
            setSelectedAgent(besiiiAgent);
            setMode("magentic-one");

            // 获取BESIII agent的配置
            try {
              const agentConfig = await agentAPI.getAgentConfig(user.email, "magentic-one");
              if (agentConfig) {
                setConfig(agentConfig.config);
              }
            } catch (error) {
              console.warn("Failed to load BESIII agent config:", error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching agent list:", error);
    }
  };

  React.useEffect(() => {
    if (user?.email) {
      handleAgentList(agents);
    }
  }, [user?.email]);


  React.useEffect(() => {
    const loadSettings = async () => {
      if (user?.email) {
        try {
          // const settings = useSettingsStore.getState().config; // Use the settings from the store
          // const parsed = parse(settings.model_configs);
          const settings = await settingsAPI.getSettings(user.email);
          const parsed = parse(settings.model_configs);
          const secretKey = parsed.model_config.config.api_key;
          const baseUrl = parsed.model_config.config.base_url;
          setSecretKey(secretKey);
          setBaseUrl(baseUrl);
        } catch (error) {
          console.error("Failed to load settings");
        }
      }
    };
    loadSettings();
  }, [user?.email]);

  React.useEffect(() => {
    // const loadModels = async () => {
    //   if (secretKey) {
    //     const response = await fetch(`${baseUrl}/models`, {
    //       headers: {
    //         "Content-Type": "application/json",
    //         Authorization: `Bearer ${secretKey}`,
    //       },
    //     });
    //     const data = (await response.json()).data;
    //     setModels(data);
    //   }
    // };
    // loadModels();
  }, [secretKey]);

  const fetchSessions = useCallback(async () => {
    if (!user?.email) return;

    try {
      setIsLoading(true);
      const data = await sessionAPI.listSessions(user.email);
      setSessions(data);

      // Only set first session if there's no sessionId in URL
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("sessionId");
      if (!session && data.length > 0 && !sessionId) {
        setSession(data[0]);
      } else {
        if (data.length === 0) {
          createDefaultSession();
        }
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
      messageApi.error("Error loading sessions");
    } finally {
      setIsLoading(false);
    }
  }, [user?.email, setSessions, session, setSession]);

  // 在session变化时保存到localStorage
  useEffect(() => {
    if (session?.id) {
      saveSessionIdToStorage(session.id);
    } else {
      saveSessionIdToStorage(null);
    }
  }, [session?.id]);

  // 在组件初始化时恢复sessionId
  useEffect(() => {
    const storedSessionId = getSessionIdFromStorage();
    if (storedSessionId && !session) {
      // 如果有存储的sessionId但没有当前session，尝试恢复
      handleSelectSession({ id: storedSessionId } as Session);
    }
  }, []);

  // 添加刷新时自动获取当前会话的id
  useEffect(() => {
    const initializeSessionOnRefresh = async () => {
      // 1. 首先尝试从localStorage获取sessionId
      const storedSessionId = getSessionIdFromStorage();

      // 2. 如果localStorage中有sessionId，但当前没有session，则恢复session
      if (storedSessionId && !session) {
        console.log(
          "Restoring session from localStorage:",
          storedSessionId
        );
        try {
          await handleSelectSession({
            id: storedSessionId,
          } as Session);
        } catch (error) {
          console.error("Failed to restore session:", error);
          // 如果恢复失败，清除localStorage中的无效sessionId
          saveSessionIdToStorage(null);
        }
      }

      // 3. 如果localStorage中没有sessionId，但URL中有sessionId参数
      if (!storedSessionId) {
        const params = new URLSearchParams(window.location.search);
        const urlSessionId = params.get("sessionId");
        if (urlSessionId && !session) {
          console.log("Restoring session from URL:", urlSessionId);
          try {
            await handleSelectSession({
              id: parseInt(urlSessionId),
            } as Session);
          } catch (error) {
            console.error(
              "Failed to restore session from URL:",
              error
            );
          }
        }
      }

      // 4. 如果都没有，但有sessions列表，选择第一个session
      if (!session && Array.isArray(sessions) && sessions.length > 0) {
        console.log(
          "No stored session, selecting first available session"
        );
        setSession(sessions[0]);
        saveSessionIdToStorage(sessions[0].id);
      }
    };

    // 在组件挂载和sessions变化时执行
    initializeSessionOnRefresh();
  }, [sessions]); // 依赖sessions，确保sessions加载完成后执行

  // Handle browser back/forward
  useEffect(() => {
    const handleLocationChange = () => {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("sessionId");

      if (!sessionId && session) {
        setSession(null);
      }
    };

    window.addEventListener("popstate", handleLocationChange);
    return () =>
      window.removeEventListener("popstate", handleLocationChange);
  }, [session]);

  const handleSaveSession = async (sessionData: Partial<Session>) => {
    if (!user || !user.email) return;

    try {
      setIsLoading(true);
      if (sessionData.id) {
        const updated = await sessionAPI.updateSession(
          sessionData.id,
          sessionData,
          user.email
        );
        setSessions(
          Array.isArray(sessions)
            ? sessions.map((s) =>
              s.id === updated.id ? updated : s
            )
            : [updated]
        );
        if (session?.id === updated.id) {
          setSession(updated);
        }
      } else {
        const created = await sessionAPI.createSession(
          {
            ...sessionData,
            name:
              "Default Session - " +
              new Date().toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
          },
          user.email
        );
        setSessions([
          created,
          ...(Array.isArray(sessions) && sessions ? sessions : []),
        ]);
        setSession(created);
      }
      setIsEditorOpen(false);
      setEditingSession(undefined);
    } catch (error) {
      messageApi.error("Error saving session");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditSession = (session?: Session) => {
    setActiveSubMenuItem("current_session");
    setIsLoading(true);
    if (session) {
      setEditingSession(session);
      setIsEditorOpen(true);
    } else {
      // this means we are creating a new session
      handleSaveSession({});
    }
    setIsLoading(false);
  };

  const handleLogoClick = () => {
    // 切换到 Current Session tab
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
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!user?.email) return;

    try {
      setIsLoading(true);
      // Close and remove socket if it exists
      if (sessionSockets[sessionId]) {
        sessionSockets[sessionId].socket.close();
        setSessionSockets((prev) => {
          const updated = { ...prev };
          delete updated[sessionId];
          return updated;
        });
      }

      await sessionAPI.deleteSession(sessionId, user.email);
      setSessions(
        Array.isArray(sessions)
          ? sessions.filter((s) => s.id !== sessionId)
          : []
      );
      if (
        session?.id === sessionId ||
        (Array.isArray(sessions) && sessions.length === 0)
      ) {
        setSession(
          Array.isArray(sessions) && sessions.length > 0
            ? sessions[0]
            : null
        );
        window.history.pushState({}, "", window.location.pathname); // Clear URL params
      }
      messageApi.success("Session deleted");
    } catch (error) {
      console.error("Error deleting session:", error);
      messageApi.error("Error deleting session");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSession = async (selectedSession: Session) => {
    if (!user?.email || !selectedSession.id) return;

    try {
      setActiveSubMenuItem("current_session");
      setIsLoading(true);
      const data = await sessionAPI.getSession(
        selectedSession.id,
        user.email
      );
      if (!data) {
        // Session not found
        messageApi.error("Session not found");
        window.history.pushState({}, "", window.location.pathname); // Clear URL
        if (Array.isArray(sessions) && sessions.length > 0) {
          setSession(sessions[0]); // Fall back to first session
        } else {
          setSession(null);
        }
        return;
      }
      setSession(data);
      window.history.pushState(
        {},
        "",
        `?sessionId=${selectedSession.id}`
      );
    } catch (error) {
      console.error("Error loading session:", error);
      messageApi.error("Error loading session");
      window.history.pushState({}, "", window.location.pathname); // Clear invalid URL
      if (Array.isArray(sessions) && sessions.length > 0) {
        setSession(sessions[0]); // Fall back to first session
      } else {
        setSession(null);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSessionName = async (sessionData: Partial<Session>) => {
    if (!sessionData.id || !user?.email) return;

    // Check if current session name matches default pattern
    const currentSession = sessions.find((s) => s.id === sessionData.id);
    if (!currentSession) return;

    // Only update if it starts with "Default Session - "
    if (currentSession.name.startsWith("Default Session - ")) {
      try {
        const updated = await sessionAPI.updateSession(
          sessionData.id,
          sessionData,
          user.email
        );
        setSessions(
          Array.isArray(sessions)
            ? sessions.map((s) =>
              s.id === updated.id ? updated : s
            )
            : [updated]
        );
        if (session?.id === updated.id) {
          setSession(updated);
        }
      } catch (error) {
        console.error("Error updating session name:", error);
        messageApi.error("Error updating session name");
      }
    }
  };

  const getBaseUrl = (url: string): string => {
    try {
      let baseUrl = url.replace(/(^\w+:|^)\/\//, "");
      if (baseUrl.startsWith("localhost")) {
        baseUrl = baseUrl.replace("/api", "");
      } else if (baseUrl === "/api") {
        baseUrl = window.location.host;
      } else {
        baseUrl = baseUrl.replace("/api", "").replace(/\/$/, "");
      }
      return baseUrl;
    } catch (error) {
      console.error("Error processing server URL:", error);
      throw new Error("Invalid server URL configuration");
    }
  };

  const setupWebSocket = (sessionId: number, runId: string): WebSocket => {
    // Close existing socket for this session if it exists
    if (sessionSockets[sessionId]) {
      sessionSockets[sessionId].socket.close();
    }

    const serverUrl = getServerUrl();
    const baseUrl = getBaseUrl(serverUrl);
    const wsProtocol =
      window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${baseUrl}/api/ws/runs/${runId}`;

    const socket = new WebSocket(wsUrl);

    // Store the new socket
    setSessionSockets((prev) => ({
      ...prev,
      [sessionId]: { socket, runId },
    }));

    return socket;
  };

  const getSessionSocket = (
    sessionId: number,
    runId: string,
    fresh_socket: boolean = false,
    only_retrieve_existing_socket: boolean = false
  ): WebSocket | null => {
    if (fresh_socket) {
      return setupWebSocket(sessionId, runId);
    } else {
      const existingSocket = sessionSockets[sessionId];

      if (
        existingSocket?.socket.readyState === WebSocket.OPEN &&
        existingSocket.runId === runId
      ) {
        return existingSocket.socket;
      }
      if (only_retrieve_existing_socket) {
        return null;
      }
      return setupWebSocket(sessionId, runId);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const updateSessionRunStatus = (sessionId: number, status: RunStatus) => {
    setSessionRunStatuses((prev) => ({
      ...prev,
      [sessionId]: status,
    }));
  };

  const createDefaultSession = async () => {
    if (!user?.email) return;

    try {
      setIsLoading(true);
      const defaultName = `Default Session - ${new Date().toLocaleDateString(
        undefined,
        {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }
      )}`;

      const created = await sessionAPI.createSession(
        {
          name: defaultName,
        },
        user.email
      );

      setSessions([
        created,
        ...(Array.isArray(sessions) && sessions ? sessions : []),
      ]);
      setSession(created);
      window.history.pushState({}, "", `?sessionId=${created.id}`);
    } catch (error) {
      console.error("Error creating default session:", error);
      messageApi.error("Error creating default session");
    } finally {
      setIsLoading(false);
    }
  };

  const chatViews = useMemo(() => {
    // 确保sessions是数组
    if (!Array.isArray(sessions)) {
      console.warn("sessions is not an array:", sessions);
      return [];
    }

    return sessions.map((s: Session) => {
      const status = sessionRunStatuses[s.id] as RunStatus;
      const isSessionPotentiallyActive = [
        "active",
        "awaiting_input",
        "pausing",
        "paused",
      ].includes(status);

      if (!isSessionPotentiallyActive && session?.id !== s.id)
        return null;

      return (
        <div
          key={s.id}
          className={`${session?.id === s.id ? "block" : "hidden"
            } relative`}
        >
          {isLoading && session?.id === s.id && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <Spin size="large" tip="Loading session..." />
            </div>
          )}
          <ChatView
            session={s}
            onSessionNameChange={handleSessionName}
            getSessionSocket={getSessionSocket}
            visible={session?.id === s.id}
            onRunStatusChange={updateSessionRunStatus}
          />
        </div>
      );
    });
  }, [
    sessions,
    session?.id,
    handleSessionName,
    getSessionSocket,
    updateSessionRunStatus,
    isLoading,
    sessionRunStatuses,
  ]);

  // Add cleanup handlers for page unload and connection loss
  useEffect(() => {
    const closeAllSockets = () => {
      Object.values(sessionSockets).forEach(({ socket }) => {
        try {
          socket.close();
        } catch (error) {
          console.error("Error closing socket:", error);
        }
      });
    };

    // Handle page unload/refresh
    window.addEventListener("beforeunload", closeAllSockets);

    // Handle connection loss
    window.addEventListener("offline", closeAllSockets);

    return () => {
      window.removeEventListener("beforeunload", closeAllSockets);
      window.removeEventListener("offline", closeAllSockets);
      closeAllSockets(); // Clean up on component unmount too
    };
  }, []);

  // 监听切换到 Current Session tab 的事件
  useEffect(() => {
    const handleSwitchToCurrentSession = async (event: CustomEvent) => {
      const { agent, newSession } = event.detail;

      // 切换到 Current Session tab
      setActiveSubMenuItem("current_session");

      // 设置选中的agent
      setSelectedAgent(agent);

      // 如果有新创建的Session，设置为当前Session
      if (newSession) {
        try {
          // 将新Session添加到sessions列表中
          setSessions((prevSessions) => [
            newSession,
            ...(Array.isArray(prevSessions) && prevSessions ? prevSessions : []),
          ]);

          // 设置为当前Session
          setSession(newSession);

          // 更新URL
          window.history.pushState(
            {},
            "",
            `?sessionId=${newSession.id}`
          );

          // 保存到localStorage
          saveSessionIdToStorage(newSession.id);

          console.log(
            "New session created and set as current:",
            newSession
          );
        } catch (error) {
          console.error("Error setting new session:", error);
        }
      }
    };

    window.addEventListener(
      "switchToCurrentSession",
      handleSwitchToCurrentSession as EventListener
    );

    return () => {
      window.removeEventListener(
        "switchToCurrentSession",
        handleSwitchToCurrentSession as EventListener
      );
    };
  }, [setSelectedAgent, setSessions, setSession]); // 添加依赖项

  const handleCreateSessionFromPlan = (
    sessionId: number,
    sessionName: string,
    planData: any
  ) => {
    // First select the session
    handleSelectSession({ id: sessionId } as Session);

    // Then dispatch the plan data to the chat component
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
    }, 2000); // Give time for session selection to complete
  };

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

      {/* Sidebar - Full height */}
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
          isLoading={isLoading}
          sessionRunStatuses={sessionRunStatuses}
          activeSubMenuItem={activeSubMenuItem}
          onSubMenuChange={setActiveSubMenuItem}
          onLogoClick={handleLogoClick}
          onStopSession={(sessionId: number) => {
            if (sessionId === undefined || sessionId === null)
              return;
            const id = Number(sessionId);
            // Find the session's socket and close it, update status
            const ws = sessionSockets[id]?.socket;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "stop",
                  reason: "Cancelled by user (sidebar)",
                })
              );
              ws.close();
            }
            setSessionRunStatuses((prev) => ({
              ...prev,
              [id]: "stopped",
            }));
          }}
        />
      </div>

      {/* Main content area - starts from sidebar right edge */}
      <div className={`flex flex-col flex-1 min-h-0 transition-smooth ${isSidebarOpen ? "ml-0 lg:ml-0" : "ml-0"}`}>
        <ContentHeader
          isMobileMenuOpen={isMobileMenuOpen}
          onMobileMenuToggle={() =>
            setIsMobileMenuOpen(!isMobileMenuOpen)
          }
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onNewSession={() => handleEditSession()}
          agentSelector={
            activeSubMenuItem === "current_session" ? (
              <AgentSelectorAdvanced
                agents={agents}
                models={models}
                selectedAgent={selectedAgent}
                onAgentSelect={setSelectedAgent}
                placeholder="Select Your Agent"
                className="w-64"
              />
            ) : null
          }
        />

        {activeSubMenuItem === "current_session" ? (
          session &&
            Array.isArray(sessions) &&
            sessions.length > 0 ? (
            <div className="h-full">
              {chatViews}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-secondary">
              <div className="text-center">
                <Spin size="large" />
                <p className="mt-4 text-sm">Loading...</p>
              </div>
            </div>
          )
        ) : activeSubMenuItem === "agent_square" ? (
          <div className="h-full overflow-hidden">
            <AgentSquare agents={[]} />
          </div>
        ) : (
          <div className="h-full overflow-hidden">
            <PlanList
              onTabChange={setActiveSubMenuItem}
              onSelectSession={handleSelectSession}
              onCreateSessionFromPlan={
                handleCreateSessionFromPlan
              }
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
