/**
 * LocalStorage utilities for session persistence
 */

const SESSION_STORAGE_KEY = 'current_session_id';
const SELECTED_AGENT_KEY = 'selected_agent';

export const useSessionStorage = () => {
  const saveSessionId = (sessionId: number | null) => {
    if (typeof window !== "undefined") {
      if (sessionId) {
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId.toString());
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  };

  const getSessionId = (): number | null => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      return stored ? parseInt(stored, 10) : null;
    }
    return null;
  };

  return { saveSessionId, getSessionId };
};

