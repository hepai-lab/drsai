import { useEffect, useRef, useState } from "react";
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  DesktopApprovalProposalResult,
  DesktopAgent,
  DesktopCommitApprovalChecklist,
  DesktopCustomCommand,
  DesktopForkQueueDispatchResult,
  DesktopForkQueueStartApprovalResult,
  DesktopProjectMemoryEntry,
  DesktopTeamMemoryEntry,
  DesktopUserPreference,
  DesktopThread,
  DesktopThreadSnapshot,
  MyDrSaiModelConfig,
  WorkspaceCheckpoint,
  WorkspaceCheckpointPreviewResult,
  WorkspaceCheckpointRestoreResult,
  WorkspaceContextOverview,
  WorkspaceInstructionSummary,
} from "@shared/desktopApi";
import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  migrateLegacyMessageToStructuredTurn,
  settleInterruptedStructuredTurn,
  type StructuredAssistantPart,
  type StructuredActivityEvent,
  type StructuredConversationEvent,
  type StructuredTurnState,
} from "@shared/structuredConversation";
import {
  parseChatCommand,
  parseForkQueueEntries,
  parseForkQueueItems,
  runChatCommand,
  type ChatCommandAction,
  type ChatRuntimeMode,
  type ForkQueueItem,
} from "../chatCommands";
import type { ChatSubmitOptions, UiMessage } from "../components/ChatWorkspace";
import { desktopApi } from "../desktopApi";
import { emitAssistantSpeechStreamEvent } from "../voice/streaming/assistantSpeechStream";
import {
  formatRecentTerminalTestResult,
  readRecentTerminalTestResult,
} from "../terminalTestResults";
import { acceptChatEventSequence, getVisibleChatText } from "../chatOutputModel";
import {
  appendDebugLog,
  appendStructuredActivityLog,
  appendStructuredProtocolLog,
} from "../debugLogStore";
import {
  analyzeMemorySafetyIntent,
  buildUserPreferenceSystemSection,
  formatMemorySafetyNotice,
  formatAppliedPreferenceNotice,
  formatPreferenceConfirmation,
  isPreferenceOnlyRequest,
  parseExplicitUserPreferenceIntent,
  redactSensitiveMemoryText,
} from "../userPreferenceIntent";

export interface DesktopChatAdapter {
  activeRequestId: string | null;
  currentRuntimeMode: ChatRuntimeMode | null;
  commandAttachments: ChatAttachment[];
  input: string;
  messages: UiMessage[];
  clearRuntimeMode: () => void;
  clearCommandAttachments: () => void;
  removeCommandAttachment: (index: number) => void;
  setInput: (value: string) => void;
  submit: (
    attachments?: ChatAttachment[],
    options?: ChatSubmitOptions,
  ) => Promise<boolean>;
  abort: () => Promise<void>;
}

export type ChatThreadSnapshot = DesktopThreadSnapshot;

const LOCAL_COMPACT_MAX_MESSAGES = 10;
const LOCAL_COMPACT_MAX_REUSABLE_ITEMS = 6;
const LOCAL_COMPACT_MAX_MESSAGE_CHARS = 360;
const LOCAL_COMPACT_MAX_ITEM_CHARS = 220;

