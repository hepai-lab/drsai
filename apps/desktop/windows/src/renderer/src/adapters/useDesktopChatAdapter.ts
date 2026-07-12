import { useEffect, useRef, useState } from "react";
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  ChatMessagePart,
  DesktopApprovalProposalResult,
  DesktopAgent,
  DesktopCommitApprovalChecklist,
  DesktopCustomCommand,
  DesktopForkQueueDispatchResult,
  DesktopForkQueueStartApprovalResult,
  DesktopProjectMemoryEntry,
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
import {
  formatRecentTerminalTestResult,
  readRecentTerminalTestResult,
} from "../terminalTestResults";
import { acceptChatEventSequence, getVisibleChatText } from "../chatOutputModel";

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
  workspacePath?: string;
}): DesktopChatAdapter {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([createWelcomeMessage(language)]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [currentRuntimeMode, setCurrentRuntimeMode] = useState<ChatRuntimeMode | null>(null);
  const [commandAttachments, setCommandAttachments] = useState<ChatAttachment[]>([]);
  const [customCommands, setCustomCommands] = useState<DesktopCustomCommand[]>([]);
  const [projectMemory, setProjectMemory] = useState<DesktopProjectMemoryEntry[]>([]);
  const streamingAssistantByRequest = useRef<Record<string, string>>({});
  const lastSequenceByRequest = useRef<Record<string, number>>({});
  const pendingDeltasByRequest = useRef<Record<string, { text: string; reasoning: string }>>({});
  const deltaFlushTimerRef = useRef<number | null>(null);
  const threadIdRef = useRef(threadId);
  const languageRef = useRef(language);
  const developerModeRef = useRef(developerMode);
  const currentRuntimeModeRef = useRef<ChatRuntimeMode | null>(null);
  const customCommandsRef = useRef<DesktopCustomCommand[]>([]);
  const projectMemoryRef = useRef<DesktopProjectMemoryEntry[]>([]);

  useEffect(() => {
    threadIdRef.current = threadId;
    languageRef.current = language;
    streamingAssistantByRequest.current = {};
    lastSequenceByRequest.current = {};
    pendingDeltasByRequest.current = {};
    if (deltaFlushTimerRef.current !== null) {
      window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
    }
    setActiveRequestId(null);
    setCurrentRuntimeMode(null);
    currentRuntimeModeRef.current = null;
    setCommandAttachments([]);
    setInput("");
    setMessages(threadSnapshot?.messages?.length ? threadSnapshot.messages : [createWelcomeMessage(language)]);
  }, [language, threadId]);

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
  }, [workspacePath]);

  useEffect(() => {
    if (threadSnapshot?.threadId !== threadId) return;
    setMessages(threadSnapshot.messages.length ? threadSnapshot.messages : [createWelcomeMessage(language)]);
  }, [language, threadId, threadSnapshot]);

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
      const memoryText = await maybeApplyMemoryCommand(command, workspacePath);
      const mcpLiveText = await maybeRequestMcpLiveBridge(command, workspacePath);
      const mcpContextText = await maybeImportMcpContext(command, workspacePath);
      const compactText = maybeApplyCompactCommand(command, messages);
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

    if (!canChat) return false;

    const userMessage: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const nextMessages: UiMessage[] = [
      ...messages,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
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
        sessionId: threadIdRef.current,
        runId: requestId,
        workspacePath,
        attachments,
        model: options?.model?.trim() || undefined,
        metadata: {
          workspace_instructions: workspaceInstructions || [],
          selected_agent: options?.agentName?.trim() || undefined,
          thinking_effort: options?.thinkingEffort,
          reasoning_effort: options?.thinkingEffort,
          runtime_mode: currentRuntimeModeRef.current
            ? serializeRuntimeMode(currentRuntimeModeRef.current)
            : undefined,
        },
        messages: buildRequestMessages(
          [...messages, userMessage]
            .filter((message) => !message.error && message.content.trim().length > 0)
            .map(({ role, content }) => ({ role, content })),
          workspaceInstructions,
          projectMemoryRef.current,
          currentRuntimeModeRef.current,
        ),
      });
      return true;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : languageRef.current === "zh" ? "聊天未能启动。" : "Chat failed to start.";
      setActiveRequestId(null);
      delete streamingAssistantByRequest.current[requestId];
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                streaming: false,
                error: true,
                content: formatAssistantError(message, developerModeRef.current, languageRef.current),
              }
            : item,
        ),
      );
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
    if (event.type === "start") {
      touchStreamingAssistant(event.requestId);
      setActiveRequestId(event.requestId);
      return;
    }
    if (event.type === "chunk") {
      queueAssistantDelta(event.requestId, "text", event.content ?? "");
      return;
    }
    if (event.type === "status") {
      setMessages((current) =>
        publishAndReturn(
          appendAssistantStatus(
            current,
            streamingAssistantByRequest.current[event.requestId],
            event.content ?? "",
            developerModeRef.current,
            languageRef.current,
          ),
        ),
      );
      return;
    }
    if (event.type === "reasoning") {
      queueAssistantDelta(event.requestId, "reasoning", event.content ?? "");
      return;
    }
    if (event.type === "tool_timeline" && event.toolTimeline) {
      const toolTimeline = event.toolTimeline;
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
    if (event.type === "done" || event.type === "aborted") {
      flushPendingDeltas();
      const assistantId = streamingAssistantByRequest.current[event.requestId];
      setMessages((current) =>
        publishAndReturn(
          updateAssistantByIdOrLatestStreaming(current, assistantId, (message) => ({
            ...message,
            streaming: false,
            parts: completeMessageParts(message.parts),
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
      flushPendingDeltas();
      const assistantId = streamingAssistantByRequest.current[event.requestId];
      setMessages((current) =>
        publishAndReturn(
          updateAssistantByIdOrLatestStreaming(current, assistantId, (message) => ({
            ...message,
            streaming: false,
            error: true,
            content: formatAssistantError(
              event.error || (languageRef.current === "zh" ? "聊天失败。" : "Chat failed."),
              developerModeRef.current,
              languageRef.current,
            ),
            parts: upsertMessagePart(completeMessageParts(message.parts), {
              id: `${message.id}:error`,
              type: "error",
              message: event.error || "Chat failed.",
              retryable: false,
              status: "error",
            }),
          })),
        ),
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
      ...messages,
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

function maybeApplyCompactCommand(
  command: ReturnType<typeof parseChatCommand>,
  currentMessages: UiMessage[],
): string | undefined {
  if (!command || command.name !== "compact") return undefined;
  return buildLocalCompactSummary(currentMessages, command.args);
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
  runtimeMode: ChatRuntimeMode | null,
): ChatMessage[] {
  const systemSections: string[] = [];
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
    systemSections.push(
      [
        "Project memory for this workspace:",
        ...projectMemory
          .slice(0, 12)
          .map((entry, index) => `${index + 1}. ${entry.content}`),
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

function createWelcomeMessage(language: "en" | "zh"): UiMessage {
  return {
    id: "welcome",
    role: "assistant",
    content:
      language === "zh"
        ? "OpenDrSai 桌面端已就绪。安装或启动本地网关后即可发送消息。"
        : "OpenDrSai desktop is ready. Install or start the local gateway, then send a message.",
  };
}

function appendAssistantChunk(
  messages: UiMessage[],
  assistantId: string | undefined,
  content: string,
): UiMessage[] {
  const next = [...messages];
  const index = findAssistantIndex(next, assistantId);
  if (index === -1) return next;
  next[index] = { ...next[index], content: `${next[index].content}${content}` };
  next[index].parts = upsertMessagePart(next[index].parts, {
    id: `${next[index].id}:text`,
    type: "text",
    text: next[index].content,
    format: "markdown",
    status: next[index].streaming ? "running" : "completed",
  });
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
  next[index] = {
    ...next[index],
    reasoningContent: `${next[index].reasoningContent ?? ""}${content}`,
    lastEventAt: Date.now(),
  };
  next[index].parts = upsertMessagePart(next[index].parts, {
    id: `${next[index].id}:reasoning`,
    type: "reasoning",
    text: next[index].reasoningContent ?? "",
    visibility: "raw",
    status: next[index].streaming ? "running" : "completed",
  });
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
  const previous = next[index].toolTimeline ?? [];
  const existingIndex = previous.findIndex((item) => item.id === boundedEvent.id);
  const timeline = existingIndex === -1
    ? [...previous, boundedEvent]
    : previous.map((item, itemIndex) => itemIndex === existingIndex ? { ...item, ...boundedEvent } : item);
  next[index] = {
    ...next[index],
    toolTimeline: timeline.slice(-20),
    lastEventAt: Date.now(),
  };
  next[index].parts = upsertMessagePart(next[index].parts, {
    id: `${next[index].id}:tool:${boundedEvent.id}`,
    type: "tool",
    event: boundedEvent,
    status: boundedEvent.status === "failed" ? "error" : boundedEvent.status === "completed" ? "completed" : "running",
  });
  return next;
}

function appendAssistantStatus(
  messages: UiMessage[],
  assistantId: string | undefined,
  content: string,
  developerMode: boolean,
  language: "en" | "zh",
): UiMessage[] {
  const status = formatAssistantStatus(content, developerMode, language).trim();
  if (!status) return messages;
  const next = [...messages];
  const index = findAssistantIndex(next, assistantId);
  if (index === -1) return next;
  const previousStatus = developerMode ? next[index].statusContent?.trimEnd() : "";
  const prefix = previousStatus ? "\n\n---\n\n" : "";
  next[index] = {
    ...next[index],
    statusContent: developerMode ? `${previousStatus}${prefix}${status}` : status,
  };
  next[index].parts = upsertMessagePart(next[index].parts, {
    id: `${next[index].id}:status`,
    type: "status",
    text: next[index].statusContent ?? status,
    status: "running",
  });
  next[index].lastEventAt = Date.now();
  return next;
}

function upsertMessagePart(parts: ChatMessagePart[] | undefined, part: ChatMessagePart): ChatMessagePart[] {
  const current = parts ?? [];
  const index = current.findIndex((item) => item.id === part.id);
  return index === -1
    ? [...current, part]
    : current.map((item, itemIndex) => itemIndex === index ? part : item);
}

function completeMessageParts(parts: ChatMessagePart[] | undefined): ChatMessagePart[] | undefined {
  return parts?.map((part) =>
    part.status === "running" || part.status === "pending"
      ? { ...part, status: "completed" }
      : part,
  );
}

function formatAssistantStatus(content: string, developerMode: boolean, language: "en" | "zh"): string {
  const raw = content.trim();
  if (!raw || developerMode) return raw;

  const title = raw.match(/\*\*([^*]+)\*\*/)?.[1]?.trim() || "LLM Retry";
  if (/model reasoning|reasoning|thinking/i.test(title)) {
    return raw;
  }
  if (/LLM Retry/i.test(title) || /retry|重试/i.test(raw)) {
    const attempt =
      raw.match(/(?:正在重试|retrying)\s*\((\d+\s*\/\s*\d+)\)/i)?.[1]?.replace(/\s+/g, "") ||
      raw.match(/\battempt\s+(\d+\s*\/\s*\d+)/i)?.[1]?.replace(/\s+/g, "");
    const wait = raw.match(/(?:等待|in)\s*([0-9.]+\s*s)/i)?.[1]?.replace(/\s+/g, "");
    const message = language === "zh"
      ? `模型调用失败${attempt ? `，正在重试 (${attempt})` : ""}${wait ? `，等待 ${wait}` : ""}。`
      : `Model call failed${attempt ? `, retrying (${attempt})` : ""}${wait ? `, waiting ${wait}` : ""}.`;
    return `**LLM Retry**\n\n${message}`;
  }

  return `**${title}**\n\n${language === "zh" ? "操作暂时没有完成，请稍后重试。" : "The operation did not complete. Please try again later."}`;
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
