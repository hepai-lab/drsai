import { useState, useCallback, useEffect } from 'react';
import { getServerUrl } from '../../utils';

interface SessionWebSocket {
  socket: WebSocket;
  runId: string;
}

type SessionWebSockets = {
  [sessionId: number]: SessionWebSocket;
};

export const useWebSocketManager = () => {
  const [sessionSockets, setSessionSockets] = useState<SessionWebSockets>({});

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
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
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

  const closeSocket = useCallback((sessionId: number) => {
    if (sessionSockets[sessionId]) {
      sessionSockets[sessionId].socket.close();
      setSessionSockets((prev) => {
        const updated = { ...prev };
        delete updated[sessionId];
        return updated;
      });
    }
  }, [sessionSockets]);

  const stopSession = useCallback((sessionId: number) => {
    const ws = sessionSockets[sessionId]?.socket;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "stop",
          reason: "Cancelled by user",
        })
      );
      ws.close();
    }
  }, [sessionSockets]);

  // Cleanup on unmount
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

    window.addEventListener("beforeunload", closeAllSockets);
    window.addEventListener("offline", closeAllSockets);

    return () => {
      window.removeEventListener("beforeunload", closeAllSockets);
      window.removeEventListener("offline", closeAllSockets);
      closeAllSockets();
    };
  }, [sessionSockets]);

  return {
    sessionSockets,
    getSessionSocket,
    closeSocket,
    stopSession,
  };
};

