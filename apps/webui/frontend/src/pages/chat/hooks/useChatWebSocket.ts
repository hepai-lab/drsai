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
  IncomingWebSocketMessage,
  isDefaultContinuationPrompt,
  isStreamV2Event,
} from "../../../components/types/datamodel";
import { createMessage } from "../../../utils/chatHelpers";
import {
  chatRenderLog,
  sealStreamMessage,
  splitAgentVisibleContent,
} from "../chatMessagePipeline";
import {
  ChatStreamState,
  LegacyStreamAdapter,
  createChatStreamState,
  materializeStreamMessages,
  reduceStreamEvent,
} from "../chatStreamReducer";

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

/** Tool/log events that should seal the current bubble and start a new one. */
function isToolInterruptMessage(m: { config: any }): boolean {
  const cfg = m.config as any;
  const meta = (cfg.metadata || {}) as Record<string, unknown>;
  return (
    meta.type === "log" ||
    cfg.content_type === "log" ||
    cfg.type === "AgentLogEvent" ||
    meta.type === "AgentLogEvent" ||
    cfg.type === "ToolCallSummaryMessage" ||
    meta.type === "ToolCallSummaryMessage" ||
    cfg.type === "ToolCallRequestEvent" ||
    cfg.type === "ToolCallExecutionEvent" ||
    cfg.content_type === "tools" ||
    meta.content_type === "tools"
  );
}

