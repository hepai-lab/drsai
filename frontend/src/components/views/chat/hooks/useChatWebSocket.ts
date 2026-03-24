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
  FilesEvent,
} from "../../../types/datamodel";
import { createMessage } from "../chatHelpers";

interface UseWebSocketProps {
  session: { id?: number } | null;
  getSessionSocket: (
    sessionId: number,
    runId: string,
    fresh_socket: boolean,
    only_retrieve_existing_socket: boolean
  ) => WebSocket | null;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  setSessionRun?: (sessionId: number, run: Run) => void;
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
  const cacheSessionRun = React.useCallback(
    (sessionId: number, run: Run) => {
      if (!setSessionRun) return;
      try {
        setSessionRun(sessionId, run);
      } catch (error) {
        console.warn("Failed to cache message:", error);
      }
    },
    [setSessionRun]
  );

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

            // Always add user messages, and non-user messages that passed deduplication
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

            cacheSessionRun(session.id, updatedRun);

            return updatedRun;
          case "message_task":
            if (!wsMessage.data) return current;
            const taskData = wsMessage.data as any;
            updatedRun = {
              ...current,
              task: taskData,
            };
            cacheSessionRun(session.id, updatedRun);
            return updatedRun;
          case "message_chunk":
            if (!wsMessage.data) return current;

            const chunkData = wsMessage.data as any;
            if (chunkData.content && typeof chunkData.content === "string") {
              const processedContent = chunkData.content;
              const lastMsgIndex = current.messages.length - 1;
              const chunkSource =
                typeof chunkData.source === "string" ? chunkData.source : "assistant";
              const sanitizedChunkMetadata =
                chunkData.metadata && typeof chunkData.metadata === "object"
                  ? { ...(chunkData.metadata as Record<string, unknown>) }
                  : undefined;
              const rawStartFlag = sanitizedChunkMetadata?.start_flag;
              const startFlagValue =
                typeof rawStartFlag === "string" ? rawStartFlag : undefined;
              const isStartChunk = startFlagValue?.toLowerCase() === "yes";

              if (isStartChunk) {
                const newChunkMessage = createMessage(
                  {
                    source: chunkSource,
                    content: processedContent,
                    metadata: {
                      ...(sanitizedChunkMetadata || {}),
                      start_flag: startFlagValue!,
                      stream_source_label: chunkSource,
                    },
                  } as AgentMessageConfig,
                  current.id,
                  session.id,
                  userEmail
                );

                streamingMessageRef.current = {
                  source: chunkSource,
                  content: processedContent,
                };

                updatedRun = {
                  ...current,
                  messages: [...current.messages, newChunkMessage],
                };

                cacheSessionRun(session.id, updatedRun);
                return updatedRun;
              }

              if (lastMsgIndex >= 0) {
                const lastMessage = current.messages[lastMsgIndex];
                
                // Check if last message is a log message - don't append chunk to log messages
                const isLastMessageLog = 
                  lastMessage.config.metadata?.type === "log" ||
                  (lastMessage.config as any).content_type === "log" ||
                  (lastMessage.config as any).type === "AgentLogEvent" ||
                  lastMessage.config.metadata?.type === "AgentLogEvent";

                if (
                  !isLastMessageLog &&
                  (lastMessage.config.source === "assistant" ||
                  lastMessage.config.source === chunkSource)
                ) {
                  const updatedMessages = [...current.messages];
                  const newContent = (lastMessage.config.content as string) + processedContent;

                  updatedMessages[lastMsgIndex] = {
                    ...lastMessage,
                    config: {
                      ...lastMessage.config,
                      content: newContent,
                      metadata: {
                        ...(lastMessage.config.metadata || {}),
                        ...(sanitizedChunkMetadata || {}),
                      },
                    },
                  };

                  streamingMessageRef.current = {
                    source: chunkSource,
                    content: newContent,
                  };

                  updatedRun = {
                    ...current,
                    messages: updatedMessages,
                  };

                  cacheSessionRun(session.id, updatedRun);
                  return updatedRun;
                }
              }

              const newChunkMessage = createMessage(
                {
                  source: chunkSource,
                  content: processedContent,
                  metadata: sanitizedChunkMetadata || {},
                } as AgentMessageConfig,
                current.id,
                session.id,
                userEmail
              );

              streamingMessageRef.current = {
                source: chunkSource,
                content: processedContent,
              };

              updatedRun = {
                ...current,
                messages: [...current.messages, newChunkMessage],
              };

              cacheSessionRun(session.id, updatedRun);
              return updatedRun;
            }
            return current;