export function useDesktopChatAdapter({
  availableAgents,
  availableModels,
  canChat,
  developerMode,
  language,
  onChatComplete,
  onForkThreadCreated,
  onOpenSkillsSquare,
  onSelectAgent,
  onSelectModel,
  onThreadUpdated,
  threadId,
  threadSnapshot,
  workspaceInstructions,
  workspaceId,
  workspacePath,
}: {
  availableAgents?: DesktopAgent[];
  availableModels?: MyDrSaiModelConfig[];
  canChat: boolean;
  developerMode: boolean;
  language: "en" | "zh";
  onChatComplete: () => void;
  onForkThreadCreated?: (thread: DesktopThread) => void;
  onOpenSkillsSquare?: (target?: Extract<ChatCommandAction, { type: "open-view" }>["target"]) => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectModel?: (model: string) => void;
  onThreadUpdated?: (snapshot: ChatThreadSnapshot) => void;
  threadId: string;
  threadSnapshot?: ChatThreadSnapshot | null;
  workspaceInstructions?: WorkspaceInstructionSummary[];
  workspaceId?: string;
  workspacePath?: string;
}): DesktopChatAdapter {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([createWelcomeMessage(language, [])]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [currentRuntimeMode, setCurrentRuntimeMode] = useState<ChatRuntimeMode | null>(null);
  const [commandAttachments, setCommandAttachments] = useState<ChatAttachment[]>([]);
  const [customCommands, setCustomCommands] = useState<DesktopCustomCommand[]>([]);
  const [projectMemory, setProjectMemory] = useState<DesktopProjectMemoryEntry[]>([]);
  const [userPreferences, setUserPreferences] = useState<DesktopUserPreference[]>([]);
  const streamingAssistantByRequest = useRef<Record<string, string>>({});
  const structuredRequests = useRef<Set<string>>(new Set());
  const completedStructuredRequests = useRef<Set<string>>(new Set());
  const lastSequenceByRequest = useRef<Record<string, number>>({});
  const pendingDeltasByRequest = useRef<Record<string, { text: string; reasoning: string }>>({});
  const deltaFlushTimerRef = useRef<number | null>(null);
  const recoveryTimersRef = useRef<Record<string, number>>({});
  const restoredSnapshotThreadRef = useRef<string | null>(null);
  const pendingStructuredEventsByRequest = useRef<Record<string, StructuredConversationEvent[]>>({});
  const structuredFlushTimerRef = useRef<number | null>(null);
  const threadIdRef = useRef(threadId);
  const languageRef = useRef(language);
  const developerModeRef = useRef(developerMode);
  const currentRuntimeModeRef = useRef<ChatRuntimeMode | null>(null);
  const customCommandsRef = useRef<DesktopCustomCommand[]>([]);
  const projectMemoryRef = useRef<DesktopProjectMemoryEntry[]>([]);
  const teamMemoryRef = useRef<DesktopTeamMemoryEntry[]>([]);
  const userPreferencesRef = useRef<DesktopUserPreference[]>([]);

  function clearRecoveryTimers(): void {
    Object.values(recoveryTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    recoveryTimersRef.current = {};
  }

  function clearStructuredFlush(): void {
    pendingStructuredEventsByRequest.current = {};
    if (structuredFlushTimerRef.current !== null) window.clearTimeout(structuredFlushTimerRef.current);
    structuredFlushTimerRef.current = null;
  }

  function applyStructuredEventBatch(requestId: string, events: StructuredConversationEvent[]): void {
    if (!events.length) return;
    const assistantId = streamingAssistantByRequest.current[requestId];
    setMessages((current) => {
      const updated = updateAssistantByIdOrLatestStreaming(current, assistantId, (message) =>
        events.reduce(applyStructuredEventToMessage, message),
      );
      return publishAndReturn(
        events.some((event) => event.type === "turn.error")
          ? settleAssistantAfterHiddenError(updated, assistantId)
          : updated,
      );
    });
  }

  function flushStructuredEventDeltas(): void {
    structuredFlushTimerRef.current = null;
    const pending = pendingStructuredEventsByRequest.current;
    pendingStructuredEventsByRequest.current = {};
    setMessages((current) => {
      let next = current;
      for (const [requestId, events] of Object.entries(pending)) {
        const assistantId = streamingAssistantByRequest.current[requestId];
        next = updateAssistantByIdOrLatestStreaming(next, assistantId, (message) =>
          events.reduce(applyStructuredEventToMessage, message),
        );
      }
      return next === current ? current : publishAndReturn(next);
    });
  }

  function restoreActiveStructuredTurns(snapshotMessages: UiMessage[]): void {
    clearRecoveryTimers();
    let latestActiveRequestId: string | null = null;
    for (const message of snapshotMessages) {
      const turn = message.structuredTurn;
      const hasRecoveryNotice = turn?.parts.some((part) =>
        part.kind === "notice" && typeof part.debugRef === "string" && part.debugRef.startsWith("recovery:"),
      );
      const isActive = turn?.status === "pending" || turn?.status === "running";
      if (message.role !== "assistant" || !turn || (!isActive && !hasRecoveryNotice) || turn.turnId.startsWith("legacy:")) continue;
      const requestId = turn.turnId;
      if (isActive) latestActiveRequestId = requestId;
      streamingAssistantByRequest.current[requestId] = message.id;
      structuredRequests.current.add(requestId);
      if (isActive) {
        recoveryTimersRef.current[requestId] = window.setTimeout(() => {
          setMessages((current) => publishAndReturn(current.map((candidate) => {
            if (candidate.structuredTurn?.turnId !== turn.turnId) return candidate;
            const settled = settleInterruptedStructuredTurn(
              candidate.structuredTurn,
              languageRef.current === "zh"
                ? "桌面端未能重新连接到这次运行。已保留收到的内容，你可以重新发送请求。"
                : "The desktop could not reconnect to this run. Received content was kept; you can send the request again.",
            );
            if (settled === candidate.structuredTurn) return candidate;
            return { ...candidate, structuredTurn: settled, streaming: false, lastEventAt: Date.now() };
          })));
          setActiveRequestId((current) => current === requestId ? null : current);
          delete recoveryTimersRef.current[requestId];
          appendDebugLog("warn", `Structured turn recovery timed out: ${requestId}`, "chat");
        }, 30_000);
      }
      void desktopApi.recoverChatRun({ requestId, sessionId: threadIdRef.current })
        .then((events) => {
          if (!events.length) return;
          // Runtime recovery emits the same normalized chunks as a live Codex
          // stream. Do not suppress them merely because the snapshot used the
          // structured-turn representation before Electron restarted.
          structuredRequests.current.delete(requestId);
          if (hasRecoveryNotice) {
            setMessages((current) => current.map((candidate) =>
              candidate.structuredTurn?.turnId === requestId
                ? {
                    ...candidate,
                    content: "",
                    error: false,
                    streaming: true,
                    structuredTurn: createStructuredTurnState(requestId),
                    lastEventAt: Date.now(),
                  }
                : candidate,
            ));
          }
          window.setTimeout(() => events.forEach(applyChatEvent), 0);
        })
        .catch(() => {
          // Keep the bounded timeout as the fallback for non-Codex or no-longer-readable Runs.
        });
    }
    setActiveRequestId(latestActiveRequestId);
  }

  useEffect(() => {
    threadIdRef.current = threadId;
    languageRef.current = language;
    streamingAssistantByRequest.current = {};
    structuredRequests.current.clear();
    completedStructuredRequests.current.clear();
    lastSequenceByRequest.current = {};
    pendingDeltasByRequest.current = {};
    clearStructuredFlush();
    clearRecoveryTimers();
    restoredSnapshotThreadRef.current = null;
    if (deltaFlushTimerRef.current !== null) {
      window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
    }
    setActiveRequestId(null);
    setCurrentRuntimeMode(null);
    currentRuntimeModeRef.current = null;
    setCommandAttachments([]);
    setInput("");
    const restoredMessages = threadSnapshot?.messages?.length
      ? hydrateStructuredMessages(threadSnapshot.messages).filter((message) => message.id !== "welcome")
      : [createWelcomeMessage(language, userPreferencesRef.current)];
    if (threadSnapshot?.messages?.length) {
      restoreActiveStructuredTurns(restoredMessages);
      restoredSnapshotThreadRef.current = threadId;
    }
    setMessages(restoredMessages);
    return () => {
      clearRecoveryTimers();
      clearStructuredFlush();
    };
  }, [language, threadId]);

  useEffect(() => {
    let cancelled = false;
    desktopApi.listUserPreferences().then((preferences) => {
      if (cancelled) return;
      userPreferencesRef.current = preferences;
      setUserPreferences(preferences);
    }).catch(() => {
      if (cancelled) return;
      userPreferencesRef.current = [];
      setUserPreferences([]);
    });
    return () => { cancelled = true; };
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    desktopApi.listTeamMemory({ limit: 20 }).then((entries) => {
      if (cancelled) return;
      teamMemoryRef.current = entries;
    }).catch(() => {
      if (cancelled) return;
      teamMemoryRef.current = [];
    });
    return () => { cancelled = true; };
  }, [threadId, workspacePath]);

  useEffect(() => {
    let cancelled = false;
    if (!workspacePath) {
      customCommandsRef.current = [];
      setCustomCommands([]);
      projectMemoryRef.current = [];
      setProjectMemory([]);
      return;
    }
    desktopApi
      .listCustomCommands({ workspacePath, limit: 100 })
      .then((entries) => {
        if (cancelled) return;
        customCommandsRef.current = entries;
        setCustomCommands(entries);
      })
      .catch(() => {
        if (cancelled) return;
        customCommandsRef.current = [];
        setCustomCommands([]);
      });
    desktopApi
      .listProjectMemory({ workspacePath, limit: 20 })
      .then((entries) => {
        if (cancelled) return;
        projectMemoryRef.current = entries;
        setProjectMemory(entries);
      })
      .catch(() => {
        if (cancelled) return;
        projectMemoryRef.current = [];
        setProjectMemory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, workspacePath]);

  useEffect(() => {
    if (threadSnapshot?.threadId !== threadId) return;
    const restoredMessages = threadSnapshot.messages.length
      ? hydrateStructuredMessages(threadSnapshot.messages).filter((message) => message.id !== "welcome")
      : [createWelcomeMessage(language, userPreferencesRef.current)];
    if (threadSnapshot.messages.length && restoredSnapshotThreadRef.current !== threadId) {
      restoreActiveStructuredTurns(restoredMessages);
      restoredSnapshotThreadRef.current = threadId;
    }
    setMessages(restoredMessages);
  }, [language, threadId, threadSnapshot]);

  useEffect(() => {
    if (threadSnapshot?.messages?.length) return;
    setMessages((current) => current.every((message) => message.id === "welcome")
      ? [createWelcomeMessage(language, userPreferences)]
      : current);
  }, [language, threadId, threadSnapshot, userPreferences]);

  useEffect(() => {
    developerModeRef.current = developerMode;
  }, [developerMode]);

  useEffect(() => {
    return desktopApi.onChatEvent((event) => {
      applyChatEvent(event);
    });
  }, []);

  useEffect(() => () => {
    if (deltaFlushTimerRef.current !== null) window.clearTimeout(deltaFlushTimerRef.current);
  }, []);

  async function submit(
    attachments: ChatAttachment[] = [],
    options?: ChatSubmitOptions,
  ): Promise<boolean> {
    const text = input.trim();
    if (!text || activeRequestId) return false;

    const materialPaths = [...new Set(attachments
      .filter((attachment) => attachment.kind === "file" && !attachment.blockedReason && attachment.path)
      .map((attachment) => attachment.path))];
    if (materialPaths.length > 0 && isMaterialInventoryIntent(text)) {
      try {
        const analysis = await desktopApi.analyzeMaterialRoles({ paths: materialPaths });
        publishLocalAssistantResult(text, formatMaterialInventoryAnswer(analysis, languageRef.current));
        setInput("");
        return true;
      } catch {
        // Fall through to the normal chat route when local material inspection is unavailable.
      }
    }
    if (materialPaths.length > 0 && isNaturalMaterialQueryIntent(text)) {
      try {
        const result = await desktopApi.queryMaterials({ paths: materialPaths, question: text });
        publishLocalAssistantResult(text, formatMaterialQueryAnswer(result, languageRef.current));
        setInput("");
        return true;
      } catch {
        // Fall through to the normal chat route when local material querying is unavailable.
      }
    }

    const memorySafety = analyzeMemorySafetyIntent(text);
    const explicitPreferences = memorySafety.temporary ? [] : parseExplicitUserPreferenceIntent(text);
    const saved: DesktopUserPreference[] = [];
    if (explicitPreferences.length) {
      for (const preference of explicitPreferences) saved.push(await desktopApi.upsertUserPreference(preference));
      const refreshed = await desktopApi.listUserPreferences();
      userPreferencesRef.current = refreshed;
      setUserPreferences(refreshed);
    }
    const handleSensitiveLocally = memorySafety.hasSensitiveContent;
    const handleTemporaryLocally = memorySafety.explicitMemoryRequest && memorySafety.temporary && isPreferenceOnlyRequest(text);
    if (attachments.length === 0 && (handleSensitiveLocally || handleTemporaryLocally || (saved.length > 0 && isPreferenceOnlyRequest(text)))) {
      const response = [
        saved.length ? formatPreferenceConfirmation(saved, languageRef.current) : "",
        formatMemorySafetyNotice(memorySafety, languageRef.current),
      ].filter(Boolean).join("\n\n");
      publishLocalAssistantResult(memorySafety.hasSensitiveContent ? redactSensitiveMemoryText(text) : text, response);
      setInput("");
      return true;
    }

    const command = parseChatCommand(text);
    if (command) {
      const result = runChatCommand(command, {
        attachments,
        availableAgents,
        availableModels,
        canChat,
        currentRuntimeMode: currentRuntimeModeRef.current ?? undefined,
        customCommands,
        options,
        projectMemory,
        workspaceInstructions,
        workspacePath,
      });
      applyChatCommandAction(result.action);
      const customCommandText = await maybeApplyCustomCommand(command, workspacePath);
      const approvalText = await maybeRequestCommitApproval(command, workspacePath);
      const goalText = await maybeApplyGoalCommand(command, workspacePath);
      const memoryText = await maybeApplyMemoryCommand(command, workspacePath);
      const mcpLiveText = await maybeRequestMcpLiveBridge(command, workspacePath);
      const mcpContextText = await maybeImportMcpContext(command, workspacePath);
      const compactText = await maybeApplyCompactCommand(
        command,
        messages,
        workspacePath,
        refreshProjectMemory,
      );
      const checkpointText = await maybeApplyWorkspaceCheckpointCommand(command, workspacePath);
      const forkHandoffResult = await maybeHandoffForkQueueThread(command);
      const forkScheduleResult = await maybeScheduleForkQueue(command, workspacePath, options);
      const forkDispatchResult = await maybeDispatchForkQueue(command, workspacePath, options);
      const forkResult = await maybeCreateForkThread(command, workspacePath, options);
      publishLocalAssistantResult(
        text,
        [
          `**${result.title}**`,
          "",
          result.content,
          customCommandText,
          approvalText,
          goalText,
          memoryText,
          mcpLiveText,
          mcpContextText,
          compactText,
          checkpointText,
          forkHandoffResult?.text,
          forkScheduleResult?.text,
          forkDispatchResult?.text,
          forkResult?.text,
        ]
          .filter((item) => item !== undefined && item !== "")
          .join("\n\n"),
      );
      if (forkHandoffResult?.thread) onForkThreadCreated?.(forkHandoffResult.thread);
      forkScheduleResult?.threads?.forEach((thread) => onForkThreadCreated?.(thread));
      forkDispatchResult?.threads?.forEach((thread) => onForkThreadCreated?.(thread));
      forkResult?.threads?.forEach((thread) => onForkThreadCreated?.(thread));
      if (result.action?.type !== "set-input") {
        setInput("");
      }
      return true;
    }

    if (!canChat) {
      const liveGateway = await desktopApi.getGatewayStatus().catch(() => null);
      if (!liveGateway?.ready || liveGateway.externalConflict) return false;
    }

    const userMessage: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const nextMessages: UiMessage[] = [
      ...messages.filter((message) => message.id !== "welcome"),
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
        structuredTurn: createStructuredTurnState(requestId),
        startedAt: Date.now(),
        lastEventAt: Date.now(),
      },
    ];
    setMessages(nextMessages);
    publishThreadUpdate(nextMessages);
    streamingAssistantByRequest.current[requestId] = assistantId;
    setInput("");
    setActiveRequestId(requestId);

    try {
      await desktopApi.startChat({
        requestId,
        agentId: options?.agentId?.trim() || undefined,
        sessionId: threadIdRef.current,
        runId: requestId,
        workspaceId,
        workspacePath,
        attachments,
        model: options?.model?.trim() || undefined,
        metadata: {
          selected_agent_id: options?.agentId?.trim() || undefined,
          workspace_instructions: workspaceInstructions || [],
          selected_agent: options?.agentName?.trim() || undefined,
          thinking_effort: options?.thinkingEffort,
          reasoning_effort: options?.thinkingEffort,
          runtime_mode: currentRuntimeModeRef.current
            ? serializeRuntimeMode(currentRuntimeModeRef.current)
            : undefined,
          user_preferences: userPreferencesRef.current.map(({ category, value }) => ({ category, value })),
          project_memory: projectMemoryRef.current.map(({ id, content }) => ({ id, content })),
          team_memory: teamMemoryRef.current.map(({ id, teamId, content }) => ({ id, teamId, content })),
        },
        messages: buildRequestMessages(
          [...messages, userMessage]
            .filter((message) => !message.error && message.content.trim().length > 0)
            .map(({ role, content }) => ({ role, content })),
          workspaceInstructions,
          projectMemoryRef.current,
          teamMemoryRef.current,
          userPreferencesRef.current,
          currentRuntimeModeRef.current,
        ),
      });
      return true;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : languageRef.current === "zh" ? "聊天未能启动。" : "Chat failed to start.";
      appendDebugLog(
        "error",
        `${formatAssistantError(message, false, languageRef.current)}\n\n${message}`,
        "chat",
      );
      setActiveRequestId(null);
      delete streamingAssistantByRequest.current[requestId];
      setMessages((current) => current.filter((item) => item.id !== assistantId));
      setInput(text);
      return false;
    }
  }

  async function abort(): Promise<void> {
    if (!activeRequestId) return;
    await desktopApi.abortChat(activeRequestId);
    setActiveRequestId(null);
  }

  function clearRuntimeMode(): void {
    currentRuntimeModeRef.current = null;
    setCurrentRuntimeMode(null);
  }

  function clearCommandAttachments(): void {
    setCommandAttachments([]);
  }

  function removeCommandAttachment(index: number): void {
    setCommandAttachments((current) => current.filter((_item, itemIndex) => itemIndex !== index));
  }

  function applyChatEvent(event: ChatEvent): void {
    if (event.sessionId && event.sessionId !== threadIdRef.current) return;
    if (!acceptChatEventSequence(lastSequenceByRequest.current, event.requestId, event.seq)) return;
    const recoveryTimer = recoveryTimersRef.current[event.requestId];
    if (recoveryTimer !== undefined) {
      window.clearTimeout(recoveryTimer);
      delete recoveryTimersRef.current[event.requestId];
    }
    if (event.type === "start") {
      touchStreamingAssistant(event.requestId);
      setActiveRequestId(event.requestId);
      return;
    }
    if (event.type === "structured" && event.structuredEvent) {
      structuredRequests.current.add(event.requestId);
      delete pendingDeltasByRequest.current[event.requestId];
      const structuredEvent = event.structuredEvent;
      const recoveryTimer = recoveryTimersRef.current[event.requestId];
      if (recoveryTimer !== undefined) {
        window.clearTimeout(recoveryTimer);
        delete recoveryTimersRef.current[event.requestId];
      }
      appendStructuredProtocolLog(structuredEvent);
      if (structuredEvent.type === "part.delta" && structuredEvent.delta.kind === "markdown.append") {
        emitAssistantSpeechStreamEvent({ type: "chunk", requestId: event.requestId, content: structuredEvent.delta.text, at: Date.now() });
      }
      if (structuredEvent.type === "activity.updated") {
        appendStructuredActivityLog(structuredEvent.activity);
      }
      if (structuredEvent.type === "part.delta") {
        pendingStructuredEventsByRequest.current[event.requestId] = [
          ...(pendingStructuredEventsByRequest.current[event.requestId] ?? []),
          structuredEvent,
        ];
        if (structuredFlushTimerRef.current === null) {
          structuredFlushTimerRef.current = window.setTimeout(flushStructuredEventDeltas, 16);
        }
        return;
      }
      const pendingStructuredEvents = pendingStructuredEventsByRequest.current[event.requestId] ?? [];
      delete pendingStructuredEventsByRequest.current[event.requestId];
      applyStructuredEventBatch(event.requestId, [...pendingStructuredEvents, structuredEvent]);
      if (structuredEvent.type === "turn.error") {
        appendDebugLog(
          "error",
          `${formatAssistantError(structuredEvent.message, false, languageRef.current)}\n\n${structuredEvent.message}`,
          "chat",
        );
      }
      if (
        structuredEvent.type === "turn.completed" ||
        structuredEvent.type === "turn.cancelled" ||
        structuredEvent.type === "turn.error"
      ) {
        emitAssistantSpeechStreamEvent({
          type: structuredEvent.type === "turn.completed" ? "done" : structuredEvent.type === "turn.cancelled" ? "aborted" : "error",
          requestId: event.requestId,
          at: Date.now(),
        });
        setActiveRequestId((current) => current === event.requestId ? null : current);
        if (!completedStructuredRequests.current.has(event.requestId)) {
          completedStructuredRequests.current.add(event.requestId);
          onChatComplete();
        }
      }
      return;
    }
    if (event.type === "connection" && event.connection) {
      const turnId = event.runId || event.requestId;
      const activity: StructuredActivityEvent = {
        id: `${turnId}:connection`,
        turnId,
        timestamp: event.connection.timestamp,
        source: event.connection.source,
        status: event.connection.status === "restored" ? "completed" : "running",
        title: event.connection.status === "restored"
          ? (languageRef.current === "zh" ? "连接已恢复" : "Connection restored")
          : (languageRef.current === "zh" ? "正在恢复连接" : "Reconnecting"),
        kind: "retry",
        attempt: event.connection.attempt,
        limit: Math.max(1, event.connection.attempt),
        ...(event.connection.delayMs !== undefined ? { delayMs: event.connection.delayMs } : {}),
      };
      appendStructuredActivityLog(activity);
      if (!structuredRequests.current.has(event.requestId)) {
        const assistantId = streamingAssistantByRequest.current[event.requestId];
        setMessages((current) => publishAndReturn(
          updateAssistantByIdOrLatestStreaming(current, assistantId, (message) => ({
            ...message,
            structuredTurn: appendConnectionActivity(message.structuredTurn, turnId, activity),
            lastEventAt: Date.now(),
          })),
        ));
      }
      return;
    }
    if (
      structuredRequests.current.has(event.requestId) &&
      (event.type === "chunk" || event.type === "reasoning" || event.type === "status" || event.type === "tool_timeline")
    ) return;
    if (event.type === "chunk") {
      emitAssistantSpeechStreamEvent({ type: "chunk", requestId: event.requestId, content: event.content ?? "", at: Date.now() });
      queueAssistantDelta(event.requestId, "text", event.content ?? "");
      return;
    }
    if (event.type === "status") {
      const statusContent = event.content ?? "";
      if (statusContent.trim()) appendDebugLog(getDebugLevel(event.level), statusContent.trim(), "chat");
      return;
    }
    if (event.type === "reasoning") {
      queueAssistantDelta(event.requestId, "reasoning", event.content ?? "");
      return;
    }
    if (event.type === "tool_timeline" && event.toolTimeline) {
      const toolTimeline = event.toolTimeline;
      appendDebugLog(
        toolTimeline.status === "failed" ? "error" : "info",
        formatToolTimelineDebugLog(toolTimeline),
        "chat",
      );
      setMessages((current) =>
        publishAndReturn(
          appendAssistantToolTimeline(
            current,
            streamingAssistantByRequest.current[event.requestId],
            toolTimeline,
          ),
        ),
      );
      return;
    }
    if (event.type === "input_request" && event.prompt) {
      const assistantId = streamingAssistantByRequest.current[event.requestId];
      setMessages((current) =>
        publishAndReturn(
          updateAssistantByIdOrLatestStreaming(current, assistantId, (message) => ({
            ...message,
            inputRequest: {
              requestId: event.requestId,
              prompt: event.prompt || "Input required",
              inputType: event.inputType || "text_input",
            },
          })),
        ),
      );
      return;
    }
    if (event.type === "done" || event.type === "aborted") {
      emitAssistantSpeechStreamEvent({ type: event.type, requestId: event.requestId, at: Date.now() });
      flushPendingDeltas();
      if (structuredRequests.current.has(event.requestId)) {
        structuredRequests.current.delete(event.requestId);
        completedStructuredRequests.current.delete(event.requestId);
        delete streamingAssistantByRequest.current[event.requestId];
        delete lastSequenceByRequest.current[event.requestId];
        delete pendingDeltasByRequest.current[event.requestId];
        setActiveRequestId((current) => current === event.requestId ? null : current);
        return;
      }
      const assistantId = streamingAssistantByRequest.current[event.requestId];
      setMessages((current) =>
        publishAndReturn(
          updateAssistantByIdOrLatestStreaming(current, assistantId, (message) => ({
            ...message,
            streaming: false,
            structuredTurn: finalizeStructuredTurn(
              message.structuredTurn,
              message.id,
              event.type === "aborted" ? "cancelled" : "completed",
            ),
          })),
        ),
      );
      delete streamingAssistantByRequest.current[event.requestId];
      delete lastSequenceByRequest.current[event.requestId];
      delete pendingDeltasByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
      onChatComplete();
      return;
    }
    if (event.type === "error") {
      emitAssistantSpeechStreamEvent({ type: "error", requestId: event.requestId, at: Date.now() });
      flushPendingDeltas();
      if (structuredRequests.current.has(event.requestId)) {
        structuredRequests.current.delete(event.requestId);
        completedStructuredRequests.current.delete(event.requestId);
        delete streamingAssistantByRequest.current[event.requestId];
        delete lastSequenceByRequest.current[event.requestId];
        delete pendingDeltasByRequest.current[event.requestId];
        setActiveRequestId((current) => current === event.requestId ? null : current);
        return;
      }
      const assistantId = streamingAssistantByRequest.current[event.requestId];
      const userFacingError = event.failureRecovery?.message
        || event.error
        || (languageRef.current === "zh" ? "聊天失败。" : "Chat failed.");
      appendDebugLog(
        "error",
        `${formatAssistantError(userFacingError, false, languageRef.current)}\n\n${userFacingError}`,
        "chat",
      );
      setMessages((current) =>
        publishAndReturn(settleAssistantAfterHiddenError(current, assistantId)),
      );
      delete streamingAssistantByRequest.current[event.requestId];
      delete lastSequenceByRequest.current[event.requestId];
      delete pendingDeltasByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
    }
  }

  function queueAssistantDelta(requestId: string, kind: "text" | "reasoning", content: string): void {
    if (!content) return;
    const pending = pendingDeltasByRequest.current[requestId] ?? { text: "", reasoning: "" };
    pending[kind] += content;
    pendingDeltasByRequest.current[requestId] = pending;
    if (deltaFlushTimerRef.current !== null) return;
    deltaFlushTimerRef.current = window.setTimeout(flushPendingDeltas, 40);
  }

  function flushPendingDeltas(): void {
    if (deltaFlushTimerRef.current !== null) {
      window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
    }
    const queued = pendingDeltasByRequest.current;
    pendingDeltasByRequest.current = {};
    if (!Object.keys(queued).length) return;
    setMessages((current) => {
      let next = current;
      for (const [requestId, delta] of Object.entries(queued)) {
        const assistantId = streamingAssistantByRequest.current[requestId];
        if (delta.reasoning) next = appendAssistantReasoning(next, assistantId, delta.reasoning);
        if (delta.text) next = appendAssistantChunk(next, assistantId, delta.text);
      }
      return publishAndReturn(next);
    });
  }

  function touchStreamingAssistant(requestId: string): void {
    const assistantId = streamingAssistantByRequest.current[requestId];
    const timestamp = Date.now();
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId ? { ...message, lastEventAt: timestamp } : message,
      ),
    );
  }

  function publishAndReturn(nextMessages: UiMessage[]): UiMessage[] {
    publishThreadUpdate(nextMessages);
    return nextMessages;
  }

  function publishThreadUpdate(nextMessages: UiMessage[]): void {
    const nonWelcome = nextMessages.filter((message) => message.id !== "welcome");
    if (!nonWelcome.length) return;
    const firstUser = nonWelcome.find((message) => message.role === "user");
    onThreadUpdated?.({
      threadId: threadIdRef.current,
      title: firstUser?.content.slice(0, 48) || (languageRef.current === "zh" ? "新会话" : "New chat"),
      messages: nextMessages,
      updatedAt: Date.now(),
      messageCount: nonWelcome.length,
    });
  }

  function publishLocalAssistantResult(userText: string, assistantText: string): void {
    const commandMessages: UiMessage[] = [
      ...messages.filter((message) => message.id !== "welcome"),
      {
        id: crypto.randomUUID(),
        role: "user",
        content: userText,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantText,
      },
    ];
    setMessages(commandMessages);
    publishThreadUpdate(commandMessages);
  }

  function applyChatCommandAction(action: ReturnType<typeof runChatCommand>["action"]): void {
    if (!action) return;
    if (action.type === "select-agent") {
      onSelectAgent?.(action.agentId);
      return;
    }
    if (action.type === "select-model") {
      onSelectModel?.(action.model);
      return;
    }
    if (action.type === "attach-selection") {
      setCommandAttachments((current) => [...current, action.attachment]);
      return;
    }
    if (action.type === "open-view") {
      if (action.viewId === "skills_square") {
        onOpenSkillsSquare?.(action.target);
      }
      return;
    }
    if (action.type === "set-input") {
      setInput(action.input);
      return;
    }
    currentRuntimeModeRef.current = action.mode;
    setCurrentRuntimeMode(action.mode);
  }

  async function maybeRequestCommitApproval(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
  ): Promise<string | undefined> {
    if (!command || command.name !== "commit" || !command.args.trim()) return undefined;
    if (!selectedWorkspacePath) {
      return "Commit approval was not requested because no workspace is selected.";
    }
    try {
      const preflight = await buildCommitPreflight(selectedWorkspacePath);
      if (!preflight.canCommit) return preflight.chatSummary;
      const result = await desktopApi.requestGitCommitApproval({
        workspacePath: selectedWorkspacePath,
        message: command.args.trim(),
        body: preflight.approvalBody,
        checklist: preflight.checklist,
        requestId: crypto.randomUUID(),
      });
      return [preflight.chatSummary, formatCommitApprovalResult(result)].join("\n\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Commit approval request failed.";
      return `Commit approval request failed: ${message}`;
    }
  }

  async function maybeApplyMemoryCommand(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
  ): Promise<string | undefined> {
    if (!command || command.name !== "memory") return undefined;
    if (!selectedWorkspacePath) return undefined;
    const args = command.args.trim();
    const addMatch = command.args.match(/^add\s+([\s\S]+)$/i);
    if (addMatch?.[1]?.trim()) {
      const entry = await desktopApi.addProjectMemory({
        workspacePath: selectedWorkspacePath,
        content: addMatch[1].trim(),
        source: "chat_command",
      });
      await refreshProjectMemory(selectedWorkspacePath);
      return `Saved project memory: ${entry.content}`;
    }
    const retrospectiveMatch = command.args.match(/^retrospective\s+([\s\S]+)$/i);
    if (retrospectiveMatch?.[1]?.trim()) {
      const entry = await desktopApi.addProjectMemory({
        workspacePath: selectedWorkspacePath,
        content: retrospectiveMatch[1].trim(),
        source: "retrospective",
      });
      await refreshProjectMemory(selectedWorkspacePath);
      return `Saved project retrospective memory: ${entry.content}`;
    }
    const editMatch = command.args.match(/^edit\s+(\S+)\s+([\s\S]+)$/i);
    if (editMatch?.[1] && editMatch?.[2]?.trim()) {
      const entries = await refreshProjectMemory(selectedWorkspacePath);
      const target = resolveProjectMemoryEntry(editMatch[1], entries);
      if (!target) {
        return `Project memory entry not found: ${editMatch[1]}. Run /memory to review current entries.`;
      }
      const entry = await desktopApi.updateProjectMemory({
        workspacePath: selectedWorkspacePath,
        entryId: target.id,
        content: editMatch[2].trim(),
      });
      await refreshProjectMemory(selectedWorkspacePath);
      return `Updated project memory #${entries.indexOf(target) + 1}: ${entry.content}`;
    }
    const deleteMatch = command.args.match(/^(?:delete|remove)\s+(\S+)$/i);
    if (deleteMatch?.[1]) {
      const entries = await refreshProjectMemory(selectedWorkspacePath);
      const target = resolveProjectMemoryEntry(deleteMatch[1], entries);
      if (!target) {
        return `Project memory entry not found: ${deleteMatch[1]}. Run /memory to review current entries.`;
      }
      const result = await desktopApi.clearProjectMemory({
        workspacePath: selectedWorkspacePath,
        entryId: target.id,
      });
      await refreshProjectMemory(selectedWorkspacePath);
      return `Deleted ${result.removedCount} project memory entry: ${target.content}`;
    }
    if (/^clear(?:\s+all)?$/i.test(args)) {
      const result = await desktopApi.clearProjectMemory({
        workspacePath: selectedWorkspacePath,
      });
      projectMemoryRef.current = [];
      setProjectMemory([]);
      return `Cleared ${result.removedCount} project memory entr${result.removedCount === 1 ? "y" : "ies"}.`;
    }
    return undefined;
  }

  async function maybeImportMcpContext(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
  ): Promise<string | undefined> {
    if (!command || command.name !== "mcp") return undefined;
    const match = command.args.match(/^(resource|tool)s?(?:\s+([\s\S]+))?$/i);
    if (!match) return undefined;
    if (!selectedWorkspacePath) {
      return "MCP context import skipped because no workspace is selected.";
    }
    const kind = match[1].toLowerCase() === "tool" ? "tool" : "resource";
    const selector = match[2]?.trim() || undefined;
    try {
      const result = await desktopApi.importMcpContext({
        workspacePath: selectedWorkspacePath,
        kind,
        selector,
        limit: 6,
      });
      if (!result.items.length) {
        return [
          result.message,
          result.verification,
          "Create `.drsai/mcp-context.json` with reviewed `resources` or `tools` entries before importing.",
        ].join("\n");
      }
      const attachments: ChatAttachment[] = result.items.map((item) => ({
        kind: "selection",
        path: `mcp-${item.kind}:${item.server}:${item.name}`,
        name: `MCP ${item.kind}: ${item.title}`,
        visibleText: item.content,
        note: [
          `Reviewed MCP ${item.kind} context imported from .drsai/mcp-context.json.`,
          `Server: ${item.server}.`,
          "No MCP server connection or tool execution was performed.",
          item.truncated ? "Content was truncated before attaching." : "",
        ].filter(Boolean).join(" "),
      }));
      setCommandAttachments((current) => [...current, ...attachments]);
      return [
        result.message,
        `Attached context chips: ${attachments.length}.`,
        result.truncated ? "Additional matching MCP handoff items were omitted by the limit." : "",
        result.verification,
      ].filter(Boolean).join("\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP context import failed.";
      return `MCP context import failed: ${message}`;
    }
  }

  async function maybeRequestMcpLiveBridge(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
  ): Promise<string | undefined> {
    if (!command || command.name !== "mcp") return undefined;
    const cancelMatch = command.args.match(/^cancel\s+(\S+)$/i);
    if (cancelMatch) {
      try {
        const cancelled = await desktopApi.decidePendingApproval({
          id: cancelMatch[1],
          approved: false,
          reason: "cancel",
        });
        return cancelled
          ? [
              `Cancelled pending MCP approval: ${cancelMatch[1]}.`,
              "No MCP stdio runtime was started by this cancellation.",
              "Open Approval Center to review the MCP session lifecycle audit.",
            ].join("\n")
          : `No pending MCP approval matched: ${cancelMatch[1]}.`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "MCP approval cancellation failed.";
        return `MCP approval cancellation failed: ${message}`;
      }
    }
    if (!selectedWorkspacePath) {
      if (/^(sync|exec)\b/i.test(command.args)) {
        return "MCP live bridge skipped because no workspace is selected.";
      }
      return undefined;
    }
    const syncMatch = command.args.match(/^sync(?:\s+([\s\S]+))?$/i);
    if (syncMatch) {
      try {
        const syncArgs = syncMatch[1]?.trim() || "";
        const reuseSession = /^--reuse(?:\s|$)/i.test(syncArgs);
        const server = reuseSession
          ? syncArgs.replace(/^--reuse\s*/i, "").trim()
          : syncArgs;
        const result = await desktopApi.requestMcpLiveEnumeration({
          workspacePath: selectedWorkspacePath,
          server: server || undefined,
          reuseSession,
        });
        return [
          result.message,
          result.approvalQueued && result.approvalId
            ? `Approval queued: ${result.approvalId}. Open Approval Center to approve live MCP enumeration.`
            : "",
          result.status === "completed"
            ? `Reviewed handoff updated: ${result.sourcePath}. Resources: ${result.resourceCount}; tools: ${result.toolCount}.`
            : "",
          result.reusedSession && result.sessionReuseKey
            ? `Reusable MCP session: ${result.sessionReuseKey}.`
            : "",
          "After approval, run `/mcp resource` or `/mcp tool` to attach the reviewed enumerated context.",
          result.verification,
        ].filter(Boolean).join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : "MCP live enumeration failed.";
        return `MCP live enumeration failed: ${message}`;
      }
    }
    const execMatch = command.args.match(/^exec\s+(?:(--reuse)\s+)?([^\s]+)\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
    if (execMatch) {
      try {
        const result = await desktopApi.requestMcpToolExecutionApproval({
          workspacePath: selectedWorkspacePath,
          server: execMatch[2],
          tool: execMatch[3],
          input: execMatch[4]?.trim() || undefined,
          reuseSession: Boolean(execMatch[1]),
        });
        return [
          result.message,
          result.queued && result.approvalId
            ? `Approval queued: ${result.approvalId}.`
            : "",
          result.status === "completed" && result.sourcePath
            ? `Reviewed tool result written: ${result.sourcePath}. Run \`/mcp tool ${result.resultContextName ?? result.tool}\` to attach it as visible context.`
            : "",
          result.reusedSession && result.sessionReuseKey
            ? `Reusable MCP session: ${result.sessionReuseKey}.`
            : "",
          result.blocked || result.queued
            ? "No MCP tool was executed by the context import path."
            : "",
          result.verification,
        ].filter(Boolean).join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : "MCP tool approval failed.";
        return `MCP tool approval failed: ${message}`;
      }
    }
    return undefined;
  }

  async function maybeApplyCustomCommand(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
  ): Promise<string | undefined> {
    if (!command || command.name !== "command") return undefined;
    if (!selectedWorkspacePath) return undefined;
    const addMatch = command.args.match(/^add\s+([a-z][a-z0-9_-]{1,31})(?:\s*=\s*|\s+)([\s\S]+)$/i);
    if (addMatch?.[1] && addMatch?.[2]?.trim()) {
      const entry = await desktopApi.upsertCustomCommand({
        workspacePath: selectedWorkspacePath,
        name: addMatch[1],
        prompt: addMatch[2].trim(),
        source: "chat_command",
      });
      await refreshCustomCommands(selectedWorkspacePath);
      return `Saved custom command \`/${entry.name}\`. Invoke it with \`/${entry.name} [args]\`.`;
    }
    const deleteMatch = command.args.match(/^(?:delete|remove)\s+(\S+)$/i);
    if (deleteMatch?.[1]) {
      const result = await desktopApi.deleteCustomCommand({
        workspacePath: selectedWorkspacePath,
        commandIdOrName: deleteMatch[1],
      });
      await refreshCustomCommands(selectedWorkspacePath);
      return `Deleted ${result.removedCount} custom command${result.removedCount === 1 ? "" : "s"}.`;
    }
    return undefined;
  }

  async function maybeApplyGoalCommand(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
  ): Promise<string | undefined> {
    if (!command || command.name !== "goal") return undefined;
    if (!selectedWorkspacePath) return undefined;
    const args = command.args.trim();
    const setMatch = args.match(/^(?:set|start|track)\s+([\s\S]+)$/i);
    if (setMatch?.[1]?.trim()) {
      const entry = await desktopApi.addProjectMemory({
        workspacePath: selectedWorkspacePath,
        content: `goal: ${setMatch[1].trim()}`,
        source: "chat_command",
      });
      await refreshProjectMemory(selectedWorkspacePath);
      return [
        `Saved durable goal: ${formatGoalContent(entry.content)}`,
        "Active durable goals are included as explicit project memory context in later natural-language chat.",
      ].join("\n");
    }
    const doneMatch = args.match(/^(?:done|complete)\s+(\S+)$/i);
    if (doneMatch?.[1]) {
      const entries = await refreshProjectMemory(selectedWorkspacePath);
      const goal = resolveGoalMemoryEntry(doneMatch[1], entries);
      if (!goal) {
        return `Durable goal not found: ${doneMatch[1]}. Run /goal list to review current goals.`;
      }
      const entry = await desktopApi.updateProjectMemory({
        workspacePath: selectedWorkspacePath,
        entryId: goal.entry.id,
        content: `goal-done: ${goal.label}`,
        source: "chat_command",
      });
      await refreshProjectMemory(selectedWorkspacePath);
      return `Marked durable goal #${goal.index + 1} complete: ${formatGoalContent(entry.content)}`;
    }
    const clearMatch = args.match(/^(?:clear|delete|remove)\s+(\S+)$/i);
    if (clearMatch?.[1]) {
      const entries = await refreshProjectMemory(selectedWorkspacePath);
      const goal = resolveGoalMemoryEntry(clearMatch[1], entries);
      if (!goal) {
        return `Durable goal not found: ${clearMatch[1]}. Run /goal list to review current goals.`;
      }
      const result = await desktopApi.clearProjectMemory({
        workspacePath: selectedWorkspacePath,
        entryId: goal.entry.id,
      });
      await refreshProjectMemory(selectedWorkspacePath);
      return `Cleared ${result.removedCount} durable goal: ${goal.label}`;
    }
    if (!args || /^list$/i.test(args)) {
      const entries = await refreshProjectMemory(selectedWorkspacePath);
      const goals = listGoalMemoryEntries(entries);
      if (!goals.length) return "No durable goals have been saved for this workspace.";
      return [
        "Durable goals:",
        ...goals.map((goal, index) => `${index + 1}. ${formatGoalContent(goal.content)}`),
      ].join("\n");
    }
    return undefined;
  }

  async function maybeApplyWorkspaceCheckpointCommand(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
  ): Promise<string | undefined> {
    if (!command || (command.name !== "checkpoint" && command.name !== "rollback")) return undefined;
    if (!selectedWorkspacePath) {
      return "Workspace checkpoint command skipped because no workspace is selected.";
    }

    if (command.name === "checkpoint") {
      try {
        const label = command.args.replace(/^create\s+/i, "").trim() || "Slash command checkpoint";
        const checkpoint = await desktopApi.createWorkspaceCheckpoint({
          workspacePath: selectedWorkspacePath,
          label,
        });
        return formatCheckpointCreateResult(checkpoint);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Workspace checkpoint creation failed.";
        return `Workspace checkpoint creation failed: ${message}`;
      }
    }

    const rollback = parseRollbackCommandArgs(command.args);
    try {
      const checkpoints = await desktopApi.listWorkspaceCheckpoints(selectedWorkspacePath);
      if (rollback.action === "list" || !rollback.selector) {
        return formatCheckpointListForRollback(checkpoints, rollback.action === "list");
      }
      const checkpoint = resolveWorkspaceCheckpointSelector(rollback.selector, checkpoints);
      if (!checkpoint) {
        return [
          `Rollback checkpoint not found: ${rollback.selector}.`,
          formatCheckpointListForRollback(checkpoints),
        ].filter(Boolean).join("\n\n");
      }
      const preview = await desktopApi.previewWorkspaceCheckpoint({
        workspacePath: selectedWorkspacePath,
        checkpointId: checkpoint.id,
        maxFiles: 12,
        maxCharsPerFile: 1200,
      });
      if (rollback.action === "preview") {
        return formatRollbackPreviewResult(preview);
      }
      const restore = await desktopApi.restoreWorkspaceCheckpoint({
        workspacePath: selectedWorkspacePath,
        checkpointId: checkpoint.id,
      });
      return [formatRollbackPreviewResult(preview), formatRollbackRestoreResult(restore)]
        .join("\n\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rollback checkpoint command failed.";
      return `Rollback checkpoint command failed: ${message}`;
    }
  }

  async function maybeCreateForkThread(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath?: string,
    options?: ChatSubmitOptions,
  ): Promise<{ text: string; threads?: DesktopThread[] } | undefined> {
    if (!command || command.name !== "fork") return undefined;
    if (/^(?:dispatch|start|run)\b/i.test(command.args.trim())) return undefined;
    if (/^(?:schedule|auto|autoschedule)\b/i.test(command.args.trim())) return undefined;
    if (/^handoff\b/i.test(command.args.trim())) return undefined;
    if (!selectedWorkspacePath) {
      return { text: "Fork thread was not created because no workspace is selected." };
    }
    const queueItems = parseForkQueueItems(command.args);
    const queueEntries = parseForkQueueEntries(command.args);
    if (queueItems.length > 1) {
      const createdThreads: DesktopThread[] = [];
      const queueGroupId = `forkqueue:${crypto.randomUUID().replace(/-/g, "")}`;
      const lines = [
        `Fork queue requested ${queueItems.length} queued subtasks.`,
        "Each queued subtask is prepared as an isolated fork thread before any code execution.",
      ];
      for (const [index, item] of queueEntries.entries()) {
        const visualAssignment = resolveForkQueueVisualAgentAssignment(
          index + 1,
          options?.forkQueueAgentAssignments,
          availableAgents ?? [],
        );
        const prefixAssignment = resolveForkQueueAgentAssignment(item, availableAgents ?? []);
        const assignment = visualAssignment ?? prefixAssignment;
        const forkResult = await createSingleForkThread(selectedWorkspacePath, item.intent, {
          queueGroupId,
          queueIndex: index + 1,
          queueSize: queueEntries.length,
          agentHint: item.agentHint,
          agentId: assignment?.agentId,
          agentName: assignment?.agentName,
        });
        if (forkResult.thread) createdThreads.push(forkResult.thread);
        lines.push(`${index + 1}. ${forkResult.text}`);
      }
      lines.push(
        createdThreads.length
          ? `Fork queue created ${createdThreads.length}/${queueItems.length} isolated subtask thread${createdThreads.length === 1 ? "" : "s"}.`
          : "Fork queue did not create any isolated subtask threads.",
      );
      if (createdThreads.length) {
        const approval = await desktopApi.requestForkQueueStartApproval({
          threadIds: createdThreads.map((thread) => thread.id),
        });
        lines.push(formatForkQueueStartApprovalResult(approval));
        return {
          text: lines.join("\n"),
          threads: approval.threads.length ? approval.threads : createdThreads,
        };
      }
      return { text: lines.join("\n"), threads: createdThreads };
    }
    const intent = command.args.trim();
    const forkResult = await createSingleForkThread(selectedWorkspacePath, intent);
    return { text: forkResult.text, threads: forkResult.thread ? [forkResult.thread] : [] };
  }

  async function maybeHandoffForkQueueThread(
    command: ReturnType<typeof parseChatCommand>,
  ): Promise<{ text: string; thread?: DesktopThread } | undefined> {
    if (!command || command.name !== "fork") return undefined;
    const handoff = parseForkHandoffArgs(command.args);
    if (!handoff) return undefined;
    try {
      const threads = await desktopApi.listThreads();
      const thread = threads.find((item) => item.id === handoff.threadId);
      if (!thread?.fork?.queueStatus) {
        return {
          text: `Fork handoff failed: no queued fork thread matched ${handoff.threadId}.`,
        };
      }
      const assignment = resolveForkQueueAgentName(handoff.agent, availableAgents ?? []);
      const updated = await desktopApi.updateThread({
        id: thread.id,
        fork: {
          ...thread.fork,
          queueAgentHint: handoff.agent,
          queueAgentId: assignment.agentId,
          queueAgentName: assignment.agentName,
          queueMessage: `Fork queue handoff assigned this subtask to ${assignment.agentName}. Dispatch still requires the existing approval and /fork dispatch path.`,
          queueUpdatedAt: new Date().toISOString(),
        },
      });
      return {
        thread: updated,
        text: [
          `Fork queue handoff saved for ${updated.title}.`,
          `Thread id: ${updated.id}.`,
          `Assigned agent: ${assignment.agentName}.`,
          "No agent run was started; approved ready queues still dispatch through `/fork dispatch`.",
        ].join("\n"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fork handoff failed.";
      return { text: `Fork handoff failed: ${message}` };
    }
  }

  async function maybeDispatchForkQueue(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath: string | undefined,
    options?: ChatSubmitOptions,
  ): Promise<{ text: string; threads?: DesktopThread[] } | undefined> {
    if (!command || command.name !== "fork") return undefined;
    if (!/^(?:dispatch|start|run)\b/i.test(command.args.trim())) return undefined;
    if (!selectedWorkspacePath) {
      return { text: "Fork queue was not dispatched because no workspace is selected." };
    }
    try {
      const allThreads = await desktopApi.listThreads();
      const readyThreads = allThreads.filter((thread) => {
        if (!thread.fork || thread.fork.queueStatus !== "ready") return false;
        return (
          normalizePathForCompare(thread.fork.sourceWorkspacePath) === normalizePathForCompare(selectedWorkspacePath) ||
          normalizePathForCompare(thread.fork.worktreePath) === normalizePathForCompare(selectedWorkspacePath)
        );
      });
      if (!readyThreads.length) {
        return {
          text: "No approved ready fork queue subtasks were found for this workspace. Approve `/fork queue ...` in Approval Center before dispatching.",
        };
      }
      const selectedAgent = findSelectedAgent(options?.agentName, availableAgents ?? []);
      const threadAgentAssignments = Object.fromEntries(
        readyThreads
          .filter((thread) => thread.fork?.queueAgentId || thread.fork?.queueAgentName)
          .map((thread) => [
            thread.id,
            {
              agentId: thread.fork?.queueAgentId,
              agentName: thread.fork?.queueAgentName,
            },
          ]),
      );
      const result = await desktopApi.dispatchForkQueue({
        threadIds: readyThreads.map((thread) => thread.id),
        selectedAgentId: selectedAgent?.id,
        selectedAgentName: selectedAgent?.name || options?.agentName,
        ...(Object.keys(threadAgentAssignments).length ? { threadAgentAssignments } : {}),
        model: options?.model || undefined,
      });
      return {
        text: formatForkQueueDispatchResult(result),
        threads: result.threads,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fork queue dispatch failed.";
      return { text: `Fork queue dispatch failed: ${message}` };
    }
  }

  async function maybeScheduleForkQueue(
    command: ReturnType<typeof parseChatCommand>,
    selectedWorkspacePath: string | undefined,
    options?: ChatSubmitOptions,
  ): Promise<{ text: string; threads?: DesktopThread[] } | undefined> {
    if (!command || command.name !== "fork") return undefined;
    if (!/^(?:schedule|auto|autoschedule)\b/i.test(command.args.trim())) return undefined;
    if (!selectedWorkspacePath) {
      return { text: "Fork queue scheduler did not run because no workspace is selected." };
    }
    try {
      const limit = parseForkScheduleLimit(command.args);
      const allThreads = await desktopApi.listThreads();
      const readyThreads = selectSchedulableForkQueueThreads(allThreads, selectedWorkspacePath, limit);
      if (!readyThreads.length) {
        return {
          text: "Fork queue scheduler found no approved ready subtasks for this workspace. Create a `/fork queue ...` and approve queue start first.",
        };
      }
      const selectedAgent = findSelectedAgent(options?.agentName, availableAgents ?? []);
      const threadAgentAssignments = buildForkQueueThreadAssignments(readyThreads);
      const result = await desktopApi.dispatchForkQueue({
        threadIds: readyThreads.map((thread) => thread.id),
        selectedAgentId: selectedAgent?.id,
        selectedAgentName: selectedAgent?.name || options?.agentName,
        ...(Object.keys(threadAgentAssignments).length ? { threadAgentAssignments } : {}),
        model: options?.model || undefined,
      });
      return {
        text: [
          `Fork queue scheduler selected ${readyThreads.length} approved ready subtask${readyThreads.length === 1 ? "" : "s"} by queue order${limit ? ` (limit ${limit})` : ""}.`,
          formatForkQueueDispatchResult(result),
        ].join("\n\n"),
        threads: result.threads,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fork queue scheduler failed.";
      return { text: `Fork queue scheduler failed: ${message}` };
    }
  }

  async function createSingleForkThread(
    selectedWorkspacePath: string,
    intent: string,
    queue?: {
      queueGroupId: string;
      queueIndex: number;
      queueSize: number;
      agentHint?: string;
      agentId?: string;
      agentName?: string;
    },
  ): Promise<{ text: string; thread?: DesktopThread }> {
    try {
      const fork = await desktopApi.prepareForkWorktree({
        workspacePath: selectedWorkspacePath,
        intent,
      });
      const thread = await desktopApi.createThread({
        kind: "agent_run",
        title: `${queue ? `Fork ${queue.queueIndex}:` : "Fork:"} ${intent || "subtask"}`.slice(0, 120),
        workspacePath: fork.worktreePath,
        fork: {
          ...(fork.worktreeId ? { worktreeId: fork.worktreeId } : {}),
          ...(fork.sourceWorkspaceId ? { sourceWorkspaceId: fork.sourceWorkspaceId } : {}),
          ...(fork.workspaceId ? { workspaceId: fork.workspaceId } : {}),
          sourceWorkspacePath: fork.sourceWorkspacePath,
          repoRoot: fork.repoRoot,
          worktreePath: fork.worktreePath,
          branch: fork.branch,
          baseRef: fork.baseRef,
          createdAt: new Date().toISOString(),
          sourceHasChanges: fork.sourceHasChanges,
          sourceStatusSummary: fork.sourceStatusSummary,
          lifecycleStatus: "active",
          ...(queue
            ? {
                queueGroupId: queue.queueGroupId,
                queueIndex: queue.queueIndex,
                queueSize: queue.queueSize,
                queueStatus: "queued" as const,
                ...(queue.agentHint ? { queueAgentHint: queue.agentHint } : {}),
                ...(queue.agentId ? { queueAgentId: queue.agentId } : {}),
                ...(queue.agentName ? { queueAgentName: queue.agentName } : {}),
                queueMessage: "Subtask fork is queued and waiting for queue-start approval.",
                queueUpdatedAt: new Date().toISOString(),
              }
            : {}),
        },
      });
      const dirtySourceText = fork.sourceHasChanges
        ? `Source workspace has uncommitted changes that were not copied into the fork: ${fork.sourceStatusSummary || "dirty worktree"}.`
        : "Source workspace was clean at fork creation.";
      return {
        thread,
        text: [
          `Created fork thread: ${thread.title}.`,
          `Thread id: ${thread.id}.`,
          `Isolated worktree: ${fork.worktreePath}.`,
          `Branch: ${fork.branch} from ${fork.baseRef}.`,
          dirtySourceText,
          "The app will switch to the forked thread so the subtask can continue in the isolated workspace.",
        ].join("\n"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fork worktree creation failed.";
      return { text: `Fork thread was not created because isolated worktree creation failed: ${message}` };
    }
  }

  async function refreshProjectMemory(
    selectedWorkspacePath: string,
  ): Promise<DesktopProjectMemoryEntry[]> {
    const entries = await desktopApi.listProjectMemory({
      workspacePath: selectedWorkspacePath,
      limit: 20,
    });
    projectMemoryRef.current = entries;
    setProjectMemory(entries);
    return entries;
  }

  async function refreshCustomCommands(
    selectedWorkspacePath: string,
  ): Promise<DesktopCustomCommand[]> {
    const entries = await desktopApi.listCustomCommands({
      workspacePath: selectedWorkspacePath,
      limit: 100,
    });
    customCommandsRef.current = entries;
    setCustomCommands(entries);
    return entries;
  }

  return {
    activeRequestId,
    commandAttachments,
    currentRuntimeMode,
    input,
    messages,
    clearCommandAttachments,
    clearRuntimeMode,
    removeCommandAttachment,
    setInput,
    submit,
    abort,
  };
}

function isMaterialInventoryIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /(?:(?:我|系统)(?:目前|现在)?)?(?:有|拥有|导入|上传)(?:了|的)?哪些材料|材料(?:清单|列表|角色|分别是什么)|what (?:files|materials|sources) (?:do i|are)|list (?:my )?(?:files|materials|sources)/i.test(normalized);
}

function isNaturalMaterialQueryIntent(text: string): boolean {
  const normalized = text.trim();
  return /[?？]/.test(normalized)
    || /(?:标题|题目|样本量|均值|容量|带宽|数字|数值|比例|百分比).*(?:是什么|是多少|有多少)/.test(normalized)
    || /(?:什么|哪种|哪些).*(?:方法|实验设计|研究设计|差异|不同|区别|冲突|不一致)/.test(normalized)
    || /(?:比较|对比).*(?:差异|不同|区别|冲突|不一致)/.test(normalized)
    || /\b(?:what|how many|where|which|compare|difference|title|bandwidth|sample size|method|protocol|conflict)\b/i.test(normalized);
}

function formatMaterialQueryAnswer(
  result: Awaited<ReturnType<typeof desktopApi.queryMaterials>>,
  language: "en" | "zh",
): string {
  if (result.status === "not_found") {
    return language === "zh"
      ? `${result.answer}\n\n已检索 ${result.filesSearched} 份材料；没有找到可引用的原文位置。`
      : `I could not find a reliable answer in the ${result.filesSearched} imported materials. I will not invent a source or location.`;
  }
  const sourceHeading = language === "zh" ? "来源" : "Sources";
  const sources = result.citations.map((citation) =>
    `- **${citation.name} · ${citation.locator}**：${citation.excerpt}`,
  ).join("\n");
  return `${result.answer}\n\n### ${sourceHeading}\n\n${sources}`;
}

function formatMaterialInventoryAnswer(
  analysis: Awaited<ReturnType<typeof desktopApi.analyzeMaterialRoles>>,
  language: "en" | "zh",
): string {
  const roles = [
    ["previous_report", language === "zh" ? "旧报告" : "Previous reports"],
    ["latest_data", language === "zh" ? "最新数据" : "Latest data"],
    ["result_image", language === "zh" ? "结果图片" : "Result images"],
    ["reference_material", language === "zh" ? "参考材料" : "Reference materials"],
  ] as const;
  const sections = roles.map(([role, label]) => {
    const matching = analysis.items.filter((item) => item.role === role);
    const files = matching.length
      ? matching.map((item) => `- **${item.name}**（${Math.round(item.confidence * 100)}%）：${item.reason}${language === "zh" ? "用途：" : " Use: "}${item.suggestedUse}`).join("\n")
      : `- ${language === "zh" ? "暂未发现" : "None detected"}`;
    return `### ${label}（${matching.length}）\n\n${files}`;
  });
  return [
    language === "zh" ? `我识别到 ${analysis.items.length} 项材料，并按它们在当前任务中的用途分成四类：` : `I found ${analysis.items.length} materials and grouped them by their likely role in this task:`,
    ...sections,
    language === "zh" ? "建议先用最新数据核对结果图片，再以旧报告为结构基线生成新版本；参考材料只用于补充背景和出处。" : "I suggest checking result images against the latest data first, then using the previous report as the structure for a new version. Use references for context and citations.",
  ].join("\n\n");
}

function resolveProjectMemoryEntry(
  selector: string,
  entries: DesktopProjectMemoryEntry[],
): DesktopProjectMemoryEntry | undefined {
  const normalized = selector.trim();
  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 1) {
    return entries[index - 1];
  }
  return entries.find((entry) => entry.id === normalized);
}

function listGoalMemoryEntries(entries: DesktopProjectMemoryEntry[]): DesktopProjectMemoryEntry[] {
  return entries.filter((entry) => /^goal(?::|-done:)/i.test(entry.content.trim()));
}

function resolveGoalMemoryEntry(
  selector: string,
  entries: DesktopProjectMemoryEntry[],
): { entry: DesktopProjectMemoryEntry; index: number; label: string } | undefined {
  const normalized = selector.trim();
  const goals = listGoalMemoryEntries(entries);
  const index = Number(normalized);
  const entry = Number.isInteger(index) && index >= 1
    ? goals[index - 1]
    : goals.find((item) => item.id === normalized);
  if (!entry) return undefined;
  return {
    entry,
    index: goals.indexOf(entry),
    label: formatGoalContent(entry.content),
  };
}

function formatGoalContent(content: string): string {
  return content.replace(/^goal-done:\s*/i, "[done] ").replace(/^goal:\s*/i, "").trim();
}

function parseRollbackCommandArgs(args: string): {
  action: "list" | "preview" | "restore";
  selector: string;
} {
  const trimmed = args.trim();
  if (/^(?:list|ls)$/i.test(trimmed)) {
    return {
      action: "list",
      selector: "",
    };
  }
  const match = trimmed.match(/^(preview|restore)\s+([\s\S]+)$/i);
  if (match?.[1]) {
    return {
      action: match[1].toLowerCase() === "restore" ? "restore" : "preview",
      selector: match[2]?.trim() ?? "",
    };
  }
  return {
    action: "preview",
    selector: trimmed,
  };
}

function resolveWorkspaceCheckpointSelector(
  selector: string,
  checkpoints: WorkspaceCheckpoint[],
): WorkspaceCheckpoint | undefined {
  const normalized = selector.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "latest") return checkpoints[0];
  return checkpoints.find((checkpoint) =>
    checkpoint.id.toLowerCase() === normalized ||
    checkpoint.id.toLowerCase().startsWith(normalized) ||
    checkpoint.label.trim().toLowerCase() === normalized,
  );
}

function formatCheckpointCreateResult(checkpoint: WorkspaceCheckpoint): string {
  return [
    `Checkpoint created from slash command: ${checkpoint.label}.`,
    `Checkpoint id: ${checkpoint.id}.`,
    `Stored files: ${checkpoint.storedFileCount}/${checkpoint.changedFileCount}.`,
    checkpoint.skippedFileCount ? `Skipped files: ${checkpoint.skippedFileCount}.` : "",
    "Restore remains Approval Center gated; use `/rollback preview latest` or `/rollback restore latest` after visible review.",
  ].filter(Boolean).join("\n");
}

function formatCheckpointListForRollback(checkpoints: WorkspaceCheckpoint[], explicitList = false): string {
  if (!checkpoints.length) {
    return "No rollback checkpoints exist for this workspace. Run `/checkpoint <label>` before risky edits.";
  }
  const lines = checkpoints.slice(0, 6).map((checkpoint, index) =>
    `${index + 1}. ${checkpoint.id} - ${checkpoint.label} (${checkpoint.storedFileCount}/${checkpoint.changedFileCount} stored)`,
  );
  return [
    explicitList ? "Rollback checkpoints listed from slash command (most recent first)." : "",
    "Rollback checkpoint selector required. Use `/rollback preview <id|label|latest>` or `/rollback restore <id|label|latest>`.",
    ...lines,
  ].filter(Boolean).join("\n");
}

function formatRollbackPreviewResult(preview: WorkspaceCheckpointPreviewResult): string {
  const entries = preview.entries.slice(0, 6).map((entry, index) =>
    `${index + 1}. ${entry.relativePath}: ${entry.change} (${entry.message})`,
  );
  return [
    `Rollback preview prepared for checkpoint ${preview.checkpointId} (${preview.label}).`,
    preview.message,
    `Changed entries: ${preview.changedEntryCount}; skipped: ${preview.skippedEntryCount}; total: ${preview.totalEntries}.`,
    preview.truncated ? "Preview was truncated before chat display." : "",
    ...entries,
  ].filter(Boolean).join("\n");
}

function formatRollbackRestoreResult(result: WorkspaceCheckpointRestoreResult): string {
  if (result.approvalQueued) {
    return [
      `Checkpoint restore is waiting in Approval Center: ${result.approvalId}.`,
      result.message,
      "No workspace files are restored until the approval item is accepted.",
    ].join("\n");
  }
  if (result.restored) {
    return [
      result.message,
      `Restored files: ${result.restoredFileCount}; removed files: ${result.removedFileCount}; skipped files: ${result.skippedFileCount}.`,
    ].join("\n");
  }
  return result.message;
}

function formatCommitApprovalResult(result: DesktopApprovalProposalResult): string {
  if (result.blocked || !result.allowed) {
    return `Commit approval blocked: ${result.reason}`;
  }
  if (result.queued && result.approval) {
    return `Commit approval queued in Approval Center: ${result.approval.title}.`;
  }
  if (!result.requiresApproval) {
    return "Commit policy allowed immediate execution.";
  }
  return result.reason;
}

function formatForkQueueStartApprovalResult(result: DesktopForkQueueStartApprovalResult): string {
  if (result.blocked || !result.allowed) {
    return `Fork queue start approval blocked: ${result.reason}`;
  }
  if (result.queued && result.approval) {
    return `Fork queue start approval queued in Approval Center: ${result.approval.title}. Subtasks remain waiting until approval.`;
  }
  return `Fork queue is ready: ${result.reason}`;
}

function formatForkQueueDispatchResult(result: DesktopForkQueueDispatchResult): string {
  const started = result.startedRuns.length
    ? result.startedRuns
        .map((run, index) => `${index + 1}. ${run.threadId} -> ${run.runId}`)
        .join("\n")
    : "none";
  const blocked = result.blockedThreadIds.length ? result.blockedThreadIds.join(", ") : "none";
  return [
    `Fork queue dispatch: ${result.reason}`,
    `Started runs: ${result.startedRuns.length}.`,
    started,
    `Blocked threads: ${blocked}.`,
  ].join("\n");
}

function findSelectedAgent(
  agentName: string | undefined,
  agents: DesktopAgent[],
): DesktopAgent | undefined {
  const normalized = agentName?.trim().toLowerCase();
  if (!normalized) return undefined;
  return agents.find((agent) =>
    [agent.id, agent.name]
      .filter((item): item is string => Boolean(item))
      .some((item) => item.trim().toLowerCase() === normalized),
  );
}

function selectSchedulableForkQueueThreads(
  threads: DesktopThread[],
  selectedWorkspacePath: string,
  limit?: number,
): DesktopThread[] {
  const selectedWorkspace = normalizePathForCompare(selectedWorkspacePath);
  const readyThreads = threads
    .filter((thread) => {
      if (!thread.fork || thread.fork.queueStatus !== "ready") return false;
      return (
        normalizePathForCompare(thread.fork.sourceWorkspacePath) === selectedWorkspace ||
        normalizePathForCompare(thread.fork.worktreePath) === selectedWorkspace
      );
    })
    .sort(compareForkQueueScheduleOrder);
  return limit ? readyThreads.slice(0, limit) : readyThreads;
}

function compareForkQueueScheduleOrder(left: DesktopThread, right: DesktopThread): number {
  const leftGroup = left.fork?.queueGroupId ?? "";
  const rightGroup = right.fork?.queueGroupId ?? "";
  const groupOrder = leftGroup.localeCompare(rightGroup);
  if (groupOrder !== 0) return groupOrder;
  const leftIndex = left.fork?.queueIndex ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = right.fork?.queueIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const leftUpdated = Date.parse(left.fork?.queueUpdatedAt ?? left.updatedAt) || 0;
  const rightUpdated = Date.parse(right.fork?.queueUpdatedAt ?? right.updatedAt) || 0;
  if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated;
  return left.id.localeCompare(right.id);
}

function parseForkScheduleLimit(args: string): number | undefined {
  const match = args.match(/(?:^|\s)(?:limit\s+|--limit\s*=?|limit=)(\d{1,2})(?:\s|$)/i);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return Math.min(parsed, 12);
}

function buildForkQueueThreadAssignments(
  threads: DesktopThread[],
): Record<string, { agentId?: string; agentName?: string }> {
  return Object.fromEntries(
    threads
      .filter((thread) => thread.fork?.queueAgentId || thread.fork?.queueAgentName)
      .map((thread) => [
        thread.id,
        {
          agentId: thread.fork?.queueAgentId,
          agentName: thread.fork?.queueAgentName,
        },
      ]),
  );
}

function resolveForkQueueAgentAssignment(
  item: ForkQueueItem,
  agents: DesktopAgent[],
): { agentId?: string; agentName?: string } | undefined {
  if (!item.agentHint) return undefined;
  const normalized = item.agentHint.trim().toLowerCase();
  const agent = agents.find((candidate) =>
    [candidate.id, candidate.name]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.trim().toLowerCase() === normalized),
  );
  return {
    agentId: agent?.id,
    agentName: agent?.name ?? item.agentHint,
  };
}

function resolveForkQueueVisualAgentAssignment(
  queueIndex: number,
  assignments: ChatSubmitOptions["forkQueueAgentAssignments"] | undefined,
  agents: DesktopAgent[],
): { agentId?: string; agentName?: string } | undefined {
  const assignment = assignments?.find((item) => item.queueIndex === queueIndex);
  if (!assignment?.agentId && !assignment?.agentName) return undefined;
  const normalizedId = assignment.agentId?.trim().toLowerCase();
  const normalizedName = assignment.agentName?.trim().toLowerCase();
  const agent = agents.find((candidate) =>
    [candidate.id, candidate.name]
      .filter((value): value is string => Boolean(value))
      .some((value) => {
        const normalized = value.trim().toLowerCase();
        return normalized === normalizedId || normalized === normalizedName;
      }),
  );
  return {
    agentId: agent?.id ?? assignment.agentId,
    agentName: agent?.name ?? assignment.agentName,
  };
}

function resolveForkQueueAgentName(
  requested: string,
  agents: DesktopAgent[],
): { agentId?: string; agentName: string } {
  const normalized = requested.trim().replace(/^@/, "").toLowerCase();
  const agent = agents.find((candidate) =>
    [candidate.id, candidate.name]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.trim().toLowerCase() === normalized),
  );
  return {
    agentId: agent?.id,
    agentName: agent?.name ?? requested.replace(/^@/, "").trim(),
  };
}

function parseForkHandoffArgs(args: string): { threadId: string; agent: string } | null {
  const match = args.trim().match(/^handoff\s+(\S+)\s+@?(.+)$/i);
  const threadId = match?.[1]?.trim();
  const agent = match?.[2]?.trim();
  if (!threadId || !agent) return null;
  return { threadId, agent };
}

function normalizePathForCompare(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

async function buildCommitPreflight(workspacePath: string): Promise<{
  approvalBody: string;
  canCommit: boolean;
  checklist?: DesktopCommitApprovalChecklist;
  chatSummary: string;
}> {
  const [overview, stagedDiff] = await Promise.all([
    desktopApi.getWorkspaceContextOverview(workspacePath),
    desktopApi.getWorkspaceGitDiff({ workspacePath, staged: true, maxChars: 80_000 }),
  ]);
  const stagedFiles = extractDiffFilePaths(stagedDiff.diff);
  const changedCount = overview.stats.changedFileCount;
  const unstagedCount = countUnstagedFiles(overview, stagedFiles);
  if (!stagedDiff.diff.trim()) {
    return {
      approvalBody: "",
      canCommit: false,
      chatSummary: [
        "**Commit preflight**",
        "",
        "Commit approval was not requested because there are no staged changes.",
        `Changed files detected in workspace: ${changedCount}. Stage the intended files first, then run /commit again.`,
      ].join("\n"),
    };
  }

  const diffLines = stagedDiff.diff.split(/\r?\n/).length;
  const risk = stagedDiff.truncated
    ? "High: staged diff was truncated before review."
    : unstagedCount > 0
      ? "Medium: unstaged workspace changes will not be included."
      : "Low: staged diff fits the preflight budget.";
  const testCommitment = "Run relevant verification before pushing or mark the commit as unverified.";
  const recentTestResult = formatRecentTerminalTestResult(
    readRecentTerminalTestResult(workspacePath),
  );
  const filesPreview = stagedFiles.slice(0, 8).join(", ");
  const fileSuffix = stagedFiles.length > 8 ? `, +${stagedFiles.length - 8} more` : "";
  const approvalBody = [
    "Commit preflight:",
    `- Staged files: ${stagedFiles.length}${filesPreview ? ` (${filesPreview}${fileSuffix})` : ""}`,
    `- Workspace changed files: ${changedCount}`,
    `- Unstaged/untracked files not included: ${unstagedCount}`,
    `- Staged diff lines reviewed: ${diffLines}${stagedDiff.truncated ? " (truncated)" : ""}`,
    `- Risk: ${risk}`,
    `- Test commitment: ${testCommitment}`,
    `- Recent test result: ${recentTestResult}`,
  ].join("\n");

  return {
    approvalBody,
    canCommit: true,
    checklist: {
      type: "git_commit",
      stagedFiles,
      workspaceChangedFileCount: changedCount,
      unstagedFileCount: unstagedCount,
      diffLineCount: diffLines,
      diffTruncated: stagedDiff.truncated,
      riskSummary: risk,
      testCommitment,
      recentTestResult,
    },
    chatSummary: [
      "**Commit preflight**",
      "",
      `Staged files: ${stagedFiles.length}`,
      `Workspace changed files: ${changedCount}`,
      `Unstaged/untracked files not included: ${unstagedCount}`,
      `Staged diff lines reviewed: ${diffLines}${stagedDiff.truncated ? " (truncated)" : ""}`,
      `Risk: ${risk}`,
      `Test commitment: ${testCommitment}`,
      `Recent test result: ${recentTestResult}`,
    ].join("\n"),
  };
}

function extractDiffFilePaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    paths.add((match[2] || match[1] || "").trim());
  }
  return [...paths].filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function countUnstagedFiles(
  overview: WorkspaceContextOverview,
  stagedFiles: string[],
): number {
  const staged = new Set(stagedFiles.map((item) => item.replace(/\\/g, "/")));
  const changedFiles = overview.git?.changedFiles ?? [];
  return changedFiles.filter((item) => !staged.has(item.path.replace(/\\/g, "/"))).length;
}

async function maybeApplyCompactCommand(
  command: ReturnType<typeof parseChatCommand>,
  currentMessages: UiMessage[],
  selectedWorkspacePath?: string,
  refreshMemory?: (selectedWorkspacePath: string) => Promise<DesktopProjectMemoryEntry[]>,
): Promise<string | undefined> {
  if (!command || command.name !== "compact") return undefined;
  const saveMatch = command.args.match(/^(?:save|persist|memory)(?:\s+([\s\S]+))?$/i);
  const compactIntent = saveMatch ? saveMatch[1]?.trim() ?? "" : command.args;
  const summary = buildLocalCompactSummary(currentMessages, compactIntent);
  if (!saveMatch) return summary;
  if (!selectedWorkspacePath) {
    return [
      summary,
      "Compact summary was not saved because no workspace is selected.",
    ].join("\n\n");
  }
  const entry = await desktopApi.addProjectMemory({
    workspacePath: selectedWorkspacePath,
    content: `compact-summary: ${clampCompactText(summary, 3800)}`,
    source: "retrospective",
  });
  await refreshMemory?.(selectedWorkspacePath);
  return [
    summary,
    `Saved compact summary to project memory: ${clampCompactText(entry.content, LOCAL_COMPACT_MAX_ITEM_CHARS)}`,
    "Future natural-language chat includes this reviewed compact summary through the existing project memory context path.",
  ].join("\n\n");
}

function buildLocalCompactSummary(messages: UiMessage[], compactIntent: string): string {
  const visibleMessages = messages
    .filter((message) => message.id !== "welcome" && !message.error)
    .map((message) => ({
      role: message.role,
      text: sanitizeCompactText(getVisibleChatText(message.content || "")),
    }))
    .filter((message) => message.text.length > 0);

  const focus = sanitizeCompactText(compactIntent.trim()) || "current thread";
  if (!visibleMessages.length) {
    return [
      "Local context compaction prepared from visible chat only.",
      `Focus: ${focus}`,
      "No prior visible messages were available to summarize.",
      "Verification: no gateway, model provider, external connector, filesystem mutation, or network call was performed.",
    ].join("\n");
  }

  const recentMessages = visibleMessages.slice(-LOCAL_COMPACT_MAX_MESSAGES);
  const recentLines = recentMessages.map((message) =>
    `- ${message.role}: ${clampCompactText(message.text, LOCAL_COMPACT_MAX_MESSAGE_CHARS)}`,
  );
  const reusableItems = collectCompactReusableItems(visibleMessages);
  const userCount = visibleMessages.filter((message) => message.role === "user").length;
  const assistantCount = visibleMessages.filter((message) => message.role === "assistant").length;

  return [
    "Local context compaction prepared from visible chat only.",
    `Messages summarized: ${visibleMessages.length} visible (${recentMessages.length} most recent shown); user: ${userCount}; assistant: ${assistantCount}.`,
    `Focus: ${focus}`,
    "Recent context:",
    ...recentLines,
    "Reusable decisions / follow-ups:",
    ...(reusableItems.length ? reusableItems.map((item) => `- ${item}`) : ["- No explicit decision or follow-up cue found in visible chat."]),
    "Verification: no gateway, model provider, external connector, filesystem mutation, or network call was performed.",
  ].join("\n");
}

function collectCompactReusableItems(
  messages: Array<{ role: ChatMessage["role"]; text: string }>,
): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const sentence of splitCompactSentences(message.text)) {
      if (!/\b(?:decid(?:e|ed|ing)|choose|chosen|approved|blocked|todo|follow[- ]?up|next|risk|assumption|verify|test)\b/i.test(sentence)) {
        continue;
      }
      const item = clampCompactText(`${message.role}: ${sentence}`, LOCAL_COMPACT_MAX_ITEM_CHARS);
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= LOCAL_COMPACT_MAX_REUSABLE_ITEMS) return items;
    }
  }
  return items;
}

function splitCompactSentences(text: string): string[] {
  return text
    .split(/(?:\r?\n|(?<=[.!?])\s+)/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function sanitizeCompactText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(
      /\b(password|passwd|pwd|token|api[_-]?key|secret|authorization)(\s*[:=]\s*)(["']?)[^\s,;]+/gi,
      (_match, label: string, separator: string, quote: string) => `${label}${separator}${quote}[redacted]`,
    )
    .trim();
}

function clampCompactText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function buildRequestMessages(
  messages: ChatMessage[],
  workspaceInstructions: WorkspaceInstructionSummary[] | undefined,
  projectMemory: DesktopProjectMemoryEntry[],
  teamMemory: DesktopTeamMemoryEntry[],
  userPreferences: DesktopUserPreference[],
  runtimeMode: ChatRuntimeMode | null,
): ChatMessage[] {
  const systemSections: string[] = [];
  const userPreferenceSection = buildUserPreferenceSystemSection(userPreferences);
  if (userPreferenceSection) systemSections.push(userPreferenceSection);
  if (runtimeMode) {
    systemSections.push(
      [
        "Current chat runtime mode:",
        `Mode: ${runtimeMode.label} (${runtimeMode.name})`,
        `Description: ${runtimeMode.description}`,
        runtimeMode.intent ? `Intent: ${runtimeMode.intent}` : null,
      ].filter((item): item is string => Boolean(item)).join("\n"),
    );
  }
  if (workspaceInstructions?.length) {
    systemSections.push(
      [
        "Workspace instructions for this project:",
        ...workspaceInstructions.map((instruction) =>
          `# ${instruction.name}\n${instruction.content}${instruction.truncated ? "\n[truncated]" : ""}`,
        ),
      ].join("\n\n"),
    );
  }
  if (projectMemory.length) {
    const activeGoals = projectMemory.filter((entry) => /^goal:\s*/i.test(entry.content.trim()));
    if (activeGoals.length) {
      systemSections.push(
        [
          "Active durable goals for this workspace:",
          ...activeGoals
            .slice(0, 5)
            .map((entry, index) => `${index + 1}. ${formatGoalContent(entry.content)}`),
        ].join("\n"),
      );
    }
    systemSections.push(
      [
        "Project memory for this workspace:",
        ...projectMemory
          .slice(0, 12)
          .map((entry, index) => `${index + 1}. ${entry.content}`),
      ].join("\n"),
    );
  }
  if (teamMemory.length) {
    systemSections.push(
      [
        "Authorized team memory for the signed-in user:",
        ...teamMemory
          .slice(0, 12)
          .map((entry, index) => `${index + 1}. [${entry.teamId}] ${entry.content}`),
      ].join("\n"),
    );
  }
  if (!systemSections.length) return messages;
  return [{ role: "system", content: systemSections.join("\n\n") }, ...messages];
}

function serializeRuntimeMode(mode: ChatRuntimeMode): Record<string, string> {
  return {
    name: mode.name,
    label: mode.label,
    description: mode.description,
    activated_by: mode.activatedBy,
    ...(mode.intent ? { intent: mode.intent } : {}),
  };
}

function createWelcomeMessage(language: "en" | "zh", preferences: DesktopUserPreference[]): UiMessage {
  const preferenceNotice = formatAppliedPreferenceNotice(preferences, language);
  return {
    id: "welcome",
    role: "assistant",
    content:
      language === "zh"
        ? `OpenDrSai 桌面端已就绪。安装或启动本地网关后即可发送消息。${preferenceNotice ? `\n\n${preferenceNotice}` : ""}`
        : `OpenDrSai desktop is ready. Install or start the local gateway, then send a message.${preferenceNotice ? `\n\n${preferenceNotice}` : ""}`,
  };
}

function hydrateStructuredMessages(messages: UiMessage[]): UiMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    if (message.structuredTurn) return sanitizeStructuredAssistantMessage(message);
    return sanitizeStructuredAssistantMessage({
      ...message,
      structuredTurn: migrateLegacyMessageToStructuredTurn({
        id: message.id,
        content: message.content,
        reasoningContent: message.reasoningContent,
        statusContent: message.statusContent,
        streaming: message.streaming,
        error: message.error,
        parts: message.parts as Array<Record<string, unknown>> | undefined,
        toolTimeline: message.toolTimeline as Array<Record<string, unknown>> | undefined,
      }),
    });
  });
}

function appendAssistantChunk(
  messages: UiMessage[],
  assistantId: string | undefined,
  content: string,
): UiMessage[] {
  const next = [...messages];
  const index = findAssistantIndex(next, assistantId);
  if (index === -1) return next;
  const structuredTurn = appendStructuredDelta(next[index].structuredTurn, next[index].id, "markdown", content);
  const canonicalContent = readStructuredMarkdown(structuredTurn);
  next[index] = { ...next[index], content: canonicalContent, structuredTurn };
  next[index].lastEventAt = Date.now();
  return next;
}

function appendAssistantReasoning(
  messages: UiMessage[],
  assistantId: string | undefined,
  content: string,
): UiMessage[] {
  if (!content) return messages;
  const next = [...messages];
  const index = findAssistantIndex(next, assistantId);
  if (index === -1) return next;
  const structuredTurn = appendStructuredDelta(next[index].structuredTurn, next[index].id, "reasoning", content);
  const canonicalReasoning = readStructuredReasoning(structuredTurn);
  next[index] = {
    ...next[index],
    reasoningContent: canonicalReasoning,
    structuredTurn,
    lastEventAt: Date.now(),
  };
  return next;
}

function appendAssistantToolTimeline(
  messages: UiMessage[],
  assistantId: string | undefined,
  event: NonNullable<ChatEvent["toolTimeline"]>,
): UiMessage[] {
  const next = [...messages];
  const index = findAssistantIndex(next, assistantId);
  if (index === -1) return next;
  const boundedEvent = event.content && event.content.length > 80_000
    ? { ...event, content: `${event.content.slice(0, 80_000)}\n\n[output truncated in chat]` }
    : event;
  next[index] = {
    ...next[index],
    structuredTurn: appendStructuredActivity(next[index].structuredTurn, next[index].id, boundedEvent),
    lastEventAt: Date.now(),
  };
  return next;
}

function appendStructuredDelta(
  current: StructuredTurnState | undefined,
  turnId: string,
  kind: "markdown" | "reasoning",
  content: string,
): StructuredTurnState {
  let state = current ?? createStructuredTurnState(turnId);
  if (state.status === "pending") state = applyLocalStructuredEvent(state, { type: "turn.started" });
  const partId = `${turnId}:${kind}`;
  if (!state.parts.some((part) => part.id === partId)) {
    const part: StructuredAssistantPart = kind === "markdown"
      ? { id: partId, kind: "markdown", status: "running", markdown: "" }
      : { id: partId, kind: "reasoning", status: "running", segments: [] };
    state = applyLocalStructuredEvent(state, { type: "part.started", part });
  }
  return applyLocalStructuredEvent(state, kind === "markdown"
    ? { type: "part.delta", partId, delta: { kind: "markdown.append", text: content } }
    : {
        type: "part.delta",
        partId,
        delta: { kind: "reasoning.append", segmentId: `${partId}:stream`, text: content, source: "desktop-sse" },
      });
}

function appendStructuredActivity(
  current: StructuredTurnState | undefined,
  turnId: string,
  event: NonNullable<ChatEvent["toolTimeline"]>,
): StructuredTurnState {
  let state = current ?? createStructuredTurnState(turnId);
  if (state.status === "pending") state = applyLocalStructuredEvent(state, { type: "turn.started" });
  return applyLocalStructuredEvent(state, {
    type: "activity.updated",
    activity: {
      id: event.id,
      turnId,
      timestamp: event.timestamp ?? new Date().toISOString(),
      source: "desktop-sse",
      status: event.status === "failed" ? "error" : event.status === "completed" ? "completed" : "running",
      title: event.title,
      kind: "tool",
      toolName: event.toolName ?? event.title,
      callId: event.id,
      ...(event.content ? { output: event.content } : {}),
    },
  });
}

function appendConnectionActivity(
  current: StructuredTurnState | undefined,
  turnId: string,
  activity: StructuredActivityEvent,
): StructuredTurnState {
  let state = current?.turnId === turnId ? current : createStructuredTurnState(turnId);
  if (state.status === "pending") state = applyLocalStructuredEvent(state, { type: "turn.started" });
  return applyLocalStructuredEvent(state, { type: "activity.updated", activity });
}

type LocalStructuredEvent =
  | Pick<Extract<StructuredConversationEvent, { type: "turn.started" }>, "type">
  | Pick<Extract<StructuredConversationEvent, { type: "part.started" }>, "type" | "part">
  | Pick<Extract<StructuredConversationEvent, { type: "part.delta" }>, "type" | "partId" | "delta">
  | Pick<Extract<StructuredConversationEvent, { type: "part.completed" }>, "type" | "part">
  | Pick<Extract<StructuredConversationEvent, { type: "activity.updated" }>, "type" | "activity">
  | Pick<Extract<StructuredConversationEvent, { type: "turn.completed" }>, "type" | "meta">
  | Pick<Extract<StructuredConversationEvent, { type: "turn.cancelled" }>, "type">
  | Pick<Extract<StructuredConversationEvent, { type: "turn.error" }>, "type" | "message" | "code" | "debugRef">;

function applyLocalStructuredEvent(state: StructuredTurnState, event: LocalStructuredEvent): StructuredTurnState {
  const sequence = state.lastSequence + 1;
  return applyStructuredConversationEvent(state, {
    ...event,
    version: 2,
    turnId: state.turnId,
    sequence,
    dedupeKey: `${state.turnId}:${sequence}:${event.type}`,
    timestamp: new Date().toISOString(),
    source: "desktop-adapter",
  } as StructuredConversationEvent);
}

function readStructuredMarkdown(state: StructuredTurnState): string {
  return state.parts
    .filter((part): part is Extract<StructuredAssistantPart, { kind: "markdown" }> => part.kind === "markdown")
    .map((part) => part.markdown)
    .join("\n\n");
}

function readStructuredReasoning(state: StructuredTurnState): string {
  return state.parts
    .filter((part): part is Extract<StructuredAssistantPart, { kind: "reasoning" }> => part.kind === "reasoning")
    .flatMap((part) => part.segments.map((segment) => segment.text))
    .join("");
}

function applyStructuredEventToMessage(
  message: UiMessage,
  event: StructuredConversationEvent,
): UiMessage {
  const current = message.structuredTurn?.turnId === event.turnId
    ? message.structuredTurn
    : createStructuredTurnState(event.turnId);
  const structuredTurn = sanitizeStructuredTurnForChat(applyStructuredConversationEvent(current, event));
  const content = readStructuredMarkdown(structuredTurn);
  const reasoningContent = readStructuredReasoning(structuredTurn);
  const activeInteraction = [...structuredTurn.parts]
    .reverse()
    .find((part): part is Extract<StructuredAssistantPart, { kind: "interaction" }> =>
      part.kind === "interaction" && (part.status === "pending" || part.status === "running"));
  const errorNotice = [...structuredTurn.parts]
    .reverse()
    .find((part): part is Extract<StructuredAssistantPart, { kind: "notice" }> =>
      part.kind === "notice" && part.level === "error");
  return sanitizeStructuredAssistantMessage({
    ...message,
    structuredTurn,
    content: content || errorNotice?.message || message.content,
    reasoningContent,
    streaming: structuredTurn.status === "pending" || structuredTurn.status === "running",
    error: structuredTurn.status === "error" || message.error,
    ...(activeInteraction
      ? {
          inputRequest: {
            requestId: activeInteraction.requestId,
            prompt: activeInteraction.prompt,
            inputType: activeInteraction.interactionType === "approval" ? "approval" as const : "text_input" as const,
          },
        }
      : {}),
    lastEventAt: Date.now(),
  });
}

function sanitizeStructuredAssistantMessage(message: UiMessage): UiMessage {
  const current = message.structuredTurn;
  if (!current) return message;
  const hiddenMessages = current.parts
    .filter(isTerminalErrorNotice)
    .map((part) => part.message.trim())
    .filter(Boolean);
  if (current.status === "error" && current.error?.message.trim()) {
    hiddenMessages.push(current.error.message.trim());
  }
  const hadTerminalError = current.status === "error" || hiddenMessages.length > 0;
  const structuredTurn = sanitizeStructuredTurnForChat(current);
  const content = hiddenMessages.includes(message.content.trim())
    ? readStructuredMarkdown(structuredTurn)
    : message.content;
  return {
    ...message,
    content,
    structuredTurn,
    // The structured turn is authoritative. Persisted renderer snapshots from an
    // interrupted/cancelled run may still carry the older `streaming: true`
    // flag, which otherwise leaves the elapsed-time indicator running forever.
    streaming: structuredTurn.status === "pending" || structuredTurn.status === "running",
    error: hadTerminalError ? false : message.error,
  };
}

function sanitizeStructuredTurnForChat(state: StructuredTurnState): StructuredTurnState {
  const parts = state.parts.filter((part) => !isTerminalErrorNotice(part));
  if (state.status !== "error") return parts.length === state.parts.length ? state : { ...state, parts };
  const { error: _error, ...rest } = state;
  return { ...rest, status: "cancelled", parts };
}

function isTerminalErrorNotice(
  part: StructuredAssistantPart,
): part is Extract<StructuredAssistantPart, { kind: "notice" }> {
  return part.kind === "notice"
    && part.level === "error"
    && part.id.endsWith(":notice:turn-error");
}

function finalizeStructuredTurn(
  current: StructuredTurnState | undefined,
  turnId: string,
  status: "completed" | "cancelled",
): StructuredTurnState {
  let state = current ?? createStructuredTurnState(turnId);
  if (status === "cancelled") return applyLocalStructuredEvent(state, { type: "turn.cancelled" });
  for (const part of state.parts) {
    if (part.status === "running" || part.status === "pending") {
      state = applyLocalStructuredEvent(state, { type: "part.completed", part: { ...part, status: "completed" } });
    }
  }
  return applyLocalStructuredEvent(state, { type: "turn.completed" });
}

function formatToolTimelineDebugLog(event: NonNullable<ChatEvent["toolTimeline"]>): string {
  return [
    `Tool event: ${event.title}`,
    `id: ${event.id}`,
    `kind: ${event.kind}`,
    event.status ? `status: ${event.status}` : "",
    event.toolName ? `tool: ${event.toolName}` : "",
    event.path ? `path: ${event.path}` : "",
    event.content ? `output:\n${event.content}` : "",
  ].filter(Boolean).join("\n");
}

function getDebugLevel(level: string | undefined): "log" | "info" | "warn" | "error" {
  if (/error|fatal/i.test(level ?? "")) return "error";
  if (/warn/i.test(level ?? "")) return "warn";
  return "info";
}

function formatAssistantError(error: string, developerMode: boolean, language: "en" | "zh"): string {
  const raw = error.trim();
  if (!raw || developerMode) return raw;

  if (/HepAI session expired|token_expired|session expired/i.test(raw)) {
    return language === "zh" ? "HepAI 登录已过期，请重新登录。" : "Your HepAI session expired. Sign in again.";
  }
  if (/invalid_token|authentication context is not valid/i.test(raw)) {
    return language === "zh" ? "HepAI 登录凭据无效，请退出后重新登录。" : "Your HepAI credentials are invalid. Sign out and sign in again.";
  }
  if (/subject_mismatch/i.test(raw)) {
    return language === "zh" ? "HepAI 登录身份不一致，请退出后重新登录。" : "Your HepAI identity does not match this session. Sign out and sign in again.";
  }
  if (/agent_credentials_unavailable/i.test(raw)) {
    return language === "zh"
      ? "当前 HepAI 账号尚未配置可用的模型访问凭据，请联系平台管理员。"
      : "No model access credential is configured for this HepAI account. Contact the platform administrator.";
  }
  if (/agent_credentials_invalid/i.test(raw)) {
    return language === "zh"
      ? "当前 HepAI 账号的模型访问凭据已失效，请在 HepAI 平台更新或联系管理员。"
      : "The model access credential for this HepAI account is invalid. Update it in HepAI or contact the administrator.";
  }
  if (/unsupported_issuer|invalid_model_base_url/i.test(raw)) {
    return language === "zh" ? "当前 HepAI 登录环境尚未配置对应的模型服务。" : "No model service is configured for this HepAI environment.";
  }
  if (/account cannot use this model|model_forbidden/i.test(raw)) {
    return language === "zh" ? "当前账号没有使用该模型的权限。" : "Your account cannot use this model.";
  }
  if (/quota or concurrency limit|quota_exceeded|rate limit/i.test(raw)) {
    return language === "zh" ? "模型额度或并发上限已达到，请稍后重试。" : "The model quota or concurrency limit was reached.";
  }
  if (/selected model is unavailable|model_not_found/i.test(raw)) {
    return language === "zh" ? "所选模型当前不可用，请更换模型。" : "The selected model is unavailable. Choose another model.";
  }
  if (/model service is temporarily unavailable|upstream_unavailable/i.test(raw)) {
    return language === "zh" ? "模型服务暂时不可用，请稍后重试。" : "The model service is temporarily unavailable.";
  }
  if (/No candidate worker|candidate worker/i.test(raw)) {
    return language === "zh"
      ? "模型服务当前不可用：没有找到可用的模型 worker。请稍后重试或切换模型。"
      : "The model service is unavailable: no model worker was found. Try again later or switch models.";
  }
  if (/timed out|timeout/i.test(raw)) {
    return language === "zh"
      ? "模型响应超时。请稍后重试。"
      : "The model response timed out. Please try again later.";
  }
  if (/HTTP\s*5\d\d|InternalServerError|INTERNAL_ERROR/i.test(raw)) {
    return language === "zh"
      ? "模型服务返回内部错误。请稍后重试或切换模型。"
      : "The model service returned an internal error. Try again later or switch models.";
  }
  return language === "zh" ? "聊天失败。请稍后重试。" : "Chat failed. Please try again later.";
}

function updateAssistantByIdOrLatestStreaming(
  messages: UiMessage[],
  assistantId: string | undefined,
  update: (message: UiMessage) => UiMessage,
): UiMessage[] {
  const next = [...messages];
  const index = findAssistantIndex(next, assistantId);
  if (index === -1) return next;
  next[index] = update(next[index]);
  return next;
}

function settleAssistantAfterHiddenError(
  messages: UiMessage[],
  assistantId: string | undefined,
): UiMessage[] {
  const next = [...messages];
  const index = findAssistantIndex(next, assistantId);
  if (index === -1) return next;
  const message = next[index];
  if (!message.content.trim()) {
    next.splice(index, 1);
    return next;
  }
  next[index] = {
    ...message,
    streaming: false,
    error: false,
    structuredTurn: message.structuredTurn
      ? finalizeStructuredTurn(message.structuredTurn, message.id, "cancelled")
      : undefined,
  };
  return next;
}

function findAssistantIndex(messages: UiMessage[], assistantId: string | undefined): number {
  if (assistantId) {
    const byId = messages.findIndex((message) => message.id === assistantId);
    if (byId !== -1) return byId;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].streaming) return index;
  }
  return -1;
}
