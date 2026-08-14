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
import {
  chatRenderLog,
  sealStreamMessage,
  splitAgentVisibleContent,
} from "../chatMessagePipeline";

/** Project raw model stream into reply + thought planes.
 *  Open <think> (no close yet) → thought streaming, reply empty.
 *  Closed think / monologue peel → thought done, reply visible.
 */
function projectStreamContent(combinedRaw: string): {
  reply: string;
  thought: string;
  thoughtDone: boolean;
} {
  const openThink =
    /<think>/i.test(combinedRaw) &&
    !/<\/(?:think|redacted_thinking)>/i.test(combinedRaw);
  if (openThink) {
    const thought = combinedRaw.replace(/^[\s\S]*?<think>\s*/i, "");
    return { reply: "", thought, thoughtDone: false };
  }
  const split = splitAgentVisibleContent(combinedRaw);
  return {
    reply: split.reply,
    thought: split.thought,
    thoughtDone: Boolean(split.thought) || /<\/(?:think|redacted_thinking)>/i.test(combinedRaw),
  };
}

function isLiveStreamDraft(m: { config: any }): boolean {
  const cfg = m.config as any;
  const meta = (cfg.metadata || {}) as Record<string, unknown>;
  if (meta.start_flag !== undefined) return true;
  if (meta._stream_draft === true) return true;
  if (meta._sealed_chunk === true) return true;
  if (meta._is_streaming_chunk === true) return true;
  if (cfg.type === "ModelClientStreamingChunkEvent") return true;
  return false;
}

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
    chatRenderLog("ws:enqueue", {
      type: msg.type,
      source: (msg.data as any)?.source,
      preview:
        typeof (msg.data as any)?.content === "string"
          ? String((msg.data as any).content).replace(/\s+/g, " ").trim().slice(0, 80)
          : undefined,
      start_flag: (msg.data as any)?.metadata?.start_flag,
      msgType: (msg.data as any)?.type,
    });
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
            const chunkSourceKey = messageData.source || "assistant";

            // Prefer promoting the live stream draft over discarding it when the
            // arriving TextMessage is empty or much shorter (common before tools).
            let bestDraft: (typeof current.messages)[0] | null = null;
            let bestDraftLen = 0;
            let lastDraft: (typeof current.messages)[0] | null = null;
            for (const m of current.messages) {
              if (m.config.source !== chunkSourceKey) continue;
              if (!isLiveStreamDraft(m)) continue;
              lastDraft = m;
              const len =
                typeof m.config.content === "string" ? m.config.content.trim().length : 0;
              if (len > bestDraftLen) {
                bestDraft = m;
                bestDraftLen = len;
              }
            }
            // Reasoning models stream everything inside <think>, so the draft's
            // visible content can be empty — still carry its thought onto the
            // final message so the ThinkBubble persists instead of vanishing.
            const draftForThought = bestDraft ?? lastDraft;
            const draftLiveThought =
              typeof (draftForThought?.config.metadata as any)?._live_thought ===
              "string"
                ? String(
                    (draftForThought!.config.metadata as any)._live_thought
                  ).trim()
                : "";

            // Content-plane split: reply visible, thought stays attached as <think>
            // ABOVE the reply so ThinkBubble never remounts below the answer.
            // Carry over the stream draft's live thought when the TextMessage body
            // has reply-only (ThoughtEvent often arrives after the draft is dropped).
            let finalContent =
              typeof messageData.content === "string" ? messageData.content : messageData.content;
            if (typeof finalContent === "string") {
              const split = splitAgentVisibleContent(finalContent);
              const thought = split.thought || draftLiveThought;
              finalContent = thought
                ? `<think>${thought}</think>\n\n${split.reply}`
                : split.reply;
            }
            const finalMessageData =
              typeof messageData.content === "string"
                ? ({ ...messageData, content: finalContent } as AgentMessageConfig)
                : messageData;

            const newMessage = createMessage(
              finalMessageData,
              current.id,
              session.id,
              userEmail
            );

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

            const newLen =
              typeof finalContent === "string" ? finalContent.trim().length : 0;

            const withoutDrafts = current.messages.filter((m) => {
              if (m.config.source !== chunkSourceKey) return true;
              return !isLiveStreamDraft(m);
            });

            chatRenderLog("ws:message", {
              source: chunkSourceKey,
              newLen,
              bestDraftLen,
              draftThought: draftLiveThought.slice(0, 48),
              droppedDrafts: current.messages.length - withoutDrafts.length,
              preview:
                typeof finalContent === "string"
                  ? finalContent.replace(/\s+/g, " ").trim().slice(0, 96)
                  : typeof finalContent,
            });
            streamingMessageRef.current = null;

            // Empty final: keep sealed draft content if any.
            if (newLen === 0) {
              updatedRun = {
                ...current,
                messages:
                  bestDraft && bestDraftLen > 0
                    ? [...withoutDrafts, sealStreamMessage(bestDraft)]
                    : withoutDrafts,
              };
              return updatedRun;
            }

            // Weak/short final after a long draft: keep the draft text too.
            if (bestDraft && bestDraftLen > Math.max(newLen * 2, 40) && newLen < 80) {
              updatedRun = {
                ...current,
                messages: [
                  ...withoutDrafts,
                  sealStreamMessage(bestDraft),
                  taggedFinalMessage,
                ],
              };
              return updatedRun;
            }

            updatedRun = {
              ...current,
              messages: [...withoutDrafts, taggedFinalMessage],
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

          case "message_chunk": {
            // One live draft bubble per source. Every token appends to the
            // draft's raw buffer, which is then re-projected into the
            // reply/thought planes (projectStreamContent).
            if (!wsMessage.data) return current;
            const chunkData = wsMessage.data as any;
            if (!chunkData.content || typeof chunkData.content !== "string") {
              return current;
            }
            const incomingRaw = chunkData.content as string;
            const chunkSource =
              typeof chunkData.source === "string"
                ? chunkData.source
                : "assistant";
            const chunkMeta =
              chunkData.metadata && typeof chunkData.metadata === "object"
                ? { ...(chunkData.metadata as Record<string, unknown>) }
                : {};
            const isStartChunk =
              typeof chunkMeta.start_flag === "string" &&
              chunkMeta.start_flag.toLowerCase() === "yes";

            const buildDraft = (combinedRaw: string, startFlag: string) => {
              const { reply, thought, thoughtDone } =
                projectStreamContent(combinedRaw);
              return {
                source: chunkSource,
                content: reply,
                metadata: {
                  ...chunkMeta,
                  _stream_draft: true,
                  stream_source_label: chunkSource,
                  start_flag: startFlag,
                  _stream_raw: combinedRaw,
                  _live_thought: thought || undefined,
                  _thought_done: thoughtDone ? "yes" : "no",
                },
              } as unknown as AgentMessageConfig;
            };

            // A draft that is still accumulating raw stream (excludes sealed
            // TextMessages that merely kept a leftover start_flag).
            const isAccumulatingDraft = (
              m: (typeof current.messages)[number]
            ) => {
              const meta = (m.config.metadata || {}) as Record<string, unknown>;
              return (
                meta._stream_draft === true ||
                typeof meta._stream_raw === "string" ||
                meta._is_streaming_chunk === true ||
                (m.config as any).type === "ModelClientStreamingChunkEvent"
              );
            };
            const draftIdx = current.messages.reduceRight(
              (found: number, m, i) =>
                found >= 0
                  ? found
                  : m.config.source === chunkSource && isAccumulatingDraft(m)
                  ? i
                  : -1,
              -1
            );

            // Branch 1 — append to the existing draft. This also covers tokens
            // that wrongly carry start_flag mid-burst (treating them as a new
            // burst used to reset the bubble to the last few lines). A start
            // flag only opens a new bubble when another event interrupted the
            // tail (draft no longer last).
            const lastIdx = current.messages.length - 1;
            if (draftIdx >= 0 && (draftIdx === lastIdx || !isStartChunk)) {
              const existing = current.messages[draftIdx];
              const existingMeta = (existing.config.metadata || {}) as any;
              const prevRaw =
                typeof existingMeta._stream_raw === "string"
                  ? (existingMeta._stream_raw as string)
                  : typeof existing.config.content === "string"
                  ? (existing.config.content as string)
                  : "";
              const payload = buildDraft(
                prevRaw + incomingRaw,
                existingMeta.start_flag || "yes"
              );
              const messages = [...current.messages];
              messages[draftIdx] = {
                ...existing,
                config: {
                  ...existing.config,
                  content: payload.content as string,
                  metadata: {
                    ...existingMeta,
                    ...(payload.metadata as any),
                  },
                },
              } as typeof existing;
              streamingMessageRef.current = {
                source: chunkSource,
                content: String(payload.content || ""),
              };
              updatedRun = { ...current, messages };
              return updatedRun;
            }

            // Branch 2 — open a new draft bubble. Seal any prior live drafts
            // from this source into normal bubbles first (drop empty ones).
            const sealed = current.messages
              .map((m) => {
                if (m.config.source !== chunkSource || !isLiveStreamDraft(m)) {
                  return m;
                }
                const content =
                  typeof m.config.content === "string"
                    ? m.config.content.trim()
                    : "";
                const liveThought =
                  typeof (m.config.metadata as any)?._live_thought === "string"
                    ? String((m.config.metadata as any)._live_thought).trim()
                    : "";
                if (!content && !liveThought) return null;
                return sealStreamMessage(m);
              })
              .filter(Boolean) as typeof current.messages;

            const payload = buildDraft(
              incomingRaw,
              isStartChunk ? (chunkMeta.start_flag as string) : "yes"
            );
            // Nothing visible yet (no reply and no thought): just keep state.
            if (!payload.content && !(payload.metadata as any)?._live_thought) {
              updatedRun = { ...current, messages: sealed };
              return updatedRun;
            }
            streamingMessageRef.current = {
              source: chunkSource,
              content: String(payload.content || ""),
            };
            updatedRun = {
              ...current,
              messages: [
                ...sealed,
                createMessage(payload, current.id, session.id, userEmail),
              ],
            };
            return updatedRun;
          }

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
            const thinkBody =
              typeof (wsMessage.data as any)?.content === "string"
                ? String((wsMessage.data as any).content).trim()
                : "";

            // Prefer folding into the live stream bubble so ThinkBubble never remounts.
            const liveIdx = current.messages.reduceRight(
              (found: number, m, i) =>
                found >= 0
                  ? found
                  : m.config.source === thinkSrc && isLiveStreamDraft(m)
                  ? i
                  : -1,
              -1
            );
            if (liveIdx >= 0 && thinkBody) {
              const live = current.messages[liveIdx];
              const updatedMessages = [...current.messages];
              updatedMessages[liveIdx] = {
                ...live,
                config: {
                  ...live.config,
                  metadata: {
                    ...(live.config.metadata || {}),
                    _live_thought:
                      thinkBody ||
                      (live.config.metadata as any)?._live_thought,
                    _thought_done: "yes",
                  },
                },
              } as typeof live;
              return { ...current, messages: updatedMessages };
            }

            // Prefer merging into the final TextMessage so think stays ABOVE the
            // reply in one bubble (never a trailing ThoughtEvent under the answer).
            const replyIdx = current.messages.reduceRight(
              (found: number, m, i) => {
                if (found >= 0) return found;
                if (m.config.source !== thinkSrc) return found;
                const meta = (m.config.metadata || {}) as any;
                const type = (m.config as any).type;
                const isReply =
                  type === "TextMessage" ||
                  meta._is_final_reply ||
                  meta._sealed_from_stream ||
                  meta._sealed_chunk;
                return isReply ? i : found;
              },
              -1
            );
            if (replyIdx >= 0 && thinkBody) {
              const replyMsg = current.messages[replyIdx];
              const raw =
                typeof replyMsg.config.content === "string"
                  ? replyMsg.config.content
                  : "";
              const split = splitAgentVisibleContent(raw);
              if (
                split.thought &&
                (split.thought.includes(thinkBody.slice(0, 80)) ||
                  thinkBody.includes(split.thought.slice(0, 80)))
              ) {
                return current;
              }
              const mergedThought = [split.thought, thinkBody]
                .filter(Boolean)
                .join("\n\n");
              const content = `<think>${mergedThought}</think>\n\n${split.reply}`;
              const updatedMessages = [...current.messages];
              updatedMessages[replyIdx] = {
                ...replyMsg,
                config: {
                  ...replyMsg.config,
                  content,
                  metadata: {
                    ...(replyMsg.config.metadata || {}),
                    _is_final_reply: true,
                  },
                } as any,
              };
              chatRenderLog("ws:thinking:merge-into-reply", {
                source: thinkSrc,
                replyIdx,
                thought: thinkBody.slice(0, 64),
              });
              return { ...current, messages: updatedMessages };
            }

            // Final TextMessage already embeds <think> — skip duplicate ThoughtEvent.
            const hasEmbeddedThink = current.messages.some((m) => {
              if (m.config.source !== thinkSrc) return false;
              const c =
                typeof m.config.content === "string" ? m.config.content : "";
              return (
                /<think>/i.test(c) &&
                thinkBody.length > 0 &&
                (c.includes(thinkBody.slice(0, 80)) ||
                  thinkBody.includes(
                    c.replace(/[\s\S]*?<think>/i, "").slice(0, 80)
                  ))
              );
            });
            if (hasEmbeddedThink) return current;

            const thinkingMessage = createMessage(
              wsMessage.data as AgentMessageConfig,
              current.id,
              session.id,
              userEmail
            );
            let insertBeforeIdx = -1;
            for (let i = current.messages.length - 1; i >= 0; i--) {
              const m = current.messages[i];
              const meta = m.config.metadata as any;
              if (m.config.source !== thinkSrc) continue;
              const type = (m.config as any).type;
              const isChunkOrReply =
                type === "TextMessage" ||
                meta?.start_flag !== undefined ||
                meta?._stream_draft ||
                meta?._sealed_chunk ||
                meta?._sealed_from_stream ||
                meta?._is_final_reply;
              if (!isChunkOrReply) continue;
              const prev = i > 0 ? current.messages[i - 1] : null;
              const prevIsThought =
                prev &&
                ((prev.config as any).type === "ThoughtEvent" ||
                  (prev.config.metadata as any)?.type === "ThoughtEvent");
              if (prevIsThought) continue;
              insertBeforeIdx = i;
              break;
            }
            const thinkMessages =
              insertBeforeIdx >= 0
                ? [
                    ...current.messages.slice(0, insertBeforeIdx),
                    thinkingMessage,
                    ...current.messages.slice(insertBeforeIdx),
                  ]
                : [...current.messages, thinkingMessage];
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

