import { useCallback, useEffect, useRef } from 'react';
import { getServerUrl } from '../../utils';

interface SessionWebSocket {
  socket: WebSocket;
  runId: string;
}

type SessionWebSockets = {
  [sessionId: number]: SessionWebSocket;
};

export const useWebSocketManager = () => {
  const sessionSocketsRef = useRef<SessionWebSockets>({});

  const getBaseUrl = useCallback((url: string): string => {
    try {
      let baseUrl = url.replace(/(^\w+:|^)\/\//, "");
      if (baseUrl.startsWith("localhost")) {
        baseUrl = baseUrl.replace("/api", "");
      } else if (baseUrl === "/api") {
        const apiPort = process.env.GATSBY_DEV_API_PORT || "8086";
        if (window.location.port && window.location.port !== "80" && window.location.port !== "443") {
          baseUrl = `${window.location.hostname}:${apiPort}`;
        } else {
          baseUrl = window.location.host;
        }
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
    const existing = sessionSocketsRef.current[sessionId];
    if (existing) {
      try {
        existing.socket.close();
      } catch (e) {
        console.warn("Error closing existing socket:", e);
      }
    }

    const serverUrl = getServerUrl();
    const baseUrl = getBaseUrl(serverUrl);
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${baseUrl}/api/ws/runs/${runId}`;

    const socket = new WebSocket(wsUrl);
    const entry: SessionWebSocket = { socket, runId };

    sessionSocketsRef.current = {
      ...sessionSocketsRef.current,
      [sessionId]: entry,
    };

    return socket;
  }, []);

  const getSessionSocket = useCallback((
    sessionId: number,
    runId: string,
    fresh_socket: boolean = false,
    only_retrieve_existing_socket: boolean = false
  ): WebSocket | null => {
    if (fresh_socket) {
      return setupWebSocket(sessionId, runId);
    } else {
      // Use ref for up-to-date socket reference
      const existingSocket = sessionSocketsRef.current[sessionId];

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
  }, [setupWebSocket]);

  const closeSocket = useCallback((sessionId: number) => {
    const existing = sessionSocketsRef.current[sessionId];
    if (existing) {
      try {
        existing.socket.close();
      } catch (e) {
        console.warn("Error closing socket:", e);
      }
      const updated = { ...sessionSocketsRef.current };
      delete updated[sessionId];
      sessionSocketsRef.current = updated;
    }
  }, []);

  const stopSession = useCallback((sessionId: number) => {
    const ws = sessionSocketsRef.current[sessionId]?.socket;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "stop",
          reason: "Cancelled by user",
        })
      );
      ws.close();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const closeAllSockets = () => {
      Object.values(sessionSocketsRef.current).forEach(({ socket }) => {
        try {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        } catch (error) {
          console.error("Error closing socket:", error);
        }
      });
    };

    window.addEventListener("beforeunload", closeAllSockets);
    window.addEventListener("offline", closeAllSockets);

    return () => {
      window.removeEventListener("beforeunload", closeAllSockets);
      window.removeEventListener("offline", closeAllSockets);
      closeAllSockets();
    };
  }, []);

  return {
    getSessionSocket,
    closeSocket,
    stopSession,
  };
};

