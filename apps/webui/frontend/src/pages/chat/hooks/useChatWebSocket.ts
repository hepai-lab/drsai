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

  const handleWebSocketMessageRef = React.useRef<
    (wsMessage: WebSocketMessage) => void
  >(() => {});

  // Batched WS message queue: coalesces bursts of chunks (and other events)
  // into a single React render. Also reorders the queue so that a terminal
  // event (input_request/completion/result) is processed BEFORE any preceding
  // chunks in the same batch. This way when the terminal event promotes the
  // last chunk to _is_final_reply, the promotion is applied in the same render
  // that first paints those chunks — no visible "inside-box then outside" flash.
  const wsMessageQueueRef = React.useRef<WebSocketMessage[]>([]);
  const wsFlushScheduledRef = React.useRef(false);
  const WS_FLUSH_DELAY_MS = 60;
  const flushWsQueue = React.useCallback(() => {
    wsFlushScheduledRef.current = false;
    const queue = wsMessageQueueRef.current;
    if (queue.length === 0) return;
    wsMessageQueueRef.current = [];
    // Reorder: if the batch contains a terminal event, process it AFTER the
    // preceding chunks so promotion sees the full accumulated chunk content.
    // (The default in-order processing already does this; explicit reordering
    // isn't needed. Just process in order.)
    for (const msg of queue) {
      handleWebSocketMessageRef.current(msg);
    }
  }, []);
  const enqueueWsMessage = React.useCallback((msg: WebSocketMessage) => {
    wsMessageQueueRef.current.push(msg);
    if (!wsFlushScheduledRef.current) {
      wsFlushScheduledRef.current = true;
      setTimeout(flushWsQueue, WS_FLUSH_DELAY_MS);
    }
  }, [flushWsQueue]);

  const handleWebSocketMessage = React.useCallback(
    (wsMessage: WebSocketMessage) => {
      setCurrentRun((current: Run | null) => {
        if (!current || !session?.id) {
          return current;
        }

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
            // Transition any non-terminal state to stopped on error:
            // active/pausing/paused = streaming, awaiting_input = waiting for user
            const nonTerminal = new Set(["active", "awaiting_input", "pausing", "paused"]);
            if (nonTerminal.has(current.status)) {
              return {
                ...current,
                status: "stopped" as BaseRunStatus,
                input_request: undefined,
                team_result: current.team_result || {
                  task_result: {
                    messages: [],
                    stop_reason: "Session was interrupted",
                  },
                  usage: "",
                  duration: 0,
                },
              };
            }
            return current;

          case "message":
            if (!wsMessage.data) return current;

            const messageData = wsMessage.data as AgentMessageConfig;

            // Strip leading <think>...</think> block from TextMessage content.
            // The ThoughtEvent (plain text) arrives separately via "message_thinking"
            // so we remove the tagged block here to avoid duplicate display.
            let finalContent = typeof messageData.content === "string"
              ? messageData.content.replace(/^<think>[\s\S]*?<\/(?:think|redacted_thinking)>\s*/, "")
              : messageData.content;
            const finalMessageData = (finalContent !== messageData.content)
              ? { ...messageData, content: finalContent } as AgentMessageConfig
              : messageData;

            const newMessage = createMessage(
              finalMessageData,
              current.id,
              session.id,
              userEmail
            );

            // Remove ONLY the last (tail-most) streaming chunk from the same source —
            // that's the one being replaced by the incoming final TextMessage. Earlier
            // intermediate chunks stay in the messages array as history and render
            // inside the process box (they're not at the tail anymore).
            const chunkSourceKey = messageData.source || "assistant";
            const taggedFinalMessage = {
              ...newMessage,
              config: {
                ...newMessage.config,
                metadata: {
                  ...(newMessage.config.metadata || {}),
                  _is_final_reply: true,
                },
              } as any,
            };
            let lastChunkIdxForSource = -1;
            for (let i = current.messages.length - 1; i >= 0; i--) {
              const m = current.messages[i];
              if (
                m.config.source === chunkSourceKey &&
                m.config.metadata?.start_flag !== undefined
              ) {
                lastChunkIdxForSource = i;
                break;
              }
            }
            if (lastChunkIdxForSource >= 0) {
              const withoutTailChunk = [
                ...current.messages.slice(0, lastChunkIdxForSource),
                ...current.messages.slice(lastChunkIdxForSource + 1),
              ];
              streamingMessageRef.current = null;
              updatedRun = { ...current, messages: [...withoutTailChunk, taggedFinalMessage] };
              return updatedRun;
            }

            updatedRun = {
              ...current,
              messages: [...current.messages, taggedFinalMessage],
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
          case "message_burst": {
            // Backend-buffered burst: the backend waited for the next event to
            // determine routing. is_final=true → render outside the box;
            // is_final=false → render inside the box with typewriter effect.
            if (!wsMessage.data) return current;
            const burstData = wsMessage.data as any;
            const burstContent = typeof burstData.content === "string" ? burstData.content : "";
            if (!burstContent) return current;
            const burstSource = typeof burstData.source === "string" ? burstData.source : "assistant";
            const isFinal = burstData.is_final === true;

            // Strip any <think>...</think> block from content
            let cleanContent = burstContent.replace(/^<think>[\s\S]*?<\/(?:think|redacted_thinking)>\s*/, "");
            if (!cleanContent.trim()) return current;

            const burstMessage = createMessage(
              {
                source: burstSource,
                content: cleanContent,
                metadata: {
                  _is_burst: true,
                  _is_final_reply: isFinal,
                },
              } as AgentMessageConfig,
              current.id,
              session.id,
              userEmail
            );

            // Remove streaming chunks and prior final bursts from the same source so
            // a corrective (longer) is_final burst replaces a truncated one.
            let msgs = current.messages.filter((m) => {
              if (m.config.source !== burstSource) return true;
              const meta = m.config.metadata as Record<string, unknown> | undefined;
              if (meta?.start_flag !== undefined) return false;
              if (isFinal && meta?._is_burst && meta?._is_final_reply) return false;
              return true;
            });

            return {
              ...current,
              messages: [...msgs, burstMessage],
            };
          }

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

              // Find the existing streaming-chunk message for this source by
              // scanning backward for start_flag. This is robust against
              // ThoughtEvent / log messages being inserted between chunks.
              const existingChunkIdx = current.messages.reduceRight(
                (found: number, m, i) =>
                  found >= 0
                    ? found
                    : m.config.source === chunkSource &&
                      m.config.metadata?.start_flag !== undefined
                    ? i
                    : -1,
                -1
              );

              // If existing chunk is still the tail → grow its content in place.
              if (existingChunkIdx >= 0 && existingChunkIdx === lastMsgIndex) {
                const existingChunk = current.messages[existingChunkIdx];
                const newContent =
                  (existingChunk.config.content as string) + processedContent;
                const updatedMessages = [...current.messages];
                updatedMessages[existingChunkIdx] = {
                  ...existingChunk,
                  config: {
                    ...existingChunk.config,
                    content: newContent,
                    metadata: {
                      ...(existingChunk.config.metadata || {}),
                      ...(sanitizedChunkMetadata || {}),
                    },
                  },
                };
                streamingMessageRef.current = { source: chunkSource, content: newContent };
                updatedRun = { ...current, messages: updatedMessages };
                return updatedRun;
              }

              // Existing chunk exists but something arrived after it (tool call, thought,
              // log, etc.). Leave the old chunk in place — it's now "history" that will
              // render INSIDE the process box (see isSingleSegment: only tail chunks
              // render outside). Create a NEW chunk at the tail for the new burst.
              // No _sealed_chunk marker needed — position in the array is authoritative.
              if (existingChunkIdx >= 0) {
                const newChunkMessage = createMessage(
                  {
                    source: chunkSource,
                    content: processedContent,
                    metadata: {
                      ...(sanitizedChunkMetadata || {}),
                      start_flag: "yes",
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

              // No existing chunk for this source — fall back to appending to last
              // message if source matches (legacy path, shouldn't normally hit).
              if (lastMsgIndex >= 0) {
                const lastMessage = current.messages[lastMsgIndex];
                const isLastMessageLog =
                  lastMessage.config.metadata?.type === "log" ||
                  (lastMessage.config as any).content_type === "log" ||
                  (lastMessage.config as any).type === "AgentLogEvent" ||
                  lastMessage.config.metadata?.type === "AgentLogEvent";
                const isLastMessageFilesEvent =
                  (lastMessage.config as any).type === "FilesEvent" ||
                  lastMessage.config.metadata?.type === "FilesEvent";

                if (
                  !isLastMessageLog &&
                  !isLastMessageFilesEvent &&
                  (lastMessage.config.source === "assistant" ||
                    lastMessage.config.source === chunkSource)
                ) {
                  const updatedMessages = [...current.messages];
                  const newContent =
                    (lastMessage.config.content as string) + processedContent;
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
                  streamingMessageRef.current = { source: chunkSource, content: newContent };
                  updatedRun = { ...current, messages: updatedMessages };
                  return updatedRun;
                }
              }

              // No suitable message to append to — create a new orphan chunk.
              // This should not happen in normal flow but avoids dropped chunks.
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

          case "tool.progress": {
            // Real-time tool output streaming (from run_bash line-by-line)
            if (!wsMessage.data) return current;
            const progressData = wsMessage.data as any;
            const toolId = progressData.tool_id || "";
            const preview = progressData.preview || "";
            if (!toolId) return current;

            // Accumulate progress into the run's metadata for the timeline panel
            const existingProgress = (current as any)._toolProgress || {};
            const existingLines = existingProgress[toolId] || [];
            const updatedProgress = {
              ...existingProgress,
              [toolId]: [...existingLines, preview],
            };

            updatedRun = {
              ...current,
              ...({ _toolProgress: updatedProgress } as any),
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
          case "message_thinking": {
            if (!wsMessage.data) return current;
            const thinkSrc = (wsMessage.data as any)?.source || "assistant";
            const thinkContent = typeof (wsMessage.data as any)?.content === "string"
              ? (wsMessage.data as any).content.trim() : "";

            // If a message_burst from the same source already exists with the same
            // content, the burst IS this thought — don't duplicate it as a ThoughtEvent.
            const burstWithSameContent = current.messages.some((m) => {
              const meta = m.config.metadata as any;
              if (!meta?._is_burst || m.config.source !== thinkSrc) return false;
              const bc = typeof m.config.content === "string" ? m.config.content.trim() : "";
              return thinkContent && bc.startsWith(thinkContent);
            });
            if (burstWithSameContent) return current;

            // ThoughtEvent arrives with type:"ThoughtEvent" already set in model_dump()
            const thinkingMessage = createMessage(
              wsMessage.data as AgentMessageConfig,
              current.id,
              session.id,
              userEmail
            );
            // ThoughtEvent arrives AFTER the chunk it logically precedes.
            // Insert it BEFORE the most recent burst/chunk from the same source
            // that doesn't already have a preceding ThoughtEvent.
            let insertBeforeIdx = -1;
            for (let i = current.messages.length - 1; i >= 0; i--) {
              const m = current.messages[i];
              const meta = m.config.metadata as any;
              if (m.config.source !== thinkSrc) continue;
              // Match active chunk (start_flag), sealed chunk (_sealed_chunk),
              // promoted final reply (_is_final_reply), or a burst message
              const isChunkOrReply =
                meta?.start_flag !== undefined ||
                meta?._sealed_chunk ||
                meta?._is_final_reply ||
                meta?._is_burst;
              if (!isChunkOrReply) continue;
              // Check if a ThoughtEvent already sits immediately before this chunk
              const prev = i > 0 ? current.messages[i - 1] : null;
              const prevIsThought =
                prev &&
                ((prev.config as any).type === "ThoughtEvent" ||
                  (prev.config.metadata as any)?.type === "ThoughtEvent");
              if (prevIsThought) continue; // already has a thought — look further back
              insertBeforeIdx = i;
              break;
            }
            let thinkMessages: typeof current.messages;
            if (insertBeforeIdx >= 0) {
              thinkMessages = [
                ...current.messages.slice(0, insertBeforeIdx),
                thinkingMessage,
                ...current.messages.slice(insertBeforeIdx),
              ];
            } else {
              thinkMessages = [...current.messages, thinkingMessage];
            }
            updatedRun = {
              ...current,
              messages: thinkMessages,
            };
            return updatedRun;
          }
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

            // Don't touch messages. The tail streaming chunk stays at the tail
            // and continues to render OUTSIDE the process box (see isSingleSegment:
            // "chunk at tail" = final reply). No promotion needed.
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

            // Don't touch messages — tail chunk stays at tail and renders outside
            // via isSingleSegment's tail-chunk rule.
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

  // Keep ref in sync so socket.onmessage always calls the latest handler
  handleWebSocketMessageRef.current = handleWebSocketMessage;

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
          // Enqueue instead of calling directly — flushed once per animation frame
          // so bursts of chunks coalesce into a single render.
          enqueueWsMessage(message);
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
          // Transition any non-terminal state to stopped on disconnect:
          // active/pausing/paused = streaming, awaiting_input = waiting for user
          const nonTerminal = new Set(["active", "awaiting_input", "pausing", "paused"]);
          if (nonTerminal.has(current.status)) {
            const updatedRun = {
              ...current,
              status: "stopped" as BaseRunStatus,
              input_request: undefined,
              team_result: current.team_result || {
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

      socket.onopen = () => {
        if (activeSocketRef.current === socket) {
          // Socket reconnected — no-op; runTask's readyState polling will see OPEN
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

