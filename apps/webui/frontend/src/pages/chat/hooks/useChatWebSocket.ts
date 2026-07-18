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
} from "../../../components/types/datamodel";
import { createMessage } from "../../../utils/chatHelpers";

interface UseWebSocketProps {
  session: { id?: number } | null;
  getSessionSocket: (
    sessionId: number,
    runId: string,
    fresh_socket: boolean,
    only_retrieve_existing_socket: boolean
  ) => WebSocket | null;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  userEmail?: string;
}

export const useChatWebSocket = ({
  session,
  getSessionSocket,
  setCurrentRun,
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

            return updatedRun;
          case "message_task":
            if (!wsMessage.data) return current;
            const taskData = wsMessage.data as any;
            updatedRun = {
              ...current,
              task: taskData,
            };
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

                // Check if last message is a FilesEvent — chunk should not append to file messages
                const isLastMessageFilesEvent =
                  lastMessage.config.type === "FilesEvent" ||
                  lastMessage.config.metadata?.type === "FilesEvent";

                if (
                  !isLastMessageLog &&
                  !isLastMessageFilesEvent &&
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
                      metadata: ({
                        ...(lastMessage.config.metadata as any),
                        ...(sanitizedChunkMetadata as any),
                      } as any),
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
            return updatedRun;

          case "tool_call_summary": {
            if (!wsMessage.data) return current;
            const summaryData = wsMessage.data as any;
            const summaryContent =
              typeof summaryData?.content === "string"
                ? summaryData.content
                : typeof summaryData?.summary === "string"
                ? summaryData.summary
                : typeof summaryData?.result === "string"
                ? summaryData.result
                : "";
            if (!summaryContent) return current;

            // ToolCallSummaryMessage may include <think>...</think>; we keep raw content here.
            // Rendering layer will decide whether to parse think tags (see disableThinkTags).

            // Aggregate into previous message_log title message if possible.
            const lastIdx = current.messages.length - 1;
            if (lastIdx < 0) return current;

            const lastMessage = current.messages[lastIdx];
            const lastMeta = (lastMessage.config.metadata || {}) as Record<
              string,
              unknown
            >;
            const isLastLogMessage =
              lastMeta.type === "log" ||
              (lastMessage.config as any).content_type === "log" ||
              (lastMessage.config as any).type === "AgentLogEvent" ||
              lastMeta.type === "AgentLogEvent";

            const isLastThoughtEvent =
              (lastMessage.config as any).type === "ThoughtEvent" ||
              lastMeta.type === "ThoughtEvent";

            if (!isLastLogMessage && !isLastThoughtEvent) {
              return current;
            }

            const prevSummaryRaw = (lastMessage.config.metadata as any)
              ?.tool_call_summary;
            const prevSummary =
              typeof prevSummaryRaw === "string" ? prevSummaryRaw.trim() : "";
            const nextSummaryChunk = summaryContent.trim();
            if (!nextSummaryChunk) return current;

            const mergedSummary = prevSummary
              ? `${prevSummary}\n\n${nextSummaryChunk}`
              : nextSummaryChunk;

            const updatedMessages = [...current.messages];
            updatedMessages[lastIdx] = {
              ...lastMessage,
              config: {
                ...lastMessage.config,
                metadata: {
                  ...(lastMessage.config.metadata || {}),
                  tool_call_summary: mergedSummary,
                },
                version: ((lastMessage.config as any).version || 0) + 1,
              } as any,
            };

            updatedRun = {
              ...current,
              messages: updatedMessages,
            };
            return updatedRun;
          }

          case "message_files":
            if (!wsMessage.data) return current;
            const filesEvent = wsMessage.data as FilesEvent;
            const filesMessage = createMessage(
              filesEvent as unknown as AgentMessageConfig,
              current.id,
              session.id,
              userEmail
            );
            updatedRun = {
              ...current,
              file_events: [...(current.file_events || []), filesEvent],
              messages: [...current.messages, filesMessage],
            };
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

            return updatedRun;

          case "system":
            updatedRun = {
              ...current,
              status: wsMessage.status as BaseRunStatus,
            };

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

            return updatedRun;

          default:
            return current;
        }
      });
    },
    [session?.id, activeSocket, setCurrentRun, userEmail]
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
    [session?.id, getSessionSocket, handleWebSocketMessage, setCurrentRun]
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

