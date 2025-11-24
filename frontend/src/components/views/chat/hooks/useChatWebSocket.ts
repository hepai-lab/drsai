import * as React from "react";
import { message as antdMessage } from "antd";
import {
  Run,
  RunLogEntry,
  WebSocketMessage,
  AgentMessageConfig,
  RunStatus as BaseRunStatus,
  InputRequest,
  InputRequestMessage,
  TeamResult,
} from "../../../types/datamodel";
import { createMessage, areMessagesSimilar, isStreamingDuplicate } from "../chatHelpers";

interface UseWebSocketProps {
  session: { id?: number } | null;
  getSessionSocket: (
    sessionId: number,
    runId: string,
    fresh_socket: boolean,
    only_retrieve_existing_socket: boolean
  ) => WebSocket | null;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  setSessionRun: (sessionId: number, run: Run) => void;
  userEmail?: string;
}

export const useChatWebSocket = ({
  session,
  getSessionSocket,
  setCurrentRun,
  setSessionRun,
  userEmail,
}: UseWebSocketProps) => {
  const [activeSocket, setActiveSocket] = React.useState<WebSocket | null>(null);
  const activeSocketRef = React.useRef<WebSocket | null>(null);
  const inputTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const streamingMessageRef = React.useRef<{ source: string; content: string } | null>(null);

  const handleWebSocketMessage = React.useCallback(
    (wsMessage: WebSocketMessage) => {
      setCurrentRun((current: Run | null) => {
        if (!current || !session?.id) return null;

        let updatedRun: Run | null = null;

        switch (wsMessage.type) {
          case "error":
            if (inputTimeoutRef.current) {
              clearTimeout(inputTimeoutRef.current);
              inputTimeoutRef.current = null;
            }
            if (activeSocket) {
              activeSocket.close();
              setActiveSocket(null);
              activeSocketRef.current = null;
            }
            return current;

          case "message":
            if (!wsMessage.data) return current;

            const messageData = wsMessage.data as AgentMessageConfig;
            const lastMessageIndex = current.messages.length - 1;

            if (lastMessageIndex >= 0) {
              const lastMessage = current.messages[lastMessageIndex];

              if (
                (lastMessage.config.source === "assistant" ||
                  lastMessage.config.source === messageData.source) &&
                typeof lastMessage.config.content === "string" &&
                typeof messageData.content === "string"
              ) {
                const lastContent = lastMessage.config.content.trim();
                const newContent = messageData.content.trim();

                // Check for streaming duplicate
                if (isStreamingDuplicate(streamingMessageRef.current, {
                  source: messageData.source,
                  content: newContent,
                })) {
                  streamingMessageRef.current = null;
                  return current;
                }

                // Check for content similarity
                if (areMessagesSimilar(lastContent, newContent)) {
                  return current;
                }
              }
            }

            const newMessage = createMessage(
              messageData,
              current.id,
              session.id,
              userEmail
            );

            updatedRun = {
              ...current,
              messages: [...current.messages, newMessage],
            };

            try {
              setSessionRun(session.id, updatedRun);
            } catch (error) {
              console.warn("Failed to cache message:", error);
            }

            return updatedRun;
          case "message_task":
            if (!wsMessage.data) return current;
            const taskData = wsMessage.data as any;
            updatedRun = {
              ...current,
              task: taskData,
            };
            setSessionRun(session.id, updatedRun);
            return updatedRun;
          case "message_chunk":
            if (!wsMessage.data) return current;

            const chunkData = wsMessage.data as any;
            if (chunkData.content && typeof chunkData.content === "string") {
              const processedContent = chunkData.content;
              const lastMsgIndex = current.messages.length - 1;

              if (lastMsgIndex >= 0) {
                const lastMessage = current.messages[lastMsgIndex];

                if (
                  lastMessage.config.source === "assistant" ||
                  lastMessage.config.source === chunkData.source
                ) {
                  const updatedMessages = [...current.messages];
                  const newContent = (lastMessage.config.content as string) + processedContent;

                  updatedMessages[lastMsgIndex] = {
                    ...lastMessage,
                    config: {
                      ...lastMessage.config,
                      content: newContent,
                    },
                  };

                  streamingMessageRef.current = {
                    source: chunkData.source || "assistant",
                    content: newContent,
                  };

                  updatedRun = {
                    ...current,
                    messages: updatedMessages,
                  };

                  setSessionRun(session.id, updatedRun);
                  return updatedRun;
                }
              }

              const newChunkMessage = createMessage(
                {
                  source: "assistant",
                  content: processedContent,
                  metadata: chunkData.metadata || {},
                } as AgentMessageConfig,
                current.id,
                session.id,
                userEmail
              );

              streamingMessageRef.current = {
                source: chunkData.source || "assistant",
                content: processedContent,
              };

              updatedRun = {
                ...current,
                messages: [...current.messages, newChunkMessage],
              };

              setSessionRun(session.id, updatedRun);
              return updatedRun;
            }
            return current;

          case "message_log":
            if (!wsMessage.data) return current;
            const logData = wsMessage.data as any;
            // 提取 content 字段并追加到日志数组
            if (logData.content && typeof logData.content === "string") {
              const timestamp =
                typeof logData.send_time_stamp === "number"
                  ? logData.send_time_stamp
                  : typeof logData.send_time_stamp === "string"
                  ? Number(logData.send_time_stamp)
                  : undefined;
              const level =
                typeof logData.send_level === "string"
                  ? logData.send_level
                  : typeof logData.send_level?.value === "string"
                  ? logData.send_level.value
                  : undefined;
              const logEntry: RunLogEntry = {
                content: logData.content,
                source: typeof logData.source === "string" ? logData.source : undefined,
                send_time_stamp:
                  typeof timestamp === "number" && Number.isFinite(timestamp)
                    ? timestamp
                    : undefined,
                send_level: level,
                content_type:
                  typeof logData.content_type === "string"
                    ? logData.content_type
                    : undefined,
              };
              // 确保 logs 数组存在，如果不存在则初始化为空数组
              const currentLogsRaw = Array.isArray(current.logs)
                ? (current.logs as Array<RunLogEntry | string>)
                : [];
              const normalizedLogs: RunLogEntry[] = currentLogsRaw.map((log) =>
                typeof log === "string" ? { content: log } : log
              );
              const updatedLogs = [...normalizedLogs, logEntry];
              updatedRun = {
                ...current,
                logs: updatedLogs,
              };
              setSessionRun(session.id, updatedRun);
              return updatedRun;
            }
            return current;
          case "input_request":
            let input_request: InputRequest;
            switch (wsMessage.input_type) {
              case "approval":
                const input_request_message = wsMessage as InputRequestMessage;
                input_request = {
                  input_type: "approval",
                  prompt: input_request_message.prompt,
                } as InputRequest;
                break;
              case "text_input":
              case null:
              default:
                input_request = { input_type: "text_input" };
                break;
            }

            updatedRun = {
              ...current,
              status: "awaiting_input",
              input_request: input_request,
            };

            setSessionRun(session.id, updatedRun);
            return updatedRun;

          case "system":
            updatedRun = {
              ...current,
              status: wsMessage.status as BaseRunStatus,
            };

            setSessionRun(session.id, updatedRun);
            return updatedRun;

          case "result":
          case "completion":
            const status: BaseRunStatus =
              wsMessage.status === "complete"
                ? "complete"
                : wsMessage.status === "error"
                ? "error"
                : "stopped";

            const isTeamResult = (data: any): data is TeamResult => {
              return (
                data &&
                "task_result" in data &&
                "usage" in data &&
                "duration" in data
              );
            };

            if (activeSocket) {
              activeSocket.close();
              setActiveSocket(null);
              activeSocketRef.current = null;
            }

            updatedRun = {
              ...current,
              status,
              team_result:
                wsMessage.data && isTeamResult(wsMessage.data)
                  ? wsMessage.data
                  : null,
            };

            setSessionRun(session.id, updatedRun);
            return updatedRun;

          default:
            return current;
        }
      });
    },
    [session?.id, activeSocket, setCurrentRun, setSessionRun, userEmail]
  );

  const setupWebSocket = React.useCallback(
    (
      runId: string,
      fresh_socket: boolean = false,
      only_retrieve_existing_socket: boolean = false
    ): WebSocket | null => {
      if (!session?.id) {
        throw new Error("Invalid session configuration");
      }

      const socket = getSessionSocket(
        session.id,
        runId,
        fresh_socket,
        only_retrieve_existing_socket
      );

      if (!socket) {
        return null;
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error("WebSocket message parsing error:", error);
        }
      };

      socket.onclose = () => {
        activeSocketRef.current = null;
        setActiveSocket(null);
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      setActiveSocket(socket);
      activeSocketRef.current = socket;
      return socket;
    },
    [session?.id, getSessionSocket, handleWebSocketMessage]
  );

  const ensureWebSocketConnection = React.useCallback(
    async (runId: string): Promise<WebSocket> => {
      if (activeSocketRef.current?.readyState === WebSocket.OPEN) {
        return activeSocketRef.current;
      }

      antdMessage.loading("正在重新连接...", 0.5);

      const socket = setupWebSocket(runId, true, false);
      if (!socket) {
        throw new Error("Failed to establish WebSocket connection");
      }

      if (socket.readyState !== WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("WebSocket connection timeout"));
          }, 5000);

          const checkState = () => {
            if (socket.readyState === WebSocket.OPEN) {
              clearTimeout(timeout);
              antdMessage.success("重新连接成功", 1);
              resolve();
            } else if (
              socket.readyState === WebSocket.CLOSED ||
              socket.readyState === WebSocket.CLOSING
            ) {
              clearTimeout(timeout);
              reject(new Error("WebSocket connection failed"));
            } else {
              setTimeout(checkState, 100);
            }
          };

          checkState();
        });
      }

      return socket;
    },
    [setupWebSocket]
  );

  return {
    activeSocket,
    activeSocketRef,
    setupWebSocket,
    ensureWebSocketConnection,
    inputTimeoutRef,
  };
};

