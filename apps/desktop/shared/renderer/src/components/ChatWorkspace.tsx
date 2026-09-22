import { useStreamingClock } from "../useStreamingClock";
import {
  FormEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Brain,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileCode2,
  FileText,
  Folder,
  FolderPlus,
  Globe2,
  Hammer,
  Info,
  Mic,
  MicOff,
  Paperclip,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ScanSearch,
  Send,
  ShieldCheck,
  Square,
  TextCursorInput,
  Terminal,
  Telescope,
  Trash2,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import drsaiLogo from "../assets/drsai.png";
import { OpenAiBrandIcon } from "./OpenAiBrandIcon";
import { canHandleMemoryRequestLocally } from "../userPreferenceIntent";
import { isTextCompositionEvent, shouldSubmitTextInput } from "../imeKeyboardPolicy";
import type {
  ChatMessage,
  ChatDraftPart,
  ConversationResourceDownloadProgressEvent,
  ConversationResourceResolveRequest,
  ConversationResourceResolveResult,
  DesktopAgent,
  DesktopHealth,
  DesktopIdeContextSnapshot,
  DiagnosticEventInput,
  DesktopVoiceInteractionMode,
  DesktopVoiceRuntimeStatus,
  DesktopDuplexVoiceCapabilities,
  DesktopDuplexVoiceReadiness,
  DesktopThreadHistoryState,
  DesktopVoiceTranscriptionResult,
  DesktopSquareSkill,
  ChatToolTimelineEvent,
  ChatMessagePart,
  MyDrSaiModelConfig,
  MaterialConsistencyAnalysisResult,
  MaterialConsistencyFindingKind,
  MaterialConsistencySource,
  MaterialRoleAnalysisResult,
  MaterialRoleItem,
  PickDialogResult,
  PickedFileDescriptor,
  WorkspaceFolderSummaryRequest,
  WorkspaceFolderSummaryResult,
  WorkspaceInstructionSummary,
  WorkspaceFilePreview,
  WorkspaceProject,
  GatewaySkill,
} from "@shared/desktopApi";
import type { ChatAttachment, InteractionOption } from "@shared/desktopApi";
import type { RunReproducibilityLevel } from "@shared/runInspection";
import type { ArtifactPart, CitationPart, InteractionPart, StructuredAssistantPart, StructuredTurnState } from "@shared/structuredConversation";
import type { AppLanguage } from "../navigation";
import { supportsFullAgentPrimaryRuntime } from "../modelCatalogRecovery";
import { getAgentEmptyChatPrompts, parseCatalogAgentExamples } from "../agentExamplePrompts";
import { desktopApi, hasDesktopApi } from "../desktopApi";
import { loadWorkspacePreview } from "../workspacePreview";
import { appendRendererStage } from "../debugLogStore";
import { decideWeChatComposerSubmit } from "../wechatComposerPolicy";
import { copyTextSafely } from "../clipboard";
import {
  resolveTurnRailNavigationIndex,
  type TurnRailNavigationKey,
} from "../conversationTurnRail";
import {
  CHAT_COMMAND_NAMES,
  parseForkQueueEntries,
  type ChatCommandName,
  type ChatRuntimeMode,
} from "../chatCommands";
import { ChatMessageContent } from "./ChatMessageContent";
import { ThreadActivityBubble } from "./ThreadActivityBubble";
import { StructuredMessageParts, type InteractionResponse } from "./StructuredMessageParts";
import { getReasoningChatText, getVisibleChatText, stripAgentToolDebugText } from "../chatOutputModel";
import { createSmoothFollowOutputController } from "../smoothFollowOutput";
import { KnowledgeBaseSelector } from "./KnowledgeBaseSelector";
import { FilePreviewer } from "./files/file_previewer/FilePreviewer";
import { VoiceCaptureBar } from "./voice/VoiceCaptureBar";
import { VoiceReviewBar } from "./voice/VoiceReviewBar";
import {
  useSystemVoicePlayback,
  type SystemVoicePlayback,
} from "../voice/useSystemVoicePlayback";
import { resolveVoiceSynthesisMode, useVoicePreferences } from "../voice/useVoicePreferences";
import { canSwitchVoiceMode, deriveVoiceModeCapabilities, getVoiceModeAvailability } from "../voice/voiceMode";
import { insertVoiceTranscript } from "../voice/voiceComposer";
import {
  getVoiceStatusLabel,
} from "../voice/voiceAudio";
import { useVoiceCapture } from "../voice/useVoiceCapture";
import { useDuplexVoiceInput } from "../voice/duplex/useDuplexVoiceInput";
import type { DuplexCaptureQualityIssue } from "../voice/duplex/captureQuality";
import { getDuplexVoiceReadinessActions, type DuplexVoiceReadinessActionId } from "../voice/duplex/readinessActions";
import { interruptedVoiceStatus } from "../voice/duplex/sessionContext";
import { deriveDuplexHudState, duplexHudLabel, getDuplexErrorRecovery, getDuplexShortcutAction, realtimeDisclosureFingerprint } from "../voice/duplex/duplexUiModel";
import { useVoiceTranscription } from "../voice/useVoiceTranscription";
import { getAssistantSpeechText } from "../voice/voiceMessageText";
import {
  createVoiceTurnId,
  initialVoiceTurnState,
  isVoiceCaptureActive,
  reduceVoiceTurn,
  type VoiceTurnEvent,
} from "../voice/voiceTurnReducer";
import type { UserFacingRecoveryAction } from "../userFacingErrors";
import type { ChatErrorPresentation } from "../chatErrorPresentation";
import { userFacingFailureMessage } from "../userFacingLanguage";

export type UiMessage = ChatMessage & {
  id: string;
  /** Authoritative Runtime Run id; distinct from the UI/request turn id. */
  runtimeRunId?: string;
  streaming?: boolean;
  error?: boolean;
  replyFailed?: boolean;
  statusContent?: string;
  reasoningContent?: string;
  toolTimeline?: ChatToolTimelineEvent[];
  parts?: ChatMessagePart[];
  structuredTurn?: StructuredTurnState;
  queuedAt?: number;
  startedAt?: number;
  lastEventAt?: number;
  firstFeedbackAt?: number;
  firstDeltaAt?: number;
  /** Files/folders attached when the user sent this message (shown as chips in the bubble). */
  attachments?: ChatAttachment[];
  recoveryActions?: UserFacingRecoveryAction[];
  errorPresentation?: ChatErrorPresentation;
  inputRequest?: {
    requestId: string;
    prompt: string;
    inputType: "text_input" | "approval" | "choice" | "confirmation";
    options?: InteractionOption[];
    defaultValue?: string;
    allowCustom?: boolean;
    timeoutAt?: string;
  };
};

async function recordVoiceDiagnostic(input: Omit<DiagnosticEventInput, "module">): Promise<void> {
  if (!hasDesktopApi() || typeof desktopApi.recordDiagnostic !== "function") return;
  try {
    await desktopApi.recordDiagnostic({ ...input, module: "voice" });
  } catch {
    // Diagnostics must never interrupt voice interaction.
  }
}

function voiceDiagnosticStack(error: unknown): NonNullable<DiagnosticEventInput["stack"]> {
  const value = error instanceof Error ? error : new Error(String(error));
  return (value.stack || `${value.name}: ${value.message}`).split(/\r?\n/).slice(0, 50).map((raw) => ({
    raw,
    language: "javascript" as const,
  }));
}

function voiceCaptureErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name) return `capture_${error.name.toLowerCase()}`;
  if (error instanceof Error && error.name && error.name !== "Error") return `capture_${error.name.toLowerCase()}`;
  return "capture_error";
}

function duplexCaptureQualityMessage(issue: DuplexCaptureQualityIssue, zh: boolean): string {
  const messages: Record<DuplexCaptureQualityIssue, [string, string]> = {
    input_too_quiet: ["麦克风声音太小，请靠近麦克风或检查输入音量。", "Microphone input is too quiet. Move closer or check its input level."],
    clipping: ["麦克风声音过大并出现削波，请降低输入音量。", "Microphone input is clipping. Reduce its input level."],
    dc_offset: ["麦克风信号存在异常偏移，建议重新连接设备。", "The microphone signal has an unusual offset. Try reconnecting it."],
    sample_rate_degraded: ["麦克风采样率低于实时语音要求。", "The microphone sample rate is below the Realtime voice requirement."],
    aec_unavailable: ["回声消除未生效，建议佩戴耳机。", "Echo cancellation is unavailable. Headphones are recommended."],
    noise_suppression_unavailable: ["降噪未生效，环境噪声可能影响识别。", "Noise suppression is unavailable; background noise may affect recognition."],
    agc_unavailable: ["自动增益未生效，请手动调整麦克风音量。", "Automatic gain control is unavailable. Adjust the microphone level manually."],
    channel_count_degraded: ["麦克风未提供单声道输入，已自动混音。", "The microphone did not provide mono input; channels are being mixed."],
  };
  return messages[issue][zh ? 0 : 1];
}

type ComposerAttachment = ChatAttachment & {
  id: string;
  importFile?: PickedFileDescriptor;
  folderImport?: {
    phase: "scanning" | "ready" | "failed";
    imported: number;
    skipped: number;
    failed: number;
    duplicates: number;
    directories: number;
    message?: string;
  };
};

interface MaterialTaskSuggestion {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export type ThinkingEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
const THINKING_EFFORTS: ThinkingEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;
const REMOTE_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_COUNT = 4;
const MAX_CLIPBOARD_PATH_MENTIONS = 6;
// Generous tolerance so subpixel scroll, trackpad settle, and near-bottom
// scrollbar clicks don't leave the "jump to latest" affordance stuck on.
const AT_BOTTOM_TOLERANCE = 64;

// Module-level style constants to avoid creating new object references on every render.
const VOICE_BUTTON_WRAPPER_STYLE: React.CSSProperties = { position: "relative", display: "inline-flex" };
const VOICE_MENU_STYLE: React.CSSProperties = { position: "absolute", bottom: "calc(100% + 8px)", right: "0", zIndex: 45, display: "grid", gap: "4px", padding: "8px", border: "1px solid var(--app-panel-border)", borderRadius: "12px", background: "var(--app-card-bg)", boxShadow: "var(--app-shadow-menu)", minWidth: "180px" };
const VOICE_MENU_ITEM_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", border: "none", borderRadius: "8px", background: "var(--app-accent)", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 500, textAlign: "left", width: "100%" };
const VOICE_MENU_DIVIDER_STYLE: React.CSSProperties = { height: "1px", background: "var(--app-panel-border)", margin: "4px 0" };

function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

export interface ChatForkQueueAgentAssignment {
  queueIndex: number;
  agentId?: string;
  agentName?: string;
}

export interface ChatSubmitOptions {
  agentId?: string;
  agentName?: string;
  draftParts?: ChatDraftPart[];
  forkQueueAgentAssignments?: ChatForkQueueAgentAssignment[];
  planMode?: boolean;
  /**
   * Per-turn Private Mode. The Gateway — not the client — pins this Run to the
   * private model and forces reasoning off, so the selected model is ignored.
   */
  privateMode?: boolean;
  model?: string;
  replaceFromMessageId?: string;
  runtimeMode?: ChatRuntimeMode | null;
  skillName?: string | null;
  /** Remote-agent skill selection in the WebUI {id, source} protocol. */
  remoteSkill?: { id: string; source: string; name?: string; content?: string; zipBase64?: string } | null;
  text?: string;
  thinkingEffort?: ThinkingEffort;
  onStarted?: (submission: {
    assistantMessageId: string;
    requestId: string;
    userMessageId: string;
  }) => void;
}

interface GoalConfirmationDraft {
  objective: string;
  materials: string;
  outputs: string;
  constraints: string;
}

function parseGoalConfirmationPrompt(prompt: string): GoalConfirmationDraft {
  const fields = Object.fromEntries(prompt.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(":");
    return separator > 0
      ? [[line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()]]
      : [];
  }));
  return {
    objective: fields.goal || "",
    materials: fields.materials === "None supplied" ? "" : fields.materials || "",
    outputs: fields.outputs === "Not specified" ? "" : fields.outputs || "",
    constraints: fields.constraints === "None supplied" ? "" : fields.constraints || "",
  };
}

function splitGoalConfirmationList(value: string): string[] {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function findPrecedingUserMessage(messages: UiMessage[], assistantMessageId: string): UiMessage | undefined {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.content.trim()) return message;
  }
  return undefined;
}

