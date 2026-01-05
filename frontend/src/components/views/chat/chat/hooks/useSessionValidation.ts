import { useConfigStore } from "../../../../../hooks/store";

/**
 * Hook for validating and retrieving session ID
 */
export const useSessionValidation = (sessionId: number) => {
  const { session: storeSession } = useConfigStore();

  const getValidSessionId = (): number | null => {
    // 1. First check the passed sessionId
    if (sessionId && typeof sessionId === "number" && sessionId > 0) {
      return sessionId;
    }

    // 2. If passed sessionId is invalid, get from store
    if (
      storeSession?.id &&
      typeof storeSession.id === "number" &&
      storeSession.id > 0
    ) {
      return storeSession.id;
    }

    // 3. If not in store, try to get from localStorage
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("current_session_id");
      if (stored) {
        const parsedId = parseInt(stored, 10);
        if (!isNaN(parsedId) && parsedId > 0) {
          return parsedId;
        }
      }
    }

    console.warn("No valid sessionId found");
    return null;
  };

  return { getValidSessionId };
};