function wrapThink(thought: string, reply: string): string {
  const t = (thought || "").trim();
  const r = (reply || "").trim();
  return t ? `<think>${t}</think>\n\n${r}` : r;
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
  const streamStateRef = React.useRef<ChatStreamState | null>(null);
  const legacyAdapterRef = React.useRef<LegacyStreamAdapter | null>(null);

  const handleWebSocketMessageRef = React.useRef<
    (wsMessage: IncomingWebSocketMessage) => void
  >(() => {});

  // Batched WS message queue: coalesces bursts of chunks (and other events)
  // into a single React render. Also reorders the queue so that a terminal
  // event (input_request/completion/result) is processed BEFORE any preceding
  // chunks in the same batch. This way when the terminal event promotes the
  // last chunk to _is_final_reply, the promotion is applied in the same render
  // that first paints those chunks — no visible "inside-box then outside" flash.
  const wsMessageQueueRef = React.useRef<IncomingWebSocketMessage[]>([]);
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
  const enqueueWsMessage = React.useCallback((msg: IncomingWebSocketMessage) => {
    const legacyData = (msg as WebSocketMessage).data as any;
    chatRenderLog("ws:enqueue", {
      type: msg.type,
      source: isStreamV2Event(msg) ? msg.source : legacyData?.source,
      preview:
        typeof legacyData?.content === "string"
          ? String(legacyData.content).replace(/\s+/g, " ").trim().slice(0, 80)
          : undefined,
      start_flag: legacyData?.metadata?.start_flag,
      msgType: legacyData?.type,
    });
    wsMessageQueueRef.current.push(msg);
    if (!wsFlushScheduledRef.current) {
      wsFlushScheduledRef.current = true;
      setTimeout(flushWsQueue, WS_FLUSH_DELAY_MS);
    }
  }, [flushWsQueue]);

  const handleWebSocketMessage = React.useCallback(
    (wsMessage: IncomingWebSocketMessage) => {
      setCurrentRun((current: Run | null) => {
        if (!current || !session?.id) {
          return current;
        }

        let streamEvents = isStreamV2Event(wsMessage) ? [wsMessage] : [];
        if (!streamEvents.length) {
          const source = ((wsMessage as WebSocketMessage).data as any)?.source;
          const isAssistantStream =
            source !== "user" &&
            source !== "user_proxy" &&
            source !== "system" &&
            (wsMessage.type === "message_chunk" ||
              wsMessage.type === "message_thinking" ||
              wsMessage.type === "message");
          if (isAssistantStream) {
            if (
              !legacyAdapterRef.current ||
              streamStateRef.current?.runId !== current.id
            ) {
              legacyAdapterRef.current = new LegacyStreamAdapter(current.id);
            }
            streamEvents = legacyAdapterRef.current.adapt(
              wsMessage as WebSocketMessage
            );
          }
        }
        if (streamEvents.length) {
          let state =
            streamStateRef.current?.runId === current.id
              ? streamStateRef.current
              : createChatStreamState(current.id);
          let nextStatus = current.status;
          let nextInputRequest = current.input_request;
          let nextAgentWorking = current.agent_working ?? null;
          for (const event of streamEvents) {
            state = reduceStreamEvent(state, event);
            if (event.event === "agent.working") {
              nextStatus = "active";
              nextAgentWorking = {
                phase: event.working?.phase || "model",
                detail: event.working?.detail,
              };
              nextInputRequest = undefined;
            } else if (
              event.event === "message.started" ||
              event.event === "message.delta" ||
              event.event === "message.snapshot"
            ) {
              // Visible stream tokens replace the waiting indicator.
              nextAgentWorking = null;
              if (nextStatus === "ready") nextStatus = "active";
            } else if (event.event === "message.completed") {
              nextAgentWorking = null;
              // Answer is on screen; unlock the composer before turn.ready.
              // Further agent.working / message.started will flip back to active.
              nextStatus = "ready";
            } else if (event.event === "turn.ready") {
              nextStatus = "ready";
              nextInputRequest = undefined;
              nextAgentWorking = null;
            } else if (event.event === "interaction.required") {
              const interactionType =
                event.interaction?.interaction_type === "approval"
                  ? "approval"
                  : "text_input";
              nextStatus = "awaiting_input";
              nextInputRequest = {
                input_type: interactionType,
                prompt: event.interaction?.prompt,
              };
              nextAgentWorking = null;
            }
          }
          streamStateRef.current = state;
          if (state.needsResume && activeSocketRef.current?.readyState === WebSocket.OPEN) {
            queueMicrotask(() => {
              activeSocketRef.current?.send(
                JSON.stringify({
                  type: "stream.resume",
                  stream_protocol: 2,
                  resume_after_seq: state.lastSeq,
                })
              );
            });
          }
          return {
            ...current,
            status: nextStatus,
            input_request: nextInputRequest,
            agent_working: nextAgentWorking,
            messages: materializeStreamMessages(
              current.messages,
              state,
              session.id,
              userEmail
            ),
          };
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
            const nonTerminal = new Set([
              "active",
              "ready",
              "awaiting_input",
              "pausing",
              "paused",
            ]);
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

            let bestDraft: (typeof current.messages)[0] | null = null;
            let bestDraftIdx = -1;
            let bestDraftLen = 0;
            let lastDraft: (typeof current.messages)[0] | null = null;
            let lastDraftIdx = -1;
            for (let i = 0; i < current.messages.length; i++) {
              const m = current.messages[i];
              if (m.config.source !== chunkSourceKey) continue;
              if (!isLiveStreamDraft(m)) continue;
              lastDraft = m;
              lastDraftIdx = i;
              const rawLen =
                typeof (m.config.metadata as any)?._stream_raw === "string"
                  ? String((m.config.metadata as any)._stream_raw).length
                  : typeof m.config.content === "string"
                  ? m.config.content.trim().length
                  : 0;
              if (rawLen >= bestDraftLen) {
                bestDraft = m;
                bestDraftIdx = i;
                bestDraftLen = rawLen;
              }
            }
            const draftForPromote = bestDraft ?? lastDraft;
            const draftIdxForPromote =
              bestDraftIdx >= 0 ? bestDraftIdx : lastDraftIdx;
            const draftLiveThought =
              typeof (draftForPromote?.config.metadata as any)?._live_thought ===
              "string"
                ? String(
                    (draftForPromote!.config.metadata as any)._live_thought
                  ).trim()
                : "";

            let incomingBody =
              typeof messageData.content === "string" ? messageData.content : "";
            let incomingThought = draftLiveThought;
            if (typeof incomingBody === "string") {
              const split = splitAgentVisibleContent(incomingBody);
              incomingThought = split.thought || draftLiveThought;
              incomingBody = wrapThink(incomingThought, split.reply);
            }

            const promoteDraftInPlace = (
              draft: (typeof current.messages)[0],
              idx: number
            ) => {
              const existingMeta = (draft.config.metadata || {}) as any;
              const prevRaw =
                typeof existingMeta._stream_raw === "string"
                  ? String(existingMeta._stream_raw)
                  : typeof draft.config.content === "string"
                  ? draft.config.content
                  : "";
              const mergedRaw =
                incomingBody.length >= prevRaw.length ? incomingBody : prevRaw;
              const projected = projectStreamContent(mergedRaw);
              const thought = projected.thought || incomingThought;
              const messages = [...current.messages];
              messages[idx] = {
                ...draft,
                config: {
                  ...draft.config,
                  content: projected.reply,
                  type: (draft.config as any).type || "TextMessage",
                  metadata: {
                    ...existingMeta,
                    _stream_draft: true,
                    _stream_raw: mergedRaw,
                    _live_thought: thought || undefined,
                    _thought_done: projected.thoughtDone ? "yes" : "no",
                    _canonical_text: true,
                    start_flag: existingMeta.start_flag || "yes",
                  },
                },
              } as unknown as typeof draft;
              chatRenderLog("ws:message:promote", {
                source: chunkSourceKey,
                prevLen: prevRaw.length,
                mergedLen: mergedRaw.length,
                incomingLen: incomingBody.length,
              });
              return { ...current, messages };
            };

            // Empty canonical: keep the live draft as-is (do not unmount).
            if (!incomingBody.trim() && !incomingThought) {
              return current;
            }

            if (draftForPromote && draftIdxForPromote >= 0) {
              return promoteDraftInPlace(draftForPromote, draftIdxForPromote);
            }

            const created = createMessage(
              {
                ...messageData,
                content: incomingBody,
              } as AgentMessageConfig,
              current.id,
              session.id,
              userEmail
            );
            return {
              ...current,
              messages: [
                ...current.messages,
                {
                  ...created,
                  config: {
                    ...created.config,
                    metadata: {
                      ...(created.config.metadata || {}),
                      _is_final_reply: true,
                    },
                  } as any,
                },
              ],
            };
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

            // Append to the live draft unless this is a real new burst after
            // a tool/log interrupt. Mid-burst start_flag (reasoning models,
            // TextMessage races) must never reset `_stream_raw`.
            const lastIdx = current.messages.length - 1;
            const lastIsToolInterrupt =
              lastIdx >= 0 && isToolInterruptMessage(current.messages[lastIdx]);
            const startNewBurst =
              isStartChunk && lastIsToolInterrupt && draftIdx !== lastIdx;

            if (draftIdx >= 0 && !startNewBurst) {
              const existing = current.messages[draftIdx];
              const existingMeta = (existing.config.metadata || {}) as any;
              const prevRaw =
                typeof existingMeta._stream_raw === "string"
                  ? (existingMeta._stream_raw as string)
                  : typeof existing.config.content === "string"
                  ? (existing.config.content as string)
                  : "";
              const combinedRaw = prevRaw + incomingRaw;
              if (combinedRaw === prevRaw) {
                return current;
              }
              const payload = buildDraft(
                combinedRaw,
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

            // New burst after tools (or first token). Seal prior live drafts
            // from this source into durable bubbles first (drop empty ones).
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
          case "input_request": {
            // Legacy frame. Default continuation prompts map to turn.ready;
            // only real blocking interactions keep awaiting_input.
            const sealedMessages = current.messages.map((m) =>
              isLiveStreamDraft(m) ? sealStreamMessage(m) : m
            );
            if (
              isDefaultContinuationPrompt(
                wsMessage.prompt,
                wsMessage.input_type || "text_input"
              )
            ) {
              return {
                ...current,
                status: "ready" as BaseRunStatus,
                input_request: undefined,
                agent_working: null,
                messages: sealedMessages,
              };
            }

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
                input_request = {
                  input_type: "text_input",
                  prompt: wsMessage.prompt,
                };
                break;
            }

            return {
              ...current,
              status: "awaiting_input",
              input_request: input_request,
              agent_working: null,
              messages: sealedMessages,
            };
          }

          case "system":
            // Do not let a stale awaiting_input system frame override turn.ready.
            if (
              current.status === "ready" &&
              wsMessage.status === "awaiting_input"
            ) {
              return current;
            }
            updatedRun = {
              ...current,
              status: wsMessage.status as BaseRunStatus,
            };

            return updatedRun;

          case "result":
          case "completion":
            const restartReason =
              (wsMessage.data as any)?.task_result?.stop_reason ||
              (wsMessage.data as any)?.stop_reason;
            // Internal restart on the same run_id. Closing the socket here is
            // what made "close tab → reopen → send" immediately show cancelled.
            if (
              (wsMessage.status as string | undefined) === "cancelled" &&
              restartReason === "Restarted by client"
            ) {
              return current;
            }

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

            // Seal remaining live drafts on terminal status so history reload
            // and copy actions see a normal TextMessage.
            const sealedOnComplete = current.messages.map((m) =>
              isLiveStreamDraft(m) ? sealStreamMessage(m) : m
            );
            updatedRun = {
              ...current,
              status,
              agent_working: null,
              messages: sealedOnComplete,
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
          const nonTerminal = new Set([
            "active",
            "ready",
            "awaiting_input",
            "pausing",
            "paused",
          ]);
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
        if (activeSocketRef.current !== socket) return;
        // Only resume after a real gap. Fresh sockets start at seq 0 and
        // negotiate protocol via the subsequent start/continue payload.
        const lastSeq =
          streamStateRef.current?.runId === runId
            ? streamStateRef.current.lastSeq
            : 0;
        if (lastSeq <= 0) return;
        socket.send(
          JSON.stringify({
            type: "stream.resume",
            stream_protocol: 2,
            resume_after_seq: lastSeq,
          })
        );
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