interface ChatWorkspaceProps {
  activeRequestId: string | null;
  cancellingRequestId?: string | null;
  canChat: boolean;
  chatUnavailableReason?: string;
  composerFocusRequest?: number;
  conversationId: string;
  conversationTitle?: string;
  conversationSource?: "opendrsai" | "codex";
  channelSource?: "wechat";
  runtimeSessionId?: string;
  conversationHistoryPending?: boolean;
  conversationHistory?: DesktopThreadHistoryState;
  operationalStateControl?: React.ReactNode;
  continuesExistingTask?: boolean;
  health: DesktopHealth | null;
  input: string;
  language: AppLanguage;
  messages: UiMessage[];
  currentRuntimeMode?: ChatRuntimeMode | null;
  defaultThinkingEffort?: ThinkingEffort;
  defaultPlanMode?: "normal" | "plan";
  searchRequestNonce?: number;
  messageFocus?: { messageId: string; nonce: number } | null;
  structuredTurnFocus?: { turnId: string; nonce: number } | null;
  selectedAgentId?: string;
  selectedAgentName?: string;
  /**
   * Authoritative source of the selected Agent, supplied by App.
   * ``agentOptions`` may not yet contain a remote worker when a thread is
   * restored, so remote detection must not depend on catalog membership.
   */
  selectedAgentSource?: DesktopAgent["source"];
  selectedModelName?: string;
  selectedModelProviderId?: string;
  selectedImageGenerationModelName?: string;
  selectedImageGenerationProviderId?: string;
  agentOptions?: DesktopAgent[];
  modelOptions?: MyDrSaiModelConfig[];
  imageGenerationModelOptions?: MyDrSaiModelConfig[];
  samplePrompts?: DesktopAgent["examples"];
  externalAttachments?: ChatAttachment[];
  ideContext?: DesktopIdeContextSnapshot | null;
  workspaceInstructions?: WorkspaceInstructionSummary[];
  workspaceName?: string;
  workspacePath?: string;
  workspaceLocation?: "local" | "remote";
  workspaceOptions?: WorkspaceProject[];
  selectedWorkspaceId?: string;
  onAbort: () => void | Promise<void>;
  onClearExternalAttachments?: () => void;
  onClearRuntimeMode?: () => void;
  onInputChange: (value: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onSelectModel?: (model: string, providerId?: string) => void;
  onSelectImageGenerationModel?: (model: string, providerId?: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenAgentSettings?: () => void;
  onOpenPreviewBrowser?: (url?: string) => void;
  onOpenWorkspaceArtifact?: (path: string) => void;
  onOpenConversationResourcePreview?: (preview: WorkspaceFilePreview, logicalPath?: string) => void;
  /** Open a Knowledge Base citation at the position it was taken from. */
  onOpenCitationSource?: (part: CitationPart) => void;
  onPickFiles?: () => Promise<PickDialogResult>;
  onPickFolder?: () => Promise<PickDialogResult>;
  onSummarizeWorkspaceFolder?: (
    request: WorkspaceFolderSummaryRequest,
  ) => Promise<WorkspaceFolderSummaryResult>;
  onRemoveExternalAttachment?: (index: number) => void;
  onAttachIdeCurrentFile?: () => void;
  onAttachIdeCurrentSelection?: () => void;
  onRefreshIdeContext?: () => void;
  onRetryMessage?: (assistantMessageId: string, mode: "same_session" | "new_session") => void | Promise<void>;
  onDeleteMessage?: (messageId: string) => void;
  onReportFeedback?: (context: { source: "error" | "message" | "tool"; errorCode?: string; errorType?: string; runId?: string }) => void;
  onRecoveryAction?: (assistantMessageId: string, action: UserFacingRecoveryAction["id"]) => void | Promise<void>;
  onLoadEarlierHistory?: () => void | Promise<void>;
  onSubmit: (
    attachments?: ChatAttachment[],
    options?: ChatSubmitOptions,
  ) => Promise<boolean>;
}

function ChatWorkspaceImpl({
  activeRequestId,
  cancellingRequestId = null,
  canChat,
  chatUnavailableReason,
  composerFocusRequest = 0,
  conversationId,
  conversationTitle,
  conversationSource = "opendrsai",
  channelSource,
  runtimeSessionId,
  conversationHistoryPending = false,
  conversationHistory,
  operationalStateControl,
  continuesExistingTask = false,
  input,
  language,
  messages,
  currentRuntimeMode,
  defaultThinkingEffort = "none",
  defaultPlanMode = "normal",
  searchRequestNonce = 0,
  messageFocus = null,
  structuredTurnFocus = null,
  selectedAgentId,
  selectedAgentName,
  selectedAgentSource,
  selectedModelName,
  selectedModelProviderId,
  selectedImageGenerationModelName,
  selectedImageGenerationProviderId,
  agentOptions = [],
  modelOptions = [],
  imageGenerationModelOptions = [],
  samplePrompts,
  externalAttachments = [],
  ideContext,
  workspaceInstructions = [],
  workspaceName,
  workspacePath = "",
  workspaceLocation = "local",
  workspaceOptions = [],
  selectedWorkspaceId,
  onAbort,
  onClearExternalAttachments,
  onClearRuntimeMode,
  onInputChange,
  onSelectAgent,
  onSelectWorkspace,
  onSelectModel,
  onSelectImageGenerationModel,
  onOpenExternal,
  onOpenAgentSettings,
  onOpenPreviewBrowser,
  onOpenWorkspaceArtifact,
  onOpenConversationResourcePreview,
  onOpenCitationSource,
  onPickFiles,
  onPickFolder,
  onSummarizeWorkspaceFolder,
  onRemoveExternalAttachment,
  onAttachIdeCurrentFile,
  onAttachIdeCurrentSelection,
  onRefreshIdeContext,
  onRetryMessage,
  onDeleteMessage,
  onReportFeedback,
  onRecoveryAction,
  onLoadEarlierHistory,
  onSubmit,
}: ChatWorkspaceProps): React.JSX.Element {
  useEffect(() => {
    appendRendererStage("chat_workspace.mounted", {
      conversationId,
      selectedAgentId,
      workspacePath,
      canChat,
      messageCount: messages.length,
    });
    return () => appendRendererStage("chat_workspace.unmounted", { conversationId });
  }, [conversationId]);

  // The composer textarea is mirrored in local state so that keystrokes only
  // re-render this component instead of the whole AuthenticatedApp tree. The
  // adapter `input` prop is the external source of truth (thread switch,
  // slash commands, retry/edit) and is updated with a short trailing debounce
  // while typing; submit and programmatic edits flush immediately.
  const [composerText, setComposerText] = useState(input);
  const composerTextRef = useRef(input);
  const composerSyncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Track IME composition (Chinese/Japanese/Korean input method). During
  // composition we must still call setComposerText so the controlled textarea
  // value stays in sync (otherwise any re-render would erase the composition).
  // We skip only the upstream onInputChange push, because parent re-renders
  // during composition can interrupt the browser's IME process and commit raw
  // pinyin letters instead of the composed characters.
  const isComposingRef = useRef(false);

  const clearComposerSyncTimer = (): void => {
    if (composerSyncTimerRef.current !== undefined) {
      clearTimeout(composerSyncTimerRef.current);
      composerSyncTimerRef.current = undefined;
    }
  };

  // Programmatic edits (insert text, undo/redo, slash/mention pick, drafts,
  // clear after send) must reach both the textarea and the adapter now.
  const applyComposerText = useCallback((next: string): void => {
    isComposingRef.current = false;
    clearComposerSyncTimer();
    composerTextRef.current = next;
    setComposerText(next);
    onInputChange(next);
  }, [onInputChange]);

  // User typing: keep the textarea instant; push upstream on a trailing pause
  // so App-level derived work happens at most once per burst.
  // During IME composition, setComposerText still runs (so the controlled
  // textarea value stays in sync and re-renders don't erase composition text),
  // but the upstream onInputChange is deferred until compositionend fires.
  const handleComposerTyping = useCallback((next: string): void => {
    composerTextRef.current = next;
    setComposerText(next);
    if (isComposingRef.current) return;
    clearComposerSyncTimer();
    composerSyncTimerRef.current = setTimeout(() => {
      composerSyncTimerRef.current = undefined;
      onInputChange(composerTextRef.current);
    }, 80);
  }, [onInputChange]);

  // Adopt external value changes (thread switch, setInput from commands).
  useEffect(() => {
    if (composerTextRef.current === input) return;
    clearComposerSyncTimer();
    composerTextRef.current = input;
    setComposerText(input);
  }, [input]);

  useEffect(() => {
    return () => {
      clearComposerSyncTimer();
      if (squareSearchTimerRef.current !== undefined) clearTimeout(squareSearchTimerRef.current);
    };
  }, []);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [conversationResourceStates, setConversationResourceStates] = useState<Record<string, ConversationResourceResolveResult["state"]>>({});
  const [conversationResourceNotice, setConversationResourceNotice] = useState<string | null>(null);
  const [conversationResourceMenu, setConversationResourceMenu] = useState<{
    part: ArtifactPart | CitationPart;
    resolved: ConversationResourceResolveResult;
    x: number;
    y: number;
    trigger?: HTMLElement;
  } | null>(null);
  const [conversationResourceDownload, setConversationResourceDownload] = useState<ConversationResourceDownloadProgressEvent | null>(null);
  useEffect(() => desktopApi.onConversationResourceDownloadProgress((progress) => {
    setConversationResourceDownload((current) => current?.operationId === progress.operationId ? progress : current);
  }), []);
  useEffect(() => {
    if (!conversationResourceMenu) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="conversation-resource-menu"] [role="menuitem"]')?.focus();
    });
    const close = (): void => {
      const trigger = conversationResourceMenu.trigger;
      const partId = conversationResourceMenu.part.id;
      setConversationResourceMenu(null);
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
        else document.querySelector<HTMLElement>(`[data-artifact-inline-id="${CSS.escape(partId)}"]`)?.focus();
      });
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      const items = [...document.querySelectorAll<HTMLElement>('[data-testid="conversation-resource-menu"] [role="menuitem"]:not(:disabled)')];
      if (!items.length) return;
      const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (current + 1) % items.length
        : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("keydown", onKeyDown); };
  }, [conversationResourceMenu]);
  const [wechatCapability, setWechatCapability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [wechatConfirmationPending, setWechatConfirmationPending] = useState(false);
  const [wechatSending, setWechatSending] = useState(false);
  const [wechatSendStatus, setWechatSendStatus] = useState<string | null>(null);
  const [runReproducibility, setRunReproducibility] = useState<Record<string, RunReproducibilityLevel>>({});
  const runtimeRunIdsKey = useMemo(() => {    const runIds = [...new Set(messages
      .map((message) => message.runtimeRunId)
      .filter((runId): runId is string => Boolean(runId?.startsWith("run-"))))]
      .slice(-20);
    return runIds.join("\n");
  }, [messages]);
  const chatStreaming = useMemo(() => messages.some((message) => message.streaming), [messages]);

  useEffect(() => {
    setWechatConfirmationPending(false);
    setWechatSendStatus(null);
    if (channelSource !== "wechat" || !runtimeSessionId) {
      setWechatCapability(null);
      return;
    }
    let cancelled = false;
    void desktopApi.getWeChatReplyCapability({ sessionId: runtimeSessionId })
      .then((value) => { if (!cancelled) setWechatCapability(value); })
      .catch(() => { if (!cancelled) setWechatCapability({ available: false, reason: "channel_not_running" }); });
    return () => { cancelled = true; };
  }, [channelSource, runtimeSessionId]);

  useEffect(() => {
    setWechatConfirmationPending(false);
  }, [input]);

  useEffect(() => {
    if (!workspacePath || typeof desktopApi.getRunReproductionManifest !== "function") return;
    // Streaming updates `messages` on every token. Never refetch manifests in
    // that loop — it previously issued hundreds of IPC calls and OOMed Desktop.
    if (chatStreaming || !runtimeRunIdsKey) return;
    const runIds = runtimeRunIdsKey.split("\n").filter(Boolean);
    let active = true;
    void Promise.all(runIds.map(async (runId) => {
      try {
        const manifest = await desktopApi.getRunReproductionManifest({
          workspacePath,
          workspaceId: selectedWorkspaceId,
          runId,
        });
        return [runId, manifest.reproducibility_level] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      setRunReproducibility(Object.fromEntries(
        entries.filter((entry): entry is readonly [string, RunReproducibilityLevel] => entry !== null),
      ));
    });
    return () => { active = false; };
  }, [chatStreaming, runtimeRunIdsKey, selectedWorkspaceId, workspacePath]);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const composerAttachmentsByThreadRef = useRef<Map<string, ComposerAttachment[]>>(new Map());
  const composerConversationIdRef = useRef(conversationId);
  const isRemoteAgent = useMemo(() => {
    if (selectedAgentSource) return selectedAgentSource === "remote";
    // Fallback for callers that do not pass the authoritative source.
    return agentOptions.some(
      (agent) => agent.id === selectedAgentId && agent.source === "remote",
    );
  }, [agentOptions, selectedAgentId, selectedAgentSource]);
  attachmentsRef.current = attachments;
  const [interactionDraft, setInteractionDraft] = useState("");
  const [materialRoleAnalysis, setMaterialRoleAnalysis] = useState<MaterialRoleAnalysisResult | null>(null);
  const [materialRolePhase, setMaterialRolePhase] = useState<"idle" | "analyzing" | "ready" | "failed">("idle");
  const [materialConsistencyAnalysis, setMaterialConsistencyAnalysis] = useState<MaterialConsistencyAnalysisResult | null>(null);
  const [materialConsistencyPhase, setMaterialConsistencyPhase] = useState<"idle" | "analyzing" | "ready" | "failed">("idle");
  const [materialConsistencySourceStatus, setMaterialConsistencySourceStatus] = useState("");
  const [materialSuggestionRuntimeReady, setMaterialSuggestionRuntimeReady] = useState(false);
  const materialRoleRequestRef = useRef(0);
  const materialConsistencyRequestRef = useRef(0);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(defaultThinkingEffort);
  const [taskInteractionMode, setTaskInteractionMode] = useState<"normal" | "plan">("normal");
  const [privateMode, setPrivateMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [metaMenuOpen, setMetaMenuOpen] = useState<"configuration" | "skill" | null>(null);
  const [configurationSection, setConfigurationSection] = useState<"model" | "imageGeneration" | "thinking" | "task" | "agent" | "private" | null>(null);
  const [configurationSubmenuPosition, setConfigurationSubmenuPosition] = useState({ top: 0, left: 0, maxHeight: 220 });
  const [installedSkills, setInstalledSkills] = useState<GatewaySkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsLoadError, setSkillsLoadError] = useState<string | null>(null);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [squareSkills, setSquareSkills] = useState<DesktopSquareSkill[]>([]);
  const [squareTags, setSquareTags] = useState<string[]>([]);
  const [squareActiveTag, setSquareActiveTag] = useState<string | null>(null);
  const [squareSearch, setSquareSearch] = useState("");
  const [squareLoading, setSquareLoading] = useState(false);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [squareInstallingSlug, setSquareInstallingSlug] = useState<string | null>(null);
  const [selectedSquareSkill, setSelectedSquareSkill] = useState<{
    slug: string;
    name: string;
    source: string;
    content?: string;
    zipBase64?: string;
    /** Exact Gateway skill name returned by installation. */
    installedName?: string;
  } | null>(null);
  const squareRequestGenerationRef = useRef(0);
  const installedSkillsCacheRef = useRef<{ items: GatewaySkill[]; timestamp: number } | null>(null);
  const [squarePage, setSquarePage] = useState(1);
  const [squareTotal, setSquareTotal] = useState(0);
  const [squareHasNext, setSquareHasNext] = useState(false);
  const [squareSort, setSquareSort] = useState<"downloads" | "name" | "time">("downloads");
  const [squareInstallFilter, setSquareInstallFilter] = useState<"all" | "installed" | "not_installed">("all");
  const [squareLoadingMore, setSquareLoadingMore] = useState(false);
  const squareSentinelRef = useRef<HTMLDivElement | null>(null);
  // Square skills cache: reuse API response across menu opens (TTL 30 s).
  const squareSkillsCacheRef = useRef<{
    items: DesktopSquareSkill[];
    tags: string[];
    search: string;
    tag: string | null;
    sort: "downloads" | "name" | "time";
    installFilter: "all" | "installed" | "not_installed";
    page: number;
    total: number;
    hasNext: boolean;
    timestamp: number;
  } | null>(null);
  // The main process applies the authoritative frontmatter/alias matching.
  const isSquareSkillInstalled = useCallback((skill: DesktopSquareSkill): boolean => skill.installed, []);
  const [introMenuOpen, setIntroMenuOpen] = useState<"workspace" | "agent" | null>(null);
  const [introSearchQuery, setIntroSearchQuery] = useState("");
  const [forkQueueAgentSelections, setForkQueueAgentSelections] = useState<Record<number, string>>({});
  const [pendingReplaceFromMessageId, setPendingReplaceFromMessageId] = useState<string | null>(null);
  const editResendBackupRef = useRef<{ input: string; attachments: ComposerAttachment[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [voiceReviewText, setVoiceReviewText] = useState<string | null>(null);
  const [voiceReviewSource, setVoiceReviewSource] = useState<"serial" | null>(null);
  const [voiceRuntimeDisclosure, setVoiceRuntimeDisclosure] = useState<string | null>(null);
  const [voiceRuntimeStatus, setVoiceRuntimeStatus] = useState<DesktopVoiceRuntimeStatus | null>(null);
  const [duplexVoiceCapabilities, setDuplexVoiceCapabilities] = useState<DesktopDuplexVoiceCapabilities | null>(null);
  const [duplexVoiceReadiness, setDuplexVoiceReadiness] = useState<DesktopDuplexVoiceReadiness | null>(null);
  const [duplexPrivacyDisclosure, setDuplexPrivacyDisclosure] = useState("Realtime voice sends microphone audio to the configured remote Provider.");
  const [duplexPrivacyConfirmed, setDuplexPrivacyConfirmed] = useState(false);
  const [duplexTextStrategy, setDuplexTextStrategy] = useState<"after_response" | "interrupt_now">("after_response");
  const [voiceConsentRequired, setVoiceConsentRequired] = useState(false);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const voiceMenuRef = useRef<HTMLDivElement | null>(null);
  const voiceButtonRef = useRef<HTMLButtonElement | null>(null);
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences();
  const [voiceTurnState, dispatchVoiceTurnBase] = useReducer(reduceVoiceTurn, initialVoiceTurnState);
  const voiceRecordingProcessTimerRef = useRef<number | null>(null);
  const voiceTurnStateRef = useRef(voiceTurnState);
  voiceTurnStateRef.current = voiceTurnState;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (voiceMenuOpen && voiceMenuRef.current && !voiceMenuRef.current.contains(event.target as Node) && voiceButtonRef.current && !voiceButtonRef.current.contains(event.target as Node)) {
        setVoiceMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [voiceMenuOpen]);
  const dispatchVoiceTurn = useCallback((event: VoiceTurnEvent): void => {
    const current = voiceTurnStateRef.current;
    const next = reduceVoiceTurn(current, event);
    if (next === current) {
      const idempotentCleanup = (event.type === "cancel" && ["idle", "completed", "failed"].includes(current.phase))
        || (event.type === "cancelled" && current.phase === "idle")
        || (event.type === "reset" && current.phase === "idle");
      if (!idempotentCleanup) {
        void recordVoiceDiagnostic({
          traceId: current.turnId ?? crypto.randomUUID(),
          component: "turn",
          operation: "voice.turn.transition",
          message: "Voice turn transition rejected",
          status: "completed",
          level: "warn",
          errorCode: "invalid_transition",
          attributes: { eventType: event.type, phase: current.phase },
        });
      }
    } else {
      voiceTurnStateRef.current = next;
    }
    dispatchVoiceTurnBase(event);
  }, []);
  const voiceLanguage = voicePreferences.interactionMode === "duplex" ? voicePreferences.realtimeLanguage : voicePreferences.inputLanguage;
  const voiceDeviceId = voicePreferences.interactionMode === "duplex" ? voicePreferences.realtimeInputDeviceId : voicePreferences.inputDeviceId;
  const voiceModeCapabilities = deriveVoiceModeCapabilities(voiceRuntimeStatus, {
    audioWorklet: typeof AudioWorkletNode !== "undefined",
    serialTts: "speechSynthesis" in window,
    duplexCapabilities: duplexVoiceCapabilities,
    duplexEnabled: Boolean(duplexVoiceCapabilities),
  });
  const negotiatedDuplexVoiceAvailability = getVoiceModeAvailability("duplex", voiceModeCapabilities);
  const duplexVoiceAvailability = !negotiatedDuplexVoiceAvailability.available
    ? negotiatedDuplexVoiceAvailability
    : duplexVoiceReadiness?.available
      ? { available: true, reason: null }
      : { available: false, reason: duplexVoiceReadiness?.message ?? "Checking Realtime voice readiness…" };
  const duplexReadinessReasonCode = duplexVoiceReadiness?.reasonCode
    ?? (typeof AudioWorkletNode === "undefined" ? "audio_worklet_unavailable"
      : !navigator.mediaDevices?.getUserMedia ? "media_devices_unavailable" : "internal");
  const duplexReadinessActions = getDuplexVoiceReadinessActions(duplexReadinessReasonCode);
  const runDuplexReadinessAction = (action: DuplexVoiceReadinessActionId): void => {
    if (action === "open_agent_settings") onOpenAgentSettings?.();
    else if (action === "switch_to_serial") { updateVoicePreferences({ interactionMode: "serial" }); setVoiceError(null); }
    else void desktopApi.getDuplexVoiceReadiness().then((readiness) => { setDuplexVoiceReadiness(readiness); if (readiness.available) setVoiceError(null); else setVoiceError(readiness.message); }).catch(() => setVoiceError(zh ? "无法重新检查实时对话状态。" : "Realtime conversation readiness could not be checked."));
  };
  const [voiceProgressMessage, setVoiceProgressMessage] = useState("");
  const [voiceRuntimeLabel, setVoiceRuntimeLabel] = useState("Voice STT");
  const voicePlayback = useSystemVoicePlayback();
  const messageVoicePlayback = useMemo(() => ({ ...voicePlayback }), [
    voicePlayback.activeMessageId, voicePlayback.error, voicePlayback.isAvailable, voicePlayback.phase,
    voicePlayback.pause, voicePlayback.play, voicePlayback.resume, voicePlayback.stop,
  ]);
  const {
    devices: voiceDevices,
    elapsedSeconds: voiceElapsedSeconds,
    error: voiceError,
    levels: voiceLevels,
    setElapsedSeconds: setVoiceElapsedSeconds,
    setError: setVoiceError,
    setState: setVoiceState,
    start: startVoiceCapture,
    state: voiceState,
    stop: stopVoiceCapture,
  } = useVoiceCapture({
    beforeStart: async () => {
      voicePlayback.stop();
      setVoiceConsentRequired(false);
    },
    deviceId: voiceDeviceId,
    onCaptureError: (error, message) => {
      reportVoiceCaptureFailure(error, message, "capture_initialization");
    },
    onDeviceUnavailable: () => {
      updateVoicePreferences({ inputDeviceId: "" });
      setVoiceError("The selected microphone is no longer available. The default microphone will be used.");
    },
    onRecorded: ({ blob, durationSeconds }) => {
      if (voiceRecordingProcessTimerRef.current !== null) window.clearTimeout(voiceRecordingProcessTimerRef.current);
      voiceRecordingProcessTimerRef.current = window.setTimeout(() => {
        voiceRecordingProcessTimerRef.current = null;
        void processVoiceRecording(blob, durationSeconds);
      }, 0);
    },
  });
  const duplexVoiceInput = useDuplexVoiceInput({
    threadId: voicePreferences.realtimeTranscriptPolicy === "stable" ? conversationId : undefined,
    deviceId: voiceDeviceId,
    outputDeviceId: voicePreferences.realtimeOutputDeviceId,
    volume: voicePreferences.realtimeVolume,
    autoRecovery: voicePreferences.realtimeAutoRecovery,
    onOutputDeviceFallback: () => updateVoicePreferences({ realtimeOutputDeviceId: "" }),
    languageHint: voiceLanguage === "auto" ? undefined : voiceLanguage,
    voice: voicePreferences.realtimeVoiceName || undefined,
    instructions: "Respond naturally and concisely in a realtime voice conversation.",
    enableToolCalling: true,
    toolExecutor: {
      execute: async ({ name, arguments: args }) => {
        if (name === "search_thread_messages") {
          const query = typeof args.query === "string" ? args.query : "";
          const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, Math.floor(args.limit))) : 8;
          return { output: await desktopApi.searchThreadMessages({ query, threadIds: [conversationId], limit }) };
        }
        if (name === "get_voice_runtime_status") return { output: await desktopApi.getVoiceRuntimeStatus() };
        throw new Error(`Realtime tool is not registered: ${name}`);
      },
    },
  });
  const duplexDisclosureFingerprint = realtimeDisclosureFingerprint(duplexVoiceReadiness?.providerId, duplexVoiceReadiness?.modelId);
  const duplexDisclosureAcknowledged = Boolean(duplexDisclosureFingerprint && voicePreferences.realtimeDisclosureFingerprint === duplexDisclosureFingerprint) || duplexPrivacyConfirmed;
  const duplexHudState = deriveDuplexHudState({ phase: duplexVoiceInput.phase, turnPhase: duplexVoiceInput.turn.phase, microphonePaused: duplexVoiceInput.microphonePaused, speechCandidate: Boolean(duplexVoiceInput.vad?.speechCandidate), playbackStarted: duplexVoiceInput.playback.started });
  const duplexFailureRecovery = duplexVoiceInput.failure ? getDuplexErrorRecovery(duplexVoiceInput.failure.code) : null;
  const {
    cancel: cancelVoiceTranscriptionTask,
    transcribe: transcribeVoiceBlob,
  } = useVoiceTranscription(setVoiceProgressMessage);
  const [respondedInputRequests, setRespondedInputRequests] = useState<Set<string>>(() => new Set());
  const [configuredCapabilityRequests, setConfiguredCapabilityRequests] = useState<Set<string>>(() => new Set());
  const [activeTurnRailId, setActiveTurnRailId] = useState<string | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  // 运行中提交的消息进入排队，待当前 turn 结束后自动发送，
  // 避免直接并发提交被后端以 session_busy 之类的错误拒绝。
  const [queuedSend, setQueuedSend] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const turnRailNavigationTargetRef = useRef<string | null>(null);
  const turnRailNavigationTimerRef = useRef<number | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  // Undo/redo history for the controlled textarea.  The browser's native
  // undo stack is reset every time React writes `value` back into the
  // element, so we maintain our own past/present/future triple.
  const inputHistoryRef = useRef<{ past: string[]; present: string; future: string[]; lastExternal: string }>({
    past: [],
    present: "",
    future: [],
    lastExternal: "",
  });
  // Push the current value onto the undo stack, clearing redo.  Called before
  // every programmatic mutation (insertTextAtCursor, slash commands, etc.).
  const pushInputHistory = useCallback((snapshot: string): void => {
    const history = inputHistoryRef.current;
    // Collapse consecutive duplicates (e.g. multiple cursor moves).
    if (history.past.at(-1) !== snapshot) {
      history.past.push(snapshot);
      if (history.past.length > 200) history.past.shift();
    }
    history.future = [];
  }, []);

  // Track input prop changes from outside the textarea (e.g. voice transcript
  // insertion, edit-and-resend restore, slash command auto-complete) so that
  // the undo history stays in sync with external mutations.
  useEffect(() => {
    const history = inputHistoryRef.current;
    if (input !== history.present) {
      // Only record external-driven changes (not our own undo/redo calls).
      if (input !== history.lastExternal) {
        history.past.push(history.present);
        if (history.past.length > 200) history.past.shift();
        history.future = [];
      }
      history.present = input;
      history.lastExternal = input;
    }
  }, [input]);

  useEffect(() => {
    if (composerFocusRequest <= 0 || conversationHistoryPending) return undefined;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerFocusRequest, conversationHistoryPending]);
  const composerDropRef = useCallback((form: HTMLFormElement | null) => {
    composerRef.current = form;
    if (!form) return;
    const onDrag = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dataTransfer = e.dataTransfer;
      if (!dataTransfer?.files.length) return;
      if (isRemoteAgent) {
        const isZh = language === "zh";
        void (async () => {
          const added: ComposerAttachment[] = [];
          let totalBytes = attachmentsRef.current.reduce(
            (sum, item) => sum + (item.sizeBytes ?? 0), 0);
          for (const f of Array.from(dataTransfer.files)) {
            if (f.size > REMOTE_ATTACHMENT_LIMIT_BYTES) {
              window.alert(isZh
                ? `文件 ${f.name} 超过远程附件 10 MB 上限。`
                : `File ${f.name} exceeds the 10 MB remote attachment limit.`);
              continue;
            }
            if (totalBytes + f.size > REMOTE_ATTACHMENT_LIMIT_BYTES) {
              window.alert(isZh
                ? "远程附件总量超过 10 MB 上限，已停止添加。"
                : "Remote attachments exceed the 10 MB total limit; stopped adding files.");
              break;
            }
            const dataUrl = await blobToDataUrl(f).catch(() => undefined);
            if (!dataUrl) continue;
            totalBytes += f.size;
            added.push({
              id: crypto.randomUUID(),
              kind: "file",
              path: `remote-file:${crypto.randomUUID()}`,
              name: f.name || "unknown",
              remoteDataUrl: dataUrl,
              sizeBytes: f.size,
              mimeType: f.type || "application/octet-stream",
              ...(f.type.startsWith("image/") ? { screenshotDataUrl: dataUrl } : {}),
            });
          }
          if (!added.length) return;
          setAttachments((current) => [...current, ...added]);
          setToolsOpen(false);
        })();
        return;
      }
      const getPath = hasDesktopApi()
        ? (f: File): string => desktopApi.getPathForFile(f)
        : (f: File): string => `C:\\Users\\Demo\\Downloads\\${f.name}`;
      void (async () => {
        const added: ComposerAttachment[] = [];
        for (const f of Array.from(dataTransfer.files)) {
          const p = getPath(f);
          if (!p) continue;
          const name = f.name || p.split(/[\\/]/).pop() || "unknown";
          const extension = name.includes(".") ? (name.split(".").pop() || "").toLowerCase() : "";
          const category = f.type.startsWith("image/") || isImageFileName(name)
            ? "image" as const
            : "other" as const;
          const screenshotDataUrl = category === "image" && f.size <= MAX_CLIPBOARD_IMAGE_BYTES
            ? await blobToDataUrl(f).catch(() => undefined)
            : undefined;
          added.push({
            id: crypto.randomUUID(),
            kind: "file",
            path: p,
            name,
            ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
            importFile: {
              path: p,
              name,
              extension,
              category,
              status: "ready",
              ...(screenshotDataUrl ? { previewDataUrl: screenshotDataUrl } : {}),
            },
          });
        }
        if (!added.length) return;
        setAttachments((c) => {
          const ex = new Set(c.map((i) => i.path));
          return [...c, ...added.filter((a) => !ex.has(a.path))];
        });
        setToolsOpen(false);
      })();
    };
    form.addEventListener("dragover", onDrag, true);
    form.addEventListener("drop", onDrop, true);
    (form as any).__drsaiDropOff = () => { form.removeEventListener("dragover", onDrag, true); form.removeEventListener("drop", onDrop, true); };
    return () => { (form as any).__drsaiDropOff?.(); };
  }, []);
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);
  const duplexStartButtonRef = useRef<HTMLButtonElement | null>(null);
  const duplexWasRunningRef = useRef(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const introPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!toolsOpen && !metaMenuOpen) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const shouldRestoreAttachmentFocus = toolsOpen;
      setToolsOpen(false);
      setMetaMenuOpen(null);
      if (shouldRestoreAttachmentFocus) {
        window.requestAnimationFrame(() => attachmentButtonRef.current?.focus());
      }
    };
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (toolsOpen && !toolsMenuRef.current?.contains(target)) {
        setToolsOpen(false);
      }
      if (metaMenuOpen) {
        // Only keep the active meta menu open when clicking its own chip/panel —
        // not the whole meta bar (voice controls / send would otherwise block dismiss).
        const inActiveMenu = target.closest(`[data-meta-menu="${metaMenuOpen}"]`);
        if (!inActiveMenu) setMetaMenuOpen(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [metaMenuOpen, toolsOpen]);

  useEffect(() => {
    if (!introMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (introPickerRef.current?.contains(event.target as Node)) return;
      setIntroMenuOpen(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setIntroMenuOpen(null);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [introMenuOpen]);

  useEffect(() => {
    const openModelPicker = (): void => {
      setConfigurationSection("model");
      setMetaMenuOpen("configuration");
    };
    window.addEventListener("drsai:open-model-picker", openModelPicker);
    return () => window.removeEventListener("drsai:open-model-picker", openModelPicker);
  }, []);

  useEffect(() => {
    setThinkingEffort(defaultThinkingEffort);
  }, [defaultThinkingEffort]);

  useEffect(() => {
    setTaskInteractionMode(defaultPlanMode);
  }, [defaultPlanMode]);

  useEffect(() => {
    setTaskInteractionMode(defaultPlanMode);
    setPrivateMode(false);
    setRespondedInputRequests(new Set());
    setInteractionDraft("");
    setForkQueueAgentSelections({});
    setPendingReplaceFromMessageId(null);
    editResendBackupRef.current = null;
  }, [conversationId, defaultPlanMode]);

  useEffect(() => {
    // Private Mode only exists for the local OpenDrSai Agent: switching to a
    // remote agent (or Codex) must clear it rather than leak a stale toggle.
    if (!agentOptions.some((agent) => agent.id === selectedAgentId && agent.source === "local" && agent.id !== "my-codex")) {
      setTaskInteractionMode("normal");
      setPrivateMode(false);
    }
  }, [agentOptions, selectedAgentId]);

  async function respondToAgentInput(
    request: NonNullable<UiMessage["inputRequest"]>,
    response: string | Record<string, unknown>,
    transportRequestId = request.requestId,
  ): Promise<void> {
    const turnId = activeInputMessage?.structuredTurn?.turnId;
    const runId = turnId?.startsWith("run-") ? turnId.split(":")[0] : undefined;
    const payload = typeof response === "string"
      ? response
      : {
          ...response,
          session_id: conversationId,
          ...(workspacePath ? { workspace_path: workspacePath } : {}),
          ...(runId ? { run_id: runId } : {}),
          ...(request.inputType === "approval" && !("approval_id" in response)
            ? { approval_id: request.requestId.startsWith("approval:")
              ? request.requestId.slice("approval:".length)
              : request.requestId }
            : {}),
          ...(request.inputType === "approval"
            && !("decision" in response)
            && typeof (response as { approved?: unknown }).approved === "boolean"
            ? { decision: (response as { approved: boolean }).approved ? "accept" : "decline" }
            : {}),
        };
    const dismissStaleRequest = () => {
      setRespondedInputRequests((current) => new Set(current).add(request.requestId));
    };
    try {
      const accepted = await desktopApi.respondChatInput(transportRequestId, payload);
      if (!accepted) {
        window.alert(language === "zh"
          ? "该批准已失效或运行已结束。已关闭批准框，你可以重新输入发送。"
          : "That approval is no longer active. The prompt was closed so you can type again.");
        dismissStaleRequest();
        return;
      }
      if (typeof payload === "object" && payload.decision === "revise") return;
      dismissStaleRequest();
    } catch (error) {
      window.alert(language === "zh"
        ? `提交批准失败：${error instanceof Error ? error.message : String(error)}\n已关闭批准框，你可以重新输入发送。`
        : `Approval submit failed: ${error instanceof Error ? error.message : String(error)}\nThe prompt was closed so you can type again.`);
      dismissStaleRequest();
    }
  }

  const respondToStructuredInteraction = useEventCallback((turnId: string, part: InteractionPart, response: InteractionResponse): void => {
    const runId = turnId.startsWith("run-") ? turnId.split(":")[0] : undefined;
    const payload = {
      ...response,
      session_id: conversationId,
      ...(workspacePath ? { workspace_path: workspacePath } : {}),
      ...(runId ? { run_id: runId } : {}),
      ...(part.interactionType === "approval" && !("approval_id" in response)
        ? {
            approval_id: part.requestId.startsWith("approval:")
              ? part.requestId.slice("approval:".length)
              : part.requestId,
          }
        : {}),
    };
    const dismissStaleRequest = () => {
      setRespondedInputRequests((current) => new Set(current).add(part.requestId));
      if (response.capabilityAction === "configured") {
        setConfiguredCapabilityRequests((current) => new Set(current).add(part.requestId));
      }
    };
    void desktopApi.respondChatInput(activeRequestId ?? turnId, payload).then((accepted) => {
      if (!accepted) {
        window.alert(language === "zh"
          ? "该批准已失效或运行已结束。已关闭批准框，你可以重新输入发送。"
          : "That approval is no longer active. The prompt was closed so you can type again.");
        dismissStaleRequest();
        return;
      }
      if (typeof payload === "object" && "decision" in payload && payload.decision === "revise") return;
      dismissStaleRequest();
    }).catch((error) => {
      window.alert(language === "zh"
        ? `提交批准失败：${error instanceof Error ? error.message : String(error)}\n已关闭批准框，你可以重新输入发送。`
        : `Approval submit failed: ${error instanceof Error ? error.message : String(error)}\nThe prompt was closed so you can type again.`);
      dismissStaleRequest();
    });
  });

  const requestStructuredTextInput = useEventCallback((turnId: string, part: InteractionPart): void => {
    const response = window.prompt(part.prompt);
    if (response?.trim()) respondToStructuredInteraction(turnId, part, { response: response.trim() });
  });

  function dismissActiveInputRequest(): void {
    if (!activeInputRequest) return;
    setRespondedInputRequests((current) => new Set(current).add(activeInputRequest.requestId));
  }

  function respondToActiveInput(response: string | Record<string, unknown>): void {
    if (!activeInputRequest || !activeInputMessage) return;
    const transportRequestId = activeRequestId
      ?? activeInputMessage.structuredTurn?.turnId
      ?? activeInputRequest.requestId;
    void respondToAgentInput(activeInputRequest, response, transportRequestId);
  }

  function submitInteractionDraft(): void {
    const response = interactionDraft.trim();
    if (!response) return;
    respondToActiveInput(response);
    setInteractionDraft("");
  }
  const shouldFollowOutputRef = useRef(true);
  // 粘性暂停：一旦检测到明确的用户向上滚动意图即置位，
  // 流式 token 触发的自动滚动/atBottom 判定不得自动解除，
  // 只有用户真正滚回最底部或点击“回到最新”才解锁。
  const userPausedRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const [smoothFollowOutput] = useState(() => createSmoothFollowOutputController({
    scrollToBottom: (behavior) => {
      const list = messageListRef.current;
      if (list) list.scrollTo({ top: Math.max(0, list.scrollHeight - list.clientHeight), behavior });
    },
    stopScrolling: (scrollTop) => messageListRef.current?.scrollTo({ top: scrollTop, behavior: "auto" }),
  }));
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRetryBlobRef = useRef<Blob | null>(null);
  const voiceRetryDurationRef = useRef(0);
  const voiceSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const voiceCaptureDiagnosticRef = useRef<{ failureRecorded: boolean; startedAt: number; traceId: string } | null>(null);
  const voicePlaybackDiagnosticRef = useRef<{ messageId: string; startedAt: number; traceId: string } | null>(null);
  const voiceResponseBaselineRef = useRef<Set<string>>(new Set());
  const voiceTtsRequestIdRef = useRef<string | null>(null);
  const voiceAutoSubmitRequestRef = useRef<string | null>(null);
  const autoReadInitializedRef = useRef(false);
  const lastAutoReadMessageIdRef = useRef<string | null>(null);
  const zh = language === "zh";
  const activeInputMessage = useMemo(
    () => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.inputRequest && !respondedInputRequests.has(message.inputRequest.requestId)) return message;
      }
      return null;
    },
    [messages, respondedInputRequests],
  );
  const activeInputRequest = activeInputMessage?.inputRequest ?? null;
  const activeGoalConfirmation = activeInputRequest?.inputType === "confirmation"
    && activeInputRequest.requestId.startsWith("goal:")
    ? activeInputRequest
    : null;
  const [goalConfirmationEditing, setGoalConfirmationEditing] = useState(false);
  const [goalConfirmationDraft, setGoalConfirmationDraft] = useState<GoalConfirmationDraft>(() =>
    parseGoalConfirmationPrompt(activeGoalConfirmation?.prompt ?? ""));

  useEffect(() => {
    setInteractionDraft(activeInputRequest?.defaultValue ?? "");
  }, [activeInputRequest?.requestId, activeInputRequest?.defaultValue]);

  useEffect(() => {
    setGoalConfirmationEditing(false);
    setGoalConfirmationDraft(parseGoalConfirmationPrompt(activeGoalConfirmation?.prompt ?? ""));
  }, [activeGoalConfirmation?.requestId, activeGoalConfirmation?.prompt]);
  const hasStreamingMessage = useMemo(() => messages.some((message) => message.streaming), [messages]);
  const showStop = Boolean(activeRequestId || hasStreamingMessage);

  // Leftover approval cards from timed-out/failed runs block the composer.
  // When nothing is actively streaming, close them so the user can type again.
  useEffect(() => {
    if (showStop || !activeInputRequest || activeGoalConfirmation) return;
    if (activeInputRequest.inputType !== "approval") return;
    const requestId = activeInputRequest.requestId;
    setRespondedInputRequests((current) => {
      if (current.has(requestId)) return current;
      return new Set(current).add(requestId);
    });
  }, [
    activeGoalConfirmation,
    activeInputRequest?.inputType,
    activeInputRequest?.requestId,
    showStop,
  ]);

  const emptyChat = useMemo(() => messages.every((message) => message.id === "welcome"), [messages]);
  const conversationMessages = useMemo(
    () => messages.filter((message) => message.id !== "welcome"),
    [messages],
  );
  const duplexHistoryMessages = useMemo<UiMessage[]>(() => duplexVoiceInput.history.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    statusContent: message.interrupted
      ? (zh ? `已听到：${message.heardContent || "（未完整播放）"}` : `Heard: ${message.heardContent || "(not fully played)"}`)
      : undefined,
    ...(message.interrupted ? { statusContent: zh ? (message.heardContent ? `播放已中断，已听到：${message.heardContent}` : `播放在约 ${Math.round(message.voice.playedAudioMs ?? 0)} 毫秒处中断；无法确定精确听到的文字。`) : interruptedVoiceStatus(message.voice) } : {}),
  })), [duplexVoiceInput.history, zh]);
  const visibleMessages = useMemo(() => {
    const existing = new Set(conversationMessages.map((message) => message.id));
    return [...conversationMessages, ...duplexHistoryMessages.filter((message) => !existing.has(message.id))];
  }, [conversationMessages, duplexHistoryMessages]);
  const renderedMessages = useMemo(
    () => visibleMessages.filter((message) => !isEmptyAssistantShell(message)),
    [visibleMessages],
  );
  const turnRailMarkers = useMemo(
    () => visibleMessages
      .filter((message) => message.role === "user")
      .map((message) => ({ id: message.id })),
    [visibleMessages],
  );
  const canSaveLocalPreference = canHandleMemoryRequestLocally(input);
  const canAnswerMaterialInventoryLocally = Boolean(materialRoleAnalysis?.items.length) && isMaterialInventoryQuestion(input);
  const canAnswerMaterialQuestionLocally = Boolean(materialRoleAnalysis?.items.length) && isNaturalMaterialQuestion(input);
  const emptyChatPreferenceNotice = emptyChat
    ? messages.find((message) => message.id === "welcome")?.content.split("\n\n").slice(1).join("\n\n").trim() || ""
    : "";
  const activeAgent = useMemo(() => agentOptions.find((agent) => agent.id === selectedAgentId), [agentOptions, selectedAgentId]);
  const activeAgentName = selectedAgentName?.trim() || activeAgent?.name || "OpenDrSai";
  const isLocalOpenDrSaiAgent = useMemo(() => agentOptions.some(
    (agent) => agent.id === selectedAgentId && agent.source === "local" && agent.id !== "my-codex",
  ), [agentOptions, selectedAgentId]);
  const remoteAgentSkills = useMemo(() => (isRemoteAgent ? activeAgent?.remoteSkills ?? [] : []), [activeAgent, isRemoteAgent]);
  const [selectedRemoteSkillId, setSelectedRemoteSkillId] = useState<string | null>(null);
  const selectedRemoteSkill = remoteAgentSkills.find((skill) => skill.id === selectedRemoteSkillId) ?? null;
  useEffect(() => {
    // Reset the remote skill selection whenever the selected Agent changes so
    // a remote {id, source} never leaks into another Agent's session.
    setSelectedRemoteSkillId(null);
    setSelectedSquareSkill(null);
  }, [selectedAgentId]);
  const workspaceLocationLabel =
    workspaceLocation === "remote"
      ? zh
        ? "远程工作区"
        : "Remote workspace"
      : zh
        ? "本机工作区"
        : "Local workspace";
  const runtimeModeLabel = currentRuntimeMode
    ? currentRuntimeMode.intent
      ? `${currentRuntimeMode.label}: ${currentRuntimeMode.intent}`
      : currentRuntimeMode.label
    : "";
  const activeModelName =
    getModelLabel(modelOptions, selectedModelName, selectedModelProviderId) || selectedModelName?.trim() || (zh ? "默认" : "Default");
  const activeImageGenerationModelName =
    getModelLabel(imageGenerationModelOptions, selectedImageGenerationModelName, selectedImageGenerationProviderId)
    || selectedImageGenerationModelName?.trim()
    || (zh ? "默认" : "Default");
  const compactModelName = getCompactComposerModelLabel(activeModelName);
  const activeModelConfig = useMemo(
    () => findSelectedModelConfig(modelOptions, selectedModelName, selectedModelProviderId),
    [modelOptions, selectedModelName, selectedModelProviderId],
  );
  const supportedThinkingEfforts = useMemo<ThinkingEffort[]>(() => {
    if (isRemoteAgent) return [];
    if (!isLocalOpenDrSaiAgent) return THINKING_EFFORTS;
    if (!activeModelConfig?.operations?.includes("reasoning")) return [];
    const configured = activeModelConfig.reasoning_efforts ?? [];
    return THINKING_EFFORTS.filter((effort) => configured.includes(effort));
  }, [activeModelConfig, isLocalOpenDrSaiAgent]);
  useEffect(() => {
    if (supportedThinkingEfforts.length === 0) return;
    if (!supportedThinkingEfforts.includes(thinkingEffort)) {
      setThinkingEffort(supportedThinkingEfforts[0]);
    }
  }, [supportedThinkingEfforts, thinkingEffort]);
  const showThinkingEffort = supportedThinkingEfforts.length > 0;
  useEffect(() => {
    if (!showThinkingEffort && configurationSection === "thinking") {
      setConfigurationSection(null);
    }
  }, [configurationSection, showThinkingEffort]);
  const thinkingEffortSupported = supportedThinkingEfforts.includes(thinkingEffort);
  const thinkingEffortLabel = getThinkingEffortLabel(
    thinkingEffortSupported ? thinkingEffort : supportedThinkingEfforts[0] ?? thinkingEffort,
    zh,
  );
  const thinkingEffortMenuLabel = showThinkingEffort
    ? thinkingEffortLabel
    : (zh ? "当前模型不支持" : "Not supported by this model");
  const taskInteractionModeLabel = taskInteractionMode === "plan"
    ? (zh ? "计划" : "Plan")
    : (zh ? "常规" : "Normal");
  const composerConfigurationSummary = [
    activeAgentName,
    // Private Mode overrides the model for the turn, so the collapsed summary
    // has to say so; otherwise it would keep naming a model that is ignored.
    ...(privateMode ? [zh ? "私密模式" : "Private mode"] : []),
    compactModelName,
    ...(showThinkingEffort ? [thinkingEffortLabel] : []),
    taskInteractionModeLabel,
  ].join(" · ");
  const hasAgentOptions = agentOptions.length > 0;
  const hasModelOptions = modelOptions.length > 0;
  const hasImageGenerationModelOptions = imageGenerationModelOptions.length > 0;
  const parsedSamplePrompts = useMemo(
    () => parseCatalogAgentExamples(samplePrompts, language),
    [samplePrompts, language],
  );
  const emptyChatPrompts = useMemo(
    () => getAgentEmptyChatPrompts(parsedSamplePrompts, language),
    [parsedSamplePrompts, language],
  );
  const activeWorkspaceName = workspaceName?.trim() || getWorkspaceDisplayName(workspacePath, zh);
  const normalizedIntroSearch = introSearchQuery.trim().toLocaleLowerCase();
  const filteredIntroWorkspaces = useMemo(() => workspaceOptions.filter((workspace) =>
    !normalizedIntroSearch
      || workspace.name.toLocaleLowerCase().includes(normalizedIntroSearch)
      || workspace.path.toLocaleLowerCase().includes(normalizedIntroSearch),
  ), [workspaceOptions, normalizedIntroSearch]);
  const filteredIntroAgents = useMemo(() => agentOptions.filter((agent) =>
    !normalizedIntroSearch
      || agent.name.toLocaleLowerCase().includes(normalizedIntroSearch)
      || getAgentOptionMeta(agent, zh).toLocaleLowerCase().includes(normalizedIntroSearch),
  ), [agentOptions, normalizedIntroSearch, zh]);
  const slashCommandQuery = input.trimStart().startsWith("/")
    ? input.trimStart().slice(1).toLowerCase()
    : "";
  const slashCommandMatches = useMemo(
    () =>
      slashCommandQuery
        ? CHAT_COMMAND_NAMES.filter((name) => name.startsWith(slashCommandQuery))
        : CHAT_COMMAND_NAMES,
    [slashCommandQuery],
  );
  const showSlashCommands = input.trimStart().startsWith("/") && slashCommandMatches.length > 0;
  const forkQueueEntries = useMemo(
    () => parseForkQueueEntries(getForkQueueCommandArgs(input)),
    [input],
  );
  const showForkQueueAgentPanel =
    /^\/fork\s+queue\b/i.test(input.trimStart()) &&
    forkQueueEntries.length > 1 &&
    hasAgentOptions;
  const inlineMentionAttachments = useMemo(
    () => parseInlineContextMentions(input, workspacePath),
    [input, workspacePath],
  );
  const materialRoleByPath = useMemo(
    () => createMaterialRoleLookup(materialRoleAnalysis?.items || []),
    [materialRoleAnalysis],
  );
  const materialTaskSuggestions = useMemo(
    () => createMaterialTaskSuggestions(materialRoleAnalysis, zh),
    [materialRoleAnalysis, zh],
  );
  const queuedContextAttachments = useMemo(
    () =>
      mergeUniqueAttachments([
        ...attachments.map(({ id: _id, importFile: _importFile, folderImport: _folderImport, ...attachment }) =>
          enrichAttachmentWithMaterialRole(attachment, findMaterialRole(materialRoleByPath, attachment))),
        ...externalAttachments,
        ...inlineMentionAttachments,
      ]).filter((attachment) => !attachment.blockedReason),
    [attachments, externalAttachments, inlineMentionAttachments, materialRoleByPath],
  );
  const contextPreviewItems = useMemo(
    () => createContextPreviewItems(queuedContextAttachments, workspaceInstructions),
    [queuedContextAttachments, workspaceInstructions],
  );
  const contextBudget = useMemo(
    () => estimateContextBudget(contextPreviewItems, activeModelConfig),
    [contextPreviewItems, activeModelConfig],
  );
  const showContextPreview = contextPreviewItems.length > 0;
  const canAttachIdeCurrentFile = Boolean(ideContext?.currentFile);
  const canAttachIdeCurrentSelection = Boolean(ideContext?.currentSelection);
  const voiceApiAvailable =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== "undefined" &&
    "MediaRecorder" in window;
  const showVoiceCaptureBar =
    voiceState === "requesting_permission" ||
    voiceState === "recording";
  const showDuplexVoiceCaptureBar = ["starting", "active", "stopping", "recovering"].includes(duplexVoiceInput.phase);
  const showAnyVoiceCaptureBar = showVoiceCaptureBar || voiceState === "processing" || showDuplexVoiceCaptureBar;
  const displayedVoicePhase = voicePreferences.interactionMode === "duplex"
    ? duplexVoiceInput.phase
    : voiceTurnState.phase;
  const latestCompletedAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === "assistant" && !message.streaming && !message.error && getAssistantDisplayContent(message)) {
        return message;
      }
    }
    return undefined;
  }, [messages]);
  const latestCompletedAssistantSpeechText = latestCompletedAssistantMessage
    ? getAssistantDisplayContent(latestCompletedAssistantMessage)
    : "";

  useEffect(() => {
    voicePlayback.stop();
    stopVoiceCapture("discard");
    void duplexVoiceInput.cancel();
    cancelVoiceTranscriptionTask();
    setVoiceReviewText(null);
    setVoiceRuntimeDisclosure(null);
    setVoiceConsentRequired(false);
    voiceRetryBlobRef.current = null;
    voiceRetryDurationRef.current = 0;
    voiceAutoSubmitRequestRef.current = null;
    if (voiceRecordingProcessTimerRef.current !== null) {
      window.clearTimeout(voiceRecordingProcessTimerRef.current);
      voiceRecordingProcessTimerRef.current = null;
    }
    autoReadInitializedRef.current = !conversationHistoryPending;
    lastAutoReadMessageIdRef.current = conversationHistoryPending ? null : latestCompletedAssistantMessage?.id ?? null;
    dispatchVoiceTurn({ type: "cancel" });
    dispatchVoiceTurn({ type: "cancelled" });
    dispatchVoiceTurn({ type: "reset" });
  }, [conversationHistoryPending, conversationId]);

  useEffect(() => {
    const stopVoiceActivityForLifecycle = (event?: Event): void => {
      if (event?.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      voicePlayback.stop();
      stopVoiceCapture("discard");
      void duplexVoiceInput.cancel();
      cancelVoiceTranscriptionTask();
      dispatchVoiceTurn({ type: "cancel" });
      dispatchVoiceTurn({ type: "cancelled" });
    };
    document.addEventListener("visibilitychange", stopVoiceActivityForLifecycle);
    window.addEventListener("pagehide", stopVoiceActivityForLifecycle);
    window.addEventListener("offline", stopVoiceActivityForLifecycle);
    return () => {
      document.removeEventListener("visibilitychange", stopVoiceActivityForLifecycle);
      window.removeEventListener("pagehide", stopVoiceActivityForLifecycle);
      window.removeEventListener("offline", stopVoiceActivityForLifecycle);
    };
  }, [cancelVoiceTranscriptionTask, stopVoiceCapture, voicePlayback.stop]);

  useEffect(() => {
    if (voiceState === "recording" && !voiceCaptureDiagnosticRef.current) {
      const traceId = crypto.randomUUID();
      voiceCaptureDiagnosticRef.current = { failureRecorded: false, startedAt: Date.now(), traceId };
      void recordVoiceDiagnostic({
        traceId,
        component: "capture",
        operation: "voice.capture",
        message: "Voice capture started",
        status: "started",
        attributes: { selectedDevice: Boolean(voiceDeviceId) },
      });
      return;
    }
    const active = voiceCaptureDiagnosticRef.current;
    if (!active || voiceState === "recording" || voiceState === "requesting_permission") return;
    voiceCaptureDiagnosticRef.current = null;
    if (voiceState === "failed" && active.failureRecorded) return;
    void recordVoiceDiagnostic({
      traceId: active.traceId,
      component: "capture",
      operation: "voice.capture",
      message: voiceState === "failed" ? (voiceError || "Voice capture failed") : "Voice capture completed",
      domain: "app",
      kind: voiceState === "failed" ? "error" : "operation",
      level: voiceState === "failed" ? "error" : "info",
      status: voiceState === "failed" ? "failed" : "completed",
      errorCode: voiceState === "failed" ? "capture_error" : undefined,
      durationMs: Date.now() - active.startedAt,
    });
  }, [voiceDeviceId, voiceError, voiceState]);

  useEffect(() => {
    const activeMessageId = voicePlayback.activeMessageId;
    if (activeMessageId && voicePlayback.phase !== "idle" && voicePlayback.phase !== "failed" && !voicePlaybackDiagnosticRef.current) {
      const traceId = crypto.randomUUID();
      voicePlaybackDiagnosticRef.current = { messageId: activeMessageId, startedAt: Date.now(), traceId };
      void recordVoiceDiagnostic({
        traceId,
        component: "playback",
        operation: "voice.playback",
        message: "Voice playback started",
        status: "started",
      });
      return;
    }
    const active = voicePlaybackDiagnosticRef.current;
    if (!active || (activeMessageId === active.messageId && voicePlayback.phase !== "idle" && voicePlayback.phase !== "failed")) return;
    voicePlaybackDiagnosticRef.current = null;
    void recordVoiceDiagnostic({
      traceId: active.traceId,
      component: "playback",
      operation: "voice.playback",
      message: voicePlayback.phase === "failed" ? voicePlayback.error || "Voice playback failed" : "Voice playback completed",
      status: voicePlayback.phase === "failed" ? "failed" : "completed",
      errorCode: voicePlayback.phase === "failed" ? "playback_error" : undefined,
      durationMs: Date.now() - active.startedAt,
      attributes: voicePlayback.phase === "failed" && voicePlayback.error ? { playbackError: voicePlayback.error } : undefined,
    });
  }, [voicePlayback.activeMessageId, voicePlayback.error, voicePlayback.phase]);

  useEffect(() => {
    if (conversationHistoryPending) return;
    if (!autoReadInitializedRef.current) {
      autoReadInitializedRef.current = true;
      lastAutoReadMessageIdRef.current = latestCompletedAssistantMessage?.id ?? null;
      return;
    }
    if (!latestCompletedAssistantMessage || lastAutoReadMessageIdRef.current === latestCompletedAssistantMessage.id) return;
    lastAutoReadMessageIdRef.current = latestCompletedAssistantMessage.id;
    if (!voicePreferences.autoReadResponses || showAnyVoiceCaptureBar) return;
    voicePlayback.play(
      latestCompletedAssistantMessage.id,
      latestCompletedAssistantSpeechText,
      zh ? "zh" : "en",
      { mode: resolveVoiceSynthesisMode(voicePreferences.synthesisMode, voicePreferences.remoteTtsConsent), rate: voicePreferences.playbackRate, voiceName: voicePreferences.voiceName },
    );
  }, [
    latestCompletedAssistantMessage?.id,
    latestCompletedAssistantSpeechText,
    conversationHistoryPending,
    showAnyVoiceCaptureBar,
    voicePlayback.play,
    voicePreferences.autoReadResponses,
    voicePreferences.playbackRate,
    voicePreferences.remoteTtsConsent,
    voicePreferences.synthesisMode,
    voicePreferences.voiceName,
    zh,
  ]);

  useEffect(() => {
    if (!voicePlayback.activeMessageId) return;
    if (messages.some((message) => message.id === voicePlayback.activeMessageId)) return;
    voicePlayback.stop();
  }, [messages, voicePlayback.activeMessageId, voicePlayback.stop]);

  useEffect(() => {
    if (voiceTurnState.phase !== "awaiting_response") return;
    const response = [...messages].reverse().find((message) =>
      message.role === "assistant"
      && !message.streaming
      && !message.error
      && (!voiceTurnState.expectedResponseMessageId || message.id === voiceTurnState.expectedResponseMessageId)
      && !voiceResponseBaselineRef.current.has(message.id)
      && Boolean(getAssistantDisplayContent(message)));
    if (response) dispatchVoiceTurn({ type: "response_completed", messageId: response.id });
  }, [messages, voiceTurnState.expectedResponseMessageId, voiceTurnState.phase]);

  useEffect(() => {
    if (voiceTurnState.phase !== "ready_to_send") return;
    if (!voiceTurnState.sttRequestId || voiceAutoSubmitRequestRef.current !== voiceTurnState.sttRequestId) return;
    const timer = window.setTimeout(() => {
      voiceAutoSubmitRequestRef.current = null;
      void submitWithAttachments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [input, voiceTurnState.phase, voiceTurnState.sttRequestId]);

  useEffect(() => {
    const phase = voiceTurnState.phase;
    if (phase === "response_ready" && !voicePreferences.autoReadResponses) {
      const timer = window.setTimeout(() => dispatchVoiceTurn({ type: "finish" }), 0);
      return () => window.clearTimeout(timer);
    }
    const isOwnedPlayback = Boolean(
      voiceTurnState.responseMessageId
      && voicePlayback.activeMessageId === voiceTurnState.responseMessageId,
    );
    if (phase === "response_ready" && isOwnedPlayback) {
      const requestId = `voice-tts-${crypto.randomUUID()}`;
      voiceTtsRequestIdRef.current = requestId;
      dispatchVoiceTurn({ type: "tts_started", requestId });
      return;
    }
    if (phase === "synthesizing" && isOwnedPlayback && voicePlayback.phase === "playing") {
      const requestId = voiceTtsRequestIdRef.current;
      if (requestId) dispatchVoiceTurn({ type: "tts_completed", requestId });
      dispatchVoiceTurn({ type: "play" });
      return;
    }
    if (phase === "playing" && voicePlayback.phase === "paused") {
      dispatchVoiceTurn({ type: "pause" });
      return;
    }
    if (phase === "paused" && voicePlayback.phase === "playing") {
      dispatchVoiceTurn({ type: "resume" });
      return;
    }
    if ((phase === "playing" || phase === "paused") && voicePlayback.phase === "idle") {
      dispatchVoiceTurn({ type: "finish" });
      return;
    }
    if ((phase === "synthesizing" || phase === "playing" || phase === "paused") && voicePlayback.phase === "failed") {
      dispatchVoiceTurn({
        type: "fail",
        error: {
          stage: phase,
          code: "playback_error",
          message: voicePlayback.error || "Voice playback failed.",
          retryable: true,
        },
      });
    }
    return undefined;
  }, [
    voicePlayback.activeMessageId,
    voicePlayback.error,
    voicePlayback.phase,
    voicePreferences.autoReadResponses,
    voiceTurnState.phase,
    voiceTurnState.responseMessageId,
  ]);

  const searchableMessages = useMemo(
    () => messages.filter((message) => {
      if (getVisibleChatText(message.content)) return true;
      return Boolean(message.structuredTurn && getStructuredTurnEstimateText(message.structuredTurn));
    }),
    [messages],
  );

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchableMessages
      .filter((message) => {
        if (getVisibleChatText(message.content).toLowerCase().includes(query)) return true;
        if (!message.structuredTurn) return false;
        return getStructuredTurnEstimateText(message.structuredTurn).toLowerCase().includes(query);
      })
      .map((message) => message.id);
  }, [searchQuery, searchableMessages]);
  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

  const activeMatchId =
    searchMatches.length > 0
      ? searchMatches[activeMatchIndex % searchMatches.length]
      : null;

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  useEffect(() => {
    const paths = [...new Set(attachments
      .filter((item) => item.kind === "file" && !item.blockedReason)
      .map((item) => item.path))];
    const requestId = materialRoleRequestRef.current + 1;
    materialRoleRequestRef.current = requestId;
    if (!paths.length || !hasDesktopApi() || typeof desktopApi.analyzeMaterialRoles !== "function") {
      setMaterialRoleAnalysis(null);
      setMaterialRolePhase("idle");
      return;
    }
    setMaterialRolePhase("analyzing");
    void desktopApi.analyzeMaterialRoles({ paths }).then((result) => {
      if (materialRoleRequestRef.current !== requestId) return;
      setMaterialRoleAnalysis(result);
      setMaterialRolePhase("ready");
    }).catch(() => {
      if (materialRoleRequestRef.current !== requestId) return;
      setMaterialRoleAnalysis(null);
      setMaterialRolePhase("failed");
    });
  }, [attachments]);

  useEffect(() => {
    const paths = [...new Set(attachments
      .filter((item) => item.kind === "file" && !item.blockedReason)
      .map((item) => item.path))];
    const requestId = materialConsistencyRequestRef.current + 1;
    materialConsistencyRequestRef.current = requestId;
    setMaterialConsistencySourceStatus("");
    if (paths.length < 2 || !hasDesktopApi() || typeof desktopApi.analyzeMaterialConsistency !== "function") {
      setMaterialConsistencyAnalysis(null);
      setMaterialConsistencyPhase("idle");
      return;
    }
    setMaterialConsistencyPhase("analyzing");
    void desktopApi.analyzeMaterialConsistency({ paths }).then((result) => {
      if (materialConsistencyRequestRef.current !== requestId) return;
      setMaterialConsistencyAnalysis(result);
      setMaterialConsistencyPhase("ready");
    }).catch(() => {
      if (materialConsistencyRequestRef.current !== requestId) return;
      setMaterialConsistencyAnalysis(null);
      setMaterialConsistencyPhase("failed");
    });
  }, [attachments]);

  useEffect(() => {
    setForkQueueAgentSelections((current) => {
      if (!forkQueueEntries.length) return {};
      const allowed = new Set(forkQueueEntries.map((_entry, index) => index + 1));
      const next = Object.fromEntries(
        Object.entries(current).filter(([index, agentId]) => allowed.has(Number(index)) && agentId),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [forkQueueEntries]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchDate("");
    setActiveMatchIndex(0);
  }, []);

  function locateConversationDate(value: string): void {
    setSearchDate(value);
    if (!value) return;
    const start = new Date(`${value}T00:00:00`).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    const match = conversationMessages.find((message) => {
      const at = message.startedAt ?? message.lastEventAt ?? 0;
      return at >= start && at < end;
    });
    if (!match) return;
    window.requestAnimationFrame(() => document.querySelector(`[data-message-id="${match.id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  const selectNextMatch = useCallback(() => {
    setActiveMatchIndex((current) =>
      searchMatches.length > 0 ? (current + 1) % searchMatches.length : 0,
    );
  }, [searchMatches.length]);

  const selectPreviousMatch = useCallback(() => {
    setActiveMatchIndex((current) =>
      searchMatches.length > 0
        ? (current - 1 + searchMatches.length) % searchMatches.length
        : 0,
    );
  }, [searchMatches.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "40px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 116)}px`;
  }, [input]);

  useEffect(() => {
    const composer = composerRef.current;
    const messageList = messageListRef.current;
    if (!composer || !messageList || emptyChat) return;
    const chatPane = messageList.parentElement;
    const updateComposerHeight = (): void => {
      const height = `${composer.offsetHeight}px`;
      messageList.style.setProperty("--chat-composer-height", height);
      chatPane?.style.setProperty("--chat-composer-height", height);
      if (shouldFollowOutputRef.current && !userPausedRef.current) {
        window.requestAnimationFrame(() => scrollMessageListToLatest("auto"));
      }
    };
    let frame = window.requestAnimationFrame(updateComposerHeight);
    const scheduleComposerHeight = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateComposerHeight);
    };
    const observer = new ResizeObserver(scheduleComposerHeight);
    observer.observe(composer);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      messageList.style.removeProperty("--chat-composer-height");
      chatPane?.style.removeProperty("--chat-composer-height");
    };
  }, [emptyChat]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!activeMatchId) return;
    const reveal = () => document.querySelector(`[data-message-id="${activeMatchId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    reveal();
  }, [activeMatchId]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    if (searchRequestNonce <= 0) return;
    openSearch();
  }, [openSearch, searchRequestNonce]);

  useEffect(() => {
    if (!messageFocus?.messageId) return;
    const reveal = () => {
      const selector = `[data-message-id="${CSS.escape(messageFocus.messageId)}"]`;
      messageListRef.current?.querySelector<HTMLElement>(selector)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    };
    window.requestAnimationFrame(reveal);
    window.setTimeout(reveal, 120);
  }, [messageFocus]);

  useEffect(() => {
    if (!structuredTurnFocus) return;
    setHighlightedTurnId(structuredTurnFocus.turnId);
    shouldFollowOutputRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const selector = `[data-structured-turn-id="${CSS.escape(structuredTurnFocus.turnId)}"]`;
      messageListRef.current?.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const timer = window.setTimeout(() => setHighlightedTurnId(null), 1800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [structuredTurnFocus]);

  useEffect(() => {
    function handleWorkflowChatCommand(event: Event): void {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const command = (detail as { command?: unknown }).command;
      if (typeof command !== "string" || !command.trim()) return;
      applyComposerText(command.trim());
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }

    window.addEventListener("drsai:workflow-chat-command", handleWorkflowChatCommand);
    return () => {
      window.removeEventListener(
        "drsai:workflow-chat-command",
        handleWorkflowChatCommand,
      );
    };
  }, [onInputChange]);

  function getMessageListMaxScrollTop(list: HTMLDivElement): number {
    return Math.max(0, list.scrollHeight - list.clientHeight);
  }

  function isMessageListAtBottom(list: HTMLDivElement): boolean {
    return getMessageListMaxScrollTop(list) - list.scrollTop <= AT_BOTTOM_TOLERANCE;
  }

  function syncAwayFromLatestFromScroll(list: HTMLDivElement): void {
    const atBottom = isMessageListAtBottom(list);
    setAwayFromLatest((current) => (current === !atBottom ? current : !atBottom));
  }

  function scrollMessageListToLatest(behavior: ScrollBehavior = "auto"): void {
    const list = messageListRef.current;
    if (!list) return;
    const target = getMessageListMaxScrollTop(list);
    programmaticScrollRef.current = true;
    list.scrollTo({ top: target, behavior });
    // Schedule a safety-net clear. For instant (auto) scrolls, the flag is
    // normally cleared by handleMessageListScroll when the scroll event
    // fires and we're at the bottom. The timeout handles edge cases where
    // the scroll event doesn't fire or we're already at the target.
    // For smooth scrolls, use a longer timeout to cover the animation.
    const timeout = behavior === "auto" ? 200 : 1200;
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollTimerRef.current = null;
      programmaticScrollRef.current = false;
    }, timeout);
  }

  useEffect(() => {
    if (!messageListRef.current) return;
    if (!shouldFollowOutputRef.current || userPausedRef.current) {
      syncAwayFromLatestFromScroll(messageListRef.current);
      return;
    }
    if (!hasStreamingMessage) {
      // Terminal rendering can replace the streaming Markdown tree and collapse
      // reasoning, both of which change the message height. A smooth scroll
      // started before those layouts settle fights the ResizeObserver and can
      // keep retargeting for hundreds of milliseconds. Wait two frames for the
      // terminal DOM to settle, then perform one deterministic jump.
      let settleFrame = 0;
      const layoutFrame = window.requestAnimationFrame(() => {
        settleFrame = window.requestAnimationFrame(() => {
          if (shouldFollowOutputRef.current && !userPausedRef.current) scrollMessageListToLatest("auto");
        });
      });
      return () => {
        window.cancelAnimationFrame(layoutFrame);
        if (settleFrame) window.cancelAnimationFrame(settleFrame);
      };
    }
    // During streaming, directly scroll to the latest content on every
    // messages update. Use auto (not smooth) for immediate tracking and
    // defer to the next animation frame so the DOM has been laid out.
    const frame = window.requestAnimationFrame(() => {
      if (shouldFollowOutputRef.current && !userPausedRef.current && messageListRef.current) {
        scrollMessageListToLatest("auto");
      }
    });
    smoothFollowOutput.handleHeightChange(messageListRef.current.scrollHeight);
    return () => window.cancelAnimationFrame(frame);
  }, [hasStreamingMessage, messages, smoothFollowOutput]);

  useEffect(() => () => smoothFollowOutput.dispose(), [smoothFollowOutput]);

  useEffect(() => {
    const list = messageListRef.current;
    const lastMessage = list?.lastElementChild;
    if (!list || !lastMessage) return undefined;
    const observer = new ResizeObserver(() => {
      if (!shouldFollowOutputRef.current || userPausedRef.current) {
        // Content grew/shrank while the user is paused — keep the jump button
        // in sync with the real distance from the latest messages.
        if (messageListRef.current) syncAwayFromLatestFromScroll(messageListRef.current);
        smoothFollowOutput.handleHeightChange(list.scrollHeight);
        return;
      }
      // Direct scroll on height change — more reliable than handleHeightChange
      // which may be gated by controller state (pendingFrame, following, etc.)
      window.requestAnimationFrame(() => {
        if (shouldFollowOutputRef.current && !userPausedRef.current && messageListRef.current) {
          scrollMessageListToLatest("auto");
        }
      });
      smoothFollowOutput.handleHeightChange(list.scrollHeight);
    });
    observer.observe(lastMessage);
    smoothFollowOutput.handleHeightChange(list.scrollHeight);
    return () => observer.disconnect();
  }, [visibleMessages.at(-1)?.id, smoothFollowOutput]);

  useEffect(() => () => {
    if (programmaticScrollTimerRef.current !== null) window.clearTimeout(programmaticScrollTimerRef.current);
  }, []);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || emptyChat) {
      setActiveTurnRailId(null);
      return undefined;
    }
    const visibleTurns = new Map<string, IntersectionObserverEntry>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageId;
        if (!id) continue;
        if (entry.isIntersecting) visibleTurns.set(id, entry);
        else visibleTurns.delete(id);
      }
      if (turnRailNavigationTargetRef.current || visibleTurns.size === 0) return;
      const center = list.getBoundingClientRect().top + list.clientHeight / 2;
      const nearest = [...visibleTurns.entries()].reduce<{ id: string; distance: number } | null>((best, [id, entry]) => {
        const entryCenter = entry.boundingClientRect.top + entry.boundingClientRect.height / 2;
        const distance = Math.abs(entryCenter - center);
        return !best || distance < best.distance ? { id, distance } : best;
      }, null);
      if (nearest) setActiveTurnRailId((current) => current === nearest.id ? current : nearest.id);
    }, { root: list, threshold: [0, 0.01, 0.5, 1] });
    list.querySelectorAll<HTMLElement>(".message.user[data-message-id]").forEach((message) => observer.observe(message));
    return () => {
      observer.disconnect();
    };
  }, [emptyChat, visibleMessages]);

  function scrollToUserTurn(messageId: string): void {
    const list = messageListRef.current;
    if (!list) return;
    const selector = `.message.user[data-message-id="${CSS.escape(messageId)}"]`;
    if (!list.querySelector(selector)) return;
    shouldFollowOutputRef.current = false;
    smoothFollowOutput.pause();
    turnRailNavigationTargetRef.current = messageId;
    if (turnRailNavigationTimerRef.current !== null) {
      window.clearTimeout(turnRailNavigationTimerRef.current);
    }
    setActiveTurnRailId(messageId);
    // 未渲染的消息是估算高度的占位符，offsetTop 可能严重漂移：
    // 先瞬移到估算位置触发目标渲染，再分阶段用最新 offsetTop 校正。
    const scrollToTarget = () => {
      const container = messageListRef.current;
      const target = container?.querySelector<HTMLElement>(selector);
      if (!container || !target) return;
      container.scrollTo({ top: Math.max(0, target.offsetTop - 18), behavior: "auto" });
    };
    scrollToTarget();
    window.requestAnimationFrame(scrollToTarget);
    window.setTimeout(scrollToTarget, 120);
    window.setTimeout(scrollToTarget, 400);
    turnRailNavigationTimerRef.current = window.setTimeout(() => {
      turnRailNavigationTargetRef.current = null;
      turnRailNavigationTimerRef.current = null;
    }, 900);
  }

  useEffect(() => () => {
    if (turnRailNavigationTimerRef.current !== null) {
      window.clearTimeout(turnRailNavigationTimerRef.current);
    }
  }, []);

  function handleTurnRailKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const nextIndex = resolveTurnRailNavigationIndex(
      currentIndex,
      turnRailMarkers.length,
      event.key as TurnRailNavigationKey,
    );
    if (nextIndex === null) return;
    const nextMarker = turnRailMarkers[nextIndex];
    if (!nextMarker) return;
    event.preventDefault();
    scrollToUserTurn(nextMarker.id);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[data-turn-id]");
    buttons?.[nextIndex]?.focus();
  }

  function handleMessageListScroll(): void {
    const list = messageListRef.current;
    if (!list) return;
    const maxScrollTop = getMessageListMaxScrollTop(list);
    const atBottom = isMessageListAtBottom(list);
    // If this scroll was triggered by our own programmatic scrollTo, don't
    // treat it as user intent. Just sync state.
    if (programmaticScrollRef.current) {
      // Check if we've reached the bottom — re-enable follow if so.
      if (atBottom) {
        programmaticScrollRef.current = false;
        if (programmaticScrollTimerRef.current !== null) {
          window.clearTimeout(programmaticScrollTimerRef.current);
          programmaticScrollTimerRef.current = null;
        }
        // 用户粘性暂停期间，程序化滚动到底不得重新开启自动跟随，
        // 否则流式 token 会把用户刚向上滚动的视口又拉回底部。
        if (!userPausedRef.current) {
          shouldFollowOutputRef.current = true;
          smoothFollowOutput.resume();
        }
        setAwayFromLatest(false);
      }
      return;
    }
    // User-initiated scroll: let smoothFollowOutput handle the state machine
    // (it distinguishes up/down, layout shrink, etc.), then sync our flag.
    const userPaused = smoothFollowOutput.handleScroll(list.scrollTop, maxScrollTop);
    // At-bottom wins over pause intent so the jump button never sticks while
    // the viewport is already on the latest content (e.g. scrollbar click).
    if (atBottom) {
      if (userPausedRef.current) {
        // 粘性暂停：流式期间内容持续增长，64px 容差会把“只上滚了一小段”
        // 误判为回到底部。只有真正到达最底部（严格判定）才解除暂停。
        if (maxScrollTop - list.scrollTop <= 2) {
          userPausedRef.current = false;
          shouldFollowOutputRef.current = true;
          smoothFollowOutput.resume();
        }
      } else {
        shouldFollowOutputRef.current = true;
        smoothFollowOutput.resume();
      }
    } else if (userPaused) {
      shouldFollowOutputRef.current = false;
    }
    // Jump affordance tracks real distance from bottom, not follow-pause alone.
    setAwayFromLatest((current) => (current === !atBottom ? current : !atBottom));
  }

  function handleMessageListWheel(event: React.WheelEvent<HTMLDivElement>): void {
    if (event.deltaY >= 0) return;
    // Wheel events are always user-initiated — clear any programmatic scroll
    // flag so subsequent scroll events are treated as user intent.
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
    }
    const list = messageListRef.current;
    if (!list) return;
    smoothFollowOutput.handleUserScrollIntent(list.scrollTop);
    shouldFollowOutputRef.current = false;
    userPausedRef.current = true;
    // Only show the jump button once we've actually left the bottom; a wheel
    // tick / trackpad bounce at the bottom must not leave it stuck visible.
    syncAwayFromLatestFromScroll(list);
  }

  function pauseMessageListFollowForUserIntent(): void {
    // Pointer/key events are always user-initiated — clear programmatic flag.
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
    }
    const list = messageListRef.current;
    if (!list) return;
    smoothFollowOutput.handleUserScrollIntent(list.scrollTop);
    shouldFollowOutputRef.current = false;
    userPausedRef.current = true;
    syncAwayFromLatestFromScroll(list);
  }

  function handleMessageListPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    const list = messageListRef.current;
    if (!list) return;
    const nearScrollbar = event.clientX >= list.getBoundingClientRect().right - 18;
    if (event.pointerType === "touch" || nearScrollbar) pauseMessageListFollowForUserIntent();
  }

  function handleMessageListKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) pauseMessageListFollowForUserIntent();
  }

  function scrollToLatest(): void {
    userPausedRef.current = false;
    shouldFollowOutputRef.current = true;
    programmaticScrollRef.current = false;
    smoothFollowOutput.resume();
    setAwayFromLatest(false);
    scrollMessageListToLatest("smooth");
  }

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [openSearch]);

  useEffect(() => {
    function handleDuplexShortcut(event: KeyboardEvent): void {
      const action = getDuplexShortcutAction({ key: event.key, altKey: event.altKey, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, enabled: voicePreferences.interactionMode === "duplex", phase: duplexVoiceInput.phase }); if (!action) return;
      event.preventDefault();
      if (action === "toggle_start") void toggleVoiceRecording();
      else if (action === "toggle_pause") void (duplexVoiceInput.microphonePaused ? duplexVoiceInput.resumeMicrophone() : duplexVoiceInput.pauseMicrophone());
      else if (action === "stop") void duplexVoiceInput.stop();
      else void duplexVoiceInput.interrupt("manual");
    }
    window.addEventListener("keydown", handleDuplexShortcut);
    return () => window.removeEventListener("keydown", handleDuplexShortcut);
  }, [duplexVoiceInput.phase, duplexVoiceInput.microphonePaused, voicePreferences.interactionMode]);

  useEffect(() => {
    const running = ["starting", "active", "recovering", "stopping"].includes(duplexVoiceInput.phase);
    if (duplexWasRunningRef.current && !running) voiceButtonRef.current?.focus();
    duplexWasRunningRef.current = running;
  }, [duplexVoiceInput.phase]);

  useEffect(() => {
    if (!hasDesktopApi() || typeof desktopApi.getVoiceRuntimeStatus !== "function") return;
    void desktopApi.getVoiceRuntimeStatus().then((runtime) => {
      setVoiceRuntimeStatus(runtime);
      setVoiceRuntimeDisclosure(runtime.providerDisclosure);
      setVoiceRuntimeLabel(runtime.runtimeId === "gateway-provider" ? "Online STT" : "Fixture STT");
    }).catch(() => setVoiceRuntimeLabel("STT unavailable"));
    void desktopApi.getDuplexVoiceCapabilities()
      .then(setDuplexVoiceCapabilities)
      .catch(() => setDuplexVoiceCapabilities(null));
    void desktopApi.getDuplexVoiceReadiness()
      .then(setDuplexVoiceReadiness)
      .catch(() => setDuplexVoiceReadiness(null));
    void desktopApi.getMyDrSaiAgentModelPolicy().then((policy) => {
      const ref = policy.effective_realtime_voice_ref ?? policy.realtime_voice_model?.ref;
      setDuplexPrivacyDisclosure(ref
        ? `Realtime voice sends microphone audio to remote Provider ${ref.provider_id}, model ${ref.model_id}. Audio is streamed only while the Session is active; stable transcripts are saved to this Thread.`
        : "Realtime voice requires an explicitly configured remote Provider and model before microphone audio can be sent.");
    }).catch(() => undefined);
  }, []);

  useEffect(() => { setDuplexPrivacyConfirmed(false); }, [duplexDisclosureFingerprint]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    appendRendererStage("chat_workspace.submit.start", {
      conversationId,
      selectedAgentId,
      canChat,
      channelSource,
      hasText: Boolean(composerTextRef.current.trim()),
      attachmentCount: attachments.length + externalAttachments.length + inlineMentionAttachments.length,
      messageCount: messages.length,
    });
    if (channelSource === "wechat") {
      const decision = decideWeChatComposerSubmit({
        channelSource, trigger: "button", available: wechatCapability?.available === true,
        confirmed: wechatConfirmationPending, sending: wechatSending, hasText: Boolean(composerText.trim()),
      });
      if (decision === "blocked" || !runtimeSessionId) return;
      if (decision === "request_confirmation") {
        setWechatConfirmationPending(true);
        setWechatSendStatus(null);
        return;
      }
      setWechatSending(true);
      const idempotencyKey = `wechat-desktop:${crypto.randomUUID()}`;
      void desktopApi.sendToWeChat({
        sessionId: runtimeSessionId,
        text: composerText.trim(),
        idempotencyKey,
        confirmExternalSend: true,
      }).then((result) => {
        setWechatSendStatus(result.status === "sent" ? (zh ? "已发送到微信" : "Sent to WeChat") : (zh ? "发送结果未知，请勿立即重复发送" : "Delivery outcome is unknown; do not resend immediately"));
        if (result.status === "sent") applyComposerText("");
      }).catch((error) => {
        setWechatSendStatus(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        setWechatSending(false);
        setWechatConfirmationPending(false);
      });
      return;
    }
    if (duplexVoiceInput.phase === "active") { void submitDuplexText(); return; }
    if (["starting", "recovering", "stopping"].includes(duplexVoiceInput.phase)) {
      setVoiceError(zh ? "实时语音正在连接、恢复或结束；文字草稿已保留，请稍后重试。" : "Realtime voice is connecting, recovering, or ending. Your text draft is preserved; retry shortly.");
      return;
    }
    void submitWithAttachments();
  }

  async function submitDuplexText(): Promise<void> { if (attachments.length || externalAttachments.length || inlineMentionAttachments.length) { setVoiceError(zh ? "实时语音中的文字消息暂不支持附件；请先移除附件。" : "Text messages inside Realtime voice do not support attachments yet. Remove attachments first."); return; } const value = composerText.trim(); if (!value) return; const submitted = await duplexVoiceInput.sendText(value, duplexTextStrategy); if (submitted) { applyComposerText(""); setVoiceError(null); } else setVoiceError(zh ? "文字未发送。可能已有一条待发送消息，或实时连接不可用。" : "Text was not sent. Another message may already be pending, or Realtime is unavailable."); }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    // Undo: Ctrl+Z (Windows/Linux) or Cmd+Z (Mac).  Must be checked before
    // the IME / submit logic below, and must not fire during IME composition.
    const isUndo = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      && (event.key === "z" || event.key === "Z");
    const isRedo = (event.ctrlKey || event.metaKey) && !event.altKey
      && (event.key === "y" || event.key === "Y"
        || ((event.key === "z" || event.key === "Z") && event.shiftKey));

    if (isUndo && !isTextCompositionEvent(event.nativeEvent)) {
      const history = inputHistoryRef.current;
      if (history.past.length > 0) {
        event.preventDefault();
        const previous = history.past.pop()!;
        history.future.unshift(history.present);
        history.present = previous;
        // Mark as our own change so the sync effect does not double-record.
        history.lastExternal = previous;
        applyComposerText(previous);
        // Restore cursor to end after undo so the user can continue typing.
        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            const pos = Math.min(previous.length, textarea.selectionStart);
            textarea.setSelectionRange(pos, pos);
          }
        });
      }
      return;
    }
    if (isRedo && !isTextCompositionEvent(event.nativeEvent)) {
      const history = inputHistoryRef.current;
      if (history.future.length > 0) {
        event.preventDefault();
        const next = history.future.shift()!;
        history.past.push(history.present);
        history.present = next;
        history.lastExternal = next;
        applyComposerText(next);
        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            const pos = Math.min(next.length, textarea.selectionStart);
            textarea.setSelectionRange(pos, pos);
          }
        });
      }
      return;
    }

    // ESC closes the tools menu when open.
    if (event.key === "Escape" && toolsOpen) {
      event.preventDefault();
      setToolsOpen(false);
      attachmentButtonRef.current?.focus();
      return;
    }

    if (!shouldSubmitTextInput(event.nativeEvent)) return;
    event.preventDefault();
    if (decideWeChatComposerSubmit({
      channelSource, trigger: "keyboard", available: wechatCapability?.available === true,
      confirmed: wechatConfirmationPending, sending: wechatSending, hasText: Boolean(composerText.trim()),
    }) === "blocked") return;
    void submitWithAttachments();
  }

  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void {
    const clipboard = event.clipboardData;
    const imageFiles = Array.from(clipboard.files)
      .filter((file) => file.type.startsWith("image/") || isImageFileName(file.name || ""))
      .slice(0, MAX_CLIPBOARD_IMAGE_COUNT);
    const text = clipboard.getData("text/plain");
    if (isRemoteAgent) {
      // Remote agents receive pasted images as Base64 payloads, never as
      // local filesystem paths or clipboard staging references.
      if (imageFiles.length) {
        event.preventDefault();
        void addRemoteClipboardFiles(imageFiles);
      }
      return;
    }
    const pathMentionText = normalizePastedLocalPathMentions(text);
    if (!imageFiles.length && !pathMentionText) return;

    event.preventDefault();
    // When pasting clipboard images, do not insert clipboard text into the
    // input box — the image is sent as a multimodal message, not as text.
    if (imageFiles.length) {
      void addClipboardImageAttachments(imageFiles);
    } else {
      insertTextAtCursor(pathMentionText || text);
    }
  }

  async function addRemoteClipboardFiles(files: File[]): Promise<void> {
    const added: ComposerAttachment[] = [];
    let totalBytes = attachmentsRef.current.reduce(
      (sum, item) => sum + (item.sizeBytes ?? 0), 0);
    for (const [index, file] of files.entries()) {
      if (file.size > REMOTE_ATTACHMENT_LIMIT_BYTES) {
        window.alert(zh
          ? `图片 ${file.name || `clipboard-image-${index + 1}`} 超过远程附件 10 MB 上限。`
          : `Image ${file.name || `clipboard-image-${index + 1}`} exceeds the 10 MB remote attachment limit.`);
        continue;
      }
      if (totalBytes + file.size > REMOTE_ATTACHMENT_LIMIT_BYTES) {
        window.alert(zh
          ? "远程附件总量超过 10 MB 上限，已停止添加。"
          : "Remote attachments exceed the 10 MB total limit; stopped adding files.");
        break;
      }
      const dataUrl = await blobToDataUrl(file).catch(() => undefined);
      if (!dataUrl) continue;
      totalBytes += file.size;
      added.push({
        id: crypto.randomUUID(),
        kind: "file",
        path: `remote-clipboard:${crypto.randomUUID()}`,
        name: file.name?.trim() || `clipboard-image-${index + 1}`,
        title: `Clipboard image: ${file.name || `clipboard-image-${index + 1}`}`,
        remoteDataUrl: dataUrl,
        sizeBytes: file.size,
        mimeType: file.type || "image/png",
        screenshotDataUrl: dataUrl,
      });
    }
    if (!added.length) return;
    setAttachments((current) => [...current, ...added]);
    setToolsOpen(false);
  }

  function startEditAndResend(assistantMessageId: string): void {
    const user = findPrecedingUserMessage(messages, assistantMessageId);
    if (!user) return;
    if (!pendingReplaceFromMessageId) {
      editResendBackupRef.current = { input, attachments };
    }
    applyComposerText(user.content);
    setPendingReplaceFromMessageId(user.id);
    setAttachments(user.attachments?.length
      ? user.attachments.map((attachment) => ({
          ...attachment,
          id: `${attachment.path || attachment.name || "attachment"}-${crypto.randomUUID()}`,
        }))
      : []);
    textareaRef.current?.focus({ preventScroll: true });
  }

  function startEditUserMessage(userMessageId: string): void {
    const user = messages.find((message) => message.id === userMessageId && message.role === "user");
    if (!user) return;
    if (!pendingReplaceFromMessageId) {
      editResendBackupRef.current = { input, attachments };
    }
    applyComposerText(user.content);
    setPendingReplaceFromMessageId(user.id);
    setAttachments(user.attachments?.length
      ? user.attachments.map((attachment) => ({
          ...attachment,
          id: `${attachment.path || attachment.name || "attachment"}-${crypto.randomUUID()}`,
        }))
      : []);
    textareaRef.current?.focus({ preventScroll: true });
  }

  function cancelEditAndResend(): void {
    const backup = editResendBackupRef.current;
    setPendingReplaceFromMessageId(null);
    if (backup) {
      applyComposerText(backup.input);
      setAttachments(backup.attachments);
    }
    editResendBackupRef.current = null;
  }

  async function regenerateAssistant(assistantMessageId: string): Promise<void> {
    const user = findPrecedingUserMessage(messages, assistantMessageId);
    if (!user || activeRequestId) return;
    await onSubmit(
      (user.attachments ?? []).filter((attachment) => !attachment.blockedReason),
      {
        agentId: selectedAgentId,
        agentName: activeAgentName,
        planMode: isLocalOpenDrSaiAgent && taskInteractionMode === "plan",
        privateMode: isLocalOpenDrSaiAgent && privateMode,
        model: selectedModelName,
        replaceFromMessageId: user.id,
        runtimeMode: currentRuntimeMode,
        skillName: !isRemoteAgent ? (selectedSkillName ?? selectedSquareSkill?.installedName) : undefined,
        remoteSkill: isRemoteAgent && (selectedRemoteSkill || selectedSquareSkill)
          ? selectedRemoteSkill
            ? { id: selectedRemoteSkill.id, source: selectedRemoteSkill.source }
            : {
                id: selectedSquareSkill!.slug,
                source: selectedSquareSkill!.source,
                name: selectedSquareSkill!.name,
                ...(selectedSquareSkill!.zipBase64 ? { zipBase64: selectedSquareSkill!.zipBase64 } : {}),
                ...(selectedSquareSkill!.content ? { content: selectedSquareSkill!.content } : {}),
              }
          : null,
        text: user.content,
        thinkingEffort: !isLocalOpenDrSaiAgent || thinkingEffortSupported ? thinkingEffort : undefined,
      },
    );
  }

  // Stable identities do not mean frozen closures: edits/regeneration must read
  // the current composer, messages, model/agent configuration and parent actions.
  const messageEvents = {
    startEditAndResend: useEventCallback(startEditAndResend),
    startEditUserMessage: useEventCallback(startEditUserMessage),
    regenerateAssistant: useEventCallback(regenerateAssistant),
    onRetryMessage: useEventCallback((...args: Parameters<NonNullable<ChatWorkspaceProps["onRetryMessage"]>>) => onRetryMessage?.(...args)),
    onReportFeedback: useEventCallback((...args: Parameters<NonNullable<ChatWorkspaceProps["onReportFeedback"]>>) => onReportFeedback?.(...args)),
    onRecoveryAction: useEventCallback((...args: Parameters<NonNullable<ChatWorkspaceProps["onRecoveryAction"]>>) => onRecoveryAction?.(...args)),
    onDeleteMessage: useEventCallback((...args: Parameters<NonNullable<ChatWorkspaceProps["onDeleteMessage"]>>) => onDeleteMessage?.(...args)),
  };

  async function submitWithAttachments(): Promise<void> {
    // Readiness gate for every text-submission path (form submit, Enter key,
    // voice auto-submit, Send & Stop). While the runtime/bootstrap is still
    // starting (or the service is otherwise not ready), keep the draft in the
    // composer instead of dispatching a turn that the backend can only reject.
    // Queueing while a task is already running (showStop) stays allowed.
    if (!canChat && !showStop) return;
    // 已有任务在运行（showStop）：把当前草稿排队，待当前 turn 结束后由
    // 下方 useEffect 自动再次调用本函数发送，而不是直接并发提交。
    if (showStop) {
      const hasPayload = composerTextRef.current.trim().length > 0
        || attachments.length > 0 || externalAttachments.length > 0 || inlineMentionAttachments.length > 0;
      if (hasPayload) setQueuedSend(true);
      return;
    }
    // Reset scroll-follow state so the view tracks the latest streaming output.
    userPausedRef.current = false;
    shouldFollowOutputRef.current = true;
    programmaticScrollRef.current = false;
    smoothFollowOutput.resume();
    setAwayFromLatest(false);
    if (duplexVoiceInput.phase === "active") { await submitDuplexText(); return; }
    if (["starting", "recovering", "stopping"].includes(duplexVoiceInput.phase)) {
      setVoiceError(zh ? "实时语音正在连接、恢复或结束；文字草稿已保留，请稍后重试。" : "Realtime voice is connecting, recovering, or ending. Your text draft is preserved; retry shortly.");
      return;
    }
    const isVoiceSubmission = voiceTurnState.phase === "ready_to_send";
    const textDraft = isVoiceSubmission ? "" : composerTextRef.current;
    if (isVoiceSubmission) {
      voiceResponseBaselineRef.current = new Set(messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.id));
      dispatchVoiceTurn({
        type: "submit_started",
        messageId: `voice-user-${voiceTurnState.turnId ?? crypto.randomUUID()}`,
      });
    }
    const folderSummaryProvider =
      onSummarizeWorkspaceFolder ?? (hasDesktopApi() ? desktopApi.summarizeWorkspaceFolder : undefined);
    const submittedAttachments = await summarizeQueuedContextAttachments([
      ...attachments.map(({ id: _id, importFile: _importFile, folderImport: _folderImport, ...attachment }) =>
        enrichAttachmentWithMaterialRole(attachment, findMaterialRole(materialRoleByPath, attachment))),
      ...externalAttachments,
      ...inlineMentionAttachments,
    ], folderSummaryProvider);
    appendRendererStage("chat_workspace.submit.before_adapter", {
      conversationId,
      selectedAgentId,
      textLength: textDraft.length,
      attachmentCount: submittedAttachments.length,
    });
    const submitted = await onSubmit(
      submittedAttachments.filter((attachment) => !attachment.blockedReason),
      {
        agentId: selectedAgentId,
        agentName: activeAgentName,
        forkQueueAgentAssignments: buildForkQueueAgentAssignments(
          forkQueueEntries,
          forkQueueAgentSelections,
          agentOptions,
        ),
        planMode: isLocalOpenDrSaiAgent && taskInteractionMode === "plan",
        privateMode: isLocalOpenDrSaiAgent && privateMode,
        model: selectedModelName,
        runtimeMode: currentRuntimeMode,
        skillName: !isRemoteAgent ? (selectedSkillName ?? selectedSquareSkill?.installedName) : undefined,
        remoteSkill: isRemoteAgent && (selectedRemoteSkill || selectedSquareSkill)
          ? selectedRemoteSkill
            ? { id: selectedRemoteSkill.id, source: selectedRemoteSkill.source }
            : {
                id: selectedSquareSkill!.slug,
                source: selectedSquareSkill!.source,
                name: selectedSquareSkill!.name,
                ...(selectedSquareSkill!.zipBase64 ? { zipBase64: selectedSquareSkill!.zipBase64 } : {}),
                ...(selectedSquareSkill!.content ? { content: selectedSquareSkill!.content } : {}),
              }
          : null,
        thinkingEffort: !isLocalOpenDrSaiAgent || thinkingEffortSupported ? thinkingEffort : undefined,
        ...(!isVoiceSubmission ? { text: textDraft } : {}),
        ...(pendingReplaceFromMessageId ? { replaceFromMessageId: pendingReplaceFromMessageId } : {}),
        onStarted: isVoiceSubmission
          ? ({ assistantMessageId, requestId, userMessageId }) => dispatchVoiceTurn({
              type: "submission_linked",
              requestId,
              sourceMessageId: userMessageId,
              responseMessageId: assistantMessageId,
            })
          : undefined,
      },
    );
    if (submitted) {
      appendRendererStage("chat_workspace.submit.adapter_ok", { conversationId, selectedAgentId, isVoiceSubmission });
      if (!isVoiceSubmission) applyComposerText("");
      setAttachments([]);
      onClearExternalAttachments?.();
      setSelectedSkillName(null);
      setSelectedRemoteSkillId(null);
      setSelectedSquareSkill(null);
      setPendingReplaceFromMessageId(null);
      editResendBackupRef.current = null;
      if (isVoiceSubmission) dispatchVoiceTurn({ type: "response_started" });
    } else {
      appendRendererStage("chat_workspace.submit.failed", { conversationId, selectedAgentId, isVoiceSubmission }, "error");
      if (!isVoiceSubmission) return;
      const message = zh ? "语音消息发送失败，转写文本和附件已保留。" : "The voice message could not be sent. The transcript and attachments were preserved.";
      dispatchVoiceTurn({
        type: "fail",
        error: {
          stage: "submitting",
          code: "chat_error",
          message,
          retryable: true,
        },
      });
      setVoiceState("failed");
      setVoiceError(message);
    }
  }

  // 当前任务结束（showStop 由 true→false）后，自动发送排队的草稿。
  useEffect(() => {
    if (!showStop && queuedSend) {
      setQueuedSend(false);
      void submitWithAttachments();
    }
  }, [showStop, queuedSend]);

  // 切换会话时丢弃未发送的排队标记，避免把草稿发到别的会话。
  useEffect(() => {
    setQueuedSend(false);
  }, [conversationId]);

  function retryVoiceChatSubmission(): void {
    const requestId = voiceTurnState.sttRequestId;
    if (voiceTurnState.phase !== "failed" || voiceTurnState.error?.stage !== "submitting" || !requestId) return;
    voiceAutoSubmitRequestRef.current = requestId;
    setVoiceState("idle");
    setVoiceError(null);
    dispatchVoiceTurn({ type: "retry" });
  }

  function clearInput(): void {
    applyComposerText("");
    textareaRef.current?.focus();
  }

  async function toggleVoiceRecording(): Promise<void> {
    void recordVoiceDiagnostic({
      traceId: voiceCaptureDiagnosticRef.current?.traceId ?? crypto.randomUUID(),
      component: "composer",
      operation: "voice.button.click",
      message: "Voice input button clicked",
      domain: "app",
      kind: "log",
      level: "info",
      status: "completed",
      visibility: "detail",
      attributes: {
        interactionMode: voicePreferences.interactionMode,
        serialCaptureState: voiceState,
        duplexCapturePhase: duplexVoiceInput.phase,
        voiceApiAvailable,
      },
    });
    if (voicePreferences.interactionMode === "duplex") {
      if (duplexVoiceInput.phase === "active" || duplexVoiceInput.phase === "recovering") {
        await duplexVoiceInput.stop();
        return;
      }
      await startDuplexVoiceRecording(false);
      return;
    }
    if (voiceState === "recording") {
      stopVoiceRecording("transcribe");
      return;
    }
    await startVoiceRecording();
  }

  async function startDuplexVoiceRecording(privacyAlreadyConfirmed: boolean): Promise<void> {
    const readiness = await desktopApi.getDuplexVoiceReadiness().catch(() => null);
    setDuplexVoiceReadiness(readiness);
    const browserReady = typeof AudioWorkletNode !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    if (!browserReady) { setVoiceError(zh ? "实时语音需要 AudioWorklet 和麦克风设备支持。" : "Realtime voice requires AudioWorklet and microphone device support."); return; }
    if (!readiness?.available) { setVoiceError(readiness?.message ?? duplexVoiceAvailability.reason ?? "Realtime voice is unavailable."); return; }
    if (!privacyAlreadyConfirmed && !duplexDisclosureAcknowledged) { setVoiceError(duplexPrivacyDisclosure); return; }
    voicePlayback.stop(); setVoiceError(null);
    try { await duplexVoiceInput.start(); }
    catch (error) { setVoiceError(error instanceof Error ? error.message : "Realtime voice failed to start."); }
  }

  async function startVoiceRecording(): Promise<void> {
    const traceId = crypto.randomUUID();
    voiceCaptureDiagnosticRef.current = { failureRecorded: false, startedAt: Date.now(), traceId };
    void recordVoiceDiagnostic({
      traceId,
      component: "capture",
      operation: "voice.capture",
      message: "Voice capture requested",
      domain: "app",
      kind: "operation",
      level: "info",
      status: "started",
      visibility: "milestone",
      attributes: {
        mediaDevicesAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
        mediaRecorderAvailable: typeof MediaRecorder !== "undefined",
        selectedDevice: Boolean(voiceDeviceId),
      },
    });
    if (!voiceApiAvailable) {
      const error = new Error("Voice recording is unavailable in this desktop runtime.");
      setVoiceState("failed");
      setVoiceError(error.message);
      reportVoiceCaptureFailure(error, error.message, "runtime_api_check");
      return;
    }
    dispatchVoiceTurn({ type: "begin_capture", turnId: createVoiceTurnId() });
    voiceSelectionRef.current = textareaRef.current
      ? { start: textareaRef.current.selectionStart, end: textareaRef.current.selectionEnd }
      : { start: input.length, end: input.length };
    const started = await startVoiceCapture();
    if (started) {
      dispatchVoiceTurn({ type: "permission_granted" });
    } else {
      const active = voiceCaptureDiagnosticRef.current;
      if (active && !active.failureRecorded) {
        const message = voiceError || "Microphone capture could not be started.";
        setVoiceState("failed");
        setVoiceError(message);
        reportVoiceCaptureFailure(
          new Error(message),
          message,
          "capture_start",
        );
      }
      dispatchVoiceTurn({
        type: "fail",
        error: {
          stage: "requesting_permission",
          code: "capture_error",
          message: zh ? "无法启动麦克风录音。" : "Microphone capture could not be started.",
          retryable: true,
        },
      });
    }
  }

  function reportVoiceCaptureFailure(error: unknown, message: string, stage: string): void {
    const active = voiceCaptureDiagnosticRef.current ?? {
      failureRecorded: false,
      startedAt: Date.now(),
      traceId: crypto.randomUUID(),
    };
    active.failureRecorded = true;
    voiceCaptureDiagnosticRef.current = active;
    void recordVoiceDiagnostic({
      traceId: active.traceId,
      component: "capture",
      operation: "voice.capture",
      message,
      domain: "app",
      kind: "error",
      level: "error",
      status: "failed",
      visibility: "milestone",
      errorCode: voiceCaptureErrorCode(error),
      durationMs: Date.now() - active.startedAt,
      stack: voiceDiagnosticStack(error),
      attributes: {
        stage,
        errorName: error instanceof Error ? error.name : typeof error,
        mediaDevicesAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
        mediaRecorderAvailable: typeof MediaRecorder !== "undefined",
        selectedDevice: Boolean(voiceDeviceId),
      },
    });
  }

  function stopVoiceRecording(mode: "transcribe" | "discard"): void {
    if (mode === "transcribe") {
      dispatchVoiceTurn({ type: "recording_stopped" });
    } else {
      dispatchVoiceTurn({ type: "cancel" });
      dispatchVoiceTurn({ type: "cancelled" });
    }
    stopVoiceCapture(mode);
  }

  async function processVoiceRecording(blob: Blob, durationSeconds: number): Promise<void> {
    const requestId = `voice-stt-${crypto.randomUUID()}`;
    setVoiceState("processing");
    setVoiceProgressMessage("Preparing audio...");
    voiceRetryBlobRef.current = blob;
    voiceRetryDurationRef.current = durationSeconds;
    if (!await prepareSerialVoiceTranscription()) return;
    dispatchVoiceTurn({ type: "stt_started", requestId });
    try {
      const result = await transcribeVoiceRecordingAsync(
        blob,
        durationSeconds,
      );
      completeSerialVoiceTranscription(result, requestId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        dispatchVoiceTurn({ type: "cancel" });
        dispatchVoiceTurn({ type: "cancelled" });
        setVoiceState("idle");
        setVoiceError(null);
      } else {
        const message = error instanceof Error ? error.message : "Voice transcription failed.";
        dispatchVoiceTurn({
          type: "fail",
          error: {
            stage: "transcribing",
            code: "provider_error",
            message,
            retryable: true,
          },
        });
        setVoiceState("failed");
        setVoiceError(message);
        reportVoiceTranscriptionFailure(error, message, "transcribing", "transcription_error");
      }
    }
  }

  function insertTextAtCursor(text: string): void {
    const textarea = textareaRef.current;
    const liveText = composerTextRef.current;
    if (!textarea) {
      applyComposerText(liveText ? `${liveText}${text}` : text);
      return;
    }
    const start = textarea.selectionStart ?? liveText.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${liveText.slice(0, start)}${text}${liveText.slice(end)}`;
    pushInputHistory(liveText);
    applyComposerText(next);
    window.setTimeout(() => {
      textarea.focus();
      const cursor = start + text.length;
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  }

  async function addClipboardImageAttachments(files: File[]): Promise<void> {
    const nextAttachments = (
      await Promise.all(files.map((file, index) => createClipboardImageAttachment(file, index)))
    ).filter((attachment): attachment is ComposerAttachment => Boolean(attachment));
    if (!nextAttachments.length) return;
    setAttachments((current) => [...current, ...nextAttachments]);
    setToolsOpen(false);
  }

  async function transcribeVoiceRecordingAsync(
    blob: Blob,
    durationSeconds: number,
  ): Promise<DesktopVoiceTranscriptionResult> {
    return transcribeVoiceBlob({
      blob,
      durationSeconds,
      languageHint: voiceLanguage === "auto" ? undefined : voiceLanguage,
      workspacePath: workspacePath || undefined,
    });
  }

  function cancelVoiceTranscription(): void {
    dispatchVoiceTurn({ type: "cancel" });
    dispatchVoiceTurn({ type: "cancelled" });
    cancelVoiceTranscriptionTask();
  }

  async function retryVoiceTranscription(skipRemoteConsent = false): Promise<void> {
    const blob = voiceRetryBlobRef.current;
    if (!blob) return;
    setVoiceError(null);
    setVoiceProgressMessage("Preparing audio...");
    setVoiceReviewText(null);
    setVoiceState("processing");
    if (!await prepareSerialVoiceTranscription(skipRemoteConsent)) return;
    const requestId = `voice-stt-${crypto.randomUUID()}`;
    dispatchVoiceTurn({ type: "stt_started", requestId });
    try {
      const result = await transcribeVoiceRecordingAsync(blob, voiceRetryDurationRef.current);
      completeSerialVoiceTranscription(result, requestId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        dispatchVoiceTurn({ type: "cancel" });
        dispatchVoiceTurn({ type: "cancelled" });
        setVoiceState("idle");
        setVoiceError(null);
      } else {
        const message = error instanceof Error ? error.message : "Voice transcription failed.";
        dispatchVoiceTurn({
          type: "fail",
          error: {
            stage: "transcribing",
            code: "provider_error",
            message,
            retryable: true,
          },
        });
        setVoiceState("failed");
        setVoiceError(message);
        reportVoiceTranscriptionFailure(error, message, "transcribing", "transcription_error");
      }
    }
  }

  async function prepareSerialVoiceTranscription(skipRemoteConsent = false): Promise<boolean> {
    if (!hasDesktopApi() || typeof desktopApi.getVoiceRuntimeStatus !== "function") return true;
    try {
      const runtime = await desktopApi.getVoiceRuntimeStatus();
      setVoiceRuntimeStatus(runtime);
      setVoiceRuntimeDisclosure(runtime.providerDisclosure);
      setVoiceRuntimeLabel(runtime.runtimeId === "gateway-provider" ? "Online STT" : "Fixture STT");
      if (runtime.runtimeId === "gateway-provider" && !skipRemoteConsent && !voicePreferences.remoteSttConsent) {
        setVoiceConsentRequired(true);
        failVoiceTranscriptionPreparation(
          "permission_denied",
          zh
            ? "录音已保留。允许在线语音识别后将继续识别，不需要重新录音。"
            : "The recording is preserved. Allow online transcription to continue without recording again.",
          true,
        );
        return false;
      }
      setVoiceConsentRequired(false);
      return true;
    } catch (error) {
      failVoiceTranscriptionPreparation(
        "runtime_unavailable",
        error instanceof Error
          ? error.message
          : (zh ? "无法检查语音识别服务。" : "Voice transcription readiness could not be checked."),
        true,
      );
      return false;
    }
  }

  function failVoiceTranscriptionPreparation(
    code: "runtime_unavailable" | "permission_denied",
    message: string,
    retryable: boolean,
  ): void {
    dispatchVoiceTurn({
      type: "fail",
      error: { stage: "preparing_audio", code, message, retryable },
    });
    setVoiceState("failed");
    setVoiceError(message);
    if (code === "runtime_unavailable") {
      reportVoiceTranscriptionFailure(new Error(message), message, "preparing_audio", code);
    }
  }

  function reportVoiceTranscriptionFailure(
    error: unknown,
    message: string,
    stage: "preparing_audio" | "transcribing",
    errorCode: string,
  ): void {
    void recordVoiceDiagnostic({
      traceId: voiceTurnStateRef.current.turnId ?? crypto.randomUUID(),
      component: "stt",
      operation: "voice.transcription",
      message,
      domain: "app",
      kind: "error",
      level: "error",
      status: "failed",
      visibility: "milestone",
      errorCode,
      stack: voiceDiagnosticStack(error),
      attributes: { stage },
    });
  }

  function completeSerialVoiceTranscription(
    result: DesktopVoiceTranscriptionResult,
    requestId: string,
  ): void {
    const transcript = result.transcript.trim();
    setVoiceRuntimeDisclosure(result.providerDisclosure);
    setVoiceState("idle");
    setVoiceError(null);
    setVoiceElapsedSeconds(0);
    if (voicePreferences.confirmBeforeSend) {
      const selection = voiceSelectionRef.current ?? { start: input.length, end: input.length };
      const insertion = insertVoiceTranscript(input, transcript, selection);
      applyComposerText(insertion.value);
      setVoiceReviewSource(null);
      setVoiceReviewText(null);
      voiceRetryBlobRef.current = null;
      voiceRetryDurationRef.current = 0;
      dispatchVoiceTurn({ type: "stt_completed", requestId, requiresReview: true });
      dispatchVoiceTurn({ type: "transcript_inserted", requestId });
      restoreComposerFocus(insertion.cursor);
      return;
    }

    const selection = voiceSelectionRef.current ?? { start: input.length, end: input.length };
    const insertion = insertVoiceTranscript(input, transcript, selection);
    applyComposerText(insertion.value);
    setVoiceReviewSource(null);
    setVoiceReviewText(null);
    voiceAutoSubmitRequestRef.current = requestId;
    voiceRetryBlobRef.current = null;
    voiceRetryDurationRef.current = 0;
    dispatchVoiceTurn({ type: "stt_completed", requestId });
  }

  function acceptVoiceReview(): void {
    const text = voiceReviewText?.trim();
    let cursor: number | null = null;
    if (text) {
      const selection = voiceSelectionRef.current ?? { start: input.length, end: input.length };
      const insertion = insertVoiceTranscript(input, text, selection);
      applyComposerText(insertion.value);
      cursor = insertion.cursor;
    }
    if (voiceReviewSource === "serial") dispatchVoiceTurn({ type: "review_accepted" });
    clearVoiceReview();
    restoreComposerFocus(cursor);
  }

  async function retryVoiceReview(): Promise<void> {
    await retryVoiceTranscription();
  }

  function discardVoiceReview(): void {
    voiceAutoSubmitRequestRef.current = null;
    dispatchVoiceTurn({ type: "cancel" });
    dispatchVoiceTurn({ type: "cancelled" });
    clearVoiceReview();
    restoreComposerFocus(null);
  }

  function clearVoiceReview(): void {
    setVoiceReviewText(null);
    setVoiceReviewSource(null);
    setVoiceRuntimeDisclosure(null);
    setVoiceError(null);
    voiceRetryBlobRef.current = null;
    voiceRetryDurationRef.current = 0;
    setVoiceState("idle");
  }

  function restoreComposerFocus(cursor: number | null): void {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      if (cursor !== null) textarea.setSelectionRange(cursor, cursor);
    });
  }

  function selectSamplePrompt(prompt: string): void {
    applyComposerText(prompt);
    textareaRef.current?.focus();
  }

  function selectSlashCommand(command: ChatCommandName): void {
    applyComposerText(`/${command} `);
    textareaRef.current?.focus();
  }

  function toggleMetaMenu(menu: "configuration" | "skill"): void {
    const next = metaMenuOpen === menu ? null : menu;
    setMetaMenuOpen(next);
    setConfigurationSection(null);
    // Do not put I/O in a React state updater: React may replay it.
    if (next === "skill") {
      if (!isRemoteAgent) void loadInstalledSkillsForPicker();
      if (squareInstallFilter !== "installed") {
        void loadSquareSkills({ search: squareSearch, tag: squareActiveTag, sort: squareSort, installFilter: squareInstallFilter });
      }
      void loadSquareSkillTags();
    }
  }

  function revealConfigurationSection(
    section: "agent" | "model" | "imageGeneration" | "thinking" | "task" | "private",
    anchor: HTMLButtonElement,
  ): void {
    const menu = anchor.closest<HTMLElement>(".composer-configuration-menu");
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu?.getBoundingClientRect() ?? anchorRect;
    const viewportPadding = 8;
    const submenuWidth = Math.min(290, window.innerWidth - viewportPadding * 2);
    const left = Math.max(
      viewportPadding,
      Math.min(menuRect.right - 1, window.innerWidth - submenuWidth - viewportPadding),
    );
    let top = Math.max(viewportPadding, anchorRect.top);
    let maxHeight = Math.min(220, window.innerHeight - top - viewportPadding);
    if (maxHeight < 96) {
      top = Math.max(viewportPadding, window.innerHeight - 96 - viewportPadding);
      maxHeight = Math.max(64, window.innerHeight - top - viewportPadding);
    }
    setConfigurationSection(section);
    setConfigurationSubmenuPosition({ top, left, maxHeight });
  }

  async function loadInstalledSkillsForPicker(): Promise<void> {
    if (!hasDesktopApi() || typeof desktopApi.listInstalledSkills !== "function") {
      setInstalledSkills([]);
      setSkillsLoadError(zh ? "当前环境不支持读取技能。" : "Skills are unavailable in this environment.");
      return;
    }
    const cached = installedSkillsCacheRef.current;
    if (cached && Date.now() - cached.timestamp < 30_000) {
      setInstalledSkills(cached.items);
      setSkillsLoadError(null);
      return;
    }
    setSkillsLoading(true);
    setSkillsLoadError(null);
    try {
      const skills = await desktopApi.listInstalledSkills();
      const items = Array.isArray(skills) ? skills : [];
      installedSkillsCacheRef.current = { items, timestamp: Date.now() };
      setInstalledSkills(items);
    } catch (error) {
      setInstalledSkills([]);
      setSkillsLoadError(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setSkillsLoading(false);
    }
  }

  async function loadSquareSkillTags(): Promise<void> {
    if (!hasDesktopApi() || typeof desktopApi.listSkillsSquareTags !== "function") return;
    try {
      const tags = await desktopApi.listSkillsSquareTags();
      setSquareTags((tags ?? []).map((tag) => tag.name).filter((name) => name.trim().length > 0));
    } catch {
      // Tag listing needs an account email on some hosts; fall back to tags
      // harvested from the loaded skills instead of surfacing an error.
      setSquareTags((current) => (current.length ? current : []));
    }
  }

  async function loadSquareSkills(options?: {
    search?: string;
    tag?: string | null;
    page?: number;
    append?: boolean;
    sort?: "downloads" | "name" | "time";
    installFilter?: "all" | "installed" | "not_installed";
  }): Promise<void> {
    if (!hasDesktopApi() || typeof desktopApi.listSkillsSquare !== "function") {
      setSquareSkills([]);
      setSquareError(zh ? "当前环境不支持读取公共技能。" : "Public skills are unavailable in this environment.");
      return;
    }
    const search = options?.search?.trim() ?? "";
    const tag = options?.tag ?? null;
    const targetPage = options?.page ?? 1;
    const append = options?.append ?? false;
    const reqSort = options?.sort ?? squareSort;
    const reqInstallFilter = options?.installFilter ?? squareInstallFilter;
    // Cache hit: only for fresh first-page loads (never append).
    if (!append && targetPage === 1) {
      const cached = squareSkillsCacheRef.current;
      if (
        cached &&
        cached.search === search &&
        cached.tag === tag &&
        cached.sort === reqSort &&
        cached.installFilter === reqInstallFilter &&
        Date.now() - cached.timestamp < 30_000
      ) {
        setSquareSkills(cached.items);
        setSquarePage(cached.page);
        setSquareTotal(cached.total);
        setSquareHasNext(cached.hasNext);
        if (!squareTags.length) setSquareTags(cached.tags);
        setSquareError(null);
        return;
      }
    }
    const requestGeneration = ++squareRequestGenerationRef.current;
    if (append) setSquareLoadingMore(true);
    else setSquareLoading(true);
    setSquareError(null);
    try {
      const result = await desktopApi.listSkillsSquare({
        scope: "public",
        page: targetPage,
        pageSize: 20,
        sort: reqSort,
        ...(search ? { q: search } : {}),
        ...(tag ? { tags: tag } : {}),
        ...(reqInstallFilter !== "all" ? { installFilter: reqInstallFilter } : {}),
      });
      if (requestGeneration !== squareRequestGenerationRef.current) return;
      const items = Array.isArray(result?.items) ? result.items : [];
      if (append) {
        setSquareSkills((prev) => [...prev, ...items]);
      } else {
        setSquareSkills(items);
      }
      setSquarePage(result?.page ?? targetPage);
      setSquareTotal(result?.total ?? 0);
      setSquareHasNext(result?.hasNext ?? false);
      // Harvest tags from loaded skills on first fresh load.
      if (!append && !squareTags.length) {
        const harvested = new Set<string>();
        for (const item of items) for (const t of item.tags ?? []) harvested.add(t);
        setSquareTags([...harvested]);
      }
      // Write cache only for fresh page-1 loads.
      if (!append && targetPage === 1) {
        squareSkillsCacheRef.current = {
          items,
          tags: squareTags.length ? squareTags : [],
          search,
          tag,
          sort: reqSort,
          installFilter: reqInstallFilter,
          page: result?.page ?? targetPage,
          total: result?.total ?? 0,
          hasNext: result?.hasNext ?? false,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      if (requestGeneration !== squareRequestGenerationRef.current) return;
      if (!append) setSquareSkills([]);
      setSquareError(userFacingFailureMessage(error, language, "operation"));
    } finally {
      if (requestGeneration === squareRequestGenerationRef.current) {
        setSquareLoading(false);
        setSquareLoadingMore(false);
      }
    }
  }

  async function selectSquareSkill(skill: DesktopSquareSkill): Promise<void> {
    const slug = skill.slug?.trim();
    if (!slug) return;
    const source = skill.source || "public";
    const sameSelection = selectedSquareSkill?.slug === slug && selectedSquareSkill?.source === source;
    // Update selection immediately; background installation must not block toggle-off.
    if (sameSelection) {
      setSelectedSquareSkill(null);
      return;
    }
    setSelectedRemoteSkillId(null);
    setSelectedSkillName(null);
    setSelectedSquareSkill({ slug, name: skill.name || slug, source, ...(!isRemoteAgent ? { installedName: skill.name || slug } : {}) });
    setSquareError(null);

    if (isRemoteAgent) {
      try {
        if (typeof desktopApi.downloadSkillsSquare === "function") {
          const zip = await desktopApi.downloadSkillsSquare({ slug });
          if (zip?.base64) {
            setSelectedSquareSkill((current) => current && current.slug === slug ? { ...current, zipBase64: zip.base64 } : current);
            return;
          }
        }
        if (typeof desktopApi.getSkillsSquareSkillMd === "function") {
          const md = await desktopApi.getSkillsSquareSkillMd({ slug });
          setSelectedSquareSkill((current) => current && current.slug === slug ? { ...current, content: md.content } : current);
        }
      } catch (error) {
        setSquareError(userFacingFailureMessage(error, language, "operation"));
      }
      return;
    }

    if (skill.installed || typeof desktopApi.installSkillsSquare !== "function") return;
    try {
      setSquareInstallingSlug(slug);
      const installed = await desktopApi.installSkillsSquare({ slug, name: skill.name });
      setSelectedSquareSkill((current) => current && current.slug === slug ? { ...current, installedName: installed.name } : current);
      installedSkillsCacheRef.current = null;
      squareSkillsCacheRef.current = null;
      setSquareSkills((items) => items.map((item) => item.slug === slug ? { ...item, installed: true } : item));
      await loadInstalledSkillsForPicker();
    } catch (error) {
      setSquareError(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setSquareInstallingSlug((current) => current === slug ? null : current);
    }
  }

  // Debounced square-skill search.
  const squareSearchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function handleSquareSearchChange(value: string): void {
    setSquareSearch(value);
    if (squareSearchTimerRef.current !== undefined) clearTimeout(squareSearchTimerRef.current);
    squareSearchTimerRef.current = setTimeout(() => {
      squareSearchTimerRef.current = undefined;
      void loadSquareSkills({ search: value, tag: squareActiveTag, sort: squareSort, installFilter: squareInstallFilter });
    }, 300);
  }

  // Sort and installation-filter helpers.
  function handleSquareSortChange(sort: "downloads" | "name" | "time"): void {
    if (sort === squareSort) return;
    setSquareSort(sort);
    void loadSquareSkills({ search: squareSearch, tag: squareActiveTag, sort, installFilter: squareInstallFilter });
  }
  function handleSquareInstallFilterChange(filter: "all" | "installed" | "not_installed"): void {
    if (filter === squareInstallFilter) return;
    setSquareInstallFilter(filter);
    void loadSquareSkills({ search: squareSearch, tag: squareActiveTag, sort: squareSort, installFilter: filter });
  }

  // Infinite scroll: load the next page when the sentinel enters the viewport.
  useEffect(() => {
    const sentinel = squareSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && squareHasNext && !squareLoading && !squareLoadingMore) {
          const nextPage = squarePage + 1;
          void loadSquareSkills({
            search: squareSearch,
            tag: squareActiveTag,
            sort: squareSort,
            installFilter: squareInstallFilter,
            page: nextPage,
            append: true,
          });
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [squareHasNext, squareLoading, squareLoadingMore, squarePage, squareSearch, squareActiveTag, squareSort, squareInstallFilter]);

  function stripSkillPrefixFromInput(value: string, skillName?: string | null): string {
    const specific = skillName?.trim()
      ? zh
        ? new RegExp(`^用\\s+${escapeRegExp(skillName.trim())}\\s*`)
        : new RegExp(`^Use\\s+${escapeRegExp(skillName.trim())}\\s+skill\\s+to\\s*`, "i")
      : null;
    if (specific?.test(value)) return value.replace(specific, "");
    const generic = zh
      ? /^(用\s+)[A-Za-z0-9_\-]+(\s+|$)/
      : /^(Use\s+)[A-Za-z0-9_\-]+(\s+skill\s+to\s+)/i;
    return generic.test(value) ? value.replace(generic, "") : value;
  }

  function applySkillToComposer(skillName: string): void {
    const cleaned = stripSkillPrefixFromInput(input, selectedSkillName).replace(/^\s+/, "");
    if (cleaned !== input) applyComposerText(cleaned);
    setSelectedSkillName(skillName);
    setMetaMenuOpen(null);
    textareaRef.current?.focus();
  }

  function clearSelectedSkill(): void {
    const cleaned = stripSkillPrefixFromInput(input, selectedSkillName);
    if (cleaned !== input) applyComposerText(cleaned);
    setSelectedSkillName(null);
    textareaRef.current?.focus();
  }

  function selectAgent(agentId: string): void {
    onSelectAgent?.(agentId);
    setMetaMenuOpen(null);
    setIntroMenuOpen(null);
    textareaRef.current?.focus();
  }

  function toggleIntroMenu(menu: "workspace" | "agent"): void {
    setIntroSearchQuery("");
    setIntroMenuOpen((current) => (current === menu ? null : menu));
  }

  function selectWorkspace(workspaceId: string): void {
    onSelectWorkspace?.(workspaceId);
    setIntroMenuOpen(null);
    textareaRef.current?.focus();
  }

  function selectModel(model: string, providerId?: string): void {
    onSelectModel?.(model, providerId);
    setMetaMenuOpen(null);
    textareaRef.current?.focus();
  }

  function selectImageGenerationModel(model: string, providerId?: string): void {
    onSelectImageGenerationModel?.(model, providerId);
    setConfigurationSection(null);
    textareaRef.current?.focus();
  }

  function selectThinkingEffort(effort: ThinkingEffort): void {
    setThinkingEffort(effort);
    setMetaMenuOpen(null);
    textareaRef.current?.focus();
  }

  function selectTaskInteractionMode(mode: "normal" | "plan"): void {
    setTaskInteractionMode(mode);
    setMetaMenuOpen(null);
    setConfigurationSection(null);
    textareaRef.current?.focus();
  }

  function togglePrivateMode(): void {
    setPrivateMode((current) => !current);
    textareaRef.current?.focus();
  }

  function selectPrivateMode(enabled: boolean): void {
    setPrivateMode(enabled);
    setMetaMenuOpen(null);
    setConfigurationSection(null);
    textareaRef.current?.focus();
  }

  function selectForkQueueAgent(queueIndex: number, agentId: string): void {
    setForkQueueAgentSelections((current) => {
      const next = { ...current };
      if (agentId) {
        next[queueIndex] = agentId;
      } else {
        delete next[queueIndex];
      }
      return next;
    });
  }

  async function addFiles(): Promise<void> {
    if (!onPickFiles) return;
    const result = await onPickFiles();
    if (!result.canceled) {
      if (isRemoteAgent) {
        await addRemotePickedFiles(result.paths);
        return;
      }
      addPickedFiles(result);
    }
  }

  async function addFolder(): Promise<void> {
    if (isRemoteAgent) {
      window.alert(zh
        ? "远程智能体不支持上传文件夹，请选择单个文件（每个最大 10 MB，总计不超过 10 MB）。"
        : "Remote agents do not support folders. Attach individual files instead (up to 10 MB each, 10 MB total).");
      return;
    }
    if (!onPickFolder) return;
    const result = await onPickFolder();
    if (!result.canceled) await addFolderAttachments(result.paths);
  }

  async function addRemotePickedFiles(paths: string[]): Promise<void> {
    if (!paths.length || !hasDesktopApi() || typeof desktopApi.readAttachmentDataUrl !== "function") return;
    const added: ComposerAttachment[] = [];
    const currentBytes = attachmentsRef.current.reduce(
      (sum, item) => sum + (item.sizeBytes ?? 0), 0);
    let totalBytes = currentBytes;
    for (const path of paths) {
      let payload;
      try {
        payload = await desktopApi.readAttachmentDataUrl(path);
      } catch (error) {
        window.alert(zh
          ? `读取文件失败：${error instanceof Error ? error.message : String(error)}`
          : `Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (payload.sizeBytes > REMOTE_ATTACHMENT_LIMIT_BYTES) {
        window.alert(zh
          ? `文件 ${payload.name} 超过远程附件 10 MB 上限。`
          : `File ${payload.name} exceeds the 10 MB remote attachment limit.`);
        continue;
      }
      if (totalBytes + payload.sizeBytes > REMOTE_ATTACHMENT_LIMIT_BYTES) {
        window.alert(zh
          ? "远程附件总量超过 10 MB 上限，已停止添加。"
          : "Remote attachments exceed the 10 MB total limit; stopped adding files.");
        break;
      }
      totalBytes += payload.sizeBytes;
      added.push({
        id: crypto.randomUUID(),
        kind: "file",
        path,
        name: payload.name,
        remoteDataUrl: payload.dataUrl,
        sizeBytes: payload.sizeBytes,
        mimeType: payload.mimeType,
        ...(payload.mimeType.startsWith("image/") ? { screenshotDataUrl: payload.dataUrl } : {}),
      });
    }
    if (!added.length) return;
    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.path));
      return [...current, ...added.filter((item) => !existing.has(item.path))];
    });
    setToolsOpen(false);
  }

  function addPickedFiles(result: PickDialogResult): void {
    const selectedFiles = result.files ?? result.paths.map((path): PickedFileDescriptor => ({
      path,
      name: getPathName(path),
      extension: "",
      category: "other",
      status: "ready",
    }));
    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.path));
      return [
        ...current,
        ...selectedFiles.filter((file) => !existing.has(file.path)).map((file): ComposerAttachment => ({
          id: crypto.randomUUID(),
          kind: "file",
          path: file.path,
          name: file.name,
          importFile: file,
          ...(file.previewDataUrl?.startsWith("data:image/")
            ? { screenshotDataUrl: file.previewDataUrl }
            : {}),
          ...(file.status === "ready" ? {} : { blockedReason: file.message || file.status }),
        })),
      ];
    });
    setToolsOpen(false);
  }

  async function addFolderAttachments(paths: string[]): Promise<void> {
    setToolsOpen(false);
    for (const path of paths) {
      const existing = attachments.find((item) => item.kind === "folder" && item.path === path);
      if (existing) {
        setAttachments((current) => current.map((item) => item.id === existing.id ? {
          ...item,
          folderImport: item.folderImport ? { ...item.folderImport, duplicates: item.folderImport.duplicates + 1 } : undefined,
        } : item));
        continue;
      }
      const id = crypto.randomUUID();
      const base: ComposerAttachment = {
        id,
        kind: "folder",
        path,
        name: getPathName(path),
        folderImport: { phase: "scanning", imported: 0, skipped: 0, failed: 0, duplicates: 0, directories: 0 },
      };
      setAttachments((current) => [...current, base]);
      if (!onSummarizeWorkspaceFolder) continue;
      try {
        const summary = await onSummarizeWorkspaceFolder({ path, maxDepth: 3, maxEntries: 240, maxSampleFiles: 30 });
        setAttachments((current) => current.map((item) => item.id === id ? {
          ...item,
          path: summary.path,
          name: summary.name,
          title: `Folder summary: ${summary.name}`,
          visibleText: summary.summary,
          note: `${summary.importedFileCount} imported, ${summary.skippedFileCount} skipped, ${summary.failedFileCount} failed, ${summary.directoryCount} folders`,
          folderImport: {
            phase: "ready",
            imported: summary.importedFileCount,
            skipped: summary.skippedFileCount + summary.skippedDirectoryCount,
            failed: summary.failedFileCount,
            duplicates: item.folderImport?.duplicates || 0,
            directories: summary.directoryCount,
            message: summary.unsupportedExtensions.length ? `Unsupported: ${summary.unsupportedExtensions.join(", ")}` : undefined,
          },
        } : item));
      } catch (error) {
        const message = userFacingFailureMessage(error, language, "operation");
        setAttachments((current) => current.map((item) => item.id === id ? {
          ...item,
          blockedReason: message,
          note: `Folder summary unavailable: ${message}`,
          folderImport: { phase: "failed", imported: 0, skipped: 0, failed: 1, duplicates: item.folderImport?.duplicates || 0, directories: 0, message },
        } : item));
      }
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function applyMaterialTaskSuggestion(suggestion: MaterialTaskSuggestion): void {
    applyComposerText(suggestion.prompt);
    if (hasDesktopApi()) {
      void desktopApi.getGatewayStatus().then((status) => {
        setMaterialSuggestionRuntimeReady(status.ready && !status.externalConflict);
      }).catch(() => setMaterialSuggestionRuntimeReady(false));
    }
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(suggestion.prompt.length, suggestion.prompt.length);
    }, 0);
  }

  function createTaskFromMaterialConsistency(): void {
    if (!materialConsistencyAnalysis?.findings.length) return;
    const issueTitles = materialConsistencyAnalysis.findings
      .filter((finding) => finding.kind !== "consensus")
      .map((finding) => `“${finding.title}”`)
      .join("、");
    const prompt = zh
      ? `请根据材料比较结果继续核对${issueTitles ? ` ${issueTitles}` : "所有发现"}，逐项说明冲突双方或新旧数值、具体文件位置、修正建议和仍不确定的地方。不要覆盖原文件。`
      : `Continue from the material comparison and verify ${issueTitles || "every finding"}. For each item, cite both sides or the old and new values, exact file locations, a correction, and remaining uncertainty. Do not overwrite source files.`;
    applyComposerText(prompt);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(prompt.length, prompt.length);
    }, 0);
  }

  async function openMaterialConsistencySource(source: MaterialConsistencySource): Promise<void> {
    if (!hasDesktopApi()) return;
    try {
      const error = await desktopApi.openPath(source.path);
      setMaterialConsistencySourceStatus(error
        ? (zh ? `无法打开 ${source.name}：${error}` : `Could not open ${source.name}: ${error}`)
        : (zh ? `已打开 ${source.name} · ${source.locator}` : `Opened ${source.name} · ${source.locator}`));
    } catch (error) {
      setMaterialConsistencySourceStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  const openPreviewBrowser = useEventCallback((url?: string): void => {
    onOpenPreviewBrowser?.(url);
    setToolsOpen(false);
  });

  const handleMarkdownLink = useEventCallback((href: string | undefined): void => {
    if (!href) return;
    let protocol: string;
    try {
      protocol = new URL(href).protocol;
    } catch {
      return;
    }
    if (protocol === 'opendrsai:' && href.startsWith('opendrsai://regression/evaluations/')) {
      void desktopApi.openRegressionReference(href);
      return;
    }
    if (!['http:', 'https:', 'mailto:'].includes(protocol)) return;
    if (isPreviewBrowserUrl(href)) {
      openPreviewBrowser(href);
      return;
    }
    onOpenExternal(href);
  });

  function conversationResourceRequest(
    part: ArtifactPart | CitationPart,
  ): ConversationResourceResolveRequest | null {
    if (!workspacePath) return null;
    if (part.sessionId && part.associationId) {
      return { workspacePath, sessionId: part.sessionId, associationId: part.associationId };
    }
    if (part.resourceRef) return { workspacePath, resourceRef: part.resourceRef };
    return null;
  }

  function conversationResourceKey(part: ArtifactPart | CitationPart): string | null {
    if (part.sessionId && part.associationId) return `${part.sessionId}:${part.associationId}`;
    const reference = part.resourceRef;
    return reference ? `${reference.workspace_id}:${reference.resource_type}:${reference.resource_id}` : null;
  }

  function rememberConversationResourceState(
    part: ArtifactPart | CitationPart,
    state: ConversationResourceResolveResult["state"],
  ): void {
    const key = conversationResourceKey(part);
    if (key) setConversationResourceStates((current) => current[key] === state ? current : { ...current, [key]: state });
  }

  function describeConversationResourceState(
    resolved: ConversationResourceResolveResult,
  ): string | null {
    if (resolved.state === "deleted") return zh ? `“${resolved.name}”已删除，无法打开当前版本。` : `“${resolved.name}” was deleted and its current version cannot be opened.`;
    if (resolved.state === "offline") return zh ? `“${resolved.name}”当前离线，请检查或切换 Runtime 后重试。` : `“${resolved.name}” is offline. Check or switch Runtime, then retry.`;
    if (resolved.state === "moved") return zh ? `资源已移动到 ${resolved.logicalPath ?? resolved.name}。` : `The resource moved to ${resolved.logicalPath ?? resolved.name}.`;
    if (resolved.state === "changed") return zh ? `“${resolved.name}”在引用后已更改，现已打开当前版本。` : `“${resolved.name}” changed after it was cited; the current version is open.`;
    if (resolved.state === "unsupported") return zh ? `当前 Host 不支持打开“${resolved.name}”。` : `The current Host cannot open “${resolved.name}”.`;
    return null;
  }

  async function resolveConversationResourcePart(
    part: ArtifactPart | CitationPart,
    suppressErrorNotice = false,
  ): Promise<{ request: ConversationResourceResolveRequest; resolved: ConversationResourceResolveResult } | null> {
    const request = conversationResourceRequest(part);
    if (!request) return null;
    try {
      const resolved = await desktopApi.resolveConversationResource(request);
      rememberConversationResourceState(part, resolved.state);
      setConversationResourceNotice(describeConversationResourceState(resolved));
      return { request, resolved };
    } catch (error) {
      if (!suppressErrorNotice) {
        setConversationResourceNotice(userFacingFailureMessage(error, language, "operation"));
      }
      return null;
    }
  }

  async function previewConversationResourcePart(
    part: ArtifactPart | CitationPart,
    version: "current" | "observed" = "current",
  ): Promise<void> {
    // For office files, try the local preview first — it includes raw bytes
    // (dataUrl) which enables rich rendering (docx-preview, JSZip).  The P2
    // path only returns extracted text.
    const OFFICE_EXTS = new Set([".docx", ".pptx", ".xlsx", ".doc", ".ppt", ".xls"]);
    const RICH_LOCAL_EXTS = new Set([...OFFICE_EXTS, ".pdf"]);
    const partExt = (part.path ?? "").match(/(\.[^.]+)$/)?.[1]?.toLowerCase() ?? "";
    if (RICH_LOCAL_EXTS.has(partExt) && part.path && workspacePath) {
      try {
        const localPreview = await loadWorkspacePreview({
          workspacePath,
          path: part.path,
          maxBytes: 220_000,
        });
        // A placeholder means the bytes are gone locally; fall through so the
        // P2/locator paths below can report it with their richer wording (or
        // serve the file from the runtime).
        if (!localPreview.missing) {
          onOpenConversationResourcePreview?.(localPreview, part.path);
          setToolsOpen(false);
          return;
        }
      } catch {
        // Local preview failed — fall through to P2.
      }
    }

    // Suppress resolve-error notice here because we fall back to the local
    // path below; showing the generic banner would be misleading.
    const outcome = await resolveConversationResourcePart(part, true);
    if (!outcome) {
      // The Runtime/Gateway may be unavailable or the association may not be
      // found.  Try a direct local preview before falling back to the file
      // tree, which may not have indexed the file yet.
      if (part.path && workspacePath) {
        try {
          const localPreview = await loadWorkspacePreview({
            workspacePath,
            path: part.path,
            maxBytes: 220_000,
          });
          if (!localPreview.missing) {
            onOpenConversationResourcePreview?.(localPreview, part.path);
            setToolsOpen(false);
            return;
          }
        } catch {
          // Local preview also failed — let the file tree try.
        }
      }
      if (part.path) onOpenWorkspaceArtifact?.(part.path);
      return;
    }
    const { request, resolved } = outcome;
    if (["deleted", "offline", "unsupported"].includes(resolved.state)) return;
    try {
      const preview = await desktopApi.previewConversationResource({ ...request, version });
      onOpenConversationResourcePreview?.(preview, resolved.logicalPath ?? resolved.path);
      setToolsOpen(false);
    } catch {
      // P2 preview failed.  Try a direct local preview first — this works
      // for office files, text, and markdown because the local preview
      // function has its own content extraction (extractOfficeText etc.).
      const fallbackPath = resolved.logicalPath ?? resolved.path ?? part.path;
      if (fallbackPath && workspacePath) {
        try {
          const localPreview = await loadWorkspacePreview({
            workspacePath,
            path: fallbackPath,
            maxBytes: 220_000,
          });
          if (!localPreview.missing) {
            onOpenConversationResourcePreview?.(localPreview, fallbackPath);
            setToolsOpen(false);
            return;
          }
        } catch {
          // Local preview also failed — fall back to file tree.
        }
      }
      if (fallbackPath) onOpenWorkspaceArtifact?.(fallbackPath);
    }
  }

  const openStructuredArtifact = useEventCallback((part: ArtifactPart): void => {
    if (part.url && isSafeWebUrl(part.url)) {
      openPreviewBrowser(part.url);
      return;
    }
    if (conversationResourceRequest(part)) {
      void previewConversationResourcePart(part);
      return;
    }
    // No P2 association — try a direct local preview.
    if (part.path && workspacePath) {
      void loadWorkspacePreview(
        { workspacePath, path: part.path, maxBytes: 220_000 },
        // Clicked on purpose: don't reuse a cached `missing` answer.
        { cacheMissing: false },
      ).then((preview) => {
        // Includes the `missing` placeholder: the pane then explains that the
        // file was deleted or moved instead of opening an empty document.
        onOpenConversationResourcePreview?.(preview, part.path);
        setToolsOpen(false);
      }).catch(() => {
        if (part.path) onOpenWorkspaceArtifact?.(part.path);
      });
      return;
    }
    if (part.path) onOpenWorkspaceArtifact?.(part.path);
  });

  const downloadStructuredArtifact = useEventCallback((part: ArtifactPart): void => {
    const request = conversationResourceRequest(part);
    if (request && part.downloadable !== false) {
      const operationId = crypto.randomUUID();
      setConversationResourceDownload({ operationId, phase: "preparing", name: part.name, transferredBytes: 0 });
      void desktopApi.downloadConversationResource({ ...request, operationId, suggestedName: part.name })
        .then((result) => setConversationResourceDownload((current) => current?.operationId === operationId
          ? { ...current, phase: result.canceled ? "cancelled" : "completed", transferredBytes: result.size ?? current.transferredBytes, percent: result.canceled ? current.percent : 100 }
          : current))
        .catch(() => setConversationResourceDownload((current) => current?.operationId === operationId ? { ...current, phase: "failed" } : current));
      return;
    }
    if (!part.path || !workspacePath || part.downloadable !== true) return;
    void desktopApi.saveWorkspaceFileAs({ workspacePath, path: part.path, suggestedName: part.name });
  });

  const openStructuredCitation = useEventCallback((part: CitationPart): void => {
    if (part.url && isSafeWebUrl(part.url)) {
      openPreviewBrowser(part.url);
      return;
    }
    // A Knowledge Base document is not in the workspace, so the file panel
    // cannot find it. Its path is relative to a corpus root that only the
    // source pane knows how to resolve.
    if (part.knowledgeBaseId && (part.documentPath || part.path)) {
      onOpenCitationSource?.(part);
      return;
    }
    if (conversationResourceRequest(part)) {
      void previewConversationResourcePart(part);
      return;
    }
    // No P2 association — try a direct local preview.
    if (part.path && workspacePath) {
      void loadWorkspacePreview(
        { workspacePath, path: part.path, maxBytes: 220_000 },
        // Clicked on purpose: don't reuse a cached `missing` answer.
        { cacheMissing: false },
      ).then((preview) => {
        // Includes the `missing` placeholder, see openStructuredArtifact.
        onOpenConversationResourcePreview?.(preview, part.path);
        setToolsOpen(false);
      }).catch(() => {
        if (part.path) onOpenWorkspaceArtifact?.(part.path);
      });
      return;
    }
    if (part.path) onOpenWorkspaceArtifact?.(part.path);
  });

  const openConversationResourceMenu = useEventCallback((
    part: ArtifactPart | CitationPart,
    anchor: { x: number; y: number; trigger?: HTMLElement },
  ): void => {
    void resolveConversationResourcePart(part).then((outcome) => {
      if (!outcome) return;
      setConversationResourceMenu({ part, resolved: outcome.resolved, ...anchor });
    });
  });

  if (composerConversationIdRef.current !== conversationId) {
    const previousAttachments = attachmentsRef.current;
    if (previousAttachments.length) {
      composerAttachmentsByThreadRef.current.set(composerConversationIdRef.current, [...previousAttachments]);
    } else {
      composerAttachmentsByThreadRef.current.delete(composerConversationIdRef.current);
    }
    composerConversationIdRef.current = conversationId;
    const restoredAttachments = composerAttachmentsByThreadRef.current.get(conversationId);
    setAttachments(restoredAttachments ? [...restoredAttachments] : []);
  }

  return (
    <div className="chat-workspace">
      <div className={`chat-primary-pane ${emptyChat ? "empty-chat" : ""}`}>
      {searchOpen && (
        <div className="chat-search-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="chat-search-backdrop"
            aria-label={zh ? "关闭搜索" : "Close search"}
            onClick={closeSearch}
          />
          <section className="chat-search-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="chat-search-modal-header">
              <h2>{zh ? "搜索当前会话" : "Search Current Chat"}</h2>
              <button
                type="button"
                className="chat-search-close"
                onClick={closeSearch}
                title={zh ? "关闭搜索" : "Close search"}
                aria-label={zh ? "关闭搜索" : "Close search"}
              >
                <X size={17} />
              </button>
            </div>
            <div className="chat-search-modal-body">
          <div className="chat-search-strip">
          <Search size={15} aria-hidden />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (isTextCompositionEvent(event.nativeEvent)) return;
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              } else if (event.key === "Enter" && event.shiftKey) {
                event.preventDefault();
                selectPreviousMatch();
              } else if (event.key === "Enter") {
                event.preventDefault();
                selectNextMatch();
              }
            }}
            placeholder={zh ? "搜索当前会话..." : "Search current chat..."}
            aria-label={zh ? "搜索当前会话" : "Search current chat"}
          />
          <input
            type="date"
            className="chat-search-date"
            value={searchDate}
            onChange={(event) => locateConversationDate(event.target.value)}
            aria-label={zh ? "按日期定位" : "Go to date"}
            title={zh ? "按日期定位" : "Go to date"}
          />
          <span className="chat-search-count">
            {searchQuery.trim()
              ? searchMatches.length > 0
                ? `${(activeMatchIndex % searchMatches.length) + 1} / ${searchMatches.length}`
                : "No results"
              : "Type to search"}
          </span>
          <button
            type="button"
            className="chat-search-step previous"
            disabled={searchMatches.length === 0}
            onClick={selectPreviousMatch}
            title="Previous match"
            aria-label="Previous match"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="chat-search-step"
            disabled={searchMatches.length === 0}
            onClick={selectNextMatch}
            title="Next match"
            aria-label="Next match"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="chat-search-close"
            onClick={closeSearch}
            title={zh ? "关闭搜索" : "Close search"}
            aria-label={zh ? "关闭搜索" : "Close search"}
          >
            <X size={15} />
          </button>
          </div>
            </div>
          </section>
        </div>
      )}
      {emptyChat && operationalStateControl ? (
        <header className="conversation-titlebar conversation-titlebar-operational-only" data-testid="conversation-titlebar">
          <div className="conversation-titlebar-main" />
          <div className="conversation-titlebar-actions">{operationalStateControl}</div>
        </header>
      ) : null}
      {!emptyChat && (
      <header className="conversation-titlebar" data-testid="conversation-titlebar">
        <div className="conversation-titlebar-main">
          <strong title={conversationTitle || conversationId}>{conversationTitle || conversationId.slice(0, 12)}</strong>
          {conversationHistory?.source === "codex" || continuesExistingTask ? <span className="conversation-backend-badge">Codex</span> : null}
          <small className={`conversation-sync-status state-${conversationHistory?.state || (conversationHistoryPending ? "loading" : "ready")}`} data-testid="conversation-sync-status">{conversationHistoryPending
          ? (zh ? "正在同步" : "Syncing")
          : conversationHistory?.state === "partial"
            ? (zh ? "部分同步" : "Partially synced")
            : conversationHistory?.state === "error"
              ? (zh ? "同步失败" : "Sync failed")
              : conversationHistory?.source === "codex"
                ? (zh ? `已同步 · ${conversationHistory.loadedRuns} 轮` : `Synced · ${conversationHistory.loadedRuns} turns`)
                : (zh ? "已就绪" : "Ready")}</small>
        </div>
        <div className="conversation-titlebar-actions">
          {operationalStateControl}
          {conversationHistory?.truncated && (conversationHistory.oaepNextCursor || conversationHistory.nextCursor) && onLoadEarlierHistory ? (
            <button type="button" className="conversation-load-earlier" disabled={conversationHistoryPending} onClick={() => void onLoadEarlierHistory()}>
              {conversationHistoryPending ? (zh ? "加载中…" : "Loading…") : (zh ? "加载更早内容" : "Load earlier")}
            </button>
          ) : null}
          <details className="conversation-titlebar-details">
            <summary title={zh ? "会话详情" : "Chat details"} aria-label={zh ? "会话详情" : "Chat details"}>•••</summary>
            <dl>
              <div><dt>{zh ? "工作区" : "Workspace"}</dt><dd>{workspaceName || "—"}</dd></div>
              <div><dt>{zh ? "后端" : "Backend"}</dt><dd>{conversationHistory?.source === "codex" || continuesExistingTask ? "Codex" : selectedAgentName || "OpenDrSai"}</dd></div>
              <div><dt>{zh ? "会话 ID" : "Session ID"}</dt><dd title={conversationId}>{conversationId}</dd></div>
              {conversationHistory ? <div><dt>{zh ? "已加载" : "Loaded"}</dt><dd>{conversationHistory.loadedRuns} {zh ? "轮" : "turns"}</dd></div> : null}
              {continuesExistingTask ? <div><dt>{zh ? "继续方式" : "Continuation"}</dt><dd>{zh ? "在当前 Codex 任务中继续" : "Continue in the current Codex task"}</dd></div> : null}
            </dl>
          </details>
        </div>
      </header>
      )}
      {!emptyChat && awayFromLatest ? <button
        type="button"
        className="conversation-jump-latest"
        data-testid="conversation-jump-latest"
        onClick={scrollToLatest}
      >{zh ? "回到最新消息" : "Jump to latest"}</button> : null}
      {workspaceLocation === "remote" ? <div className="remote-session-migration-notice" role="note" data-testid="remote-session-migration-notice">
        {zh ? "这是远程工作区。为避免上下文串线，本地会话不会自动绑定到远程 Runtime；请在远程工作区中新建会话，或使用明确的迁移流程。" : "This is a remote workspace. Local sessions are never auto-bound to the remote Runtime; start a remote session or use an explicit migration flow."}
      </div> : null}
      {!emptyChat && (
      <div
        className="message-list"
        ref={messageListRef}
        onScroll={handleMessageListScroll}
        onWheel={handleMessageListWheel}
        onPointerDown={handleMessageListPointerDown}
        onKeyDown={handleMessageListKeyDown}
      >
        {renderedMessages.map((message, messageIndex) => (
          <VirtualizedMessage
            key={message.id}
            message={message}
            className={`message ${message.role} ${message.error ? "error" : ""} ${searchMatchSet.has(message.id) ? "search-match" : ""} ${activeMatchId === message.id ? "search-active" : ""} ${message.structuredTurn?.turnId === highlightedTurnId ? "structured-turn-focus" : ""}`}
            pinned={message.streaming === true || visibleMessages.length - messageIndex <= 12}
            scrollRootRef={messageListRef}
            language={language}
            workspacePath={workspacePath}
            searchQuery={searchQuery}
            conversationResourceStates={conversationResourceStates}
            respondedInputRequests={respondedInputRequests}
            configuredCapabilityRequests={configuredCapabilityRequests}
            reproducibilityLevel={message.runtimeRunId ? runReproducibility[message.runtimeRunId] : undefined}
            voicePlayback={messageVoicePlayback}
            playbackDisabled={showAnyVoiceCaptureBar || isVoiceCaptureActive(voiceTurnState.phase)}
            playbackRate={voicePreferences.playbackRate}
            synthesisMode={resolveVoiceSynthesisMode(voicePreferences.synthesisMode, voicePreferences.remoteTtsConsent)}
            voiceName={voicePreferences.voiceName}
            turnActionsDisabled={Boolean(activeRequestId) || !canChat}
            handleMarkdownLink={handleMarkdownLink}
            openStructuredArtifact={openStructuredArtifact}
            downloadStructuredArtifact={downloadStructuredArtifact}
            openConversationResourceMenu={openConversationResourceMenu}
            openStructuredCitation={openStructuredCitation}
            respondToStructuredInteraction={respondToStructuredInteraction}
            requestStructuredTextInput={requestStructuredTextInput}
            startEditAndResend={messageEvents.startEditAndResend}
            startEditUserMessage={messageEvents.startEditUserMessage}
            regenerateAssistant={messageEvents.regenerateAssistant}
            onRetryMessage={onRetryMessage ? messageEvents.onRetryMessage : undefined}
            onReportFeedback={onReportFeedback ? messageEvents.onReportFeedback : undefined}
            onRecoveryAction={onRecoveryAction ? messageEvents.onRecoveryAction : undefined}
            onDeleteMessage={onDeleteMessage ? messageEvents.onDeleteMessage : undefined}
          />
        ))}
      </div>
      )}
      {!emptyChat && turnRailMarkers.length > 0 ? (
        <nav
          className="conversation-turn-rail"
          aria-label={zh ? "用户输入定位" : "User message navigation"}
          style={{ gridTemplateRows: `repeat(${turnRailMarkers.length}, minmax(0, 1fr))` }}
        >
          {turnRailMarkers.map((marker, index) => {
            const message = messages.find((item) => item.id === marker.id);
            const label = message?.content.trim().replace(/\s+/g, " ") || `${zh ? "用户输入" : "User message"} ${index + 1}`;
            return (
              <button
                key={marker.id}
                type="button"
                className={marker.id === activeTurnRailId ? "active" : ""}
                data-turn-id={marker.id}
                title={label}
                aria-label={`${zh ? "定位到用户输入" : "Go to user message"} ${index + 1}: ${label.slice(0, 80)}`}
                tabIndex={marker.id === activeTurnRailId || (!activeTurnRailId && index === 0) ? 0 : -1}
                onClick={() => scrollToUserTurn(marker.id)}
                onKeyDown={(event) => handleTurnRailKeyDown(event, index)}
              />
            );
          })}
        </nav>
      ) : null}
      {emptyChat && conversationHistoryPending && (
        <div className="empty-chat-history-loading" role="status" aria-live="polite">
          <span className="chat-loading-indicator" aria-hidden />
          <strong>{conversationSource === "codex"
            ? (zh ? "正在加载 Codex 会话…" : "Loading Codex session…")
            : (zh ? "正在加载 OpenDrSai 会话…" : "Loading OpenDrSai session…")}</strong>
          <small>{zh ? "首次打开较长会话可能需要几秒钟。" : "A long conversation can take a few seconds the first time it is opened."}</small>
        </div>
      )}
      {emptyChat && !conversationHistoryPending && (
        <div className="empty-chat-intro" role="group" aria-label={zh ? "新建会话" : "New conversation"}>
          <img className="empty-chat-logo" src={drsaiLogo} alt="OpenDrSai" />
          <h1>
            <span>
              {zh ? "在 " : "In "}
              <strong>{activeWorkspaceName}</strong>
              {zh ? " 工作区，用 " : " workspace, using "}
              <strong>{activeAgentName}</strong>
              {zh ? " 智能体，做什么呢？" : " agent, what should we do?"}
            </span>
          </h1>
          {emptyChatPreferenceNotice ? (
            <div className="remembered-preferences-notice" data-testid="remembered-preferences-notice" role="status">
              {emptyChatPreferenceNotice}
            </div>
          ) : null}
        </div>
      )}
      {emptyChat && !conversationHistoryPending && (
        <section className="sample-prompts" aria-label={zh ? "示例任务" : "Example tasks"}>
          {emptyChatPrompts.map((prompt, index) => {
            const PromptIcon = [Telescope, Hammer, ScanSearch, Bug][index] ?? Telescope;
            return (
              <button
                className={`sample-prompt-card sample-prompt-card-${index + 1}`}
                key={`${index}-${prompt.slice(0, 32)}`}
                type="button"
                title={prompt}
                onClick={() => selectSamplePrompt(prompt)}
              >
                <PromptIcon size={18} aria-hidden />
                <span>{prompt}</span>
              </button>
            );
          })}
        </section>
      )}
      <form
        ref={composerDropRef}
        className="composer"
        data-voice-turn-phase={displayedVoicePhase}
        onSubmit={handleSubmit}
      >
        {!canChat && !showStop && chatUnavailableReason ? (
          <div className="composer-locked-notice" role="status" aria-live="polite" data-testid="composer-locked-notice">
            {chatUnavailableReason}
          </div>
        ) : null}
        <div className="composer-shell">
          {pendingReplaceFromMessageId ? (
            <div className="composer-edit-resend" data-testid="composer-edit-resend" role="status">
              <span>{zh ? "将用这段文字替换该轮提问及之后的回复" : "This will replace that prompt and later replies"}</span>
              <button type="button" onClick={cancelEditAndResend}>{zh ? "取消" : "Cancel"}</button>
            </div>
          ) : null}
          {channelSource === "wechat" ? (
            <div className="wechat-outbound-notice" data-testid="wechat-outbound-notice" role="status">
              <strong>{zh ? "微信会话" : "WeChat conversation"}</strong>
              <span>{wechatCapability?.available
                ? (wechatConfirmationPending ? (zh ? "再次点击“确认发送到微信”才会外发。" : "Click “Confirm send to WeChat” to send externally.") : (zh ? "普通 Desktop 消息不会外发；请使用明确的发送到微信操作。" : "Ordinary Desktop messages are not sent externally; use the explicit WeChat action."))
                : (zh ? "当前无法回复：等待对方先发消息，或启动微信频道。" : "Reply unavailable: wait for an inbound message or start the WeChat channel.")}</span>
              {wechatSendStatus ? <small>{wechatSendStatus}</small> : null}
            </div>
          ) : null}
          {externalAttachments.some((attachment) => attachment.kind === "terminal") && (
            <div className="composer-terminal-cards">
              {externalAttachments.map((attachment, index) =>
                attachment.kind === "terminal" ? (
                  <article
                    className="composer-terminal-card"
                    key={`terminal-card-${index}-${attachment.path}`}
                  >
                    <Terminal size={15} />
                    <div>
                      <strong>{attachment.name}</strong>
                      <span>{attachment.title || attachment.path}</span>
                      {attachmentContextSummary(attachment) ? <small>{attachmentContextSummary(attachment)}</small> : null}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => onRemoveExternalAttachment?.(index)}
                    >
                      <X size={13} />
                    </button>
                  </article>
                ) : null,
              )}
            </div>
          )}
          <div className="composer-attachments" aria-live="polite">
            {attachments.map((attachment) => (
              <ComposerAttachmentChip
                key={attachment.id}
                attachment={attachment}
                workspacePath={workspacePath}
                zh={zh}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
            {externalAttachments.map((attachment, index) => {
              if (attachment.kind === "terminal") return null;
              const name =
                attachment.title ||
                attachment.name ||
                attachment.url ||
                "Browser context";
              const Icon =
                attachment.kind === "folder"
                  ? FolderPlus
                  : attachment.kind === "selection"
                    ? ClipboardList
                  : attachment.kind === "browser"
                    ? Globe2
                    : Paperclip;
              return (
                <span
                  className="composer-attachment-chip"
                  key={`external-browser-${index}-${attachment.path}`}
                  title={attachment.path}
                >
                  <Icon size={14} />
                  <span className="composer-attachment-copy">
                    <strong>{name}</strong>
                    {attachmentContextSummary(attachment) ? <small>{attachmentContextSummary(attachment)}</small> : null}
                  </span>
                  <button
                    type="button"
                    aria-label={zh ? `绉婚櫎 ${name}` : `Remove ${name}`}
                    onClick={() => onRemoveExternalAttachment?.(index)}
                  >
                    <X size={13} />
                  </button>
                </span>
              );
            })}
          </div>

          {materialRolePhase !== "idle" && (
            <section
              className={`material-role-panel ${materialRolePhase}`}
              data-testid="material-role-panel"
              data-analysis-phase={materialRolePhase}
              aria-live="polite"
            >
              <div className="material-role-panel-header">
                <strong><Brain size={14} />{zh ? "材料角色" : "Material roles"}</strong>
                <span>{materialRolePhase === "analyzing" ? (zh ? "正在识别…" : "Analyzing…") : materialRolePhase === "failed" ? (zh ? "暂时无法识别" : "Analysis unavailable") : (zh ? `已识别 ${materialRoleAnalysis?.items.length || 0} 项` : `${materialRoleAnalysis?.items.length || 0} identified`)}</span>
              </div>
              {materialRolePhase === "ready" && materialRoleAnalysis ? (
                <div className="material-role-groups">
                  {(["previous_report", "latest_data", "result_image", "reference_material"] as const)
                    .filter((role) => (materialRoleAnalysis.roleCounts[role] || 0) > 0)
                    .map((role) => (
                    <article
                      key={role}
                      data-material-role={role}
                      data-role-count={materialRoleAnalysis.roleCounts[role]}
                    >
                      <b>{formatMaterialRoleLabel(role, zh)}</b>
                      <span>{materialRoleAnalysis.roleCounts[role]} {zh ? "项" : "items"}</span>
                      <small>{formatMaterialRoleFiles(materialRoleAnalysis.items, role, zh)}</small>
                    </article>
                  ))}
                </div>
              ) : null}
              {materialRolePhase === "ready" ? <p>{zh ? "你可以直接问：我有哪些材料？" : "You can ask: What materials do I have?"}</p> : null}
            </section>
          )}

          {materialConsistencyPhase !== "idle" ? (
            <section
              className={`material-consistency-panel ${materialConsistencyPhase}`}
              data-testid="material-consistency-panel"
              data-analysis-phase={materialConsistencyPhase}
              aria-live="polite"
            >
              <div className="material-consistency-header">
                <strong>{zh ? "材料之间有哪些关系" : "How the materials relate"}</strong>
                <span>{materialConsistencyPhase === "analyzing"
                  ? (zh ? "正在逐项比较…" : "Comparing…")
                  : materialConsistencyPhase === "failed"
                    ? (zh ? "暂时无法完成比较" : "Comparison unavailable")
                    : (zh ? `发现 ${materialConsistencyAnalysis?.findings.length || 0} 项` : `${materialConsistencyAnalysis?.findings.length || 0} findings`)}</span>
              </div>
              {materialConsistencyPhase === "ready" && materialConsistencyAnalysis ? (
                <>
                  <p>{materialConsistencyAnalysis.summary}</p>
                  {materialConsistencyAnalysis.findings.length ? (
                    <div className="material-consistency-findings">
                      {materialConsistencyAnalysis.findings.map((finding) => (
                        <article
                          key={finding.id}
                          className={`material-consistency-finding ${finding.kind}`}
                          data-testid="material-consistency-finding"
                          data-finding-kind={finding.kind}
                          data-finding-id={finding.id}
                        >
                          <header>
                            <strong>{finding.title}</strong>
                            <em>{formatMaterialConsistencyKind(finding.kind, zh)}</em>
                          </header>
                          <p>{finding.explanation}</p>
                          <small>{zh ? "建议：" : "Recommendation: "}{finding.recommendation}</small>
                          <div className="material-consistency-sources">
                            {finding.sources.map((source) => (
                              <button
                                type="button"
                                key={`${finding.id}-${source.path}-${source.locator}`}
                                data-testid="material-consistency-source"
                                data-source-name={source.name}
                                data-source-locator={source.locator}
                                onClick={() => void openMaterialConsistencySource(source)}
                              >
                                <strong>{source.name}</strong>
                                <span>{source.locator} · {source.value}</span>
                                <small>{source.excerpt}</small>
                              </button>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <p>{zh ? "暂未发现可以确定的共识、冲突或过期数字。" : "No reliable consensus, conflict, or outdated number was found."}</p>}
                  {materialConsistencyAnalysis.findings.length ? (
                    <button
                      type="button"
                      className="material-consistency-create-task"
                      data-testid="material-consistency-create-task"
                      onClick={createTaskFromMaterialConsistency}
                    >
                      {zh ? "基于这些发现继续核对" : "Continue checking these findings"}
                    </button>
                  ) : null}
                  {materialConsistencySourceStatus ? <output data-testid="material-consistency-source-status">{materialConsistencySourceStatus}</output> : null}
                </>
              ) : null}
            </section>
          ) : null}

          {materialRolePhase === "ready" && !composerText.trim() && materialTaskSuggestions.length > 0 ? (
            <section className="material-task-suggestions" data-testid="material-task-suggestions">
              <div className="material-task-suggestions-header">
                <strong>{zh ? "你可以接着做" : "Suggested next tasks"}</strong>
                <span>{zh ? "选择后仍可修改" : "Click to edit before sending"}</span>
              </div>
              <div className="material-task-suggestion-list">
                {materialTaskSuggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion.id}
                    data-testid="material-task-suggestion"
                    data-suggestion-id={suggestion.id}
                    data-suggestion-prompt={suggestion.prompt}
                    onClick={() => applyMaterialTaskSuggestion(suggestion)}
                  >
                    <strong>{suggestion.title}</strong>
                    <span>{suggestion.description}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {showContextPreview && (
            <section className="context-assembly-preview" aria-label={zh ? "上下文预览" : "Context assembly preview"}>
              <div className="context-assembly-preview-header">
                <strong>
                  <Info size={13} />
                  {zh ? "上下文预览" : "Context preview"}
                </strong>
                <span
                  className={`context-budget-meter ${contextBudget.level}`}
                  title={`Estimated prompt context budget: ${contextBudget.estimatedTokens} / ${contextBudget.limit} tokens. Raw estimate ${contextBudget.rawEstimatedTokens} tokens. ${contextBudget.source}. ${contextBudget.calibrationSource ?? "No tokenizer calibration samples."} ${contextBudget.calibrationDrift ?? ""} ${contextBudget.reservedOutputTokens} tokens reserved for output.`}
                >
                  {zh ? `${contextPreviewItems.length} 项材料 · ${formatApproxTokensZh(contextBudget.estimatedTokens)}` : `${contextPreviewItems.length} visible source${contextPreviewItems.length === 1 ? "" : "s"} · ${formatApproxTokens(contextBudget.estimatedTokens)}`}
                  <small>{zh ? formatContextBudgetSourceZh(contextBudget) : contextBudget.calibrationSource ?? contextBudget.source}</small>
                  {contextBudget.calibrationDrift ? <small>{contextBudget.calibrationDrift}</small> : null}
                </span>
              </div>
              <div className="context-assembly-preview-list">
                {contextPreviewItems.map((item) => (
                  <span className="context-assembly-preview-item" key={item.key} title={item.detail}>
                    <b>{zh ? formatContextKindZh(item.kind) : item.kind}</b>
                    {item.label}
                    <small>{zh ? formatApproxTokensZh(item.estimatedTokens) : formatApproxTokens(item.estimatedTokens)}</small>
                  </span>
                ))}
              </div>
              <p>{zh ? formatContextBudgetMessageZh(contextBudget) : `${contextBudget.message} Only these visible sources and workspace instructions are sent with the next message.`}</p>
            </section>
          )}

          {showSlashCommands && (
            <div className="slash-command-panel" role="listbox" aria-label="Slash commands">
              {slashCommandMatches.map((command) => (
                <button
                  key={command}
                  type="button"
                  role="option"
                  onClick={() => selectSlashCommand(command)}
                >
                  <strong>/{command}</strong>
                  <span>{getSlashCommandDescription(command)}</span>
                </button>
              ))}
            </div>
          )}

          {showForkQueueAgentPanel && (
            <section className="composer-fork-queue-agent-panel" aria-label="Fork queue agent assignments">
              <div className="composer-fork-queue-agent-header">
                <strong>
                  <Bot size={13} />
                  Fork queue agents
                </strong>
                <span>Choose per-subtask agents before queue creation.</span>
              </div>
              <div className="composer-fork-queue-agent-list">
                {forkQueueEntries.map((entry, index) => {
                  const queueIndex = index + 1;
                  return (
                    <label className="composer-fork-queue-agent-row" key={`${queueIndex}-${entry.intent}`}>
                      <span title={entry.intent}>
                        <b>{queueIndex}</b>
                        {entry.intent}
                      </span>
                      <select
                        value={forkQueueAgentSelections[queueIndex] ?? ""}
                        onChange={(event) => selectForkQueueAgent(queueIndex, event.target.value)}
                        aria-label={`Assign agent for fork queue subtask ${queueIndex}`}
                      >
                        <option value="">
                          {entry.agentHint ? (zh ? `使用 @${entry.agentHint}` : `Use @${entry.agentHint}`) : (zh ? `默认：${activeAgentName}` : `Default: ${activeAgentName}`)}
                        </option>
                        {agentOptions.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          <div className="composer-box">
            <div className="composer-input-row">
              <div className="composer-tools" ref={toolsMenuRef}>
                <button
                  ref={attachmentButtonRef}
                  type="button"
                  className="composer-icon-button"
                  aria-expanded={toolsOpen}
                  aria-label={zh ? "添加附件或工具" : "Add attachment or tool"}
                  title={zh ? "添加附件或工具" : "Add attachment or tool"}
                  onClick={() => setToolsOpen((open) => !open)}
                >
                  <Plus size={18} />
                </button>
                {toolsOpen && (
                  <div className="composer-tool-menu">
                    {/* Attachments group — the core "+" functionality */}
                    <div className="composer-tool-group" role="group" aria-label={zh ? "附件" : "Attachments"}>
                      <button type="button" onClick={addFiles}>
                        <span data-testid="composer-add-file-label" hidden />
                        <Paperclip size={15} />
                        {zh ? "添加文件" : "Add File"}
                      </button>
                      <button type="button" onClick={addFolder}>
                        <span data-testid="composer-add-folder-label" hidden />
                        <FolderPlus size={15} />
                        {zh ? "添加文件夹" : "Add Folder"}
                      </button>
                    </div>
                    {/* IDE integration group */}
                    <div className="composer-tool-group" role="group" aria-label={zh ? "IDE 集成" : "IDE Integration"}>
                      <button
                        type="button"
                        disabled={!canAttachIdeCurrentFile}
                        title={!canAttachIdeCurrentFile ? (zh ? "需要先在 IDE 中打开文件" : "Open a file in the IDE first") : undefined}
                        onClick={() => {
                          onAttachIdeCurrentFile?.();
                          setToolsOpen(false);
                        }}
                      >
                        <FileCode2 size={15} />
                        {zh ? "IDE 当前文件" : "IDE current file"}
                      </button>
                      <button
                        type="button"
                        disabled={!canAttachIdeCurrentSelection}
                        title={!canAttachIdeCurrentSelection ? (zh ? "需要先在 IDE 中选中文本" : "Select text in the IDE first") : undefined}
                        onClick={() => {
                          onAttachIdeCurrentSelection?.();
                          setToolsOpen(false);
                        }}
                      >
                        <TextCursorInput size={15} />
                        {zh ? "IDE 选中文本" : "IDE selection"}
                      </button>
                      <button
                        type="button"
                        disabled
                        title={zh ? "当前版本暂不支持此功能" : "This feature is not currently supported"}
                      >
                        <RefreshCw size={15} />
                        {zh ? "刷新 IDE 上下文" : "Refresh IDE context"}
                      </button>
                    </div>
                    {/* Tools group */}
                    <div className="composer-tool-group" role="group" aria-label={zh ? "工具" : "Tools"}>
                      <button
                        type="button"
                        disabled
                        title={zh ? "当前版本暂不支持此功能" : "This feature is not currently supported"}
                      >
                        <Globe2 size={15} />
                        {zh ? "预览浏览器" : "Open Preview"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {activeInputRequest ? (
                <section className="chat-agent-input-request composer-agent-interaction" data-testid="composer-agent-interaction" aria-label={zh ? "智能体请求输入" : "Agent input request"}>
                  <div className="composer-agent-interaction-copy">
                    <strong>{activeGoalConfirmation
                      ? (zh ? "确认任务目标" : "Confirm task goal")
                      : (zh ? "智能体需要你的输入" : "Agent needs your input")}</strong>
                    <span>{activeGoalConfirmation
                      ? goalConfirmationDraft.objective
                      : activeInputRequest.prompt}</span>
                  </div>
                  {activeGoalConfirmation ? (
                    goalConfirmationEditing ? (
                      <div className="structured-goal-editor" data-testid="composer-goal-editor">
                        <label>{zh ? "目标" : "Goal"}<textarea data-testid="composer-goal-objective" value={goalConfirmationDraft.objective} onChange={(event) => setGoalConfirmationDraft((current) => ({ ...current, objective: event.target.value }))} /></label>
                        <label>{zh ? "材料（每行一项）" : "Materials (one per line)"}<textarea data-testid="composer-goal-materials" value={goalConfirmationDraft.materials} onChange={(event) => setGoalConfirmationDraft((current) => ({ ...current, materials: event.target.value }))} /></label>
                        <label>{zh ? "输出（每行一项）" : "Outputs (one per line)"}<textarea data-testid="composer-goal-outputs" value={goalConfirmationDraft.outputs} onChange={(event) => setGoalConfirmationDraft((current) => ({ ...current, outputs: event.target.value }))} /></label>
                        <label>{zh ? "约束（每行一项）" : "Constraints (one per line)"}<textarea data-testid="composer-goal-constraints" value={goalConfirmationDraft.constraints} onChange={(event) => setGoalConfirmationDraft((current) => ({ ...current, constraints: event.target.value }))} /></label>
                        <div className="composer-agent-interaction-controls">
                          <button type="button" onClick={() => setGoalConfirmationEditing(false)}>{zh ? "取消修改" : "Cancel edit"}</button>
                          <button type="button" className="primary" data-testid="composer-goal-save" disabled={!goalConfirmationDraft.objective.trim() || splitGoalConfirmationList(goalConfirmationDraft.outputs).length === 0} onClick={() => {
                            respondToActiveInput({
                              decision: "revise",
                              goal: {
                                objective: goalConfirmationDraft.objective.trim(),
                                materials: splitGoalConfirmationList(goalConfirmationDraft.materials),
                                outputs: splitGoalConfirmationList(goalConfirmationDraft.outputs),
                                constraints: splitGoalConfirmationList(goalConfirmationDraft.constraints),
                              },
                            });
                            setGoalConfirmationEditing(false);
                          }}>{zh ? "保存修改" : "Save changes"}</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <details className="composer-goal-details">
                          <summary>{zh ? "查看材料、输出和约束" : "Review materials, outputs, and constraints"}</summary>
                          <dl>
                            <div><dt>{zh ? "材料" : "Materials"}</dt><dd>{goalConfirmationDraft.materials || (zh ? "未提供" : "None supplied")}</dd></div>
                            <div><dt>{zh ? "输出" : "Outputs"}</dt><dd>{goalConfirmationDraft.outputs || (zh ? "未指定" : "Not specified")}</dd></div>
                            <div><dt>{zh ? "约束" : "Constraints"}</dt><dd>{goalConfirmationDraft.constraints || (zh ? "无" : "None supplied")}</dd></div>
                          </dl>
                        </details>
                        <div className="composer-agent-interaction-controls">
                          <button type="button" data-testid="composer-goal-edit" onClick={() => setGoalConfirmationEditing(true)}>{zh ? "修改或补充" : "Edit or add details"}</button>
                          <button type="button" data-testid="composer-goal-cancel" onClick={() => respondToActiveInput({ decision: "decline" })}>{zh ? "取消任务" : "Cancel task"}</button>
                          <button type="button" className="primary" data-testid="composer-goal-confirm" onClick={() => respondToActiveInput({ decision: "accept" })}>{zh ? "确认并开始" : "Confirm and start"}</button>
                        </div>
                      </>
                    )
                  ) : activeInputRequest.inputType === "approval" ? (
                    <div className="composer-agent-interaction-controls">
                      <button type="button" onClick={() => dismissActiveInputRequest()}>
                        {zh ? "关闭并继续输入" : "Close and type"}
                      </button>
                      <button type="button" onClick={() => respondToActiveInput({ approved: false })}>{zh ? "拒绝" : "Reject"}</button>
                      <button type="button" className="primary" onClick={() => respondToActiveInput({ approved: true })}>{zh ? "批准" : "Approve"}</button>
                    </div>
                  ) : activeInputRequest.inputType === "confirmation" ? (
                    <div className="composer-agent-interaction-controls">
                      <button type="button" onClick={() => dismissActiveInputRequest()}>
                        {zh ? "关闭并继续输入" : "Close and type"}
                      </button>
                      <button type="button" onClick={() => respondToActiveInput({ decision: "decline" })}>{zh ? "取消" : "Cancel"}</button>
                      <button type="button" className="primary" onClick={() => respondToActiveInput({ decision: "accept" })}>{zh ? "确认" : "Confirm"}</button>
                    </div>
                  ) : activeInputRequest.inputType === "choice" && activeInputRequest.options?.length ? (
                    <div className="composer-agent-interaction-controls">
                      <button type="button" onClick={() => dismissActiveInputRequest()}>
                        {zh ? "关闭并继续输入" : "Close and type"}
                      </button>
                      {activeInputRequest.options.map((option) => (
                        <button
                          type="button"
                          key={option.id}
                          onClick={() => respondToActiveInput({ choice: option.value ?? option.id, choice_id: option.id })}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="composer-editor composer-agent-interaction-controls">
                      <textarea
                        data-testid="composer-agent-interaction-input"
                        value={interactionDraft}
                        onChange={(event) => setInteractionDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submitInteractionDraft();
                        }}
                        placeholder={zh ? "输入给智能体的回复..." : "Reply to the agent..."}
                        rows={1}
                      />
                      <button type="button" className="composer-submit" disabled={!interactionDraft.trim()} onClick={submitInteractionDraft}>
                        <Send size={16} />
                      </button>
                    </div>
                  )}
                </section>
              ) : voiceReviewText !== null ? (
                <div className="composer-streaming-review-stack">
                  <VoiceReviewBar
                    value={voiceReviewText}
                    disclosure={voiceRuntimeDisclosure}
                    onChange={setVoiceReviewText}
                    onAccept={acceptVoiceReview}
                    onRetry={() => void retryVoiceReview()}
                    onDiscard={discardVoiceReview}
                  />
                </div>
              ) : showDuplexVoiceCaptureBar ? (
                <div className="composer-voice-status" data-testid="duplex-voice-status" data-state={duplexHudState}>
                  <strong role="status" aria-live="polite" aria-atomic="true">{zh ? "实时语音" : "Realtime voice"}: {duplexHudLabel(duplexHudState, zh)}</strong>
                  <label><span>{zh ? "输入音量" : "Input level"}</span><progress aria-label={zh ? "实时语音输入音量" : "Realtime voice input level"} value={Math.min(1, duplexVoiceInput.vad?.level ?? 0)} max="1" /></label>
                  <small>{zh ? `输出：${duplexVoiceInput.playback.outputState === "running" ? "正常" : "已暂停"}` : `Output: ${duplexVoiceInput.playback.outputState}`}</small>
                  {duplexVoiceInput.inputTranscript ? <small>{duplexVoiceInput.inputTranscript}</small> : null}
                  {duplexVoiceInput.outputTranscript ? <small>{duplexVoiceInput.outputTranscript}</small> : null}
                  {duplexVoiceInput.flowControl.paused ? <small>{zh ? "音频上行暂缓" : "Audio uplink paused"}</small> : null}
                  <label>
                    <span>{zh ? "麦克风" : "Microphone"}</span>
                    <select aria-label={zh ? "实时语音麦克风" : "Realtime voice microphone"} value={duplexVoiceInput.constraints?.requestedDeviceId ?? ""} disabled={duplexVoiceInput.deviceSwitching} onChange={(event) => void duplexVoiceInput.switchInputDevice(event.target.value)}>
                      <option value="">{zh ? "系统默认" : "System default"}</option>
                      {duplexVoiceInput.devices.filter((device) => device.deviceId).map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || (zh ? "麦克风" : "Microphone")}</option>)}
                    </select>
                  </label>
                  {duplexVoiceInput.deviceSwitching ? <small>{zh ? "正在切换麦克风…" : "Switching microphone…"}</small> : null}
                  {duplexVoiceInput.deviceSwitchError ? <small role="alert">{zh ? `麦克风切换失败：${duplexVoiceInput.deviceSwitchError}` : `Microphone switch failed: ${duplexVoiceInput.deviceSwitchError}`}</small> : null}
                  <label>
                    <span>{zh ? "扬声器" : "Output"}</span>
                    <select aria-label={zh ? "实时语音输出设备" : "Realtime voice output device"} value={voicePreferences.realtimeOutputDeviceId} disabled={duplexVoiceInput.outputDeviceSwitching} onChange={(event) => { const sinkId = event.target.value; void duplexVoiceInput.switchOutputDevice(sinkId).then((switched) => { if (switched) updateVoicePreferences({ realtimeOutputDeviceId: sinkId }); }); }}>
                      <option value="">{zh ? "系统默认" : "System default"}</option>
                      {duplexVoiceInput.outputDevices.filter((device) => device.deviceId).map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || (zh ? "音频输出" : "Audio output")}</option>)}
                    </select>
                  </label>
                  <label><span>{zh ? "语音音量" : "Voice volume"}</span><input aria-label={zh ? "实时语音音量" : "Realtime voice volume"} type="range" min="0" max="1" step="0.05" value={voicePreferences.realtimeVolume} onChange={(event) => { const volume = Number(event.target.value); duplexVoiceInput.setVolume(volume); updateVoicePreferences({ realtimeVolume: volume }); }} /></label>
                  {duplexVoiceInput.outputDeviceError ? <small role="alert">{duplexVoiceInput.outputDeviceError}</small> : null}
                  {duplexVoiceInput.playbackRecovery ? <small role="alert">{duplexVoiceInput.playbackRecovery} <button type="button" onClick={() => void duplexVoiceInput.retryPlayback()}>{zh ? "重试" : "Retry"}</button></small> : null}
                  {duplexVoiceInput.playbackDegradation ? <small role="status">{zh ? "网络抖动导致一小段音频缺失，播放已自动继续。" : duplexVoiceInput.playbackDegradation}</small> : null}
                  {duplexVoiceInput.connectionNotice ? <small role="status">{duplexVoiceInput.connectionNotice}</small> : null}
                  {duplexVoiceInput.reconnectCountdownSeconds > 0 ? <small role="timer">{zh ? `${duplexVoiceInput.reconnectCountdownSeconds} 秒后重试连接` : `Retrying connection in ${duplexVoiceInput.reconnectCountdownSeconds}s`}</small> : null}
                  {duplexVoiceInput.playbackFlowControl.paused ? <small>{zh ? "正在按播放速度接收语音…" : "Receiving voice at playback speed…"}</small> : null}
                  {duplexVoiceInput.playback.networkQuality !== "stable" ? <small role="status">{zh ? `网络波动，语音缓冲已调整为 ${duplexVoiceInput.playback.jitterBufferTargetMs} 毫秒。` : `Network is ${duplexVoiceInput.playback.networkQuality}; voice buffer adjusted to ${duplexVoiceInput.playback.jitterBufferTargetMs} ms.`}</small> : null}
                  {duplexVoiceInput.quality?.issues.map((issue) => <small key={issue} role="status">{duplexCaptureQualityMessage(issue, zh)}</small>)}
                  {duplexVoiceInput.usageWarning ? <small>{duplexVoiceInput.usageWarning}</small> : null}
                  <small data-testid="duplex-voice-slo">TTFA {duplexVoiceInput.slo.ttfaMs === null ? "—" : `${Math.round(duplexVoiceInput.slo.ttfaMs)} ms`} · Stop {duplexVoiceInput.slo.stopLatencyMs === null ? "—" : `${Math.round(duplexVoiceInput.slo.stopLatencyMs)} ms`} · Interrupt {duplexVoiceInput.slo.interruptAccuracy === null ? "—" : `${Math.round(duplexVoiceInput.slo.interruptAccuracy * 100)}%`} · Underruns {duplexVoiceInput.slo.underruns} · Reconnects {duplexVoiceInput.slo.reconnects} · Audio {duplexVoiceInput.slo.inputAudioSeconds.toFixed(1)}/{duplexVoiceInput.slo.outputAudioSeconds.toFixed(1)}s · Cost {duplexVoiceInput.slo.estimatedCostUsd === null ? "unavailable" : `$${duplexVoiceInput.slo.estimatedCostUsd.toFixed(4)}`}</small>
                  <span data-testid="duplex-temporary-diagnostics">
                    {duplexVoiceInput.temporaryDiagnosticsExpiresAt ? <><small>Temporary numeric diagnostics active until {new Date(duplexVoiceInput.temporaryDiagnosticsExpiresAt).toLocaleTimeString()}.</small><button type="button" onClick={duplexVoiceInput.disableTemporaryDiagnostics}>Disable and erase</button></> : <button type="button" onClick={() => duplexVoiceInput.enableTemporaryDiagnostics()}>Enable temporary diagnostics (10 min)</button>}
                  </span>
                  <label><span>{zh ? "文字发送" : "Text timing"}</span><select aria-label={zh ? "实时语音文字发送时机" : "Realtime text send timing"} value={duplexTextStrategy} onChange={(event) => setDuplexTextStrategy(event.target.value as "after_response" | "interrupt_now")}><option value="after_response">{zh ? "当前回答后发送" : "Send after current answer"}</option><option value="interrupt_now">{zh ? "立即打断并发送" : "Interrupt and send now"}</option></select></label>
                  {duplexVoiceInput.pendingText ? <small role="status">{zh ? "文字将在当前回答结束后发送。" : "Text will be sent after the current answer."} <button type="button" onClick={() => { const restored = duplexVoiceInput.cancelPendingText(); if (restored) applyComposerText(restored); }}>{zh ? "取消并恢复草稿" : "Cancel and restore draft"}</button></small> : null}
                  {Object.values(duplexVoiceInput.toolStatuses).slice(-1).map((tool, index) => <small key={`${tool.status}-${index}`}>{tool.detail ?? tool.status}</small>)}
                  <button type="button" onClick={() => void duplexVoiceInput.finishTurn()} disabled={duplexVoiceInput.microphonePaused}>{zh ? "结束本轮发言" : "Finish turn"}</button>
                  <button type="button" aria-keyshortcuts="Alt+Shift+P" aria-pressed={duplexVoiceInput.microphonePaused} onClick={() => void (duplexVoiceInput.microphonePaused ? duplexVoiceInput.resumeMicrophone() : duplexVoiceInput.pauseMicrophone())}>{duplexVoiceInput.microphonePaused ? (zh ? "继续麦克风" : "Resume microphone") : (zh ? "暂停麦克风" : "Pause microphone")}</button>
                  {duplexVoiceInput.microphonePaused ? <strong role="status">{zh ? "麦克风已暂停；实时会话和工具仍保持连接。" : "Microphone paused; the Realtime Session and tools remain connected."}</strong> : null}
                  <button type="button" aria-keyshortcuts="Alt+Shift+I" onClick={() => void duplexVoiceInput.interrupt("manual")}>{zh ? "立即打断" : "Interrupt now"}</button>
                  <button type="button" aria-keyshortcuts="Alt+Shift+S" onClick={() => void duplexVoiceInput.stop()}>{zh ? "结束会话" : "End session"}</button>
                  <button type="button" onClick={() => void duplexVoiceInput.cancel()}>{zh ? "立即取消" : "Cancel now"}</button>
                </div>
              ) : showVoiceCaptureBar ? (
                <VoiceCaptureBar
                  elapsedSeconds={voiceElapsedSeconds}
                  levels={voiceLevels}
                  state={voiceState}
                  onStop={() => stopVoiceRecording("transcribe")}
                />
              ) : (
                <div className="composer-editor">
                  {/* Temporarily hide composer Skills picker — keep for later reuse.
                  {selectedSkillName ? (
                    <div className="composer-skill-tags" aria-label={zh ? "已选技能" : "Selected skill"}>
                      <span className="composer-skill-tag" data-testid="composer-skill-tag">
                        <Zap size={12} aria-hidden="true" />
                        <span className="composer-skill-tag-label">{selectedSkillName}</span>
                        <button
                          type="button"
                          aria-label={zh ? `移除技能 ${selectedSkillName}` : `Remove skill ${selectedSkillName}`}
                          title={zh ? "移除技能" : "Remove skill"}
                          onClick={clearSelectedSkill}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    </div>
                  ) : null}
                  */}
                  <textarea
                    data-testid="composer-input"
                    ref={textareaRef}
                    value={composerText}
                    onChange={(event) => handleComposerTyping(event.target.value)}
                    onCompositionStart={() => {
                      isComposingRef.current = true;
                    }}
                    onCompositionEnd={(event) => {
                      isComposingRef.current = false;
                      // Chrome (Electron) fires compositionend BEFORE the final
                      // input event, so onChange will pick up the composed text
                      // normally. But in case the input event was already
                      // processed (compositionend after input in some browsers),
                      // force the update with the final composed value.
                      handleComposerTyping(event.currentTarget.value);
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={
                      channelSource === "wechat"
                        ? (zh ? "输入要明确发送到微信的回复…" : "Type a reply to explicitly send to WeChat…")
                        : canChat
                        ? zh ? "向 OpenDrSai 提问..." : "Ask OpenDrSai..."
                        : chatUnavailableReason ?? (zh ? "请稍候，当前任务正在处理..." : "Please wait while the current task is running...")
                    }
                    rows={1}
                  />
                </div>
              )}

            </div>

            {voiceError || duplexVoiceInput.error ? (
              <div
                className={`composer-voice-status ${voiceState === "failed" || duplexVoiceInput.phase === "failed" ? "error" : ""}`}
                aria-live="polite"
              >
                <span>
                  {getVoiceStatusLabel(voiceState, voiceElapsedSeconds)}
                </span>
                {voiceError || duplexVoiceInput.error ? <small>{voiceError ?? duplexVoiceInput.error}</small> : null}
                {voiceConsentRequired ? (
                  <span className="composer-voice-error-actions">
                    <button
                      type="button"
                      onClick={() => {
                        updateVoicePreferences({ remoteSttConsent: true });
                        setVoiceConsentRequired(false);
                        setVoiceError(null);
                        void retryVoiceTranscription(true);
                      }}
                    >
                      {zh ? "允许并识别" : "Allow and transcribe"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceConsentRequired(false);
                        setVoiceError(null);
                        setVoiceState("idle");
                        voiceRetryBlobRef.current = null;
                        voiceRetryDurationRef.current = 0;
                        dispatchVoiceTurn({ type: "reset" });
                      }}
                    >
                      {zh ? "暂不使用" : "Not now"}
                    </button>
                  </span>
                ) : null}
                {voicePreferences.interactionMode === "duplex" && !duplexDisclosureAcknowledged && voiceError === duplexPrivacyDisclosure ? (
                  <span className="composer-voice-error-actions" aria-label="Realtime voice privacy confirmation">
                    <button type="button" onClick={() => { updateVoicePreferences({ realtimeDisclosureFingerprint: duplexDisclosureFingerprint }); setDuplexPrivacyConfirmed(true); void startDuplexVoiceRecording(true); }}>{zh ? "了解并开始实时语音" : "I understand—start Realtime voice"}</button>
                    <button type="button" onClick={() => setVoiceError(null)}>{zh ? "暂不使用" : "Not now"}</button>
                  </span>
                ) : null}
                {duplexVoiceInput.occupancy?.occupied && !duplexVoiceInput.occupancy.ownedByCaller ? (
                  <span className="composer-voice-error-actions" aria-label={zh ? "实时对话占用处理" : "Realtime conversation occupancy actions"} data-testid="duplex-voice-occupancy">
                    <small>{zh ? `${duplexVoiceInput.occupancy.ownerLabel ?? "另一个窗口"} 从 ${duplexVoiceInput.occupancy.startedAt ? new Date(duplexVoiceInput.occupancy.startedAt).toLocaleTimeString() : "未知时间"} 开始占用实时对话。` : `${duplexVoiceInput.occupancy.ownerLabel ?? "Another window"} has owned the Realtime conversation since ${duplexVoiceInput.occupancy.startedAt ? new Date(duplexVoiceInput.occupancy.startedAt).toLocaleTimeString() : "an unknown time"}.`}</small>
                    <button type="button" onClick={() => void duplexVoiceInput.takeOver()}>{zh ? "结束原会话并接管" : "End it and take over"}</button>
                    <button type="button" onClick={() => { duplexVoiceInput.declineTakeOver(); updateVoicePreferences({ interactionMode: "serial" }); setVoiceError(null); }}>{zh ? "使用单次输入" : "Use single input"}</button>
                  </span>
                ) : null}
                {voicePreferences.interactionMode === "duplex" && duplexVoiceInput.failure && duplexFailureRecovery ? <section className="composer-voice-recovery" role="alert" data-testid="duplex-runtime-recovery" data-reason-code={duplexVoiceInput.failure.code}>
                  <strong>{zh ? "实时语音需要处理" : "Realtime voice needs attention"}</strong>
                  <small>{duplexVoiceInput.failure.message}</small>
                  <small>{zh ? `原因代码：${duplexVoiceInput.failure.code}` : `Reason code: ${duplexVoiceInput.failure.code}`}{"requestId" in duplexVoiceInput.failure && duplexVoiceInput.failure.requestId ? ` · Trace: ${duplexVoiceInput.failure.requestId}` : ""}</small>
                  <span className="composer-voice-error-actions">
                    <button type="button" onClick={() => { if (duplexFailureRecovery.primary === "open_agent_settings") onOpenAgentSettings?.(); else if (duplexFailureRecovery.primary === "switch_to_serial") updateVoicePreferences({ interactionMode: "serial" }); else void startDuplexVoiceRecording(false); }}>{duplexFailureRecovery.primary === "open_agent_settings" ? (zh ? "打开智能体配置" : "Open Agent configuration") : duplexFailureRecovery.primary === "switch_to_serial" ? (zh ? "使用单次输入" : "Use single input") : (zh ? "重试" : "Retry")}</button>
                    {duplexFailureRecovery.fallback ? <button type="button" onClick={() => updateVoicePreferences({ interactionMode: "serial" })}>{zh ? "使用单次输入" : "Use single input"}</button> : null}
                  </span>
                </section> : null}
                {voiceError && voiceRetryBlobRef.current && !voiceConsentRequired ? (
                  <span className="composer-voice-error-actions">
                    <button type="button" onClick={() => void retryVoiceTranscription()}>Retry</button>
                    <button type="button" onClick={discardVoiceReview}>Discard</button>
                  </span>
                ) : null}
                {voiceTurnState.phase === "failed" && voiceTurnState.error?.stage === "submitting" ? (
                  <span className="composer-voice-error-actions">
                    <button type="button" onClick={retryVoiceChatSubmission}>{zh ? "重试发送" : "Retry sending"}</button>
                    <button type="button" onClick={() => {
                      setVoiceState("idle");
                      setVoiceError(null);
                      dispatchVoiceTurn({ type: "reset" });
                    }}>{zh ? "保留文本" : "Keep transcript"}</button>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="composer-meta-bar">
              {currentRuntimeMode && (
                <div className="composer-meta-item">
                  <span
                    className="composer-meta-chip composer-runtime-mode-chip"
                    title={currentRuntimeMode.description}
                  >
                    <ClipboardList size={14} />
                    Mode: {runtimeModeLabel}
                    <button
                      type="button"
                      aria-label="Clear runtime mode"
                      onClick={onClearRuntimeMode}
                    >
                      <X size={12} />
                    </button>
                  </span>
                </div>
              )}
              {isLocalOpenDrSaiAgent && (
                <div className="composer-meta-item">
                  <button
                    className={`composer-meta-chip composer-meta-button composer-private-mode${privateMode ? " active" : ""}`}
                    data-testid="composer-private-mode"
                    type="button"
                    aria-pressed={privateMode}
                    aria-label={zh ? "私密模式" : "Private mode"}
                    disabled={showStop}
                    title={privateMode
                      ? (zh
                          ? "私密模式已开启：本轮固定使用私密模型，忽略当前所选模型，且不进行推理"
                          : "Private mode is on: this turn uses the private model, ignores the selected model, and does not reason")
                      : (zh
                          ? "私密模式：本轮固定使用私密模型，忽略当前所选模型"
                          : "Private mode: this turn uses the private model and ignores the selected model")}
                    onClick={togglePrivateMode}
                  >
                    <ShieldCheck size={14} />
                    {zh ? "私密模式" : "Private"}
                    {privateMode ? <Check size={12} aria-hidden /> : null}
                  </button>
                </div>
              )}
              {isLocalOpenDrSaiAgent && (
                <KnowledgeBaseSelector
                  agentId={selectedAgentId!}
                  language={language}
                />
              )}
                  <div className="composer-meta-item" data-meta-menu="skill">
                 <button
                   className={`composer-meta-chip composer-meta-button${selectedRemoteSkill || selectedSquareSkill ? " active" : ""}`}
                   type="button"
                   aria-expanded={metaMenuOpen === "skill"}
                   aria-haspopup="dialog"
                   onClick={() => toggleMetaMenu("skill")}
                   title={zh ? "选择远程智能体技能或公共技能" : "Pick a remote Agent skill or a public skill"}
                 >
                   <Zap size={14} />
                   {selectedRemoteSkill?.name || selectedRemoteSkill?.id
                     || selectedSquareSkill?.name || selectedSquareSkill?.slug
                     || (zh ? "技能" : "Skill")}
                   <ChevronDown size={13} />
                 </button>
                 {metaMenuOpen === "skill" && (
                   <div className="composer-meta-menu wide skill-picker" role="listbox" aria-label={zh ? "技能选择" : "Skill picker"}>
                     {/* Remote agent skills, when available. */}
                     {isRemoteAgent && remoteAgentSkills.length ? (
                       <>
                         {remoteAgentSkills.map((skill) => (
                           <button
                             key={`${skill.source}:${skill.id}`}
                             type="button"
                             role="option"
                             className={skill.id === selectedRemoteSkillId ? "active" : ""}
                             onClick={() => {
                               setSelectedRemoteSkillId(skill.id === selectedRemoteSkillId ? null : skill.id);
                               setSelectedSquareSkill(null);
                               setMetaMenuOpen(null);
                             }}
                           >
                             <span>{skill.name || skill.id}</span>
                             <small>{skill.source}</small>
                           </button>
                         ))}
                         {selectedRemoteSkillId ? (
                           <button
                             type="button"
                             role="option"
                             onClick={() => {
                               setSelectedRemoteSkillId(null);
                               setMetaMenuOpen(null);
                             }}
                           >
                             <span>{zh ? "清除技能选择" : "Clear skill selection"}</span>
                           </button>
                         ) : null}
                         <div className="composer-skill-square-divider" aria-hidden />
                       </>
                     ) : null}

                     {/* Toolbar: count, sorting, and installation filter. */}
                     <div className="composer-skill-square-toolbar">
                       <span className="composer-skill-square-count">
                         {squareTotal > 0
                           ? (zh ? `共 ${squareTotal} 个技能` : `${squareTotal} skills`)
                           : ""}
                       </span>
                       <div className="composer-skill-square-sort">
                         <button
                           type="button"
                           className={squareSort === "downloads" ? "active" : ""}
                           onClick={() => handleSquareSortChange("downloads")}
                         >
                           {zh ? "热门" : "Popular"}
                         </button>
                         <button
                           type="button"
                           className={squareSort === "name" ? "active" : ""}
                           onClick={() => handleSquareSortChange("name")}
                         >
                           {zh ? "名称" : "Name"}
                         </button>
                         <button
                           type="button"
                           className={squareSort === "time" ? "active" : ""}
                           onClick={() => handleSquareSortChange("time")}
                         >
                           {zh ? "最新" : "Latest"}
                         </button>
                       </div>
                       <div className="composer-skill-square-filter-toggle">
                         <button
                           type="button"
                           className={squareInstallFilter === "all" ? "active" : ""}
                           onClick={() => handleSquareInstallFilterChange("all")}
                         >
                           {zh ? "全部" : "All"}
                         </button>
                         <button
                           type="button"
                           className={squareInstallFilter === "installed" ? "active" : ""}
                           onClick={() => handleSquareInstallFilterChange("installed")}
                         >
                           {zh ? "已安装" : "Installed"}
                         </button>
                         <button
                           type="button"
                           className={squareInstallFilter === "not_installed" ? "active" : ""}
                           onClick={() => handleSquareInstallFilterChange("not_installed")}
                         >
                           {zh ? "未安装" : "Not installed"}
                         </button>
                       </div>
                     </div>

                     {/* Search and tags. */}
                     <div className="composer-skill-square-filter">
                       <input
                         type="text"
                         value={squareSearch}
                         onChange={(event) => handleSquareSearchChange(event.target.value)}
                         placeholder={zh ? "搜索公共技能…" : "Search public skills…"}
                       />
                       {squareTags.length ? (
                         <div className="composer-skill-square-tags">
                           {squareTags.map((tag) => (
                             <button
                               key={tag}
                               type="button"
                               className={squareActiveTag === tag ? "active" : ""}
                               onClick={() => {
                                 const next = squareActiveTag === tag ? null : tag;
                                 setSquareActiveTag(next);
                                 void loadSquareSkills({ search: squareSearch, tag: next, sort: squareSort, installFilter: squareInstallFilter });
                               }}
                             >
                               {tag}
                             </button>
                           ))}
                         </div>
                       ) : null}
                     </div>

                     {/* Clear selection button (always visible). */}
                     <div className="composer-skill-square-clear">
                       <button
                         type="button"
                         role="option"
                         disabled={!selectedSquareSkill}
                         onClick={() => {
                           setSelectedSquareSkill(null);
                         }}
                       >
                         {zh ? "清除公共技能选择" : "Clear public skill selection"}
                       </button>
                     </div>

                     {/* Skills list. */}
                     <div className="composer-skill-square-list">
                       {squareLoading && !squareLoadingMore ? (
                         <p className="composer-meta-menu-empty">{zh ? "正在加载公共技能…" : "Loading public skills…"}</p>
                       ) : squareError ? (
                         <p className="composer-meta-menu-empty">{squareError}</p>
                        ) : squareInstallFilter === "installed" ? (
                         skillsLoading ? <p className="composer-meta-menu-empty">{zh ? "正在加载本地技能…" : "Loading local skills…"}</p>
                         : skillsLoadError ? <p className="composer-meta-menu-empty">{skillsLoadError}</p>
                         : installedSkills.length ? <>
                           {installedSkills.filter((skill) => !squareSearch.trim() || `${skill.name} ${skill.description}`.toLowerCase().includes(squareSearch.trim().toLowerCase())).map((skill) => (
                             <button key={skill.path || skill.name} type="button" role="option" className={selectedSkillName === skill.name ? "active installed" : "installed"} onClick={() => {
                               setSelectedSkillName((current) => current === skill.name ? null : skill.name);
                               setSelectedSquareSkill(null);
                               setSelectedRemoteSkillId(null);
                             }}><span className="composer-skill-square-item-line"><span className="composer-skill-square-installed-badge">✓</span><span className="composer-skill-square-item-name">{skill.name}</span></span></button>
                           ))}
                         </> : <p className="composer-meta-menu-empty">{zh ? "还没有本地已安装技能。" : "No locally installed skills yet."}</p>
                       ) : squareSkills.length ? (
                         <>
                           {squareSkills.map((skill) => (
                             <button
                               key={skill.slug}
                               type="button"
                               role="option"
                               className={
                                 (selectedSquareSkill?.slug === skill.slug ? "active " : "") +
                                 (isSquareSkillInstalled(skill) ? "installed" : "")
                               }
                               aria-busy={squareInstallingSlug === skill.slug}
                               onClick={() => void selectSquareSkill(skill)}
                             >
                               <span className="composer-skill-square-item-line">
                                 {isSquareSkillInstalled(skill) ? (
                                   <span className="composer-skill-square-installed-badge" title={zh ? "已安装" : "Installed"}>✓</span>
                                 ) : null}
                                 <span className="composer-skill-square-item-name">{skill.name || skill.slug}</span>
                                 {skill.version ? <span className="composer-skill-square-item-version">v{skill.version}</span> : null}
                                 {skill.downloads != null && skill.downloads > 0 ? (
                                   <span className="composer-skill-square-item-downloads">↓{skill.downloads}</span>
                                 ) : null}
                               </span>
                             </button>
                           ))}
                           {/* Infinite scroll sentinel */}
                           {squareHasNext ? (
                             <div ref={squareSentinelRef} className="composer-skill-square-sentinel">
                               {squareLoadingMore
                                 ? (zh ? "正在加载更多…" : "Loading more…")
                                 : (zh ? "滚动加载更多" : "Scroll for more")}
                             </div>
                           ) : squareSkills.length > 0 ? (
                             <p className="composer-skill-square-end">{zh ? "已显示全部技能" : "All skills shown"}</p>
                           ) : null}
                         </>
                       ) : (
                         <p className="composer-meta-menu-empty">
                           {zh ? "暂无公共技能。可在技能广场浏览 opendrsai.ihep.ac.cn 的技能。" : "No public skills. Browse the Skills Square on opendrsai.ihep.ac.cn."}
                         </p>
                       )}
                       {squareInstallingSlug ? (
                         <p className="composer-meta-menu-empty">{zh ? "正在安装技能…" : "Installing skill…"}</p>
                       ) : null}
                     </div>
                   </div>
              )}
                </div>
              <div className="composer-meta-item composer-configuration" data-meta-menu="configuration">
                <button
                  className="composer-meta-chip composer-meta-button composer-configuration-trigger"
                  data-testid="composer-configuration-trigger"
                  type="button"
                  aria-expanded={metaMenuOpen === "configuration"}
                  aria-haspopup="dialog"
                  onClick={() => toggleMetaMenu("configuration")}
                  title={composerConfigurationSummary}
                >
                  <AgentInlineIcon agent={activeAgent} size={14} />
                  <span>{composerConfigurationSummary}</span>
                  <ChevronDown size={13} />
                </button>
                {metaMenuOpen === "configuration" ? (
                  <div
                    className="composer-configuration-menu"
                    role="dialog"
                    aria-label={zh ? "任务设置" : "Task settings"}
                    onMouseLeave={(event) => {
                      const next = event.relatedTarget;
                      if (next instanceof Node && event.currentTarget.contains(next)) return;
                      setConfigurationSection(null);
                    }}
                  >
                    <div className="composer-configuration-rows">
                      <button type="button" data-testid="composer-primary-model" aria-expanded={configurationSection === "model"} onMouseEnter={(event) => revealConfigurationSection("model", event.currentTarget)} onFocus={(event) => revealConfigurationSection("model", event.currentTarget)} onClick={(event) => revealConfigurationSection("model", event.currentTarget)}><span><strong>{zh ? "主模型" : "Primary model"}</strong><small title={activeModelName}>{activeModelName}</small></span><ChevronRight size={14} /></button>
                      <button type="button" data-testid="composer-image-generation-model" disabled={!isLocalOpenDrSaiAgent || showStop} aria-expanded={configurationSection === "imageGeneration"} onMouseEnter={(event) => revealConfigurationSection("imageGeneration", event.currentTarget)} onFocus={(event) => revealConfigurationSection("imageGeneration", event.currentTarget)} onClick={(event) => revealConfigurationSection("imageGeneration", event.currentTarget)}><span><strong>{zh ? "图像生成" : "Image generation"}</strong><small title={isLocalOpenDrSaiAgent ? activeImageGenerationModelName : (zh ? "仅本地 Agent" : "Local Agent only")}>{isLocalOpenDrSaiAgent ? activeImageGenerationModelName : (zh ? "仅本地 Agent" : "Local Agent only")}</small></span><ChevronRight size={14} /></button>
                      <button type="button" disabled={!showThinkingEffort} aria-expanded={configurationSection === "thinking"} onMouseEnter={(event) => revealConfigurationSection("thinking", event.currentTarget)} onFocus={(event) => revealConfigurationSection("thinking", event.currentTarget)} onClick={(event) => revealConfigurationSection("thinking", event.currentTarget)}><span><strong>{zh ? "推理强度" : "Reasoning effort"}</strong><small title={thinkingEffortMenuLabel}>{thinkingEffortMenuLabel}</small></span><ChevronRight size={14} /></button>
                      <button type="button" data-testid="composer-plan-mode" disabled={!isLocalOpenDrSaiAgent || showStop} aria-expanded={configurationSection === "task"} onMouseEnter={(event) => revealConfigurationSection("task", event.currentTarget)} onFocus={(event) => revealConfigurationSection("task", event.currentTarget)} onClick={(event) => revealConfigurationSection("task", event.currentTarget)}><span><strong>{zh ? "计划模式" : "Plan mode"}</strong><small title={taskInteractionModeLabel}>{taskInteractionModeLabel}</small></span><ChevronRight size={14} /></button>
                      <button type="button" data-testid="composer-private-mode-row" disabled={!isLocalOpenDrSaiAgent || showStop} aria-expanded={configurationSection === "private"} onMouseEnter={(event) => revealConfigurationSection("private", event.currentTarget)} onFocus={(event) => revealConfigurationSection("private", event.currentTarget)} onClick={(event) => revealConfigurationSection("private", event.currentTarget)}><span><strong>{zh ? "私密模式" : "Private mode"}</strong><small>{privateMode ? (zh ? "已开启" : "On") : (zh ? "已关闭" : "Off")}</small></span><ChevronRight size={14} /></button>
                    </div>
                    {configurationSection ? <div className="composer-configuration-submenu" style={configurationSubmenuPosition} role="menu" aria-label={configurationSection === "model" ? (zh ? "选择主模型" : "Choose primary model") : configurationSection === "imageGeneration" ? (zh ? "选择图像生成模型" : "Choose image-generation model") : configurationSection === "thinking" ? (zh ? "选择推理强度" : "Choose reasoning effort") : configurationSection === "private" ? (zh ? "选择私密模式" : "Choose private mode") : (zh ? "选择计划模式" : "Choose plan mode")}>
                      <div className="composer-configuration-options">
                        {configurationSection === "model" ? (hasModelOptions ? modelOptions.map((model) => {
                          const selected = (model.alias || model.model) === selectedModelName
                            && (!selectedModelProviderId || model.provider_id === selectedModelProviderId);
                          const primaryReady = supportsFullAgentPrimaryRuntime(model)
                            // Remote worker options are always primary-capable:
                            // the worker owns its own model namespace and the
                            // Desktop has no local capability metadata for it.
                            // The marker is only produced by the remote branch
                            // of getAgentModelOptions, so the local gate above
                            // is untouched.
                            || (isRemoteAgent && model.capability_source === "provider");
                          const isRemoteDefault = isRemoteAgent
                            && Boolean(activeAgent?.remoteDefaultModel)
                            && (model.alias || model.model) === activeAgent?.remoteDefaultModel;
                          return (
                          <button key={`${model.provider_id || "backend"}:${model.alias || model.model}`} type="button" role="menuitemradio" aria-checked={selected} aria-disabled={!primaryReady} disabled={!primaryReady} className={selected ? "active" : ""} onClick={() => {
                            if (!primaryReady) return;
                            selectModel(model.alias || model.model || "", model.provider_id);
                          }}>
                            <span><strong title={getModelOptionLabel(model)}>{getModelOptionLabel(model)}{isRemoteDefault ? (zh ? "（默认）" : " (Default)") : ""}</strong><small>{isRemoteAgent
                              ? (zh ? "远程模型配置" : "Remote agent model")
                              : primaryReady ? getModelProviderLabel(model, zh) : (zh ? "不可用作主模型 · 请在图像理解中配置" : "Not a primary model · use Image understanding")}</small></span>
                            {selected ? <Check size={14} aria-hidden /> : null}
                          </button>
                          );
                        }) : <p className="composer-meta-menu-empty">{isRemoteAgent
                          ? (zh ? "远程智能体未返回模型配置，请刷新智能体列表后重试。" : "The remote agent returned no model configs. Refresh the agent list and retry.")
                          : (zh ? "暂无可用模型" : "No models available")}</p>) : configurationSection === "imageGeneration" ? (hasImageGenerationModelOptions ? imageGenerationModelOptions.map((model) => {
                          const selected = (model.alias || model.model) === selectedImageGenerationModelName
                            && (!selectedImageGenerationProviderId || model.provider_id === selectedImageGenerationProviderId);
                          const usable = model.availability === undefined
                            || model.availability === "available"
                            || model.availability === "configured_unverified"
                            || selected;
                          const status = !usable
                            ? (model.availability === "unauthorized"
                              ? (zh ? "需重新登录" : "Sign in again")
                              : (zh ? "维护中/不可用" : "Unavailable"))
                            : getModelProviderLabel(model, zh);
                          return (
                          <button key={`image-gen:${model.provider_id || "backend"}:${model.alias || model.model}`} type="button" role="menuitemradio" aria-checked={selected} aria-disabled={!usable} disabled={!usable} className={selected ? "active" : ""} data-testid={`composer-image-generation-option-${model.alias || model.model}`} onClick={() => {
                            if (!usable) return;
                            selectImageGenerationModel(model.alias || model.model || "", model.provider_id);
                          }}>
                            <span><strong title={getModelOptionLabel(model)}>{getModelOptionLabel(model)}</strong><small>{status}</small></span>
                            {selected ? <Check size={14} aria-hidden /> : null}
                          </button>
                          );
                        }) : <p className="composer-meta-menu-empty">{zh ? "暂无图像生成模型，请刷新目录或检查 Provider" : "No image-generation models. Refresh the catalog or check the Provider."}</p>) : configurationSection === "thinking" ? supportedThinkingEfforts.map((effort) => (
                          <button key={effort} type="button" role="menuitemradio" aria-checked={effort === thinkingEffort} className={effort === thinkingEffort ? "active" : ""} onClick={() => selectThinkingEffort(effort)}>
                            <span><strong>{getThinkingEffortLabel(effort, zh)}</strong></span>
                            {effort === thinkingEffort ? <Check size={14} aria-hidden /> : null}
                          </button>
                        )) : configurationSection === "private" ? (["off", "on"] as const).map((state) => (
                          <button key={state} type="button" role="menuitemradio" aria-checked={(state === "on") === privateMode} data-testid={`composer-private-mode-${state}`} disabled={showStop} className={(state === "on") === privateMode ? "active" : ""} onClick={() => selectPrivateMode(state === "on")}>
                            <span><strong>{state === "on" ? (zh ? "开启" : "On") : (zh ? "关闭" : "Off")}</strong><small>{state === "on" ? (zh ? "本轮固定使用私密模型，忽略当前所选模型，且不进行推理" : "This turn uses the private model, ignores the selected model, and does not reason") : (zh ? "使用当前所选模型" : "Use the currently selected model")}</small></span>
                            {(state === "on") === privateMode ? <Check size={14} aria-hidden /> : null}
                          </button>
                        )) : (["normal", "plan"] as const).map((mode) => (
                          <button key={mode} type="button" role="menuitemradio" aria-checked={mode === taskInteractionMode} data-testid={`composer-plan-mode-${mode}`} disabled={!isLocalOpenDrSaiAgent || showStop} className={mode === taskInteractionMode ? "active" : ""} onClick={() => selectTaskInteractionMode(mode)}>
                            <span><strong>{mode === "normal" ? (zh ? "常规" : "Normal") : (zh ? "计划" : "Plan")}</strong><small>{mode === "normal" ? (zh ? "适合日常问答和简单任务，立即开始" : "Best for everyday questions and simple tasks; starts right away") : (zh ? "适合复杂任务，开始前与你深入讨论需求和方案" : "Best for complex tasks; interviews you relentlessly to align on the plan first")}</small></span>
                            {mode === taskInteractionMode ? <Check size={14} aria-hidden /> : null}
                          </button>
                        ))}
                      </div>
                    </div> : null}
                  </div>
                ) : null}
              </div>
              {/* Temporarily hide composer Skills picker — keep for later reuse.
              <div className="composer-meta-item" data-meta-menu="skill">
                <button
                  className={`composer-meta-chip composer-meta-button${selectedSkillName ? " active" : ""}`}
                  type="button"
                  aria-expanded={metaMenuOpen === "skill"}
                  onClick={() => toggleMetaMenu("skill")}
                  title={zh ? "从 Skills 管理中选择技能" : "Pick a skill from Skills manager"}
                >
                  <Zap size={14} />
                  {zh ? "技能" : "Skill"}
                  <ChevronDown size={13} />
                </button>
                {metaMenuOpen === "skill" && (
                  <div className="composer-meta-menu wide" role="listbox" aria-label={zh ? "已安装技能" : "Installed skills"}>
                    {skillsLoading ? (
                      <p className="composer-meta-menu-empty">{zh ? "正在加载 Skills…" : "Loading skills…"}</p>
                    ) : skillsLoadError ? (
                      <p className="composer-meta-menu-empty">{skillsLoadError}</p>
                    ) : installedSkills.length ? (
                      installedSkills.map((skill) => (
                        <button
                          key={skill.path || skill.name}
                          type="button"
                          role="option"
                          className={skill.name === selectedSkillName ? "active" : ""}
                          onClick={() => applySkillToComposer(skill.name)}
                        >
                          <span>{skill.name}</span>
                          <small>{skill.description || skill.category || (zh ? "用户技能" : "User skill")}</small>
                        </button>
                      ))
                    ) : (
                      <p className="composer-meta-menu-empty">
                        {zh
                          ? "还没有已安装技能。可到左侧 Skills 管理中新建。"
                          : "No installed skills yet. Create one in Skills manager."}
                      </p>
                    )}
                  </div>
                )}
              </div>
              */}
              <div className="composer-actions composer-actions-meta">
                {composerText.trim() && !showStop ? (
                  <button
                    type="button"
                    className="composer-icon-button"
                    onClick={clearInput}
                    aria-label="Clear input"
                    title="Clear"
                  >
                    <X size={16} />
                  </button>
                ) : null}
                {voicePreferences.interactionMode === "duplex" && duplexVoiceAvailability.available && ["idle", "failed"].includes(duplexVoiceInput.phase) && !duplexDisclosureAcknowledged ? <section className="composer-voice-preflight" data-testid="duplex-voice-preflight" aria-labelledby="duplex-preflight-title">
                  <strong id="duplex-preflight-title">{zh ? "开始实时语音前" : "Before Realtime voice starts"}</strong>
                  <ul>
                    <li>{zh ? `服务：${duplexVoiceReadiness?.providerId ?? "未知"} / ${duplexVoiceReadiness?.modelId ?? "未知"}` : `Provider/model: ${duplexVoiceReadiness?.providerId ?? "unknown"} / ${duplexVoiceReadiness?.modelId ?? "unknown"}`}</li>
                    <li>{zh ? "发送：会话期间麦克风音频会流式发送给该服务。" : "Sending: microphone audio is streamed to this Provider while the Session is active."}</li>
                    <li>{zh ? "保存：稳定的文字转录会保存到当前任务；不保存原始音频。" : "Saving: stable transcripts are saved to this task; raw audio is not saved."}</li>
                    <li>{duplexVoiceCapabilities?.supportsToolCalling ? (zh ? "工具：读取类工具可直接运行；写入类工具必须在审批中心点击批准。" : "Tools: reads may run directly; writes require a click in Approval Center.") : (zh ? "工具：当前模型不会调用工具。" : "Tools: this model will not call tools.")}</li>
                  </ul>
                  <button type="button" onClick={() => { updateVoicePreferences({ realtimeDisclosureFingerprint: duplexDisclosureFingerprint }); setDuplexPrivacyConfirmed(true); setVoiceError(null); void startDuplexVoiceRecording(true); }}>{zh ? "确认并开始" : "Confirm and start"}</button>
                  <button type="button" onClick={() => updateVoicePreferences({ interactionMode: "serial" })}>{zh ? "改用单次输入" : "Use single input"}</button>
                </section> : null}
                {voicePreferences.interactionMode === "duplex" && !duplexVoiceAvailability.available ? <div className="composer-voice-recovery" role="alert" data-testid="duplex-voice-recovery">
                  <small>{duplexVoiceAvailability.reason}</small>
                  <button type="button" onClick={() => runDuplexReadinessAction(duplexReadinessActions.primary)}>{duplexReadinessActions.primary === "open_agent_settings" ? (zh ? "打开智能体配置" : "Open Agent configuration") : duplexReadinessActions.primary === "switch_to_serial" ? (zh ? "使用单次输入" : "Use single input") : (zh ? "重新检查" : "Check again")}</button>
                  {duplexReadinessActions.fallback ? <button type="button" onClick={() => runDuplexReadinessAction(duplexReadinessActions.fallback!)}>{zh ? "使用单次输入" : "Use single input"}</button> : null}
                </div> : null}
                                <div style={VOICE_BUTTON_WRAPPER_STYLE}>
                <button
                  type="button"
                  ref={voiceButtonRef} className={`composer-icon-button composer-voice-button ${voiceState === "recording" || duplexVoiceInput.phase === "active" ? "recording" : ""}`}
                  disabled={voiceState === "requesting_permission" || voiceState === "processing" || duplexVoiceInput.phase === "starting" || duplexVoiceInput.phase === "stopping"}
                  aria-pressed={voiceState === "recording" || duplexVoiceInput.phase === "active"}
                  aria-keyshortcuts={voicePreferences.interactionMode === "duplex" ? "Alt+Shift+V" : undefined}
                  aria-label={
                    voiceState === "processing"
                      ? "Transcribing voice input"
                      : voiceState === "recording" || duplexVoiceInput.phase === "active" || duplexVoiceInput.phase === "recovering"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  title={
                    voiceState === "processing"
                      ? "Transcribing voice input"
                      : voiceState === "recording" || duplexVoiceInput.phase === "active" || duplexVoiceInput.phase === "recovering"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  onClick={() => { setVoiceMenuOpen(!voiceMenuOpen); }}
                >
                  {voiceState === "processing" ? (
                    <ThreadActivityBubble state={{ kind: "running" }} language={zh ? "zh" : "en"} />
                  ) : voiceState === "recording" || duplexVoiceInput.phase === "active" || duplexVoiceInput.phase === "recovering" ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                  {voiceMenuOpen && (
                    <div style={VOICE_MENU_STYLE} ref={voiceMenuRef}>
                      <button
                        type="button"
                        style={VOICE_MENU_ITEM_STYLE}
                        onClick={() => { setVoiceMenuOpen(false); void startVoiceRecording(); }}
                      >
                        <Mic size={16} />
                        {zh ? "开始录音" : "Start recording"}
                      </button>
                      <div style={VOICE_MENU_DIVIDER_STYLE} />
<select
                  className="composer-voice-mode"
                  data-testid="composer-voice-mode"
                  value={voicePreferences.interactionMode}
                  onChange={(event) => updateVoicePreferences({ interactionMode: event.target.value as DesktopVoiceInteractionMode })}
                  disabled={!canSwitchVoiceMode(voiceTurnState.phase) || showDuplexVoiceCaptureBar}
                  aria-label={zh ? "语音交互模式" : "Voice interaction mode"}
                  title={voiceRuntimeDisclosure ?? voiceRuntimeLabel}
                >
                  <option value="serial">{zh ? "串行" : "Serial"}</option>
                  <option value="duplex" disabled={!duplexVoiceAvailability.available}>{zh ? "实时" : "Realtime"}</option>
                </select>
<select
                    className="composer-voice-device"
                    value={voiceDeviceId}
                    onChange={(event) => updateVoicePreferences({ inputDeviceId: event.target.value })}
                    disabled={showAnyVoiceCaptureBar}
                    aria-label="Microphone device"
                    title="Microphone device"
                  >
                    <option value="">Default mic</option>
                    {(voicePreferences.interactionMode === "duplex" ? duplexVoiceInput.devices : voiceDevices).map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
<select
                  className="composer-voice-language"
                  value={voiceLanguage}
                  onChange={(event) => updateVoicePreferences({ inputLanguage: event.target.value as "auto" | "zh-CN" | "en-US" })}
                  disabled={showAnyVoiceCaptureBar}
                  aria-label="Voice transcription language"
                  title="Voice transcription language"
                >
                  <option value="auto">Auto</option>
                  <option value="zh-CN">中文</option>
                  <option value="en-US">EN</option>
                </select>
                    </div>
                  )}
                </div>

                {showStop ? (
                  composerText.trim() ? (
                    <>
                      {queuedSend ? (
                        <button type="button" className="composer-submit" title={zh ? "已排队，当前任务结束后自动发送；点击取消排队" : "Queued — will send when the current task finishes; click to cancel"}
                          onClick={() => setQueuedSend(false)}>
                          <Send size={16} />{zh ? "已排队（点击取消）" : "Queued (click to cancel)"}
                        </button>
                      ) : (
                        <button className="composer-submit" type="submit" title={zh ? "默认排在当前任务之后" : "Queue after the current task"}>
                          <Send size={16} />{zh ? "排队发送" : "Queue"}
                        </button>
                      )}
                      <button type="button" className="composer-submit" title={zh ? "发送并停止当前任务输出，开始新任务" : "Send and stop current task output, start new task"}
                        onClick={async () => { try { await onAbort(); } catch { /* best-effort */ } void submitWithAttachments(); }}>
                        <Send size={16} />{zh ? "发送并停止" : "Send & Stop"}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="composer-submit" title={zh ? "停止当前任务" : "Stop current task"}
                      onClick={() => void onAbort()}>
                      <Square size={16} />{zh ? "停止" : "Stop"}
                    </button>
                  )
                ) : (
                  <button className="composer-submit" type="submit" title={zh ? "发送消息" : "Send message"} disabled={!canChat}>
                    <Send size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>
      </div>
      {conversationResourceNotice ? (
        <aside className="conversation-resource-notice" data-testid="conversation-resource-notice" role="status">
          <span>{conversationResourceNotice}</span>
          <button type="button" onClick={() => setConversationResourceNotice(null)} aria-label={zh ? "关闭资源提示" : "Close resource notice"}><X size={14} /></button>
        </aside>
      ) : null}
      {conversationResourceDownload ? (
        <aside className="conversation-resource-download" data-testid="conversation-resource-download" data-phase={conversationResourceDownload.phase} role="status">
          <strong>{conversationResourceDownload.name}</strong>
          <progress max={100} value={conversationResourceDownload.percent ?? 0} />
          <span>{conversationResourceDownload.phase === "cancelled" ? (zh ? "已取消" : "Cancelled") : `${conversationResourceDownload.percent ?? 0}%`}</span>
          {["preparing", "downloading"].includes(conversationResourceDownload.phase) ? <button type="button" onClick={() => void desktopApi.cancelConversationResourceDownload(conversationResourceDownload.operationId)}>{zh ? "取消下载" : "Cancel download"}</button> : null}
          <button type="button" onClick={() => setConversationResourceDownload(null)} aria-label={zh ? "关闭下载状态" : "Close download status"}><X size={14} /></button>
        </aside>
      ) : null}
      {conversationResourceMenu ? createPortal((() => {
        const { part, resolved } = conversationResourceMenu;
        const request = conversationResourceRequest(part)!;
        const close = (): void => setConversationResourceMenu(null);
        const download = (): void => {
          close();
          const operationId = crypto.randomUUID();
          setConversationResourceDownload({ operationId, phase: "preparing", name: resolved.name, transferredBytes: 0 });
          void desktopApi.downloadConversationResource({ ...request, operationId, suggestedName: resolved.name })
            .catch(() => setConversationResourceDownload((current) => current?.operationId === operationId ? { ...current, phase: "failed" } : current));
        };
        return <div
          className="conversation-resource-menu"
          data-testid="conversation-resource-menu"
          role="menu"
          style={{ left: Math.min(conversationResourceMenu.x, window.innerWidth - 290), top: Math.min(conversationResourceMenu.y, window.innerHeight - 360) }}
        >
          {resolved.capabilities.read && resolved.state !== "deleted" && resolved.state !== "offline" ? <button role="menuitem" type="button" onClick={() => { close(); void previewConversationResourcePart(part); }}>{zh ? "打开当前版本" : "Open current version"}</button> : null}
          {resolved.capabilities.preview ? <button role="menuitem" type="button" onClick={() => { close(); void previewConversationResourcePart(part); }}>{zh ? "预览" : "Preview"}</button> : null}
          {resolved.observedVersionAvailable ? <button role="menuitem" type="button" onClick={() => { close(); void previewConversationResourcePart(part, "observed"); }}>{zh ? "打开引用时版本" : "Open cited version"}</button> : null}
          {(resolved.logicalPath || resolved.path) && resolved.state !== "deleted" && resolved.state !== "offline" ? <button role="menuitem" type="button" onClick={() => { close(); if (resolved.capabilities.preview) void previewConversationResourcePart(part); else onOpenWorkspaceArtifact?.(resolved.logicalPath ?? resolved.path!); }}>{zh ? "在文件栏显示" : "Show in Files"}</button> : null}
          {resolved.capabilities.download ? <button role="menuitem" type="button" onClick={download}>{zh ? "下载 / 另存为" : "Download / Save as"}</button> : null}
          {resolved.capabilities.reveal ? <button role="menuitem" type="button" onClick={() => { close(); void desktopApi.revealConversationResource(request).then((ok) => setConversationResourceNotice(ok ? (zh ? "已在系统文件管理器中显示。" : "Revealed in the system file manager.") : (zh ? "无法在系统文件管理器中显示。" : "Could not reveal the resource."))); }}>{zh ? "在系统文件管理器中显示" : "Reveal in system file manager"}</button> : null}
          {resolved.capabilities.copyLogicalPath && resolved.logicalPath ? <button role="menuitem" type="button" onClick={() => { close(); void desktopApi.copyConversationResourceLogicalPath(request).then((path) => copyTextSafely(path)); }}>{zh ? "复制逻辑路径" : "Copy logical path"}</button> : null}
          {resolved.state === "offline" ? <button role="menuitem" type="button" onClick={() => { close(); void resolveConversationResourcePart(part); }}>{zh ? "重试" : "Retry"}</button> : null}
          <button role="menuitem" type="button" onClick={() => { close(); setConversationResourceNotice(`${resolved.name} · ${resolved.logicalPath ?? resolved.resourceId} · ${resolved.state}`); }}>{zh ? "查看资源详情" : "Resource details"}</button>
        </div>;
      })(), document.body) : null}
    </div>
  );
}

// Streaming appends at the tail, so the newest message is almost always the
// element that differs. Comparing from the end finds that mismatch on the
// first step instead of walking the whole array - which, on a long
// conversation, meant touching thousands of elements per rendered frame
// before reaching the one that moved.
function shallowArrayEqual(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = left.length - 1; index >= 0; index -= 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

// Hoisted out of the comparator: it runs on every parent render and used to
// allocate a fresh Set each time.
const CHAT_WORKSPACE_ARRAY_PROPS: ReadonlySet<keyof ChatWorkspaceProps> = new Set<keyof ChatWorkspaceProps>([
  "messages", "agentOptions", "modelOptions", "imageGenerationModelOptions", "samplePrompts",
  "externalAttachments", "workspaceInstructions", "workspaceOptions",
]);

function chatWorkspacePropsEqual(previous: ChatWorkspaceProps, next: ChatWorkspaceProps): boolean {
  // Callback-only changes must reach live event refs; removed optional props
  // must also invalidate this boundary. Never silently ignore function props.
  if (Object.keys(previous).length !== Object.keys(next).length) return false;
  return (Object.keys(next) as Array<keyof ChatWorkspaceProps>).every((key) => {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) return false;
    const nextValue = next[key];
    const previousValue = previous[key];
    if (CHAT_WORKSPACE_ARRAY_PROPS.has(key)) {
      return shallowArrayEqual(previousValue as readonly unknown[] | undefined, nextValue as readonly unknown[] | undefined);
    }
    return Object.is(previousValue, nextValue);
  });
}

export const ChatWorkspace = memo(ChatWorkspaceImpl, chatWorkspacePropsEqual);

const virtualMessageHeightCache = new Map<string, number>();
const MAX_VIRTUAL_MESSAGE_HEIGHTS = 2_000;

function rememberVirtualMessageHeight(messageId: string, height: number): void {
  if (!Number.isFinite(height) || height < 1) return;
  virtualMessageHeightCache.delete(messageId);
  virtualMessageHeightCache.set(messageId, Math.ceil(height));
  while (virtualMessageHeightCache.size > MAX_VIRTUAL_MESSAGE_HEIGHTS) {
    const oldest = virtualMessageHeightCache.keys().next().value;
    if (typeof oldest !== "string") break;
    virtualMessageHeightCache.delete(oldest);
  }
}

function estimateVirtualMessageHeight(message: UiMessage): number {
  const estimateText = [message.content ?? "", message.structuredTurn ? getStructuredTurnEstimateText(message.structuredTurn) : ""]
    .filter(Boolean)
    .join("\n\n");
  const textLength = estimateText.length;
  const newlineCount = estimateText ? (estimateText.match(/\n/g)?.length ?? 0) : 0;
  if (message.role === "user") {
    return Math.min(260, Math.max(76, 62 + newlineCount * 18 + Math.ceil(textLength / 90) * 20));
  }
  const structuredWeight = message.structuredTurn
    ? (message.structuredTurn.parts.length * 46) + Math.min(180, message.structuredTurn.activities.length * 10)
    : 0;
  return Math.min(3_200, Math.max(220, 150 + newlineCount * 18 + Math.ceil(textLength / 78) * 22 + structuredWeight));
}

function getStructuredTurnEstimateText(turn: StructuredTurnState): string {
  return turn.parts.map(getStructuredPartEstimateText).filter(Boolean).join("\n\n");
}

function getStructuredPartEstimateText(part: StructuredAssistantPart): string {
  if (part.kind === "markdown") return part.markdown;
  if (part.kind === "reasoning") return [part.summary, ...part.segments.map((segment) => segment.text)].filter(Boolean).join("\n");
  if (part.kind === "progress") return part.summary;
  if (part.kind === "artifact") return [part.name, part.summary].filter(Boolean).join("\n");
  if (part.kind === "citation") return [part.title, part.excerpt].filter(Boolean).join("\n");
  if (part.kind === "interaction") return part.prompt;
  if (part.kind === "subtask") return [part.title, part.summary].filter(Boolean).join("\n");
  return part.message;
}

// Keep the entire row inside this memo boundary: JSX children created by the
// workspace would change on every token, while ignoring them freezes UI state.
// Every display dependency is an explicit prop; event props use live callbacks.
interface VirtualizedMessageProps {
  message: UiMessage;
  className: string;
  pinned: boolean;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  language: AppLanguage;
  workspacePath: string | undefined;
  searchQuery: string;
  conversationResourceStates: Readonly<Record<string, ConversationResourceResolveResult["state"]>>;
  respondedInputRequests: ReadonlySet<string>;
  configuredCapabilityRequests: ReadonlySet<string>;
  reproducibilityLevel: RunReproducibilityLevel | undefined;
  voicePlayback: SystemVoicePlayback;
  playbackDisabled: boolean;
  playbackRate: number;
  synthesisMode: "system" | "provider";
  voiceName: string;
  turnActionsDisabled: boolean;
  handleMarkdownLink: (href: string | undefined) => void;
  openStructuredArtifact: (part: ArtifactPart) => void;
  downloadStructuredArtifact: (part: ArtifactPart) => void;
  openConversationResourceMenu: (part: ArtifactPart | CitationPart, anchor: { x: number; y: number; trigger?: HTMLElement }) => void;
  openStructuredCitation: (part: CitationPart) => void;
  respondToStructuredInteraction: (turnId: string, part: InteractionPart, response: InteractionResponse) => void;
  requestStructuredTextInput: (turnId: string, part: InteractionPart) => void;
  startEditAndResend: (messageId: string) => void;
  startEditUserMessage: (messageId: string) => void;
  regenerateAssistant: (messageId: string) => Promise<void>;
  onRetryMessage: ChatWorkspaceProps["onRetryMessage"];
  onReportFeedback: ChatWorkspaceProps["onReportFeedback"];
  onRecoveryAction: ChatWorkspaceProps["onRecoveryAction"];
  onDeleteMessage: ChatWorkspaceProps["onDeleteMessage"];
}

const VirtualizedMessage = memo(function VirtualizedMessage({
  message,
  className,
  pinned,
  scrollRootRef,
  language,
  workspacePath,
  searchQuery,
  conversationResourceStates,
  respondedInputRequests,
  configuredCapabilityRequests,
  reproducibilityLevel,
  voicePlayback,
  playbackDisabled,
  playbackRate,
  synthesisMode,
  voiceName,
  turnActionsDisabled,
  handleMarkdownLink,
  openStructuredArtifact,
  downloadStructuredArtifact,
  openConversationResourceMenu,
  openStructuredCitation,
  respondToStructuredInteraction,
  requestStructuredTextInput,
  startEditAndResend,
  startEditUserMessage,
  regenerateAssistant,
  onRetryMessage,
  onReportFeedback,
  onRecoveryAction,
  onDeleteMessage,
}: VirtualizedMessageProps): React.JSX.Element {
  const zh = language === "zh";
  const assistantContent = message.role === "assistant"
    ? getAssistantDisplayContent(message)
    : message.content;
  const elementRef = useRef<HTMLElement | null>(null);
  const [renderContent, setRenderContent] = useState(pinned);

  useEffect(() => {
    if (pinned) setRenderContent(true);
  }, [pinned]);

  useEffect(() => {
    const element = elementRef.current;
    const root = scrollRootRef.current;
    if (!element || !root || pinned) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setRenderContent((current) => entry.isIntersecting ? true : current && false);
    }, { root, rootMargin: "900px 0px", threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.id, pinned, scrollRootRef]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !renderContent) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
      if (height) rememberVirtualMessageHeight(message.id, height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.id, renderContent]);

  const placeholderHeight = virtualMessageHeightCache.get(message.id) ?? estimateVirtualMessageHeight(message);
  return (
    <article
      ref={elementRef}
      className={`${className} ${renderContent ? "virtual-message-rendered" : "virtual-message-placeholder"}`}
      data-message-id={message.id}
      data-structured-turn-id={message.structuredTurn?.turnId}
      data-run-id={message.runtimeRunId ?? message.structuredTurn?.turnId ?? (message.role === "assistant" ? message.id : undefined)}
      style={renderContent ? undefined : { height: placeholderHeight }}
      aria-hidden={renderContent ? undefined : true}
    >
      {renderContent ? (<>
            {message.role === "user" || !message.structuredTurn ? <strong className="message-author">{message.role === "user" ? "You" : "OpenDrSai"}</strong> : null}
            <div className="message-body">
              {message.role === "user" && message.attachments?.length ? (
                <div className="message-attachment-badges" aria-label={zh ? "附件" : "Attachments"}>
                  {message.attachments.map((attachment, index) => (
                    <MessageAttachmentBadge
                      key={`${message.id}-attachment-${index}-${attachment.path || attachment.name}`}
                      attachment={attachment}
                      workspacePath={workspacePath}
                      zh={zh}
                    />
                  ))}
                </div>
              ) : null}
              {message.role === "assistant" && message.replyFailed ? (
                <div className="chat-reply-failed">
                  {onRetryMessage ? <span className="chat-retry-actions">
                    <button type="button" onClick={() => void onRetryMessage(message.id, "same_session")}>{zh ? "在当前会话重试" : "Retry in this session"}</button>
                    <button type="button" onClick={() => void onRetryMessage(message.id, "new_session")}>{zh ? "分支到新会话" : "Branch to a new session"}</button>
                  </span> : null}
                  {onReportFeedback ? <button type="button" data-testid={`message-feedback-${message.id}`} onClick={() => onReportFeedback({ source: "error", errorCode: message.replyFailed ? "reply_incomplete" : "chat_error", errorType: "assistant_message_failure", runId: message.runtimeRunId })}>{zh ? "反馈这个问题" : "Report this problem"}</button> : null}
                </div>
              ) : message.content && message.role === "user" ? (
                <p>{highlightPlainText(message.content, searchQuery)}</p>
              ) : message.role === "assistant" && message.structuredTurn ? (
                message.structuredTurn.parts.length || message.structuredTurn.activities.length ? (
                  <StructuredMessageParts
                    turn={message.structuredTurn}
                    language={language}
                    workspacePath={workspacePath}
                    resourceStates={conversationResourceStates}
                    respondedRequestIds={respondedInputRequests}
                    configuredCapabilityRequestIds={configuredCapabilityRequests}
                    onOpenLink={handleMarkdownLink}
                    onOpenArtifact={openStructuredArtifact}
                    onDownloadArtifact={downloadStructuredArtifact}
                    onOpenArtifactMenu={openConversationResourceMenu}
                    onOpenCitation={openStructuredCitation}
                    onOpenCitationMenu={openConversationResourceMenu}
                    onRespondInteraction={(part, response) => respondToStructuredInteraction(message.structuredTurn!.turnId, part, response)}
                    onRequestTextInteraction={(part) => requestStructuredTextInput(message.structuredTurn!.turnId, part)}
                    reproducibilityLevel={reproducibilityLevel}
                    startedAt={message.startedAt}
                    completedAt={message.lastEventAt}
                  />
                ) : (
                  <StreamingStatus message={message} zh={zh} />
                )
              ) : message.content ? (
                <ChatMessageContent
                  content={assistantContent}
                  streaming={message.streaming}
                  language={language}
                  onOpenLink={handleMarkdownLink}
                />
              ) : message.role === "user" && message.attachments?.length ? null : (
                <StreamingStatus message={message} zh={zh} />
              )}
              {message.role === "assistant" && message.errorPresentation ? (
                <ChatErrorCard
                  presentation={message.errorPresentation}
                  messageId={message.id}
                  zh={zh}
                  onRecoveryAction={onRecoveryAction}
                />
              ) : null}
              {!message.structuredTurn && message.reasoningContent && (
                <details className="chat-reasoning chat-event-reasoning">
                  <summary>
                    <ChevronRight size={14} />
                    <span>{message.streaming ? (zh ? "正在思考…" : "Thinking…") : (zh ? "思考过程" : "Reasoning")}</span>
                  </summary>
                  <div className="chat-reasoning-content">
                    <ChatMessageContent
                      content={getReasoningChatText(message.reasoningContent)}
                      streaming={message.streaming}
                      language={language}
                      onOpenLink={handleMarkdownLink}
                    />
                  </div>
                </details>
              )}
              {message.role === "assistant" && !message.errorPresentation && message.recoveryActions?.length && onRecoveryAction ? (
                <div className="chat-recovery-actions" role="group" aria-label={zh ? "恢复操作" : "Recovery actions"}>
                  {message.recoveryActions.map((action) => <button type="button" key={action.id}
                    onClick={() => void onRecoveryAction(message.id, action.id)}>{action.label}</button>)}
                </div>
              ) : null}
              {!message.structuredTurn && message.inputRequest ? (
                <section className="chat-agent-input-request structured-interaction-compact" aria-label={zh ? "智能体请求输入" : "Agent input request"}>
                  <span>{respondedInputRequests.has(message.inputRequest.requestId)
                    ? (zh ? "操作已处理" : "Action handled")
                    : (zh ? "等待你的操作，请在输入栏处理" : "Action required in the composer")}</span>
                </section>
              ) : null}
              {message.role === "assistant" && !message.streaming && !message.error && assistantContent ? (
                <MessageActions
                  content={assistantContent}
                  messageId={message.id}
                  playback={voicePlayback}
                  playbackDisabled={playbackDisabled}
                  playbackRate={playbackRate}
                  synthesisMode={synthesisMode}
                  voiceName={voiceName}
                  zh={zh}
                  turnActionsDisabled={turnActionsDisabled}
                  showTurnActions={!message.replyFailed}
                  onEditAndResend={startEditAndResend}
                  onRegenerate={() => void regenerateAssistant(message.id)}
                  onDelete={onDeleteMessage}
                />
              ) : null}
              {message.role === "user" && message.content ? (
                <UserMessageActions
                  content={message.content}
                  messageId={message.id}
                  zh={zh}
                  turnActionsDisabled={turnActionsDisabled}
                  onEditAndResend={startEditUserMessage}
                  onDelete={onDeleteMessage}
                />
              ) : null}
            </div>
      </>) : null}
    </article>
  );
});

function formatPickedFileMeta(file: PickedFileDescriptor, zh: boolean): string {
  const category = {
    pdf: "PDF",
    word: zh ? "Word 文档" : "Word document",
    spreadsheet: zh ? "Excel 工作簿" : "Excel workbook",
    table: zh ? "表格数据" : "Table data",
    image: zh ? "图片" : "Image",
    presentation: zh ? "演示文稿" : "Presentation",
    text: zh ? "文本" : "Text",
    other: zh ? "其他文件" : "Other file",
  }[file.category];
  const status = file.status === "ready"
    ? (zh ? "已就绪" : "Ready")
    : file.status === "unsupported"
      ? (zh ? "暂不支持" : "Unsupported")
      : (zh ? "读取失败" : "Unreadable");
  const size = typeof file.sizeBytes === "number" ? formatPickedFileSize(file.sizeBytes) : "";
  return [category, size, status].filter(Boolean).join(" · ");
}

function formatPickedFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createMaterialTaskSuggestions(
  analysis: MaterialRoleAnalysisResult | null,
  zh: boolean,
): MaterialTaskSuggestion[] {
  if (!analysis?.items.length) return [];
  const byRole = (role: MaterialRoleItem["role"]) => analysis.items.filter((item) => item.role === role).map((item) => item.name);
  const reports = byRole("previous_report");
  const data = byRole("latest_data");
  const images = byRole("result_image");
  const references = byRole("reference_material");
  const quoted = (names: string[]) => names.map((name) => `“${name}”`).join("、");
  const suggestions: MaterialTaskSuggestion[] = [];
  if (reports.length && data.length) suggestions.push({
    id: "update-report",
    title: zh ? "用最新数据更新旧报告" : "Update the previous report",
    description: zh ? "保留原文件，生成一份可核对的新版本" : "Keep originals and produce a reviewable new version",
    prompt: zh ? `请用最新数据 ${quoted(data)} 更新旧报告 ${quoted(reports)}，保留原文件，列出改动和依据，并生成一份新版本。` : `Update ${quoted(reports)} with the latest data in ${quoted(data)}. Keep the originals, list every change and its evidence, and create a new version.`,
  });
  if (data.length) suggestions.push({
    id: "check-data",
    title: zh ? "检查数据是否有问题" : "Check the data for issues",
    description: zh ? "检查字段、单位、缺失值、异常值和趋势" : "Check fields, units, missing values, outliers, and trends",
    prompt: zh ? `请检查 ${quoted(data)} 是否有字段、单位、缺失值、异常值或趋势问题，说明发现、依据和建议。` : `Check ${quoted(data)} for field, unit, missing-value, outlier, and trend issues. Explain findings, evidence, and recommendations.`,
  });
  if (data.length && suggestions.length < 2) suggestions.push({
    id: "visualize-data",
    title: zh ? "制作数据图表" : "Create data charts",
    description: zh ? "选择合适图表并解释主要趋势" : "Choose suitable charts and explain key trends",
    prompt: zh ? `请分析 ${quoted(data)}，选择合适的图表展示主要趋势和异常点，保留单位、图例和数据来源，并解释为什么选择这些图表。` : `Analyze ${quoted(data)} and create suitable charts for the main trends and outliers. Preserve units, legends, and data sources, and explain the chart choices.`,
  });
  if (data.length && images.length) suggestions.push({
    id: "check-image-data-consistency",
    title: zh ? "核对图片与数据" : "Compare images with data",
    description: zh ? "检查趋势、坐标、单位和数字是否一致" : "Verify trends, axes, units, and values",
    prompt: zh ? `请核对结果图片 ${quoted(images)} 与最新数据 ${quoted(data)} 是否一致，逐项检查趋势、坐标、单位和关键数字，并标出冲突。` : `Compare result images ${quoted(images)} with latest data ${quoted(data)}. Check trends, axes, units, and key values, and flag every conflict.`,
  });
  if (references.length) suggestions.push({
    id: "summarize-references",
    title: zh ? "提取材料要点" : "Extract key points",
    description: zh ? "整理结论、结构、关键数字和可引用出处" : "Organize conclusions, structure, key figures, and citations",
    prompt: zh ? `请提取参考材料 ${quoted(references)} 的核心结论、内容结构、关键数字和可引用出处，用非专业读者能理解的语言说明。` : `Extract the main conclusions, structure, key figures, and citable sources from ${quoted(references)}, using language a non-specialist can understand.`,
  });
  if (references.length && suggestions.length < 2) suggestions.push({
    id: "organize-reference-questions",
    title: zh ? "整理值得继续追问的问题" : "Identify follow-up questions",
    description: zh ? "区分已有结论、证据缺口和下一步问题" : "Separate known conclusions, evidence gaps, and next questions",
    prompt: zh ? `请基于 ${quoted(references)} 整理已有结论、仍不确定的地方、证据缺口和下一步最值得追问的 5 个问题，并标明对应材料位置。` : `Using ${quoted(references)}, organize established conclusions, uncertainties, evidence gaps, and the five most useful follow-up questions, citing their source locations.`,
  });
  if (images.length && !data.length && suggestions.length < 2) suggestions.push({
    id: "explain-images",
    title: zh ? "解释图片表达了什么" : "Explain the images",
    description: zh ? "识别图表元素、趋势和需要补充的信息" : "Identify chart elements, trends, and missing context",
    prompt: zh ? `请解释结果图片 ${quoted(images)} 表达的趋势和结论，识别坐标、单位、图例及缺失信息；无法确认的地方请明确说明。` : `Explain the trends and conclusions in ${quoted(images)}. Identify axes, units, legends, and missing context, and clearly state anything that cannot be verified.`,
  });
  return suggestions.slice(0, 4);
}

function createMaterialRoleLookup(items: MaterialRoleItem[]): Map<string, MaterialRoleItem> {
  const lookup = new Map<string, MaterialRoleItem>();
  const nameCounts = new Map<string, number>();
  for (const item of items) {
    const nameKey = item.name.toLocaleLowerCase();
    nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1);
    lookup.set(normalizeMaterialRolePath(item.path), item);
  }
  for (const item of items) {
    const nameKey = item.name.toLocaleLowerCase();
    if (nameCounts.get(nameKey) === 1) lookup.set(`name:${nameKey}`, item);
  }
  return lookup;
}

function findMaterialRole(
  lookup: Map<string, MaterialRoleItem>,
  attachment: ChatAttachment,
): MaterialRoleItem | undefined {
  return lookup.get(normalizeMaterialRolePath(attachment.path))
    || lookup.get(`name:${attachment.name.toLocaleLowerCase()}`);
}

function normalizeMaterialRolePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function enrichAttachmentWithMaterialRole(
  attachment: ChatAttachment,
  item?: MaterialRoleItem,
): ChatAttachment {
  if (!item) return attachment;
  const roleSummary = `Material role: ${formatMaterialRoleLabel(item.role, false)} (${Math.round(item.confidence * 100)}% confidence). ${item.reason} Suggested use: ${item.suggestedUse}`;
  return {
    ...attachment,
    note: [attachment.note, roleSummary].filter(Boolean).join("\n"),
  };
}

function isMaterialInventoryQuestion(text: string): boolean {
  return /(?:(?:我|系统)(?:目前|现在)?)?(?:有|拥有|导入|上传)(?:了|的)?哪些材料|材料(?:清单|列表|角色|分别是什么)|what (?:files|materials|sources) (?:do i|are)|list (?:my )?(?:files|materials|sources)/i.test(text.trim());
}

function isNaturalMaterialQuestion(text: string): boolean {
  const normalized = text.trim();
  return /[?？]/.test(normalized)
    || /(?:标题|题目|样本量|均值|容量|带宽|数字|数值|比例|百分比).*(?:是什么|是多少|有多少)/.test(normalized)
    || /(?:什么|哪种|哪些).*(?:方法|实验设计|研究设计|差异|不同|区别|冲突|不一致)/.test(normalized)
    || /(?:比较|对比).*(?:差异|不同|区别|冲突|不一致)/.test(normalized)
    || /\b(?:what|how many|where|which|compare|difference|title|bandwidth|sample size|method|protocol|conflict)\b/i.test(normalized);
}

function formatMaterialRoleLabel(role: MaterialRoleItem["role"], zh: boolean): string {
  if (role === "previous_report") return zh ? "旧报告" : "Previous reports";
  if (role === "latest_data") return zh ? "最新数据" : "Latest data";
  if (role === "result_image") return zh ? "结果图片" : "Result images";
  return zh ? "参考材料" : "Reference materials";
}

function formatMaterialConsistencyKind(kind: MaterialConsistencyFindingKind, zh: boolean): string {
  if (kind === "consensus") return zh ? "多来源共识" : "Consensus";
  if (kind === "source_conflict") return zh ? "来源冲突" : "Source conflict";
  if (kind === "outdated_number") return zh ? "过期数字" : "Outdated number";
  if (kind === "chart_mismatch") return zh ? "图文不一致" : "Chart mismatch";
  return zh ? "证据不足" : "Evidence gap";
}

function formatMaterialRoleFiles(
  items: MaterialRoleItem[],
  role: MaterialRoleItem["role"],
  zh: boolean,
): string {
  const matching = items.filter((item) => item.role === role);
  if (!matching.length) return zh ? "暂未发现" : "None detected";
  return matching.map((item) => `${item.name} · ${Math.round(item.confidence * 100)}%`).join("；");
}

function formatFolderImportMeta(folder: NonNullable<ComposerAttachment["folderImport"]>, zh: boolean): string {
  if (folder.phase === "scanning") return zh ? "正在扫描文件夹…" : "Scanning folder…";
  if (folder.phase === "failed") return zh ? `扫描失败 · ${folder.message || "无法读取"}` : `Scan failed · ${folder.message || "Unreadable"}`;
  return zh
    ? `已导入 ${folder.imported} · 跳过 ${folder.skipped} · 失败 ${folder.failed} · 重复 ${folder.duplicates} · 子目录 ${folder.directories}`
    : `Imported ${folder.imported} · skipped ${folder.skipped} · failed ${folder.failed} · duplicates ${folder.duplicates} · ${folder.directories} folders`;
}

function getForkQueueCommandArgs(input: string): string {
  const match = input.trimStart().match(/^\/fork\s+([\s\S]*)$/i);
  return match?.[1]?.trim() ?? "";
}

function buildForkQueueAgentAssignments(
  entries: ReturnType<typeof parseForkQueueEntries>,
  selections: Record<number, string>,
  agents: DesktopAgent[],
): ChatForkQueueAgentAssignment[] | undefined {
  const assignments: ChatForkQueueAgentAssignment[] = [];
  entries.forEach((_entry, index) => {
    const queueIndex = index + 1;
    const agentId = selections[queueIndex];
    if (!agentId) return;
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    assignments.push({
      queueIndex,
      agentId: agent.id,
      agentName: agent.name,
    });
  });
  return assignments.length ? assignments : undefined;
}

function ChatErrorCard({
  presentation,
  messageId,
  zh,
  onRecoveryAction,
}: {
  presentation: ChatErrorPresentation;
  messageId: string;
  zh: boolean;
  onRecoveryAction?: (assistantMessageId: string, action: UserFacingRecoveryAction["id"]) => void | Promise<void>;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const primary = presentation.actions.find((action) => action.id !== "diagnostics");
  const secondary = presentation.actions.filter((action) => action !== primary);
  const invoke = (action: UserFacingRecoveryAction) => void onRecoveryAction?.(messageId, action.id);
  const copyDetails = async () => {
    try {
      await copyTextSafely(`${presentation.title}\n${presentation.summary}\nCode: ${presentation.code}\nTrace ID: ${presentation.traceId}`);
    } catch {
      // Clipboard availability must not break progressive disclosure.
    }
  };
  return <section className={`chat-error-card chat-error-card-${presentation.severity}`} role="alert">
    <div className="chat-error-card-heading"><strong>{presentation.title}</strong></div>
    <p>{presentation.summary}</p>
    {presentation.partialContentPreserved ? <p className="chat-error-card-preserved">{zh ? "已生成内容已保留" : "Generated content has been preserved"}</p> : null}
    <div className="chat-error-card-primary">
      {primary && onRecoveryAction ? <button type="button" onClick={() => invoke(primary)}>{primary.id === "diagnostics" ? (zh ? "打开诊断" : "Open diagnostics") : primary.label}</button> : null}
      <button type="button" className="chat-error-card-details-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? (zh ? "收起详情" : "Hide details") : (zh ? "查看详情" : "View details")}</button>
    </div>
    {expanded ? <div className="chat-error-card-details">
      <dl><div><dt>{zh ? "错误代码" : "Code"}</dt><dd>{presentation.code}</dd></div><div><dt>{zh ? "跟踪 ID" : "Trace ID"}</dt><dd>{presentation.traceId}</dd></div></dl>
      <button type="button" onClick={() => void copyDetails()}>{zh ? "复制脱敏错误信息" : "Copy redacted error details"}</button>
      {secondary.length && onRecoveryAction ? <div className="chat-error-card-secondary" role="group" aria-label={zh ? "其他恢复操作" : "Other recovery actions"}>{secondary.map((action) => <button type="button" key={action.id} onClick={() => invoke(action)}>{action.id === "diagnostics" ? (zh ? "打开诊断" : "Open diagnostics") : action.label}</button>)}</div> : null}
    </div> : null}
  </section>;
}

function StreamingStatus({
  message,
  zh,
}: {
  message: UiMessage;
  zh: boolean;
}): React.JSX.Element | null {
  const now = useStreamingClock(Boolean(message.streaming));
  if (!message.streaming) {
    // Empty completed shells are filtered elsewhere; never show the literal placeholder.
    if (message.error && !message.errorPresentation) {
      return <p>{zh ? "回复失败。请查看调试信息。" : "Reply failed. View debug details."}</p>;
    }
    return null;
  }

  if (!message.startedAt) {
    const queuedSeconds = Math.max(0, Math.floor((now - (message.queuedAt ?? now)) / 1000));
    return (
      <div className="streaming-status">
        <span className="streaming-dot" aria-hidden />
        <span>{zh ? "正在排队" : "Queued"}</span>
        <time>{zh ? `已等待 ${queuedSeconds} 秒` : `Waiting ${queuedSeconds}s`}</time>
      </div>
    );
  }

  const startedAt = message.startedAt;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const lastEventAt = message.lastEventAt ?? startedAt;
  const idleSeconds = Math.max(0, Math.floor((now - lastEventAt) / 1000));
  const detail = elapsedSeconds >= 120
    ? zh ? "任务仍在运行；你可以继续等待、停止，或打开调试信息" : "The task is still running; you can keep waiting, stop it, or open diagnostics"
    : elapsedSeconds >= 60
      ? zh ? "模型仍在处理长任务，连接保持正常" : "The model is still processing this long task; the connection remains active"
      : elapsedSeconds >= 30
        ? zh ? "这一步比平时更久，正在继续等待模型" : "This step is taking longer than usual; still waiting for the model"
    : elapsedSeconds < 3
    ? zh ? "正在连接本地运行时..." : "Connecting to the local runtime..."
    : idleSeconds >= 10
      ? zh ? "正在等待模型输出" : "Waiting for model output"
      : zh ? "正在处理" : "Working";

  return (
    <div className="streaming-status">
      <span className="streaming-dot" aria-hidden />
      <span>{detail}</span>
      <time>{zh ? `已执行 ${elapsedSeconds} 秒` : `Running ${elapsedSeconds}s`}</time>
      {message.firstFeedbackAt && message.startedAt ? <small>{zh ? "首个状态" : "First status"} {Math.max(0, message.firstFeedbackAt - message.startedAt)}ms</small> : null}
      {message.firstDeltaAt && message.startedAt ? <small>{zh ? "首个模型片段" : "First model delta"} {Math.max(0, message.firstDeltaAt - message.startedAt)}ms</small> : null}
    </div>
  );
}

function UserMessageActions({
  content,
  messageId,
  zh,
  turnActionsDisabled = false,
  onEditAndResend,
  onDelete,
}: {
  content: string;
  messageId: string;
  zh: boolean;
  turnActionsDisabled?: boolean;
  onEditAndResend?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      if (!await copyTextSafely(content)) return;
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="message-actions user-message-actions" aria-live="polite">
      <button type="button" onClick={() => void handleCopy()} title={zh ? "复制输入" : "Copy input"}>
        {copied ? <Check size={13} /> : <ClipboardList size={13} />}
        <span>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</span>
      </button>
      {onEditAndResend ? (
        <button
          type="button"
          data-testid={`user-message-action-edit-resend-${messageId}`}
          disabled={turnActionsDisabled}
          onClick={() => onEditAndResend(messageId)}
          title={zh ? "编辑并重发" : "Edit & resend"}
        >
          <Pencil size={13} />
          <span>{zh ? "编辑并重发" : "Edit & resend"}</span>
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          data-testid={`user-message-action-delete-${messageId}`}
          onClick={() => onDelete(messageId)}
          title={zh ? "删除本条" : "Delete"}
        >
          <Trash2 size={13} />
          <span>{zh ? "删除" : "Delete"}</span>
        </button>
      ) : null}
    </div>
  );
}

function MessageActions({
  content,
  messageId,
  playback,
  playbackDisabled,
  playbackRate,
  synthesisMode,
  voiceName,
  zh,
  turnActionsDisabled = false,
  showTurnActions = false,
  onEditAndResend,
  onRegenerate,
  onDelete,
}: {
  content: string;
  messageId: string;
  playback: SystemVoicePlayback;
  playbackDisabled: boolean;
  playbackRate: number;
  synthesisMode: "system" | "provider";
  voiceName: string;
  zh: boolean;
  turnActionsDisabled?: boolean;
  showTurnActions?: boolean;
  onEditAndResend?: (messageId: string) => void;
  onRegenerate?: () => void;
  onDelete?: (messageId: string) => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [localPending, setLocalPending] = useState(false);
  const isActive = playback.activeMessageId === messageId;
  const isPlaying = isActive && playback.phase === "playing";
  const isPaused = isActive && playback.phase === "paused";
  const isSynthesizing = localPending || (isActive && playback.phase === "synthesizing");
  const playbackError = isActive && playback.phase === "failed" ? playback.error : null;

  useEffect(() => {
    if (!localPending) return;
    if (playback.activeMessageId === messageId && playback.phase !== "idle") {
      setLocalPending(false);
      return;
    }
    if (playback.error && playback.phase === "failed") {
      setLocalPending(false);
    }
  }, [localPending, messageId, playback.activeMessageId, playback.error, playback.phase]);

  async function handleCopy(): Promise<void> {
    try {
      if (!await copyTextSafely(content)) return;
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function handleReadAloud(): void {
    setLocalPending(true);
    try {
      playback.play(messageId, content, zh ? "zh" : "en", {
        mode: synthesisMode,
        rate: playbackRate,
        voiceName,
      });
    } catch (error) {
      setLocalPending(false);
      console.error("voice playback failed to start", error);
    }
  }

  return (
    <div className={`message-actions ${isActive || isSynthesizing || playbackError ? "active" : ""}`} aria-live="polite">
      <button type="button" onClick={() => void handleCopy()} title={zh ? "复制回答" : "Copy response"}>
        {copied ? "✓" : <ClipboardList size={13} />}
        <span>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</span>
      </button>
      {showTurnActions && onEditAndResend ? (
        <button
          type="button"
          data-testid={`message-action-edit-resend-${messageId}`}
          disabled={turnActionsDisabled}
          onClick={() => onEditAndResend(messageId)}
          title={zh ? "编辑原问题并重发这一轮" : "Edit the prompt and resend this turn"}
        >
          <Pencil size={13} />
          <span>{zh ? "编辑并重发" : "Edit & resend"}</span>
        </button>
      ) : null}
      {showTurnActions && onRegenerate ? (
        <button
          type="button"
          data-testid={`message-action-regenerate-${messageId}`}
          disabled={turnActionsDisabled}
          onClick={() => onRegenerate()}
          title={zh ? "用原问题重新生成这一轮" : "Regenerate this turn with the same prompt"}
        >
          <RefreshCw size={13} />
          <span>{zh ? "重新生成" : "Regenerate"}</span>
        </button>
      ) : null}
      {showTurnActions && onDelete ? (
        <button
          type="button"
          data-testid={`message-action-delete-${messageId}`}
          onClick={() => onDelete(messageId)}
          title={zh ? "删除本条" : "Delete this message"}
        >
          <Trash2 size={13} />
          <span>{zh ? "删除本条" : "Delete"}</span>
        </button>
      ) : null}
      {isSynthesizing ? (
        <button type="button" disabled title={zh ? "正在合成语音" : "Synthesizing speech"}>
          <RefreshCw size={13} className="spinning" />
          <span>{zh ? "合成中" : "Synthesizing"}</span>
        </button>
      ) : isPlaying ? (
        <button type="button" onClick={playback.pause} title={zh ? "暂停朗读" : "Pause reading"}>
          <Pause size={13} />
          <span>{zh ? "暂停" : "Pause"}</span>
        </button>
      ) : isPaused ? (
        <button type="button" onClick={playback.resume} title={zh ? "继续朗读" : "Resume reading"}>
          <Play size={13} />
          <span>{zh ? "继续" : "Resume"}</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={playbackDisabled || !playback.isAvailable}
          onClick={handleReadAloud}
          title={
            playbackDisabled
              ? (zh ? "录音进行中，暂不可朗读" : "Unavailable while recording")
              : !playback.isAvailable
                ? (zh ? "当前环境不支持朗读" : "Speech playback unavailable")
                : (zh ? "朗读回复" : "Read response aloud")
          }
        >
          <Volume2 size={13} />
          <span>{zh ? "朗读" : "Read"}</span>
        </button>
      )}
      {isActive || isSynthesizing ? (
        <button
          type="button"
          onClick={() => {
            setLocalPending(false);
            playback.stop();
          }}
          title={zh ? "停止朗读" : "Stop reading"}
        >
          <Square size={12} />
          <span>{zh ? "停止" : "Stop"}</span>
        </button>
      ) : null}
      {playbackError ? (
        <>
          <span className="message-action-error" role="status">{playbackError}</span>
          <button type="button" onClick={handleReadAloud} title={zh ? "重试朗读" : "Retry reading"}>
            <RefreshCw size={13} />
            <span>{zh ? "重试" : "Retry"}</span>
          </button>
          {synthesisMode === "provider" ? (
            <button
              type="button"
              onClick={() => playback.play(messageId, content, zh ? "zh" : "en", {
                mode: "system",
                rate: playbackRate,
                voiceName,
              })}
              title={zh ? "改用 Windows 本地朗读" : "Use Windows system speech"}
            >
              <Volume2 size={13} />
              <span>{zh ? "Windows 朗读" : "Windows speech"}</span>
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function highlightPlainText(text: string, query: string): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerNeedle);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    parts.push(
      <mark className="chat-search-mark" key={`${matchIndex}-${lowerNeedle}`}>
        {text.slice(matchIndex, matchIndex + needle.length)}
      </mark>,
    );
    cursor = matchIndex + needle.length;
    matchIndex = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function getPathName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

async function createClipboardImageAttachment(
  file: File,
  index: number,
): Promise<ComposerAttachment | null> {
  const name = file.name?.trim() || `clipboard-image-${index + 1}`;
  const tooLarge = file.size > MAX_CLIPBOARD_IMAGE_BYTES;
  // visibleText is undefined for clipboard images — the actual image content
  // is sent as a multimodal OaepInputResource, not as text metadata.
  const visibleText = undefined;
  const screenshotDataUrl = tooLarge ? undefined : await blobToDataUrl(file);
  return {
    id: crypto.randomUUID(),
    kind: "selection",
    path: `clipboard:image:${crypto.randomUUID()}`,
    name,
    title: `Clipboard image: ${name}`,
    visibleText,
    screenshotDataUrl,
    note: tooLarge
      ? "Explicit clipboard image paste; metadata only because the image exceeded the local data URL limit."
      : "Explicit clipboard image paste with bounded data URL context.",
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read clipboard image."));
    reader.readAsDataURL(blob);
  });
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name.trim());
}

function isImageAttachment(
  attachment: ChatAttachment,
  importFile?: PickedFileDescriptor,
): boolean {
  if (attachment.screenshotDataUrl?.startsWith("data:image/")) return true;
  if (importFile?.category === "image") return true;
  if (importFile?.previewDataUrl?.startsWith("data:image/")) return true;
  return isImageFileName(attachment.name) || isImageFileName(attachment.path);
}

function splitLocalFilePreviewPath(filePath: string): { workspacePath: string; relativePath: string } | null {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith("clipboard:")) return null;
  const sepIdx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (sepIdx <= 0) return null;
  const workspacePath = trimmed.slice(0, sepIdx);
  const relativePath = trimmed.slice(sepIdx + 1);
  if (!workspacePath || !relativePath) return null;
  return { workspacePath, relativePath };
}

function canOpenComposerFilePreview(attachment: ComposerAttachment): boolean {
  if (attachment.kind === "folder" || attachment.kind === "terminal" || attachment.kind === "selection" || attachment.kind === "browser") {
    return false;
  }
  if (attachment.folderImport?.phase === "scanning" || attachment.folderImport?.phase === "failed") {
    return false;
  }
  if (attachment.importFile?.status && attachment.importFile.status !== "ready") {
    return false;
  }
  return Boolean(splitLocalFilePreviewPath(attachment.path));
}

function ComposerAttachmentChip({
  attachment,
  workspacePath,
  zh,
  onRemove,
}: {
  attachment: ComposerAttachment;
  workspacePath?: string;
  zh: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  const Icon =
    attachment.kind === "folder"
      ? FolderPlus
      : attachment.kind === "terminal"
        ? Terminal
      : attachment.kind === "selection"
        ? ClipboardList
      : attachment.kind === "browser"
        ? Globe2
        : Paperclip;
  const previewSrc = useAttachmentImageSrc(attachment, workspacePath, attachment.importFile);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const canPreviewImage = Boolean(previewSrc);
  const canPreviewFile = !canPreviewImage && canOpenComposerFilePreview(attachment);
  const copy = (
    <span className="composer-attachment-copy">
      <strong>{attachment.name}</strong>
      {attachment.importFile ? <small>{formatPickedFileMeta(attachment.importFile, zh)}</small> : null}
      {attachment.importFile?.message ? <small data-testid="composer-file-status-message">{attachment.importFile.message}</small> : null}
      {attachment.importFile?.recoveryAction ? <small data-testid="composer-file-recovery-action">{attachment.importFile.recoveryAction}</small> : null}
      {attachment.importFile?.privacyNotice ? <small data-testid="composer-file-privacy-notice">{attachment.importFile.privacyNotice}</small> : null}
      {attachment.folderImport ? <small>{formatFolderImportMeta(attachment.folderImport, zh)}</small> : null}
    </span>
  );

  return (
    <span
      className={`composer-attachment-chip ${(attachment.importFile?.status && attachment.importFile.status !== "ready") || attachment.folderImport?.phase === "failed" ? "import-failed" : ""} ${attachment.folderImport?.phase === "scanning" ? "import-scanning" : ""} ${isImageAttachment(attachment, attachment.importFile) ? "has-image-preview" : ""}`}
      title={attachment.importFile?.message || attachment.folderImport?.message || attachment.path}
      data-testid="composer-attachment"
      data-import-status={attachment.importFile?.status || "ready"}
      data-file-category={attachment.importFile?.category || "other"}
      data-size-bytes={attachment.importFile?.sizeBytes ?? ""}
      data-diagnostic-code={attachment.importFile?.diagnosticCode || ""}
      data-processing-mode={attachment.importFile?.processingMode || ""}
      data-sensitive-detected={attachment.importFile?.sensitiveDataDetected ? "true" : "false"}
      data-sensitive-kinds={attachment.importFile?.sensitiveKinds?.join(",") || ""}
      data-sensitive-count={attachment.importFile?.sensitiveValueCount ?? 0}
      data-folder-import-phase={attachment.folderImport?.phase || ""}
      data-imported-count={attachment.folderImport?.imported ?? ""}
      data-skipped-count={attachment.folderImport?.skipped ?? ""}
      data-failed-count={attachment.folderImport?.failed ?? ""}
      data-duplicate-count={attachment.folderImport?.duplicates ?? ""}
    >
      {canPreviewImage && previewSrc ? (
        <button
          type="button"
          className="composer-attachment-preview"
          title={zh ? `查看大图：${attachment.name}` : `View full size: ${attachment.name}`}
          aria-label={zh ? `查看大图：${attachment.name}` : `View full size: ${attachment.name}`}
          data-testid="composer-attachment-preview"
          onClick={() => setLightboxOpen(true)}
        >
          <img className="composer-attachment-thumb" src={previewSrc} alt="" />
          {copy}
        </button>
      ) : canPreviewFile ? (
        <button
          type="button"
          className="composer-attachment-preview composer-attachment-file-preview"
          title={zh ? `预览：${attachment.name}` : `Preview: ${attachment.name}`}
          aria-label={zh ? `预览：${attachment.name}` : `Preview: ${attachment.name}`}
          data-testid="composer-attachment-file-preview"
          onClick={() => setFilePreviewOpen(true)}
        >
          <Icon size={14} />
          {copy}
        </button>
      ) : (
        <>
          <Icon size={14} />
          {copy}
        </>
      )}
      <button
        type="button"
        aria-label={zh ? `移除 ${attachment.name}` : `Remove ${attachment.name}`}
        onClick={onRemove}
      >
        <X size={13} />
      </button>
      {lightboxOpen && previewSrc
        ? (
          <AttachmentImageLightbox
            src={previewSrc}
            name={attachment.name}
            path={attachment.path}
            zh={zh}
            onClose={() => setLightboxOpen(false)}
          />
        )
        : null}
      {filePreviewOpen
        ? (
          <ComposerFilePreviewLightbox
            attachment={attachment}
            language={zh ? "zh" : "en"}
            zh={zh}
            onClose={() => setFilePreviewOpen(false)}
          />
        )
        : null}
    </span>
  );
}

function useAttachmentImageSrc(
  attachment: ChatAttachment,
  workspacePath?: string,
  importFile?: PickedFileDescriptor,
): string | undefined {
  const embedded = attachment.screenshotDataUrl?.startsWith("data:image/")
    ? attachment.screenshotDataUrl
    : importFile?.previewDataUrl?.startsWith("data:image/")
      ? importFile.previewDataUrl
      : undefined;
  const [previewSrc, setPreviewSrc] = useState(embedded);
  const showImage = isImageAttachment(attachment, importFile);

  useEffect(() => {
    if (embedded) setPreviewSrc(embedded);
  }, [embedded]);

  useEffect(() => {
    if (!showImage || previewSrc || !workspacePath?.trim() || !attachment.path.trim()) return;
    if (attachment.path.startsWith("clipboard:")) return;
    let cancelled = false;
    void loadWorkspacePreview({
      workspacePath,
      path: attachment.path,
      maxBytes: 8_000_000,
    }).then((preview) => {
      if (!cancelled && preview.kind === "image" && preview.dataUrl?.startsWith("data:image/")) {
        setPreviewSrc(preview.dataUrl);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attachment.path, previewSrc, showImage, workspacePath]);

  return previewSrc;
}

function AttachmentImageLightbox({
  src,
  name,
  path,
  zh,
  onClose,
}: {
  src: string;
  name: string;
  path?: string;
  zh: boolean;
  onClose: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="message-attachment-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      data-testid="message-attachment-lightbox"
    >
      <button
        type="button"
        className="message-attachment-lightbox-backdrop"
        aria-label={zh ? "关闭大图" : "Close image"}
        onClick={onClose}
      />
      <div className="message-attachment-lightbox-panel">
        <header>
          <strong title={path || name}>{name}</strong>
          <button type="button" aria-label={zh ? "关闭" : "Close"} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <img src={src} alt={name} />
      </div>
    </div>,
    document.body,
  );
}

function ComposerFilePreviewLightbox({
  attachment,
  language,
  zh,
  onClose,
}: {
  attachment: ComposerAttachment;
  language: AppLanguage;
  zh: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const parts = splitLocalFilePreviewPath(attachment.path);
    if (!parts) {
      setLoading(false);
      setError(zh ? "无法解析附件路径。" : "Could not resolve attachment path.");
      return () => undefined;
    }

    setLoading(true);
    setError(null);
    setPreview(null);
    void (async () => {
      try {
        const result = await loadWorkspacePreview(
          { workspacePath: parts.workspacePath, path: parts.relativePath, maxBytes: 220_000 },
          // Opened from a click: don't reuse a cached `missing` answer. A missing
          // result is still passed through, FilePreviewer renders the reason.
          { cacheMissing: false },
        );
        if (cancelled) return;
        setPreview(result);
      } catch (cause) {
        if (cancelled) return;
        setPreview(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachment.path, zh]);

  return createPortal(
    <div
      className="message-attachment-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      data-testid="composer-file-preview-lightbox"
    >
      <button
        type="button"
        className="message-attachment-lightbox-backdrop"
        aria-label={zh ? "关闭预览" : "Close preview"}
        onClick={onClose}
      />
      <div className="message-attachment-lightbox-panel composer-file-preview-panel">
        <header>
          <strong title={attachment.path || attachment.name}>{attachment.name}</strong>
          <button type="button" aria-label={zh ? "关闭" : "Close"} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="composer-file-preview-body">
          {loading ? (
            <p className="composer-file-preview-status">{zh ? "正在加载预览…" : "Loading preview…"}</p>
          ) : null}
          {error ? (
            <p className="composer-file-preview-status" role="alert">{error}</p>
          ) : null}
          {!loading && !error && preview ? (
            <FilePreviewer language={language} preview={preview} />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MessageAttachmentBadge({
  attachment,
  workspacePath,
  zh,
}: {
  attachment: ChatAttachment;
  workspacePath?: string;
  zh: boolean;
}): React.JSX.Element {
  const previewSrc = useAttachmentImageSrc(attachment, workspacePath);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const showImage = isImageAttachment(attachment);

  if (showImage && previewSrc) {
    return (
      <>
        <button
          type="button"
          className="message-attachment-image"
          title={zh ? `查看大图：${attachment.name}` : `View full size: ${attachment.name}`}
          aria-label={zh ? `查看大图：${attachment.name}` : `View full size: ${attachment.name}`}
          data-testid="message-attachment-image"
          onClick={() => setLightboxOpen(true)}
        >
          <img src={previewSrc} alt={attachment.name} />
          <span className="message-attachment-image-caption">{attachment.name}</span>
        </button>
        {lightboxOpen
          ? (
            <AttachmentImageLightbox
              src={previewSrc}
              name={attachment.name}
              path={attachment.path}
              zh={zh}
              onClose={() => setLightboxOpen(false)}
            />
          )
          : null}
      </>
    );
  }

  return (
    <span
      className="message-attachment-badge"
      title={attachment.path || attachment.name}
      data-testid="message-attachment-badge"
    >
      {renderMessageAttachmentIcon(attachment.kind)}
      <span>{attachment.name}</span>
    </span>
  );
}

function renderMessageAttachmentIcon(kind: ChatAttachment["kind"]): React.JSX.Element {
  const Icon =
    kind === "folder"
      ? FolderPlus
      : kind === "terminal"
        ? Terminal
        : kind === "selection"
          ? ClipboardList
          : kind === "browser"
            ? Globe2
            : FileText;
  return <Icon size={14} aria-hidden="true" />;
}

function mergeUniqueAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  const seen = new Set<string>();
  const merged: ChatAttachment[] = [];
  for (const attachment of attachments) {
    const key = `${attachment.kind}:${normalizeAttachmentPath(attachment.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(attachment);
  }
  return merged;
}

function parseInlineContextMentions(input: string, workspacePath: string): ChatAttachment[] {
  const mentions: ChatAttachment[] = [];
  const pattern = /(?:^|\s)@(file|folder):(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const kind = match[1].toLowerCase() as "file" | "folder";
    const rawPath = (match[2] || match[3] || match[4] || match[5] || "").trim();
    if (!rawPath) continue;
    const path = resolveInlineMentionPath(rawPath, workspacePath);
    const blockedReason = getInlineMentionBlockedReason(rawPath, path, workspacePath);
    mentions.push({
      kind,
      path,
      name: getPathName(path),
      title: kind === "folder" ? `Inline @folder: ${getPathName(path)}` : `Inline @file: ${getPathName(path)}`,
      note:
        blockedReason
          ? blockedReason
          : kind === "folder"
          ? "Inline @folder mention from composer. Folder summary is prepared before send."
          : "Inline @file mention from composer.",
      blockedReason,
    });
  }
  return mergeUniqueAttachments(mentions);
}

function normalizePastedLocalPathMentions(text: string): string | null {
  const mentions = extractPastedLocalPathMentions(text);
  if (!mentions.length) return null;
  return mentions.join("\n");
}

function extractPastedLocalPathMentions(text: string): string[] {
  if (!text.trim()) return [];
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const candidate = normalizePastedPathCandidate(rawLine);
    if (!candidate) continue;
    const key = candidate.path.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(`@${candidate.kind}:"${candidate.path}"`);
    if (mentions.length >= MAX_CLIPBOARD_PATH_MENTIONS) break;
  }
  return mentions;
}

function normalizePastedPathCandidate(rawLine: string): { kind: "file" | "folder"; path: string } | null {
  const trimmed = rawLine.trim().replace(/^file:\/\//i, "");
  const unquoted = trimmed.replace(/^["'`]|["'`]$/g, "").trim();
  if (!unquoted || /\s/.test(unquoted) && !isLikelyWindowsPath(unquoted)) return null;
  const path = decodeFilePath(unquoted);
  if (!isAbsoluteLocalPath(path)) return null;
  if (/[<>|?*]/.test(path.replace(/^[a-zA-Z]:/, ""))) return null;
  const kind = /[\\/]$/.test(path) || !/\.[^\\/.\s]+$/.test(path) ? "folder" : "file";
  return { kind, path: path.replace(/[\\/]+$/, kind === "folder" ? "" : "") };
}

function isLikelyWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value);
}

function decodeFilePath(value: string): string {
  try {
    return decodeURIComponent(value).replace(/\//g, "\\");
  } catch {
    return value.replace(/\//g, "\\");
  }
}

async function summarizeInlineFolderAttachment(
  attachment: ChatAttachment,
  onSummarizeWorkspaceFolder?: (
    request: WorkspaceFolderSummaryRequest,
  ) => Promise<WorkspaceFolderSummaryResult>,
): Promise<ChatAttachment> {
  if (attachment.blockedReason) return attachment;
  if (attachment.kind !== "folder") return attachment;
  if (!onSummarizeWorkspaceFolder) return attachment;
  try {
    const summary = await onSummarizeWorkspaceFolder({
      path: attachment.path,
      maxDepth: 3,
      maxEntries: 240,
      maxSampleFiles: 16,
    });
    return {
      ...attachment,
      path: summary.path,
      name: summary.name,
      title: `Inline @folder summary: ${summary.name}`,
      visibleText: summary.summary,
      note: [
        "Inline @folder mention from composer.",
        `${summary.fileCount} files`,
        `${summary.directoryCount} folders`,
        `${summary.estimatedTokens} estimated tokens`,
        summary.truncated ? "truncated" : "",
      ].filter(Boolean).join(", "),
    };
  } catch (error) {
    return {
      ...attachment,
      note: error instanceof Error
        ? `Inline @folder summary unavailable: ${error.message}`
        : "Inline @folder summary unavailable.",
    };
  }
}

async function summarizeQueuedContextAttachments(
  attachments: ChatAttachment[],
  onSummarizeWorkspaceFolder?: (
    request: WorkspaceFolderSummaryRequest,
  ) => Promise<WorkspaceFolderSummaryResult>,
): Promise<ChatAttachment[]> {
  const summarized = await Promise.all(
    mergeUniqueAttachments(attachments).map((attachment) =>
      summarizeInlineFolderAttachment(attachment, onSummarizeWorkspaceFolder),
    ),
  );
  return mergeUniqueAttachments(summarized);
}

function resolveInlineMentionPath(rawPath: string, workspacePath: string): string {
  const trimmed = rawPath.trim();
  if (isAbsoluteLocalPath(trimmed) || !workspacePath.trim()) return trimmed;
  const separator = workspacePath.includes("/") && !workspacePath.includes("\\") ? "/" : "\\";
  const base = workspacePath.replace(/[\\/]+$/, "");
  const relative = trimmed.replace(/^[.][\\/]/, "").replace(/[\\/]+/g, separator);
  return `${base}${separator}${relative}`;
}

function getInlineMentionBlockedReason(
  rawPath: string,
  resolvedPath: string,
  workspacePath: string,
): string | undefined {
  if (!workspacePath.trim()) return undefined;
  if (hasParentPathSegment(rawPath)) {
    return "Inline mention blocked: path escapes the selected workspace.";
  }
  if (isAbsoluteLocalPath(resolvedPath) && !isPathInsideWorkspace(resolvedPath, workspacePath)) {
    return "Inline mention blocked: path is outside the selected workspace.";
  }
  return undefined;
}

function hasParentPathSegment(path: string): boolean {
  return path
    .replace(/^[.][\\/]/, "")
    .split(/[\\/]+/)
    .some((segment) => segment === "..");
}

function isPathInsideWorkspace(path: string, workspacePath: string): boolean {
  const target = normalizePathForWorkspaceCompare(path);
  const workspace = normalizePathForWorkspaceCompare(workspacePath);
  return Boolean(workspace) && (target === workspace || target.startsWith(`${workspace}/`));
}

function normalizePathForWorkspaceCompare(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

function isAbsoluteLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function normalizeAttachmentPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

interface ContextPreviewItem {
  key: string;
  kind: string;
  label: string;
  detail: string;
  estimatedTokens: number;
}

type ContextBudgetLevel = "ok" | "high" | "over";

interface ContextBudgetEstimate {
  estimatedTokens: number;
  rawEstimatedTokens: number;
  level: ContextBudgetLevel;
  limit: number;
  message: string;
  reservedOutputTokens: number;
  source: string;
  calibrationSource?: string;
  calibrationDrift?: string;
}

const FALLBACK_CONTEXT_TOKEN_BUDGET = 12000;
const CONTEXT_TOKEN_BUDGET = FALLBACK_CONTEXT_TOKEN_BUDGET;
const CONTEXT_OUTPUT_RESERVE_TOKENS = 2048;
const MIN_CONTEXT_TOKEN_BUDGET = 4000;
const CONTEXT_SYSTEM_PREAMBLE_TOKENS = 36;

function createContextPreviewItems(
  attachments: ChatAttachment[],
  workspaceInstructions: WorkspaceInstructionSummary[],
): ContextPreviewItem[] {
  const attachmentItems = attachments.map((attachment, index) => ({
    key: `attachment-${index}-${attachment.kind}-${attachment.path}`,
    kind: getContextKindLabel(attachment.kind),
    label: attachment.title || attachment.name || getPathName(attachment.path),
    detail: attachment.url || attachment.note || attachment.path,
    estimatedTokens: estimateAttachmentTokens(attachment),
  }));
  const instructionItems = workspaceInstructions.map((instruction, index) => ({
    key: `instruction-${index}-${instruction.path}`,
    kind: "Instruction",
    label: instruction.name,
    detail: instruction.truncated
      ? `${instruction.path} (truncated)`
      : instruction.path,
    estimatedTokens: estimateBackendSerializedContextTokens(
      [
        `Workspace instruction: ${instruction.name}`,
        `Path: ${instruction.path}`,
        instruction.truncated ? "Status: truncated" : "",
        "Content:",
        instruction.content,
      ].filter(Boolean).join("\n"),
    ),
  }));
  return [...attachmentItems, ...instructionItems];
}

function estimateContextBudget(
  items: ContextPreviewItem[],
  modelConfig?: MyDrSaiModelConfig,
): ContextBudgetEstimate {
  const rawEstimatedTokens = items.reduce((total, item) => total + item.estimatedTokens, 0);
  const calibration = getTokenizerCalibration(modelConfig);
  const calibrationTrusted = calibration ? calibration.trustLevel !== "untrusted" : false;
  const estimatedTokens = calibration && calibrationTrusted
    ? Math.max(1, Math.ceil(rawEstimatedTokens * calibration.factor))
    : rawEstimatedTokens;
  const modelTokenLimit = getModelTokenLimit(modelConfig);
  const limit = modelTokenLimit
    ? Math.max(MIN_CONTEXT_TOKEN_BUDGET, modelTokenLimit - CONTEXT_OUTPUT_RESERVE_TOKENS)
    : CONTEXT_TOKEN_BUDGET;
  const highContextTokenThreshold = Math.floor(limit * 0.8);
  const level: ContextBudgetLevel =
    estimatedTokens > limit
      ? "over"
      : estimatedTokens >= highContextTokenThreshold
        ? "high"
        : "ok";
  const source = modelTokenLimit
    ? `Model limit ${formatApproxTokens(modelTokenLimit)}`
    : `Fallback budget ${formatApproxTokens(CONTEXT_TOKEN_BUDGET)}`;
  const calibrationSource = calibration
    ? calibrationTrusted
      ? `Tokenizer-calibrated x${calibration.factor.toFixed(2)} from ${calibration.sampleCount} trusted sample${calibration.sampleCount === 1 ? "" : "s"}`
      : `Tokenizer calibration not applied: ${calibration.trustReason}`
    : undefined;
  const calibrationDrift = calibration ? formatCalibrationDrift(calibration) : undefined;
  const calibratedSource = calibrationSource ? `${source}; ${calibrationSource}` : source;
  const message =
    level === "over"
      ? `Context estimate is above the ${calibratedSource.toLowerCase()} after output reserve; remove large sources before sending.`
      : level === "high"
        ? `Context estimate is close to the ${calibratedSource.toLowerCase()} after output reserve.`
        : `Context estimate is within the ${calibratedSource.toLowerCase()} after output reserve.`;
  return {
    estimatedTokens,
    rawEstimatedTokens,
    level,
    limit,
    message,
    reservedOutputTokens: CONTEXT_OUTPUT_RESERVE_TOKENS,
    source,
    calibrationSource,
    calibrationDrift,
  };
}

function estimateAttachmentTokens(attachment: ChatAttachment): number {
  if (attachment.blockedReason) return 1;
  const serializedContext = serializeAttachmentForBackendEstimate(attachment);
  const serializedTokens = estimateBackendSerializedContextTokens(serializedContext);
  const screenshotTokens = attachment.screenshotDataUrl ? 900 : 0;
  const baseTokens = {
    browser: 160,
    file: 120,
    folder: 180,
    selection: 100,
    terminal: 140,
  }[attachment.kind];
  return Math.max(1, baseTokens + serializedTokens + screenshotTokens);
}

function serializeAttachmentForBackendEstimate(attachment: ChatAttachment): string {
  const contextBody =
    attachment.kind === "browser"
      ? [
          `URL: ${attachment.url || attachment.path}`,
          attachment.title ? `Title: ${attachment.title}` : "",
          attachment.note ? `Note: ${attachment.note}` : "",
          attachment.visibleText ? `Visible page text and structure:\n${attachment.visibleText}` : "",
        ]
      : attachment.kind === "terminal"
        ? [
            `Terminal: ${attachment.path}`,
            attachment.title ? `Title: ${attachment.title}` : "",
            attachment.note ? `Note: ${attachment.note}` : "",
            attachment.visibleText ? `Terminal output:\n${attachment.visibleText}` : "",
          ]
        : attachment.kind === "selection"
          ? [
              `Selection: ${attachment.name}`,
              attachment.title ? `Title: ${attachment.title}` : "",
              attachment.note ? `Note: ${attachment.note}` : "",
              attachment.visibleText ? `Selected text:\n${attachment.visibleText}` : "",
            ]
          : attachment.kind === "folder"
            ? [
                `Folder: ${attachment.name}`,
                `Path: ${attachment.path}`,
                attachment.title ? `Title: ${attachment.title}` : "",
                attachment.note ? `Note: ${attachment.note}` : "",
                attachment.visibleText ? `Folder summary:\n${attachment.visibleText}` : "",
              ]
            : [
                attachment.title ? `Title: ${attachment.title}` : "",
                attachment.note ? `Note: ${attachment.note}` : "",
                attachment.visibleText ? `File preview:\n${attachment.visibleText}` : "",
              ];
  return [
    `Attachment preview: ${attachment.name}`,
    `Kind: ${attachment.kind}`,
    `Path: ${attachment.path}`,
    "Content:",
    ...contextBody,
  ].filter(Boolean).join("\n");
}

function estimateBackendSerializedContextTokens(text: string): number {
  return CONTEXT_SYSTEM_PREAMBLE_TOKENS + estimateTextTokens(text);
}

function estimateTextTokens(text: string): number {
  if (!text.trim()) return 0;
  const cjkChars = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const asciiWords = (text.match(/[A-Za-z0-9_]+/g) || [])
    .reduce((total, word) => total + Math.max(1, Math.ceil(word.length / 4)), 0);
  const punctuation = (text.match(/[^\sA-Za-z0-9_\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const newlines = (text.match(/\n/g) || []).length;
  return Math.ceil(cjkChars + asciiWords + punctuation * 0.5 + newlines * 0.25);
}

function getTokenizerCalibration(
  model?: MyDrSaiModelConfig,
): {
  factor: number;
  sampleCount: number;
  minFactor: number;
  maxFactor: number;
  driftPercent: number;
  driftLevel: "low" | "medium" | "high";
  trustLevel: "trusted" | "provisional" | "untrusted";
  trustReason: string;
} | undefined {
  const ratios = (model?.tokenizer_calibration ?? [])
    .map((sample) => {
      if (!sample || typeof sample.sample !== "string") return null;
      if (typeof sample.tokens !== "number" || !Number.isFinite(sample.tokens) || sample.tokens <= 0) return null;
      const estimated = estimateTextTokens(sample.sample);
      if (estimated <= 0) return null;
      return sample.tokens / estimated;
    })
    .filter((ratio): ratio is number => typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0)
    .sort((left, right) => left - right);
  if (!ratios.length) return undefined;
  const middle = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 === 0
    ? (ratios[middle - 1] + ratios[middle]) / 2
    : ratios[middle];
  const boundedMedian = Math.min(4, Math.max(0.25, median));
  const minFactor = ratios[0];
  const maxFactor = ratios[ratios.length - 1];
  const driftPercent = ratios.length > 1
    ? Math.round(((maxFactor - minFactor) / Math.max(0.01, boundedMedian)) * 100)
    : 0;
  const driftLevel = driftPercent >= 50
    ? "high"
    : driftPercent >= 25
      ? "medium"
      : "low";
  const trustLevel = ratios.length === 1
    ? "provisional"
    : driftLevel === "high"
      ? "untrusted"
      : "trusted";
  const trustReason = trustLevel === "untrusted"
    ? `high calibration drift (${driftPercent}% spread) exceeds the trusted threshold`
    : trustLevel === "provisional"
      ? "single calibration sample is provisional"
      : `${driftLevel} calibration drift is within the trusted threshold`;
  return {
    factor: boundedMedian,
    sampleCount: ratios.length,
    minFactor,
    maxFactor,
    driftPercent,
    driftLevel,
    trustLevel,
    trustReason,
  };
}

function formatCalibrationDrift(
  calibration: NonNullable<ReturnType<typeof getTokenizerCalibration>>,
): string {
  if (calibration.sampleCount === 1) {
    return "single calibration sample";
  }
  return `${calibration.driftLevel} calibration drift (${calibration.driftPercent}% spread; ${calibration.trustLevel})`;
}

function formatApproxTokens(tokens: number): string {
  if (tokens >= 1000) return `~${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k tokens`;
  return `~${tokens} tokens`;
}

function formatApproxTokensZh(tokens: number): string {
  if (tokens >= 1000) return `约 ${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k 词元`;
  return `约 ${tokens} 词元`;
}

function formatContextKindZh(kind: string): string {
  return { Browser: "网页", File: "文件", Folder: "文件夹", Selection: "选区", Terminal: "终端", Instruction: "说明" }[kind] || kind;
}

function formatContextBudgetSourceZh(budget: ContextBudgetEstimate): string {
  if (budget.calibrationSource) return "已按当前模型校准";
  return budget.source.startsWith("Model limit") ? "当前模型上限" : "默认上下文上限";
}

function formatContextBudgetMessageZh(budget: ContextBudgetEstimate): string {
  if (budget.level === "over") return "材料预计超过上下文上限；请在发送前移除较大的材料。下一条消息只会发送上面列出的材料和工作区说明。";
  if (budget.level === "high") return "材料预计接近上下文上限。下一条消息只会发送上面列出的材料和工作区说明。";
  return "材料预计在上下文上限内。下一条消息只会发送上面列出的材料和工作区说明。";
}

function getContextKindLabel(kind: ChatAttachment["kind"]): string {
  return {
    browser: "Browser",
    file: "File",
    folder: "Folder",
    selection: "Selection",
    terminal: "Terminal",
  }[kind];
}

function getModelLabel(
  models: MyDrSaiModelConfig[],
  selectedModelName?: string,
  selectedModelProviderId?: string,
): string {
  if (!selectedModelName) return "";
  const model = models.find(
    (item) => (item.alias === selectedModelName || item.model === selectedModelName)
      && (!selectedModelProviderId || item.provider_id === selectedModelProviderId),
  );
  return model ? getModelOptionLabel(model) : "";
}

function findSelectedModelConfig(
  models: MyDrSaiModelConfig[],
  selectedModelName?: string,
  selectedModelProviderId?: string,
): MyDrSaiModelConfig | undefined {
  if (!selectedModelName) return undefined;
  const normalized = selectedModelName.trim().toLowerCase();
  return models.find((model) =>
    (!selectedModelProviderId || model.provider_id === selectedModelProviderId)
    && [model.alias, model.model, model.display_name]
      .filter((item): item is string => Boolean(item))
      .some((item) => item.trim().toLowerCase() === normalized),
  );
}

function getModelTokenLimit(model?: MyDrSaiModelConfig): number | undefined {
  const candidates = [model?.token_limit, model?.max_tokens];
  for (const candidate of candidates) {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    if (candidate <= 0) continue;
    return Math.floor(candidate);
  }
  return undefined;
}

function getModelOptionLabel(model: MyDrSaiModelConfig): string {
  return model.display_name || model.alias || model.model || "Model";
}

function getCompactComposerModelLabel(label: string): string {
  const compact = label
    .replace(/^deepseek(?:[-_/\s]+ai)?[-_/\s]*/i, "")
    .replace(/^deepseek\s*/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return compact
    .replace(/\bv(\d+(?:\.\d+)?)\s*pro\b/i, "V$1 Pro")
    .replace(/\bv(\d+(?:\.\d+)?)\b/i, "V$1")
    || label;
}

function getModelProviderLabel(model: MyDrSaiModelConfig, zh: boolean): string {
  const provider = model.provider_id || model.client_type;
  return provider
    ? (zh ? `提供方：${provider}` : `Provider: ${provider}`)
    : (zh ? "提供方：未知" : "Provider: Unknown");
}

function getAgentOptionMeta(agent: DesktopAgent, zh: boolean): string {
  const source = agent.source === "local" ? (zh ? "本机" : "Local") : (zh ? "在线" : "Online");
  const status =
    agent.status === "running"
      ? zh ? "运行中" : "Running"
      : agent.status === "stopped"
        ? zh ? "未启动" : "Stopped"
        : zh ? "不可达" : "Unreachable";
  return `${source} · ${status}`;
}

function AgentInlineIcon({ agent, size }: { agent?: DesktopAgent; size: number }): React.JSX.Element {
  const isCodex = agent?.id === "my-codex";
  const logo = agent?.source === "local" ? drsaiLogo : agent?.logo;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logo]);
  if (isCodex) return <OpenAiBrandIcon size={size} className="agent-inline-icon" />;
  return logo && !failed
    ? <img className="agent-inline-icon" src={logo} alt="" width={size} height={size} onError={() => setFailed(true)} />
    : <Bot size={size} aria-hidden />;
}

function getThinkingEffortLabel(effort: ThinkingEffort, zh: boolean): string {
  if (zh) {
    return {
      none: "不思考",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "极高",
      max: "最大",
    }[effort];
  }
  return {
    none: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Ultra",
    max: "Max",
  }[effort];
}

function getSlashCommandDescription(command: ChatCommandName): string {
  return {
    model: "Show the active model routing.",
    permissions: "Summarize current execution boundaries.",
    plan: "Record planning intent before execution.",
    goal: "Record the objective for this thread.",
    diff: "Prepare workspace diff context.",
    review: "Switch the next request toward review findings.",
    fix: "Prepare a focused bug-fix request.",
    test: "Prepare a targeted verification request.",
    commit: "Prepare a policy-gated commit workflow.",
    checkpoint: "Create a bounded rollback checkpoint.",
    rollback: "List, preview, or queue an approval-gated checkpoint restore.",
    mcp: "Inspect connector and MCP context expectations.",
    mention: "Explain visible context mentions.",
    compact: "Prepare visible context compaction.",
    memory: "Inspect project memory expectations.",
    skills: "Inspect reusable skill workflows.",
    agent: "Show the active agent routing.",
    fork: "Prepare isolated follow-up work.",
    status: "Summarize chat, context, and runtime status.",
  }[command];
}

function isEmptyAssistantShell(message: UiMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.streaming || message.error || message.replyFailed) return false;
  if (message.structuredTurn?.parts?.length) return false;
  const body = [message.content, message.reasoningContent, message.statusContent]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join("");
  return !body;
}

const assistantDisplayContentCache = new WeakMap<UiMessage, string>();

function getAssistantDisplayContent(message: UiMessage): string {
  const cached = assistantDisplayContentCache.get(message);
  if (cached !== undefined) return cached;
  const content = stripAgentToolDebugText(getAssistantSpeechText(message, getVisibleChatText));
  assistantDisplayContentCache.set(message, content);
  return content;
}

function getWorkspaceDisplayName(workspacePath: string | undefined, zh: boolean): string {
  const normalized = workspacePath?.trim().replace(/[\\/]+$/, "") ?? "";
  const name = normalized.split(/[\\/]/).filter(Boolean).at(-1);
  return name || (zh ? "当前" : "current workspace");
}

function attachmentContextSummary(attachment: ChatAttachment): string {
  const text = attachment.visibleText?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return attachment.url?.slice(0, 160) ?? "";
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function isPreviewBrowserUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isSafeWebUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
