import { message, Spin } from "antd";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { parse } from "yaml";
import { appContext } from "@/hooks/provider";
import { useConfigStore } from "../../hooks/store";
import { useModeConfigStore } from "../../store/modeConfig";
import { Agent } from "../../types/common";
import ContentHeader from "../contentheader";
import { AgentSquare } from "../features/Agents/AgentSquare";
import PlanList from "../features/Plans/PlanList";
import type { Session } from "../types/datamodel";
import { RunStatus } from "../types/datamodel";
import { getServerUrl } from "../utils";
import { agentAPI, sessionAPI, settingsAPI } from "./api";
import ChatView from "./chat/chat";
import NewChatView from "./chat/NewChatView";
import { SessionEditor } from "./session_editor";
import { Sidebar } from "./sidebar";


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
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [pendingFirstMessage, setPendingFirstMessage] = useState<{
    query: string;
    files: any[];
    plan?: any;
    uploadedFileData?: Record<string, any>;
  } | null>(null);
  const [isIntentionalSessionClear, setIsIntentionalSessionClear] = useState(false); // 标记用户主动清空session

  // 使用 ref 来同步标记，避免状态更新延迟导致的时序问题
  const isIntentionalSessionClearRef = React.useRef(false);

  const { user } = useContext(appContext);
  const { session, setSession, sessions, setSessions } = useConfigStore();
  const [baseUrl, setBaseUrl] = React.useState<string | undefined>();
  const { selectedAgent, setSelectedAgent, setMode, setConfig } = useModeConfigStore();
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

  const handleAgentList = async () => {
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
      handleAgentList();
    }
  }, [user?.email]);


  React.useEffect(() => {
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


  const fetchSessions = useCallback(async () => {
    if (!user?.email) return;

    try {
      setIsLoading(true);
      const data = await sessionAPI.listSessions(user.email);
      setSessions(data);

      // Only set first session if there's no sessionId in URL
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("sessionId");
      if (!session && data.length > 0 && !sessionId && !isIntentionalSessionClearRef.current) {
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

  // Save session to localStorage when it changes
  useEffect(() => {
    if (session?.id) {
      saveSessionIdToStorage(session.id);
    } else {
      saveSessionIdToStorage(null);
    }
  }, [session?.id]);
  const handleSelectSession = async (selectedSession: Session) => {
    if (!user?.email || !selectedSession?.id) return;

    // 防止重复调用
    if (isSessionLoading) {
      return;
    }

    try {
      setActiveSubMenuItem("current_session");
      setIsLoading(true);
      setIsSessionLoading(true);

      const data = await sessionAPI.getSession(
        selectedSession.id,
        user.email
      );
      if (!data) {
        // Session not found - 清除无效的sessionId
        saveSessionIdToStorage(null);
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

      // 重置清空标志，因为用户选择了一个会话
      isIntentionalSessionClearRef.current = false;
      setIsIntentionalSessionClear(false);

      // 如果后端返回了 agent 名称，则同步更新全局选中智能体，便于 ContentHeader 展示
      if (data.agent_mode_config) {
        console.log('[加载 session] 同步 selectedAgent.mode:', data.agent_mode_config.mode);

        setSelectedAgent(data.agent_mode_config);
        setMode(data.agent_mode_config.mode);
        // 同步加载该智能体的后端配置，避免运行时报 AssistantAgent 配置为空
        try {
          const agentConfig = await agentAPI.getAgentConfig(user.email, data.agent_mode_config.mode);
          if (agentConfig) {
            setConfig(agentConfig.config);
          }
        } catch (e) {
          console.warn("Failed to load agent config for matched agent:", e);
        }
      }
      window.history.pushState(
        {},
        "",
        `?sessionId=${selectedSession.id}`
      );
    } catch (error) {
      console.error("Error loading session:", error);
      // 如果是"Failed to fetch session"错误，清除localStorage中的无效sessionId
      if (error instanceof Error && error.message.includes("Failed to fetch session")) {
        saveSessionIdToStorage(null);
      }
      messageApi.error("Error loading session");
      window.history.pushState({}, "", window.location.pathname); // Clear invalid URL
      if (Array.isArray(sessions) && sessions.length > 0) {
        setSession(sessions[0]); // Fall back to first session
        // 同时更新agent信息
        if (sessions[0].agent_mode_config) {
          setSelectedAgent(sessions[0].agent_mode_config);
          setMode(sessions[0].agent_mode_config.mode || "");
        } else {
          setSelectedAgent(null);
          setMode("");
          setConfig({});
        }
      } else {
        setSession(null);
        setSelectedAgent(null);
        setMode("");
        setConfig({});
      }
    } finally {
      setIsLoading(false);
      setIsSessionLoading(false);
    }
  };
  // Restore sessionId on component initialization


  // Initialize session on refresh
  useEffect(() => {
    const initializeSessionOnRefresh = async () => {
      const storedSessionId = getSessionIdFromStorage();

      if (storedSessionId && !session) {
        // Restoring session from localStorage
      }

      if (!storedSessionId) {
        const params = new URLSearchParams(window.location.search);
        const urlSessionId = params.get("sessionId");
        if (urlSessionId && !session) {
          // Restoring session from URL
        }
      }

      // 只在非主动清空的情况下自动选择第一个 session
      // 使用 ref 来检查，避免状态更新延迟
      if (!session &&
        Array.isArray(sessions) &&
        sessions.length > 0 &&
        !isIntentionalSessionClearRef.current) {
        // No stored session, selecting first available session
        // 但不在用户主动切换智能体时自动选择
        setSession(sessions[0]);
        if (sessions[0].id) {
          saveSessionIdToStorage(sessions[0].id);
        }
      }
    };

    initializeSessionOnRefresh();
  }, [sessions, session, setSession, isIntentionalSessionClear]);

  useEffect(() => {
    const delayReload = async () => {
      // 防止竞态条件：如果正在加载session或者正在删除session，则不执行
      if (isSessionLoading || isLoading) {
        return;
      }

      // 如果用户主动清空了 session，不要自动恢复
      // 使用 ref 来检查，避免状态更新延迟
      if (isIntentionalSessionClearRef.current) {
        return;
      }

      const storedSessionId = getSessionIdFromStorage();

      if (storedSessionId && !session) {
        // console.log('[delayReload] 从 localStorage 恢复 session:', storedSessionId);
        setIsSessionLoading(true);
        try {
          await handleSelectSession({ id: storedSessionId } as Session);
        } catch (error) {
          console.error('Error in delayReload:', error);
          // 如果获取session失败，清除localStorage中的无效sessionId
          saveSessionIdToStorage(null);
        } finally {
          setIsSessionLoading(false);
        }
      }
    };

    // 添加延迟执行，避免在快速状态变化时重复触发
    const timeoutId = setTimeout(delayReload, 100);

    return () => clearTimeout(timeoutId);
  }, [session, handleSelectSession, isSessionLoading, isLoading, isIntentionalSessionClear]);
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
        const curSession = sessions.find((s) => s.id === sessionData.id);
        if (!curSession) return;
        curSession.name = sessionData.name || curSession.name;
        const updated = await sessionAPI.updateSession(
          sessionData.id,
          curSession,
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
        setSelectedAgent({
          mode: "magentic-one",
          name: "Dr.Sai General",
        });
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
            agent_mode_config: {
              mode: "magentic-one",
              name: "Dr.Sai General",
            },
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

  // 点击 Agent：只选中智能体，不创建会话
  const handleAgentClick = async (agent: Agent) => {
    if (!user?.email) return;

    // console.log('[点击 Agent] 收到的 agent 对象:', agent.mode, agent.name);

    // 检查是否切换到不同的智能体
    const isDifferentAgent = selectedAgent?.mode !== agent.mode;

    try {
      setIsLoading(true);

      setSelectedAgent(agent);
      setConfig({ mode: agent.mode });

      // 只有在切换到不同智能体时才清空当前会话
      if (isDifferentAgent) {
        // 同步设置 ref，避免状态更新延迟
        isIntentionalSessionClearRef.current = true;
        setIsIntentionalSessionClear(true); // 标记为用户主动清空
        setSession(null);
        saveSessionIdToStorage(null); // 清除 localStorage 中的 sessionId，防止自动恢复
        window.history.replaceState({}, '', window.location.pathname); // 清除 URL 中的 sessionId

        // 延迟一下再重置 loading 状态，确保状态更新完成
        setTimeout(() => {
          setIsLoading(false);
        }, 100);
        return; // 提前返回，不要继续执行
      }

      setActiveSubMenuItem("current_session");
    } catch (e) {
      messageApi.error("Failed to select agent");
      console.error(e);
    } finally {
      if (!isDifferentAgent) {
        setIsLoading(false);
      }
    }
  };

  // 处理新对话的第一条消息：创建会话并设置待发送的消息
  const handleNewChatFirstMessage = async (
    agent: Agent,
    query: string,
    files: any[] = [],
    plan?: any,
    uploadedFileData?: Record<string, any>
  ) => {
    if (!user?.email) {
      messageApi.error("User not logged in");
      return;
    }

    // console.log('[创建新会话] agent.mode:', agent.mode, 'agent.name:', agent.name);

    try {
      setIsLoading(true);

      // 1. 保存待发送的消息
      setPendingFirstMessage({ query, files, plan, uploadedFileData });

      // 2. 创建新会话
      const agentModeConfig = {
        mode: agent.mode,
        name: agent.name,
        description: agent.description,
        url: agent.config?.url,
        apikey: agent.config?.apikey,
      };

      const sessionData = {
        name: query.slice(0, 50) || `${agent.name} Chat`,
        agent_mode_config: agentModeConfig,
      };

      // console.log('[发送给后端] session 数据:', sessionData);

      const created = await sessionAPI.createSession(
        sessionData,
        user.email
      );

      // console.log('[会话已创建] 完整数据:', created.id, created.agent_mode_config?.mode);

      // 3. 更新会话列表和当前会话
      setSessions([
        created,
        ...(Array.isArray(sessions) && sessions ? sessions : []),
      ]);
      setSession(created);

      // 重置标志，因为已经创建了新会话
      isIntentionalSessionClearRef.current = false;
      setIsIntentionalSessionClear(false);

      // ChatView 会检测到 session 的变化和 pendingFirstMessage，然后自动发送消息
    } catch (e) {
      messageApi.error("创建会话失败");
      console.error(e);
      setPendingFirstMessage(null); // 清除待发送消息
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
      // 创建新会话（恢复原来的逻辑）
      setSelectedAgent({
        mode: "magentic-one",
        name: "Dr.Sai General",
      });
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

      // 检查是否删除的是当前选中的session
      const isDeletingCurrentSession = session?.id === sessionId;

      // 更新sessions列表
      const updatedSessions = Array.isArray(sessions)
        ? sessions.filter((s) => s.id !== sessionId)
        : [];
      setSessions(updatedSessions);

      if (isDeletingCurrentSession) {
        // 删除的是当前选中的session，先清除localStorage中的sessionId，避免竞态条件
        saveSessionIdToStorage(null);

        // 关闭当前session相关的WebSocket连接
        if (sessionSockets[sessionId]) {
          sessionSockets[sessionId].socket.close();
          setSessionSockets((prev) => {
            const updated = { ...prev };
            delete updated[sessionId];
            return updated;
          });
        }

        // 清除当前session状态，确保不会再尝试获取被删除的session
        setSession(null);
        setSelectedAgent({
          mode: "magentic-one",
          name: "Dr.Sai General",
        });
        setMode("magentic-one");
        setConfig({});


        if (updatedSessions.length > 0) {
          // 检查第一个session是否是default session
          const firstSession = updatedSessions[0];
          const isFirstSessionDefault = firstSession.name && firstSession.name.startsWith("Default Session - ");


          if (isFirstSessionDefault) {
            // 如果第一个session是default session，直接选中它
            setSession(firstSession);
            if (firstSession.id) {
              window.history.pushState({}, "", `?sessionId=${firstSession.id}`);
            }
          } else {
            // 如果第一个session不是default session，创建新的default session
            await new Promise(resolve => setTimeout(resolve, 0));
            await createDefaultSession();
          }
        } else {
          // 如果没有其他session了，创建新的default session
          await createDefaultSession();
        }
        // 清除URL参数
        window.history.pushState({}, "", window.location.pathname);
      } else {
        // 只需要确保当前session仍然有效
        if (session && !updatedSessions.find(s => s.id === session.id)) {
          // 如果当前session被删除了，选择第一个可用的session
          if (updatedSessions.length > 0) {
            setSession(updatedSessions[0]);
            if (updatedSessions[0].id) {
              window.history.pushState({}, "", `?sessionId=${updatedSessions[0].id}`);
            }
          } else {
            setSession(null);
          }
        }
      }

      messageApi.success("Session deleted");
    } catch (error) {
      console.error("Error deleting session:", error);
      messageApi.error("Error deleting session");
    } finally {
      setIsLoading(false);
    }
  };



  const handleSessionName = async (sessionData: Partial<Session>) => {
    if (!sessionData.id || !user?.email) return;

    // Check if current session name matches default pattern
    const currentSession = sessions.find((s) => s.id === sessionData.id);
    if (!currentSession) return;
    currentSession.name = sessionData.name || currentSession.name;
    // Only update if it starts with "Default Session - "

    try {
      const updated = await sessionAPI.updateSession(
        sessionData.id,
        currentSession,
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
  };

  const getBaseUrl = useCallback((url: string): string => {
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
  }, []);

  const setupWebSocket = useCallback((sessionId: number, runId: string): WebSocket => {
    // Close existing socket for this session if it exists
    if (sessionSockets[sessionId]) {
      sessionSockets[sessionId].socket.close();
    }

    const serverUrl = getServerUrl();
    const baseUrl = getBaseUrl(serverUrl);
    // TODO: 适配wss
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
  }, [sessionSockets, getBaseUrl]);

  const getSessionSocket = useCallback((
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
  }, [sessionSockets, setupWebSocket]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const updateSessionRunStatus = useCallback((sessionId: number, status: RunStatus) => {
    setSessionRunStatuses((prev) => ({
      ...prev,
      [sessionId]: status,
    }));
  }, []);

  const createDefaultSession = useCallback(async () => {
    console.log('createSession-------------------', session);
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
          agent_mode_config: {},
        },
        user.email
      );
      setSessions([
        created,
        ...(Array.isArray(sessions) && sessions ? sessions : []),
      ]);
      setSession(created);
      if (created.id) {
        window.history.pushState({}, "", `?sessionId=${created.id}`);
      }

    } catch (error) {
      console.error("Error creating default session:", error);
      messageApi.error("Error creating default session");
    } finally {
      setIsLoading(false);
    }
  }, [user?.email, sessions, setSessions, setSession, messageApi]);

  const chatViews = useMemo(() => {
    // 确保sessions是数组
    if (!Array.isArray(sessions)) {
      console.warn("sessions is not an array:", sessions);
      return [];
    }

    // 如果没有选中任何 session，直接返回空数组
    if (!session) {
      return [];
    }

    return sessions.map((s: Session) => {
      if (!s.id) return null; // 跳过没有id的session

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
            pendingFirstMessage={session?.id === s.id ? pendingFirstMessage : null}
            onPendingMessageSent={() => setPendingFirstMessage(null)}
          />
        </div>
      );
    });
  }, [
    sessions,
    session,  // 使用完整的 session 对象，而不只是 session?.id
    handleSessionName,
    getSessionSocket,
    updateSessionRunStatus,
    isLoading,
    sessionRunStatuses,
    pendingFirstMessage,
  ]);

  // Add cleanup handlers for page unload and connection loss
  useEffect(() => {
    const closeAllSockets = () => {
      Object.values(sessionSockets).forEach(({ socket }) => {
        try {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
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
  }, [sessionSockets]);

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
          const currentSessions = Array.isArray(sessions) ? sessions : [];
          setSessions([newSession, ...currentSessions]);

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
  }, [setSelectedAgent, setSessions, setSession]); // 添加依赖项

  const handleCreateSessionFromPlan = useCallback((
    sessionId: number,
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
  }, [handleSelectSession]);

  const handleDeleteAgent = async (id: string) => {
    if (!user?.email) return;

    try {
      setIsLoading(true);
      // 调用删除接口
      await agentAPI.deleteMainAgent(user.email, id);
      // 调用list接口
      const updatedAgents = await agentAPI.getAgentList(user.email);
      // 更新agents列表
      setAgents(updatedAgents);

      messageApi.success(`Agent deleted successfully`);
    } catch (error) {
      console.error("Error deleting agent:", error);
      messageApi.error("Failed to delete agent");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAgentWrapper = async (id: string) => {

    await handleDeleteAgent(id);
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
          agents={agents}
          selectedAgentMode={selectedAgent?.mode}
          onAgentClick={handleAgentClick}
          onDeleteAgent={handleDeleteAgentWrapper}
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
          agentSelector={null}
          activeSubMenuItem={activeSubMenuItem}
        />


        {activeSubMenuItem === "current_session" ? (
          (() => {
            if (session) {
              return (
                // 有当前会话 - 显示 ChatView
                <div className="h-full">
                  {chatViews}
                </div>
              );
            } else if (selectedAgent && selectedAgent.name) {
              return (
                // 用户选中了智能体但没有会话 - 显示新对话视图
                <NewChatView
                  agent={selectedAgent as Agent}
                  onSubmit={async (agent, query, files, plan, uploadedFileData) => {
                    await handleNewChatFirstMessage(
                      agent,  // 使用 NewChatView 传递过来的 agent，而不是闭包中的 selectedAgent
                      query,
                      files,
                      plan,
                      uploadedFileData
                    );
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
            <AgentSquare
              agents={[]}
              handleAgentList={handleAgentList}
              existingAgents={agents}
            />
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