          case "message_log":
            if (!wsMessage.data) return current;
            const logData = wsMessage.data as any;
            // 提取 content 和 title 字段
            const hasContent = logData.content && typeof logData.content === "string";
            const hasTitle = logData.title && typeof logData.title === "string";
            
            // 至少需要有 content 或 title 之一
            if (!hasContent && !hasTitle) return current;
            
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
            // 创建日志条目，无论是否有 title 都添加到 run.logs
            const logEntry: RunLogEntry = {
              content: hasContent ? logData.content : "",
              title: hasTitle ? logData.title : undefined,
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
            // 如果有 title，在聊天区创建消息显示 title（用于聊天界面显示）
            let updatedMessages = current.messages;
            if (hasTitle) {
              const logSource = typeof logData.source === "string" ? logData.source : "assistant";
              const logMetaType =
                logData.type === "AgentLogEvent" ? "AgentLogEvent" : "log";
              const logMessage = createMessage(
                {
                  source: logSource,
                  content: logData.title,
                  // 与后端 model_dump 一致：顶层 type / content_type，便于 RenderMessage 识别
                  ...(logData.type === "AgentLogEvent"
                    ? { type: "AgentLogEvent" as const }
                    : {}),
                  ...(typeof logData.content_type === "string"
                    ? { content_type: logData.content_type }
                    : {}),
                  metadata: {
                    type: logMetaType,
                    ...(hasContent ? { log_content: logData.content } : {}),
                    ...(typeof logData.content_type === "string"
                      ? { content_type: logData.content_type }
                      : {}),
                  },
                } as AgentMessageConfig,
                current.id,
                session.id,
                userEmail
              );
              updatedMessages = [...current.messages, logMessage];
            }
            
            updatedRun = {
              ...current,
              messages: updatedMessages,
              logs: updatedLogs,
            };
            cacheSessionRun(session.id, updatedRun);
            return updatedRun;

          case "message_files":
            if (!wsMessage.data) return current;
            const filesEvent = wsMessage.data as FilesEvent;
            updatedRun = {
              ...current,
              file_events: [...(current.file_events || []), filesEvent],
            };
            cacheSessionRun(session.id, updatedRun);
            return updatedRun;
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

            cacheSessionRun(session.id, updatedRun);
            return updatedRun;

          case "system":
            updatedRun = {
              ...current,
              status: wsMessage.status as BaseRunStatus,
            };

            cacheSessionRun(session.id, updatedRun);
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

            cacheSessionRun(session.id, updatedRun);
            return updatedRun;

          default:
            return current;
        }
      });
    },
    [cacheSessionRun, session?.id, activeSocket, setCurrentRun, userEmail]
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

      // Capture sessionId and runId at the time of socket creation to avoid stale closures
      const socketSessionId = session.id;
      const socketRunId = runId;
      
      socket.onclose = () => {
        // Only process close event if this socket belongs to the current session and run
        // This prevents old socket close events from affecting new sessions
        setCurrentRun((current: Run | null) => {
          if (!current || !session?.id) return current;
          // Check if this socket belongs to the current session and run
          if (session.id !== socketSessionId || current.id !== socketRunId) {
            return current;
          }
          // Only update if the socket is still the active one
          if (activeSocketRef.current !== socket) {
            return current;
          }
          if (current.status === "awaiting_input") {
            const updatedRun = {
              ...current,
              status: "stopped" as BaseRunStatus,
              input_request: undefined,
              team_result: {
                task_result: {
                  messages: [],
                  stop_reason: "Cancelled by user",
                },
                usage: "",
                duration: 0,
              } as TeamResult,
            };
            cacheSessionRun(session.id, updatedRun);
            return updatedRun;
          }
          return current;
        });
        // Only clear active socket if this is the current active socket
        if (activeSocketRef.current === socket) {
          activeSocketRef.current = null;
          setActiveSocket(null);
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      setActiveSocket(socket);
      activeSocketRef.current = socket;
      return socket;
    },
    [cacheSessionRun, session?.id, getSessionSocket, handleWebSocketMessage, setCurrentRun]
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

