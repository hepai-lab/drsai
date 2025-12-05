import { useState, useCallback, useEffect, useRef } from 'react';
import { Session, RunStatus } from '../../types/datamodel';
import { Agent } from '../../../types/common';
import { sessionAPI, agentAPI } from '../api';
import { useConfigStore } from '../../../hooks/store';
import { useModeConfigStore } from '../../../store/modeConfig';
import { useSessionStorage } from './useSessionStorage';
import { buildAgentModeConfig, normalizeAgentModeConfig, DEFAULT_AGENT_MODE_CONFIG } from '@/utils/agent';

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
  } | null>(null);

  // 标记用户主动清空session（使用 ref 避免状态更新延迟）
  const [isIntentionalSessionClear, setIsIntentionalSessionClear] = useState(false);
  const isIntentionalSessionClearRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const lastUserEmailRef = useRef(userEmail);
  
  // Reset initialization flag when user changes
  if (lastUserEmailRef.current !== userEmail) {
    lastUserEmailRef.current = userEmail;
    hasInitializedRef.current = false;
  }

  // Fetch sessions from API
  const fetchSessions = useCallback(async () => {
    if (!userEmail) return;

    try {
      setIsLoading(true);
      const data = await sessionAPI.listSessions(userEmail);
      setSessions(data);

      // Only auto-load session on initial fetch
      if (!hasInitializedRef.current) {
        hasInitializedRef.current = true;
        
        // Check URL params - only load session if explicitly specified in URL
        const params = new URLSearchParams(window.location.search);
        const urlSessionId = params.get("sessionId");
        
        if (urlSessionId) {
          // Load session from URL
          const sessionIdNum = parseInt(urlSessionId, 10);
          const sessionToLoad = data.find(s => s.id === sessionIdNum) || null;
          
          if (sessionToLoad && !session) {
            try {
              const fullSessionData = await sessionAPI.getSession(sessionToLoad.id!, userEmail);
              setSession(fullSessionData);
              
              // Reset intentional clear flag
              isIntentionalSessionClearRef.current = false;
              setIsIntentionalSessionClear(false);
              
              // Update agent config
              if (fullSessionData.agent_mode_config) {
                const normalizedAgent = normalizeAgentModeConfig(fullSessionData.agent_mode_config) || DEFAULT_AGENT_MODE_CONFIG;
                fullSessionData.agent_mode_config = normalizedAgent;
                setSelectedAgent(normalizedAgent);
                setMode(normalizedAgent.mode || "");
                
                if (normalizedAgent.mode) {
                  try {
                    const agentConfig = await agentAPI.getAgentConfig(userEmail, normalizedAgent.mode);
                    if (agentConfig) {
                      setConfig(agentConfig.config);
                    }
                  } catch (e) {
                    console.warn("Failed to load agent config:", e);
                  }
                }
              }
              
              window.history.pushState({}, "", `?sessionId=${sessionToLoad.id}`);
            } catch (error) {
              console.error("Error loading session details:", error);
            }
          }
        } else {
          // No URL sessionId - clear localStorage and don't auto-load any session
          // This ensures we always show welcome page when opening the app fresh
          saveSessionId(null);
          setSession(null);
          window.history.replaceState({}, '', window.location.pathname);
        }
        // The selected agent will be restored from localStorage separately
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
      onError?.("Error loading sessions");
    } finally {
      setIsLoading(false);
    }
  }, [userEmail]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: This should only depend on userEmail to avoid infinite loops
  // Other dependencies (setSessions, setSession, etc.) are stable from stores
  // session state is checked inside but shouldn't trigger refetch

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
        const normalizedAgent = normalizeAgentModeConfig(data.agent_mode_config) || DEFAULT_AGENT_MODE_CONFIG;
        data.agent_mode_config = normalizedAgent;
        setSelectedAgent(normalizedAgent);
        setMode(normalizedAgent.mode || "");
        
        if (normalizedAgent.mode) {
          try {
            const agentConfig = await agentAPI.getAgentConfig(userEmail, normalizedAgent.mode);
            if (agentConfig) {
              setConfig(agentConfig.config);
            }
          } catch (e) {
            console.warn("Failed to load agent config:", e);
          }
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
          const normalizedAgent = normalizeAgentModeConfig(sessions[0].agent_mode_config) || DEFAULT_AGENT_MODE_CONFIG;
          setSelectedAgent(normalizedAgent);
          setMode(normalizedAgent.mode || "");
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
          agent_mode_config: buildAgentModeConfig(DEFAULT_AGENT_MODE_CONFIG),
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
    plan?: any
  ) => {
    if (!userEmail) {
      onError?.("User not logged in");
      return;
    }

    try {
      setIsLoading(true);

      // 1. 保存待发送的消息
      setPendingFirstMessage({ query, files, plan });

      // 2. 创建新会话
      const sessionData = {
        name: query.slice(0, 50) || `${agent.name} Chat`,
        agent_mode_config: buildAgentModeConfig(agent),
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
        setSelectedAgent(DEFAULT_AGENT_MODE_CONFIG);
        
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
            agent_mode_config: buildAgentModeConfig(DEFAULT_AGENT_MODE_CONFIG),
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
        
        // 清空当前会话，不创建默认 session
        // 保持当前选中的 agent 不变
        setSession(null);
        
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
  }, [userEmail, session, sessions, setSessions, setSession, saveSessionId, onSuccess, onError]);

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

  // Note: Auto-restore session from localStorage is now handled in fetchSessions
  // This ensures the session from localStorage is properly validated against DB data

  // Note: Auto-select first session is now handled in fetchSessions
  // This avoids race conditions and ensures proper session selection priority

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

