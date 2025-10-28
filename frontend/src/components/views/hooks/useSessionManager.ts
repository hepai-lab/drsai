import { useState, useCallback, useEffect, useRef } from 'react';
import { Session, RunStatus } from '../../types/datamodel';
import { Agent } from '../../../types/common';
import { sessionAPI, agentAPI } from '../api';
import { useConfigStore } from '../../../hooks/store';
import { useModeConfigStore } from '../../../store/modeConfig';
import { useSessionStorage } from './useSessionStorage';

interface UseSessionManagerProps {
  userEmail: string | undefined;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export const useSessionManager = ({ userEmail, onSuccess, onError }: UseSessionManagerProps) => {
  const { session, setSession, sessions, setSessions } = useConfigStore();
  const { selectedAgent, setSelectedAgent, setMode, setConfig } = useModeConfigStore();
  const { saveSessionId, getSessionId } = useSessionStorage();

  const [isLoading, setIsLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [sessionRunStatuses, setSessionRunStatuses] = useState<{ [sessionId: number]: RunStatus }>({});
  const [pendingFirstMessage, setPendingFirstMessage] = useState<{
    query: string;
    files: any[];
    plan?: any;
    uploadedFileData?: Record<string, any>;
  } | null>(null);

  // 标记用户主动清空session（使用 ref 避免状态更新延迟）
  const [isIntentionalSessionClear, setIsIntentionalSessionClear] = useState(false);
  const isIntentionalSessionClearRef = useRef(false);

  // Fetch sessions from API
  const fetchSessions = useCallback(async () => {
    if (!userEmail) return;

    try {
      setIsLoading(true);
      const data = await sessionAPI.listSessions(userEmail);
      setSessions(data);

      // Only set first session if there's no sessionId in URL and user didn't intentionally clear
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("sessionId");
      if (!session && data.length > 0 && !sessionId && !isIntentionalSessionClearRef.current) {
        setSession(data[0]);
      } else {
        if (data.length === 0) {
          await createDefaultSession();
        }
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
      onError?.("Error loading sessions");
    } finally {
      setIsLoading(false);
    }
  }, [userEmail, setSessions, session, setSession, isIntentionalSessionClearRef.current]);

  // Select a session
  const selectSession = useCallback(async (selectedSession: Session) => {
    if (!userEmail || !selectedSession?.id || isSessionLoading) return;

    try {
      setIsLoading(true);
      setIsSessionLoading(true);

      const data = await sessionAPI.getSession(selectedSession.id, userEmail);
      
      if (!data) {
        saveSessionId(null);
        onError?.("Session not found");
        window.history.pushState({}, "", window.location.pathname);
        
        if (Array.isArray(sessions) && sessions.length > 0) {
          setSession(sessions[0]);
        } else {
          setSession(null);
        }
        return;
      }

      setSession(data);

      // 重置清空标志
      isIntentionalSessionClearRef.current = false;
      setIsIntentionalSessionClear(false);

      // 同步更新全局选中智能体
      if (data.agent_mode_config) {
        setSelectedAgent(data.agent_mode_config);
        setMode(data.agent_mode_config.mode);
        
        try {
          const agentConfig = await agentAPI.getAgentConfig(userEmail, data.agent_mode_config.mode);
          if (agentConfig) {
            setConfig(agentConfig.config);
          }
        } catch (e) {
          console.warn("Failed to load agent config:", e);
        }
      }
      
      window.history.pushState({}, "", `?sessionId=${selectedSession.id}`);
    } catch (error) {
      console.error("Error loading session:", error);
      
      if (error instanceof Error && error.message.includes("Failed to fetch session")) {
        saveSessionId(null);
      }
      
      onError?.("Error loading session");
      window.history.pushState({}, "", window.location.pathname);
      
      if (Array.isArray(sessions) && sessions.length > 0) {
        setSession(sessions[0]);
        if (sessions[0].agent_mode_config) {
          setSelectedAgent(sessions[0].agent_mode_config);
          setMode(sessions[0].agent_mode_config.mode || "");
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
  }, [userEmail, isSessionLoading, sessions, setSession, setSelectedAgent, setMode, setConfig, saveSessionId, onError]);

  // Create default session
  const createDefaultSession = useCallback(async () => {
    if (!userEmail) return;

    try {
      setIsLoading(true);
      const defaultName = `Default Session - ${new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`;

      const created = await sessionAPI.createSession(
        {
          name: defaultName,
          agent_mode_config: {},
        },
        userEmail
      );
      
      setSessions([created, ...(Array.isArray(sessions) ? sessions : [])]);
      setSession(created);
      
      if (created.id) {
        window.history.pushState({}, "", `?sessionId=${created.id}`);
      }
    } catch (error) {
      console.error("Error creating default session:", error);
      onError?.("Error creating default session");
    } finally {
      setIsLoading(false);
    }
  }, [userEmail, sessions, setSessions, setSession, onError]);

  // Create new chat session with first message
  const createNewChatSession = useCallback(async (
    agent: Agent,
    query: string,
    files: any[] = [],
    plan?: any,
    uploadedFileData?: Record<string, any>
  ) => {
    if (!userEmail) {
      onError?.("User not logged in");
      return;
    }

    try {
      setIsLoading(true);

      // 1. 保存待发送的消息
      setPendingFirstMessage({ query, files, plan, uploadedFileData });

      // 2. 创建新会话
      const sessionData = {
        name: query.slice(0, 50) || `${agent.name} Chat`,
        agent_mode_config: {
          mode: agent.mode,
          name: agent.name,
          description: agent.description,
          url: agent.config?.url,
          apikey: agent.config?.apikey,
        },
      };

      const created = await sessionAPI.createSession(sessionData, userEmail);

      // 3. 更新会话列表和当前会话
      setSessions([created, ...(Array.isArray(sessions) ? sessions : [])]);
      setSession(created);

      // 重置标志
      isIntentionalSessionClearRef.current = false;
      setIsIntentionalSessionClear(false);
    } catch (e) {
      onError?.("创建会话失败");
      console.error(e);
      setPendingFirstMessage(null);
    } finally {
      setIsLoading(false);
    }
  }, [userEmail, sessions, setSessions, setSession, onError]);

  // Update session
  const updateSession = useCallback(async (sessionData: Partial<Session>) => {
    if (!userEmail) return;

    try {
      setIsLoading(true);
      
      if (sessionData.id) {
        const curSession = sessions.find((s) => s.id === sessionData.id);
        if (!curSession) return;
        
        curSession.name = sessionData.name || curSession.name;
        const updated = await sessionAPI.updateSession(sessionData.id, curSession, userEmail);

        setSessions(
          Array.isArray(sessions)
            ? sessions.map((s) => (s.id === updated.id ? updated : s))
            : [updated]
        );
        
        if (session?.id === updated.id) {
          setSession(updated);
        }
      } else {
        // Create new session
        setSelectedAgent({
          mode: "magentic-one",
          name: "Dr.Sai General",
        });
        
        const created = await sessionAPI.createSession(
          {
            ...sessionData,
            name: `Default Session - ${new Date().toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}`,
            agent_mode_config: {
              mode: "magentic-one",
              name: "Dr.Sai General",
            },
          },
          userEmail
        );

        setSessions([created, ...(Array.isArray(sessions) ? sessions : [])]);
        setSession(created);
      }
    } catch (error) {
      onError?.("Error saving session");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [userEmail, sessions, session, setSessions, setSession, setSelectedAgent, onError]);

  // Update session name only
  const updateSessionName = useCallback(async (sessionData: Partial<Session>) => {
    if (!sessionData.id || !userEmail) return;

    const currentSession = sessions.find((s) => s.id === sessionData.id);
    if (!currentSession) return;
    
    currentSession.name = sessionData.name || currentSession.name;

    try {
      const updated = await sessionAPI.updateSession(sessionData.id, currentSession, userEmail);

      setSessions(
        Array.isArray(sessions)
          ? sessions.map((s) => (s.id === updated.id ? updated : s))
          : [updated]
      );
      
      if (session?.id === updated.id) {
        setSession(updated);
      }
    } catch (error) {
      console.error("Error updating session name:", error);
      onError?.("Error updating session name");
    }
  }, [userEmail, sessions, session, setSessions, setSession, onError]);

  // Delete session
  const deleteSession = useCallback(async (sessionId: number, closeSocket: (id: number) => void) => {
    if (!userEmail) return;

    try {
      setIsLoading(true);
      
      // Close socket
      closeSocket(sessionId);

      await sessionAPI.deleteSession(sessionId, userEmail);

      const isDeletingCurrentSession = session?.id === sessionId;
      const updatedSessions = Array.isArray(sessions)
        ? sessions.filter((s) => s.id !== sessionId)
        : [];
      
      setSessions(updatedSessions);

      if (isDeletingCurrentSession) {
        saveSessionId(null);
        closeSocket(sessionId);
        
        setSession(null);
        setSelectedAgent({ mode: "magentic-one", name: "Dr.Sai General" });
        setMode("magentic-one");
        setConfig({});

        if (updatedSessions.length > 0) {
          const firstSession = updatedSessions[0];
          const isFirstSessionDefault = firstSession.name?.startsWith("Default Session - ");

          if (isFirstSessionDefault) {
            setSession(firstSession);
            if (firstSession.id) {
              window.history.pushState({}, "", `?sessionId=${firstSession.id}`);
            }
          } else {
            await new Promise(resolve => setTimeout(resolve, 0));
            await createDefaultSession();
          }
        } else {
          await createDefaultSession();
        }
        
        window.history.pushState({}, "", window.location.pathname);
      } else {
        if (session && !updatedSessions.find(s => s.id === session.id)) {
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

      onSuccess?.("Session deleted");
    } catch (error) {
      console.error("Error deleting session:", error);
      onError?.("Error deleting session");
    } finally {
      setIsLoading(false);
    }
  }, [userEmail, session, sessions, setSessions, setSession, setSelectedAgent, setMode, setConfig, saveSessionId, createDefaultSession, onSuccess, onError]);

  // Clear current session (when switching agents)
  const clearCurrentSession = useCallback(() => {
    isIntentionalSessionClearRef.current = true;
    setIsIntentionalSessionClear(true);
    setSession(null);
    saveSessionId(null);
    window.history.replaceState({}, '', window.location.pathname);
  }, [setSession, saveSessionId]);

  // Update session run status
  const updateSessionRunStatus = useCallback((sessionId: number, status: RunStatus) => {
    setSessionRunStatuses((prev) => ({ ...prev, [sessionId]: status }));
  }, []);

  // Auto-restore session from localStorage
  useEffect(() => {
    if (isSessionLoading || isLoading || isIntentionalSessionClearRef.current) return;

    const storedSessionId = getSessionId();
    
    if (storedSessionId && !session) {
      const timeoutId = setTimeout(async () => {
        setIsSessionLoading(true);
        try {
          await selectSession({ id: storedSessionId } as Session);
        } catch (error) {
          console.error('Error restoring session:', error);
          saveSessionId(null);
        } finally {
          setIsSessionLoading(false);
        }
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [session, isSessionLoading, isLoading, getSessionId, selectSession, saveSessionId]);

  // Auto-select first session if no session selected
  useEffect(() => {
    if (!session && Array.isArray(sessions) && sessions.length > 0 && !isIntentionalSessionClearRef.current) {
      setSession(sessions[0]);
      if (sessions[0].id) {
        saveSessionId(sessions[0].id);
      }
    }
  }, [sessions, session, setSession, saveSessionId]);

  // Save session to localStorage when it changes
  useEffect(() => {
    if (session?.id) {
      saveSessionId(session.id);
    } else {
      saveSessionId(null);
    }
  }, [session?.id, saveSessionId]);

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
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, [session, setSession]);

  return {
    // State
    session,
    sessions,
    isLoading,
    isSessionLoading,
    sessionRunStatuses,
    pendingFirstMessage,
    isIntentionalSessionClear,
    
    // Actions
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
  };
};

