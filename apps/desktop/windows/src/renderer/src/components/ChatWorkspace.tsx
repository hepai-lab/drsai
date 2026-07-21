import {
  FormEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Brain,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileCode2,
  Folder,
  FolderPlus,
  Gauge,
  Globe2,
  Hammer,
  Info,
  Mic,
  MicOff,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ScanSearch,
  Send,
  Square,
  TextCursorInput,
  Terminal,
  Telescope,
  Volume2,
  X,
} from "lucide-react";
import drsaiLogo from "../assets/drsai.png";
import { canHandleMemoryRequestLocally } from "../userPreferenceIntent";
import type {
  ChatMessage,
  DesktopAgent,
  DesktopHealth,
  DesktopIdeContextSnapshot,
  DiagnosticEventInput,
  DesktopVoiceInteractionMode,
  DesktopVoiceRuntimeStatus,
  DesktopStreamingVoiceCapabilities,
  DesktopVoiceTranscriptionResult,
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
  WorkspaceProject,
} from "@shared/desktopApi";
import type { ChatAttachment } from "@shared/desktopApi";
import type { ArtifactPart, CitationPart, InteractionPart, StructuredTurnState } from "@shared/structuredConversation";
import type { AppLanguage } from "../navigation";
import { desktopApi, hasDesktopApi } from "../desktopApi";
import {
  CHAT_COMMAND_NAMES,
  parseForkQueueEntries,
  type ChatCommandName,
  type ChatRuntimeMode,
} from "../chatCommands";
import { ChatMessageContent } from "./ChatMessageContent";
import { StructuredMessageParts } from "./StructuredMessageParts";
import { getReasoningChatText, getVisibleChatText } from "../chatOutputModel";
import { VoiceCaptureBar } from "./voice/VoiceCaptureBar";
import { VoiceReviewBar } from "./voice/VoiceReviewBar";
import { StreamingVoiceCaptureBar } from "./voice/StreamingVoiceCaptureBar";
import { StreamingVoiceOutputBar } from "./voice/StreamingVoiceOutputBar";
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
import { useStreamingVoiceInput } from "../voice/streaming/useStreamingVoiceInput";
import { useAssistantSpeechSegments } from "../voice/streaming/assistantSpeechStream";
import { useStreamingVoiceOutput } from "../voice/streaming/useStreamingVoiceOutput";
import { createStreamingVoiceDiagnostic } from "../voice/streaming/streamingVoiceDiagnostics";
import { useVoiceTranscription } from "../voice/useVoiceTranscription";
import { getAssistantSpeechText } from "../voice/voiceMessageText";
import {
  createVoiceTurnId,
  initialVoiceTurnState,
  isVoiceCaptureActive,
  reduceVoiceTurn,
  type VoiceTurnEvent,
} from "../voice/voiceTurnReducer";

export type UiMessage = ChatMessage & {
  id: string;
  streaming?: boolean;
  error?: boolean;
  replyFailed?: boolean;
  statusContent?: string;
  reasoningContent?: string;
  toolTimeline?: ChatToolTimelineEvent[];
  parts?: ChatMessagePart[];
  structuredTurn?: StructuredTurnState;
  startedAt?: number;
  lastEventAt?: number;
  inputRequest?: {
    requestId: string;
    prompt: string;
    inputType: "text_input" | "approval";
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

export type ThinkingEffort = "low" | "medium" | "high" | "xhigh";
const THINKING_EFFORTS: ThinkingEffort[] = ["low", "medium", "high", "xhigh"];
const MAX_CLIPBOARD_IMAGE_BYTES = 1_250_000;
const MAX_CLIPBOARD_IMAGE_COUNT = 4;
const MAX_CLIPBOARD_PATH_MENTIONS = 6;

export interface ChatForkQueueAgentAssignment {
  queueIndex: number;
  agentId?: string;
  agentName?: string;
}

export interface ChatSubmitOptions {
  agentId?: string;
  agentName?: string;
  forkQueueAgentAssignments?: ChatForkQueueAgentAssignment[];
  model?: string;
  runtimeMode?: ChatRuntimeMode | null;
  thinkingEffort: ThinkingEffort;
}

interface ChatWorkspaceProps {
  activeRequestId: string | null;
  canChat: boolean;
  chatUnavailableReason?: string;
  conversationId: string;
  health: DesktopHealth | null;
  input: string;
  language: AppLanguage;
  messages: UiMessage[];
  currentRuntimeMode?: ChatRuntimeMode | null;
  defaultThinkingEffort?: ThinkingEffort;
  searchRequestNonce?: number;
  structuredTurnFocus?: { turnId: string; nonce: number } | null;
  selectedAgentId?: string;
  selectedAgentName?: string;
  selectedModelName?: string;
  agentOptions?: DesktopAgent[];
  modelOptions?: MyDrSaiModelConfig[];
  samplePrompts?: DesktopAgent["examples"];
  externalAttachments?: ChatAttachment[];
  ideContext?: DesktopIdeContextSnapshot | null;
  workspaceInstructions?: WorkspaceInstructionSummary[];
  workspaceName?: string;
  workspacePath?: string;
  workspaceLocation?: "local" | "remote";
  workspaceOptions?: WorkspaceProject[];
  selectedWorkspaceId?: string;
  onAbort: () => void;
  onClearExternalAttachments?: () => void;
  onClearRuntimeMode?: () => void;
  onInputChange: (value: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onSelectModel?: (model: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenDebug?: () => void;
  onOpenPreviewBrowser?: (url?: string) => void;
  onOpenWorkspaceArtifact?: (path: string) => void;
  onPickFiles?: () => Promise<PickDialogResult>;
  onPickFolder?: () => Promise<PickDialogResult>;
  onSummarizeWorkspaceFolder?: (
    request: WorkspaceFolderSummaryRequest,
  ) => Promise<WorkspaceFolderSummaryResult>;
  onRemoveExternalAttachment?: (index: number) => void;
  onAttachIdeCurrentFile?: () => void;
  onAttachIdeCurrentSelection?: () => void;
  onRefreshIdeContext?: () => void;
  onSubmit: (
    attachments?: ChatAttachment[],
    options?: ChatSubmitOptions,
  ) => Promise<boolean>;
}

export function ChatWorkspace({
  activeRequestId,
  canChat,
  chatUnavailableReason,
  conversationId,
  input,
  language,
  messages,
  currentRuntimeMode,
  defaultThinkingEffort = "medium",
  searchRequestNonce = 0,
  structuredTurnFocus = null,
  selectedAgentId,
  selectedAgentName,
  selectedModelName,
  agentOptions = [],
  modelOptions = [],
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
  onOpenExternal,
  onOpenDebug,
  onOpenPreviewBrowser,
  onOpenWorkspaceArtifact,
  onPickFiles,
  onPickFolder,
  onSummarizeWorkspaceFolder,
  onRemoveExternalAttachment,
  onAttachIdeCurrentFile,
  onAttachIdeCurrentSelection,
  onRefreshIdeContext,
  onSubmit,
}: ChatWorkspaceProps): React.JSX.Element {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [materialRoleAnalysis, setMaterialRoleAnalysis] = useState<MaterialRoleAnalysisResult | null>(null);
  const [materialRolePhase, setMaterialRolePhase] = useState<"idle" | "analyzing" | "ready" | "failed">("idle");
  const [materialConsistencyAnalysis, setMaterialConsistencyAnalysis] = useState<MaterialConsistencyAnalysisResult | null>(null);
  const [materialConsistencyPhase, setMaterialConsistencyPhase] = useState<"idle" | "analyzing" | "ready" | "failed">("idle");
  const [materialConsistencySourceStatus, setMaterialConsistencySourceStatus] = useState("");
  const [materialSuggestionRuntimeReady, setMaterialSuggestionRuntimeReady] = useState(false);
  const materialRoleRequestRef = useRef(0);
  const materialConsistencyRequestRef = useRef(0);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(defaultThinkingEffort);
  const [searchOpen, setSearchOpen] = useState(false);
  const [metaMenuOpen, setMetaMenuOpen] = useState<"agent" | "model" | "thinking" | null>(null);
  const [introMenuOpen, setIntroMenuOpen] = useState<"workspace" | "agent" | null>(null);
  const [introSearchQuery, setIntroSearchQuery] = useState("");
  const [forkQueueAgentSelections, setForkQueueAgentSelections] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [voiceReviewText, setVoiceReviewText] = useState<string | null>(null);
  const [voiceReviewSource, setVoiceReviewSource] = useState<"serial" | "streaming" | null>(null);
  const [streamingVoiceReadyToSend, setStreamingVoiceReadyToSend] = useState(false);
  const [streamingVoiceResponseArmed, setStreamingVoiceResponseArmed] = useState(false);
  const [voiceRuntimeDisclosure, setVoiceRuntimeDisclosure] = useState<string | null>(null);
  const [voiceRuntimeStatus, setVoiceRuntimeStatus] = useState<DesktopVoiceRuntimeStatus | null>(null);
  const [streamingVoiceCapabilities, setStreamingVoiceCapabilities] = useState<DesktopStreamingVoiceCapabilities | null>(null);
  const [voiceConsentRequired, setVoiceConsentRequired] = useState(false);
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences();
  const [voiceTurnState, dispatchVoiceTurnBase] = useReducer(reduceVoiceTurn, initialVoiceTurnState);
  const voiceTurnStateRef = useRef(voiceTurnState);
  voiceTurnStateRef.current = voiceTurnState;
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
  const voiceLanguage = voicePreferences.inputLanguage;
  const voiceDeviceId = voicePreferences.inputDeviceId;
  const voiceModeCapabilities = deriveVoiceModeCapabilities(voiceRuntimeStatus, {
    audioWorklet: typeof AudioWorkletNode !== "undefined",
    serialTts: "speechSynthesis" in window,
    streamingTts: false,
    streamingCapabilities: streamingVoiceCapabilities,
  });
  const streamingVoiceAvailability = getVoiceModeAvailability("streaming", voiceModeCapabilities);
  const [voiceProgressMessage, setVoiceProgressMessage] = useState("");
  const [voiceRuntimeLabel, setVoiceRuntimeLabel] = useState("Voice STT");
  const voicePlayback = useSystemVoicePlayback();
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
      if (hasDesktopApi() && typeof desktopApi.getVoiceRuntimeStatus === "function") {
        const [runtime, streamingCapabilities] = await Promise.all([
          desktopApi.getVoiceRuntimeStatus(),
          desktopApi.getStreamingVoiceCapabilities().catch(() => null),
        ]);
        setVoiceRuntimeStatus(runtime);
        setStreamingVoiceCapabilities(streamingCapabilities);
        setVoiceRuntimeDisclosure(runtime.providerDisclosure);
        if (runtime.state !== "ready") throw new Error(runtime.message);
        if (runtime.runtimeId === "gateway-provider" && !voicePreferences.remoteSttConsent) {
          setVoiceConsentRequired(true);
          throw new Error(zh
            ? "使用在线语音识别前，需要允许将录音发送给当前语音服务提供方。"
            : "Allow sending recordings to the configured speech provider before using online transcription.");
        }
      }
    },
    deviceId: voiceDeviceId,
    onDeviceUnavailable: () => {
      updateVoicePreferences({ inputDeviceId: "" });
      setVoiceError("The selected microphone is no longer available. The default microphone will be used.");
    },
    onRecorded: ({ blob, durationSeconds }) => {
      void processVoiceRecording(blob, durationSeconds);
    },
  });
  const streamingVoiceInput = useStreamingVoiceInput({
    deviceId: voiceDeviceId,
    languageHint: voiceLanguage === "auto" ? undefined : voiceLanguage,
    onReview: (transcript) => {
      setVoiceReviewSource("streaming");
      setVoiceReviewText(transcript);
      setVoiceRuntimeDisclosure(voiceRuntimeStatus?.providerDisclosure ?? "Live transcription completed.");
    },
  });
  const streamingDiagnosticKeysRef = useRef(new Set<string>());
  const assistantSpeechSegments = useAssistantSpeechSegments(voicePreferences.interactionMode === "streaming");
  const streamingVoiceOutput = useStreamingVoiceOutput({
    enabled: streamingVoiceResponseArmed,
    segments: assistantSpeechSegments.segments,
    textCompleted: assistantSpeechSegments.completed,
    voice: voicePreferences.voiceName || undefined,
    speed: voicePreferences.playbackRate,
    onTerminal: (terminal) => {
      if (terminal === "completed") {
        streamingVoiceInput.markTtsCompleted();
        streamingVoiceInput.markPlaybackCompleted();
      } else if (terminal === "cancelled") streamingVoiceInput.cancelOutput();
      else streamingVoiceInput.failOutput("Streaming reply audio could not be played.");
      setStreamingVoiceResponseArmed(false);
    },
  });

  useEffect(() => {
    const turnId = streamingVoiceInput.turnState.turnId;
    if (!turnId) return;
    const phase = streamingVoiceInput.turnState.phase;
    const key = `${turnId}:turn:${phase}:${streamingVoiceInput.turnState.terminal ?? "active"}`;
    if (streamingDiagnosticKeysRef.current.has(key)) return;
    streamingDiagnosticKeysRef.current.add(key);
    const status = streamingVoiceInput.turnState.terminal ?? (phase === "user" ? "started" : "running");
    const event = createStreamingVoiceDiagnostic({
      traceId: turnId,
      turnId,
      stage: phase === "user" || phase === "review" ? "asr" : phase === "assistant" ? "llm" : "transport",
      status,
      metrics: {
        sequence: streamingVoiceInput.transcript.lastEventSequence,
        bufferedAudioMs: streamingVoiceInput.flowControl.bufferedAudioMs,
        partialCount: streamingVoiceInput.transcript.revision,
        finalCount: streamingVoiceInput.transcript.committedText ? 1 : 0,
        segmentCount: assistantSpeechSegments.segments.length,
        playedSegmentCount: streamingVoiceOutput.playedSegments,
        paused: streamingVoiceInput.flowControl.paused,
      },
      errorCode: streamingVoiceInput.turnState.terminal === "failed" ? "streaming_turn_failed" : undefined,
    });
    const { module: _module, ...voiceEvent } = event;
    void recordVoiceDiagnostic(voiceEvent);
  }, [
    assistantSpeechSegments.segments.length,
    streamingVoiceInput.flowControl.bufferedAudioMs,
    streamingVoiceInput.flowControl.paused,
    streamingVoiceInput.transcript.committedText,
    streamingVoiceInput.transcript.lastEventSequence,
    streamingVoiceInput.transcript.revision,
    streamingVoiceInput.turnState.phase,
    streamingVoiceInput.turnState.terminal,
    streamingVoiceInput.turnState.turnId,
    streamingVoiceOutput.playedSegments,
  ]);

  useEffect(() => {
    if (!streamingVoiceResponseArmed) return;
    if (assistantSpeechSegments.completed) streamingVoiceInput.markAssistantTextCompleted();
  }, [assistantSpeechSegments.completed, streamingVoiceResponseArmed]);

  useEffect(() => {
    if (!streamingVoiceResponseArmed) return;
    if (["synthesizing", "playing", "paused", "draining", "completed"].includes(streamingVoiceOutput.phase)) {
      streamingVoiceInput.markTtsStarted();
    }
    if (["playing", "paused", "draining", "completed"].includes(streamingVoiceOutput.phase)) {
      streamingVoiceInput.markPlaybackStarted();
    }
  }, [streamingVoiceOutput.phase, streamingVoiceResponseArmed]);
  const {
    cancel: cancelVoiceTranscriptionTask,
    transcribe: transcribeVoiceBlob,
  } = useVoiceTranscription(setVoiceProgressMessage);
  const [respondedInputRequests, setRespondedInputRequests] = useState<Set<string>>(() => new Set());
  const [turnRailMarkers, setTurnRailMarkers] = useState<Array<{ id: string; top: number }>>([]);
  const [activeTurnRailId, setActiveTurnRailId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);
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
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
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
    const openModelPicker = (): void => setMetaMenuOpen("model");
    window.addEventListener("drsai:open-model-picker", openModelPicker);
    return () => window.removeEventListener("drsai:open-model-picker", openModelPicker);
  }, []);

  useEffect(() => {
    setThinkingEffort(defaultThinkingEffort);
  }, [defaultThinkingEffort]);

  async function respondToAgentInput(
    request: NonNullable<UiMessage["inputRequest"]>,
    response: string | Record<string, unknown>,
  ): Promise<void> {
    const accepted = await desktopApi.respondChatInput(request.requestId, response);
    if (!accepted) return;
    setRespondedInputRequests((current) => new Set(current).add(request.requestId));
  }

  function requestTextAgentInput(request: NonNullable<UiMessage["inputRequest"]>): void {
    const response = window.prompt(request.prompt);
    if (response?.trim()) void respondToAgentInput(request, response.trim());
  }

  function respondToStructuredInteraction(part: InteractionPart, response: { approved: boolean }): void {
    void respondToAgentInput({
      requestId: part.requestId,
      prompt: part.prompt,
      inputType: part.interactionType === "approval" ? "approval" : "text_input",
    }, response);
  }

  function requestStructuredTextInput(part: InteractionPart): void {
    requestTextAgentInput({ requestId: part.requestId, prompt: part.prompt, inputType: "text_input" });
  }
  const shouldFollowOutputRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRetryBlobRef = useRef<Blob | null>(null);
  const voiceRetryDurationRef = useRef(0);
  const voiceSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const voiceCaptureDiagnosticRef = useRef<{ startedAt: number; traceId: string } | null>(null);
  const voicePlaybackDiagnosticRef = useRef<{ messageId: string; startedAt: number; traceId: string } | null>(null);
  const voiceResponseBaselineRef = useRef<Set<string>>(new Set());
  const voiceTtsRequestIdRef = useRef<string | null>(null);
  const autoReadInitializedRef = useRef(false);
  const lastAutoReadMessageIdRef = useRef<string | null>(null);
  const zh = language === "zh";
  const [now, setNow] = useState(Date.now());
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const showStop = Boolean(activeRequestId || hasStreamingMessage);
  const emptyChat = messages.every((message) => message.id === "welcome");
  const canSaveLocalPreference = canHandleMemoryRequestLocally(input);
  const canAnswerMaterialInventoryLocally = Boolean(materialRoleAnalysis?.items.length) && isMaterialInventoryQuestion(input);
  const canAnswerMaterialQuestionLocally = Boolean(materialRoleAnalysis?.items.length) && isNaturalMaterialQuestion(input);
  const emptyChatPreferenceNotice = emptyChat
    ? messages.find((message) => message.id === "welcome")?.content.split("\n\n").slice(1).join("\n\n").trim() || ""
    : "";
  const activeAgentName = selectedAgentName?.trim() || "OpenDrSai";
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
    getModelLabel(modelOptions, selectedModelName) || selectedModelName?.trim() || (zh ? "默认" : "Default");
  const activeModelConfig = useMemo(
    () => findSelectedModelConfig(modelOptions, selectedModelName),
    [modelOptions, selectedModelName],
  );
  const thinkingEffortLabel = getThinkingEffortLabel(thinkingEffort, zh);
  const hasAgentOptions = agentOptions.length > 0;
  const hasModelOptions = modelOptions.length > 0;
  const parsedSamplePrompts = useMemo(
    () => parseAgentExamples(samplePrompts, language),
    [samplePrompts, language],
  );
  const emptyChatPrompts = useMemo(
    () => getEmptyChatPrompts(parsedSamplePrompts, zh),
    [parsedSamplePrompts, zh],
  );
  const activeWorkspaceName = workspaceName?.trim() || getWorkspaceDisplayName(workspacePath, zh);
  const normalizedIntroSearch = introSearchQuery.trim().toLocaleLowerCase();
  const filteredIntroWorkspaces = workspaceOptions.filter((workspace) =>
    !normalizedIntroSearch
      || workspace.name.toLocaleLowerCase().includes(normalizedIntroSearch)
      || workspace.path.toLocaleLowerCase().includes(normalizedIntroSearch),
  );
  const filteredIntroAgents = agentOptions.filter((agent) =>
    !normalizedIntroSearch
      || agent.name.toLocaleLowerCase().includes(normalizedIntroSearch)
      || getAgentOptionMeta(agent, zh).toLocaleLowerCase().includes(normalizedIntroSearch),
  );
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
    voiceState === "recording" ||
    voiceState === "processing";
  const showStreamingVoiceCaptureBar = ["starting", "streaming", "stopping", "cancelling"].includes(streamingVoiceInput.phase);
  const showAnyVoiceCaptureBar = showVoiceCaptureBar || showStreamingVoiceCaptureBar;
  const displayedVoicePhase = voicePreferences.interactionMode === "streaming"
    ? streamingVoiceInput.phase
    : voiceTurnState.phase;
  const latestCompletedAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && !message.streaming && !message.error && getAssistantDisplayContent(message));
  const latestCompletedAssistantSpeechText = latestCompletedAssistantMessage
    ? getAssistantDisplayContent(latestCompletedAssistantMessage)
    : "";

  useEffect(() => {
    voicePlayback.stop();
    stopVoiceCapture("discard");
    void streamingVoiceInput.cancel();
    streamingVoiceInput.reset();
    cancelVoiceTranscriptionTask();
    setVoiceReviewText(null);
    setVoiceRuntimeDisclosure(null);
    setVoiceConsentRequired(false);
    voiceRetryBlobRef.current = null;
    voiceRetryDurationRef.current = 0;
    autoReadInitializedRef.current = true;
    lastAutoReadMessageIdRef.current = latestCompletedAssistantMessage?.id ?? null;
    dispatchVoiceTurn({ type: "cancel" });
    dispatchVoiceTurn({ type: "cancelled" });
    dispatchVoiceTurn({ type: "reset" });
  }, [conversationId]);

  useEffect(() => {
    const stopVoiceActivityForLifecycle = (event?: Event): void => {
      if (event?.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      voicePlayback.stop();
      stopVoiceCapture("discard");
      void streamingVoiceInput.cancel();
      streamingVoiceOutput.stop();
      if (streamingVoiceResponseArmed && (activeRequestId || hasStreamingMessage)) onAbort();
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
  }, [activeRequestId, cancelVoiceTranscriptionTask, hasStreamingMessage, onAbort, stopVoiceCapture, streamingVoiceOutput.stop, streamingVoiceResponseArmed, voicePlayback.stop]);

  useEffect(() => {
    if (voiceState === "recording" && !voiceCaptureDiagnosticRef.current) {
      const traceId = crypto.randomUUID();
      voiceCaptureDiagnosticRef.current = { startedAt: Date.now(), traceId };
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
    void recordVoiceDiagnostic({
      traceId: active.traceId,
      component: "capture",
      operation: "voice.capture",
      message: voiceState === "failed" ? "Voice capture failed" : "Voice capture completed",
      status: voiceState === "failed" ? "failed" : "completed",
      errorCode: voiceState === "failed" ? "capture_error" : undefined,
      durationMs: Date.now() - active.startedAt,
    });
  }, [voiceDeviceId, voiceState]);

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
      message: voicePlayback.phase === "failed" ? "Voice playback failed" : "Voice playback completed",
      status: voicePlayback.phase === "failed" ? "failed" : "completed",
      errorCode: voicePlayback.phase === "failed" ? "playback_error" : undefined,
      durationMs: Date.now() - active.startedAt,
    });
  }, [voicePlayback.activeMessageId, voicePlayback.phase]);

  useEffect(() => {
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
      && !voiceResponseBaselineRef.current.has(message.id)
      && Boolean(getAssistantDisplayContent(message)));
    if (response) dispatchVoiceTurn({ type: "response_completed", messageId: response.id });
  }, [messages, voiceTurnState.phase]);

  useEffect(() => {
    const phase = voiceTurnState.phase;
    if (phase === "response_ready" && !voicePreferences.autoReadResponses) {
      dispatchVoiceTurn({ type: "finish" });
      return;
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
  }, [
    voicePlayback.activeMessageId,
    voicePlayback.error,
    voicePlayback.phase,
    voicePreferences.autoReadResponses,
    voiceTurnState.phase,
    voiceTurnState.responseMessageId,
  ]);

  const searchableMessages = useMemo(
    () => messages.filter((message) => getVisibleChatText(message.content)),
    [messages],
  );

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchableMessages
      .filter((message) => getVisibleChatText(message.content).toLowerCase().includes(query))
      .map((message) => message.id);
  }, [searchQuery, searchableMessages]);

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
    setActiveMatchIndex(0);
  }, []);

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
    textarea.style.height = "52px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    const composer = composerRef.current;
    const messageList = messageListRef.current;
    if (!composer || !messageList || emptyChat) return;
    const updateComposerHeight = (): void => {
      messageList.style.setProperty("--chat-composer-height", `${composer.offsetHeight}px`);
    };
    updateComposerHeight();
    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composer);
    return () => {
      observer.disconnect();
      messageList.style.removeProperty("--chat-composer-height");
    };
  }, [emptyChat]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!activeMatchId) return;
    const node = document.querySelector(`[data-message-id="${activeMatchId}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
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
      onInputChange(command.trim());
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

  useEffect(() => {
    if (!messages.some((message) => message.streaming && !message.content.trim())) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [messages]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || !shouldFollowOutputRef.current) return;
    list.scrollTo({ top: list.scrollHeight, behavior: messages.some((message) => message.streaming) ? "auto" : "smooth" });
  }, [messages]);

  const updateTurnRail = useCallback((): void => {
    const list = messageListRef.current;
    if (!list) return;
    const nodes = [...list.querySelectorAll<HTMLElement>(".message.user[data-message-id]")];
    const scrollHeight = Math.max(list.scrollHeight, 1);
    const viewportCenter = list.scrollTop + list.clientHeight / 2;
    let nearestId: string | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const markers = nodes.flatMap((node) => {
      const id = node.dataset.messageId;
      if (!id) return [];
      const center = node.offsetTop + node.offsetHeight / 2;
      const distance = Math.abs(center - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = id;
      }
      return [{ id, top: Math.max(1, Math.min(99, (center / scrollHeight) * 100)) }];
    });
    setTurnRailMarkers(markers);
    setActiveTurnRailId(nearestId);
  }, []);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || emptyChat) {
      setTurnRailMarkers([]);
      setActiveTurnRailId(null);
      return undefined;
    }
    const frame = window.requestAnimationFrame(updateTurnRail);
    const observer = new ResizeObserver(updateTurnRail);
    observer.observe(list);
    window.addEventListener("resize", updateTurnRail);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updateTurnRail);
    };
  }, [emptyChat, messages, updateTurnRail]);

  function scrollToUserTurn(messageId: string): void {
    const list = messageListRef.current;
    const message = list?.querySelector<HTMLElement>(
      `.message.user[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!list || !message) return;
    shouldFollowOutputRef.current = false;
    setActiveTurnRailId(messageId);
    list.scrollTo({ top: Math.max(0, message.offsetTop - 18), behavior: "smooth" });
  }

  function handleMessageListScroll(): void {
    const list = messageListRef.current;
    if (!list) return;
    shouldFollowOutputRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    updateTurnRail();
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
    if (!hasDesktopApi() || typeof desktopApi.getVoiceRuntimeStatus !== "function") return;
    void desktopApi.getVoiceRuntimeStatus().then((runtime) => {
      setVoiceRuntimeStatus(runtime);
      setVoiceRuntimeDisclosure(runtime.providerDisclosure);
      setVoiceRuntimeLabel(runtime.runtimeId === "gateway-provider" ? "Online STT" : "Fixture STT");
    }).catch(() => setVoiceRuntimeLabel("STT unavailable"));
    void desktopApi.getStreamingVoiceCapabilities()
      .then(setStreamingVoiceCapabilities)
      .catch(() => setStreamingVoiceCapabilities(null));
  }, []);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    void submitWithAttachments();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submitWithAttachments();
  }

  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void {
    const clipboard = event.clipboardData;
    const imageFiles = Array.from(clipboard.files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, MAX_CLIPBOARD_IMAGE_COUNT);
    const text = clipboard.getData("text/plain");
    const pathMentionText = normalizePastedLocalPathMentions(text);
    if (!imageFiles.length && !pathMentionText) return;

    event.preventDefault();
    insertTextAtCursor(pathMentionText || text);
    if (imageFiles.length) void addClipboardImageAttachments(imageFiles);
  }

  async function submitWithAttachments(): Promise<void> {
    const isVoiceSubmission = voiceTurnState.phase === "ready_to_send";
    const isStreamingVoiceSubmission = streamingVoiceReadyToSend;
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
        model: selectedModelName,
        runtimeMode: currentRuntimeMode,
        thinkingEffort,
      },
    );
    if (submitted) {
      setAttachments([]);
      onClearExternalAttachments?.();
      if (isVoiceSubmission) dispatchVoiceTurn({ type: "response_started" });
      if (isStreamingVoiceSubmission) {
        streamingVoiceInput.acceptReview();
        streamingVoiceInput.markAssistantTextStarted();
        setStreamingVoiceReadyToSend(false);
        setStreamingVoiceResponseArmed(true);
      }
    } else if (isVoiceSubmission) {
      dispatchVoiceTurn({
        type: "fail",
        error: {
          stage: "submitting",
          code: "chat_error",
          message: zh ? "语音消息发送失败，请重试。" : "The voice message could not be sent. Try again.",
          retryable: true,
        },
      });
    }
  }

  function clearInput(): void {
    onInputChange("");
    textareaRef.current?.focus();
  }

  async function toggleVoiceRecording(): Promise<void> {
    if (voicePreferences.interactionMode === "streaming") {
      if (streamingVoiceInput.phase === "streaming") {
        await streamingVoiceInput.stop();
        return;
      }
      await startStreamingVoiceRecording();
      return;
    }
    if (voiceState === "recording") {
      stopVoiceRecording("transcribe");
      return;
    }
    await startVoiceRecording();
  }

  async function startStreamingVoiceRecording(): Promise<void> {
    if (!streamingVoiceAvailability.available) {
      setVoiceError(streamingVoiceAvailability.reason ?? "Live transcription is unavailable.");
      return;
    }
    voicePlayback.stop();
    streamingVoiceOutput.stop();
    setVoiceReviewText(null);
    setVoiceReviewSource(null);
    setVoiceError(null);
    voiceSelectionRef.current = textareaRef.current
      ? { start: textareaRef.current.selectionStart, end: textareaRef.current.selectionEnd }
      : { start: input.length, end: input.length };
    await streamingVoiceInput.start();
  }

  async function startVoiceRecording(): Promise<void> {
    if (!voiceApiAvailable) {
      setVoiceState("failed");
      setVoiceError("Voice recording is unavailable in this desktop runtime.");
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
    dispatchVoiceTurn({ type: "stt_started", requestId });
    setVoiceState("processing");
    setVoiceProgressMessage("Preparing audio...");
    voiceRetryBlobRef.current = blob;
    voiceRetryDurationRef.current = durationSeconds;
    try {
      const result = await transcribeVoiceRecordingAsync(
        blob,
        durationSeconds,
      );
      setVoiceReviewSource("serial");
      setVoiceReviewText(result.transcript);
      dispatchVoiceTurn({ type: "stt_completed", requestId });
      setVoiceRuntimeDisclosure(result.providerDisclosure);
      setVoiceState("idle");
      setVoiceError(null);
      setVoiceElapsedSeconds(0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        dispatchVoiceTurn({ type: "cancel" });
        dispatchVoiceTurn({ type: "cancelled" });
        setVoiceState("idle");
        setVoiceError(null);
      } else {
        dispatchVoiceTurn({
          type: "fail",
          error: {
            stage: "transcribing",
            code: "provider_error",
            message: error instanceof Error ? error.message : "Voice transcription failed.",
            retryable: true,
          },
        });
        setVoiceState("failed");
        setVoiceError(error instanceof Error ? error.message : "Voice transcription failed.");
      }
    }
  }

  function insertTextAtCursor(text: string): void {
    const textarea = textareaRef.current;
    if (!textarea) {
      onInputChange(input ? `${input}${text}` : text);
      return;
    }
    const start = textarea.selectionStart ?? input.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${input.slice(0, start)}${text}${input.slice(end)}`;
    onInputChange(next);
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

  async function retryVoiceTranscription(): Promise<void> {
    const blob = voiceRetryBlobRef.current;
    if (!blob) return;
    setVoiceError(null);
    setVoiceProgressMessage("Preparing audio...");
    setVoiceReviewText(null);
    setVoiceState("processing");
    const requestId = `voice-stt-${crypto.randomUUID()}`;
    dispatchVoiceTurn({ type: "stt_started", requestId });
    try {
      const result = await transcribeVoiceRecordingAsync(blob, voiceRetryDurationRef.current);
      setVoiceReviewSource("serial");
      setVoiceReviewText(result.transcript);
      dispatchVoiceTurn({ type: "stt_completed", requestId });
      setVoiceRuntimeDisclosure(result.providerDisclosure);
      setVoiceState("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        dispatchVoiceTurn({ type: "cancel" });
        dispatchVoiceTurn({ type: "cancelled" });
        setVoiceState("idle");
        setVoiceError(null);
      } else {
        dispatchVoiceTurn({
          type: "fail",
          error: {
            stage: "transcribing",
            code: "provider_error",
            message: error instanceof Error ? error.message : "Voice transcription failed.",
            retryable: true,
          },
        });
        setVoiceState("failed");
        setVoiceError(error instanceof Error ? error.message : "Voice transcription failed.");
      }
    }
  }

  function acceptVoiceReview(): void {
    const text = voiceReviewText?.trim();
    const streamingReview = voiceReviewSource === "streaming";
    let cursor: number | null = null;
    if (text) {
      const selection = voiceSelectionRef.current ?? { start: input.length, end: input.length };
      const insertion = insertVoiceTranscript(input, text, selection);
      onInputChange(insertion.value);
      cursor = insertion.cursor;
    }
    if (voiceReviewSource === "serial") dispatchVoiceTurn({ type: "review_accepted" });
    else {
      assistantSpeechSegments.clear();
    }
    clearVoiceReview();
    if (streamingReview) setStreamingVoiceReadyToSend(true);
    restoreComposerFocus(cursor);
  }

  async function retryVoiceReview(): Promise<void> {
    if (voiceReviewSource !== "streaming") {
      await retryVoiceTranscription();
      return;
    }
    clearVoiceReview();
    streamingVoiceInput.reset();
    await startStreamingVoiceRecording();
  }

  function discardVoiceReview(): void {
    if (voiceReviewSource === "serial") {
      dispatchVoiceTurn({ type: "cancel" });
      dispatchVoiceTurn({ type: "cancelled" });
    } else {
      streamingVoiceInput.reset();
    }
    clearVoiceReview();
    restoreComposerFocus(null);
  }

  function clearVoiceReview(): void {
    setVoiceReviewText(null);
    setVoiceReviewSource(null);
    setStreamingVoiceReadyToSend(false);
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
    onInputChange(prompt);
    textareaRef.current?.focus();
  }

  function selectSlashCommand(command: ChatCommandName): void {
    onInputChange(`/${command} `);
    textareaRef.current?.focus();
  }

  function toggleMetaMenu(menu: "agent" | "model" | "thinking"): void {
    setMetaMenuOpen((current) => (current === menu ? null : menu));
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

  function selectModel(model: string): void {
    onSelectModel?.(model);
    setMetaMenuOpen(null);
    textareaRef.current?.focus();
  }

  function selectThinkingEffort(effort: ThinkingEffort): void {
    setThinkingEffort(effort);
    setMetaMenuOpen(null);
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
    if (!result.canceled) addPickedFiles(result);
  }

  async function addFolder(): Promise<void> {
    if (!onPickFolder) return;
    const result = await onPickFolder();
    if (!result.canceled) await addFolderAttachments(result.paths);
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
        const message = error instanceof Error ? error.message : String(error);
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
    onInputChange(suggestion.prompt);
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
    onInputChange(prompt);
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
      setMaterialConsistencySourceStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function openPreviewBrowser(url?: string): void {
    onOpenPreviewBrowser?.(url);
    setToolsOpen(false);
  }

  function handleMarkdownLink(href: string | undefined): void {
    if (!href) return;
    let protocol: string;
    try {
      protocol = new URL(href).protocol;
    } catch {
      return;
    }
    if (!['http:', 'https:', 'mailto:'].includes(protocol)) return;
    if (isPreviewBrowserUrl(href)) {
      openPreviewBrowser(href);
      return;
    }
    onOpenExternal(href);
  }

  function openStructuredArtifact(part: ArtifactPart): void {
    if (part.url && isSafeWebUrl(part.url)) {
      openPreviewBrowser(part.url);
      return;
    }
    if (part.path) onOpenWorkspaceArtifact?.(part.path);
  }

  function openStructuredCitation(part: CitationPart): void {
    if (part.url && isSafeWebUrl(part.url)) {
      openPreviewBrowser(part.url);
      return;
    }
    if (part.path) onOpenWorkspaceArtifact?.(part.path);
  }

  return (
    <div className="chat-workspace">
      <div className={`chat-primary-pane ${emptyChat ? "empty-chat" : ""}`}>
      {searchOpen && (
        <div className="chat-search-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="chat-search-backdrop"
            aria-label={zh ? "鍏抽棴鎼滅储" : "Close search"}
            onClick={closeSearch}
          />
          <section className="chat-search-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="chat-search-modal-header">
              <h2>{zh ? "搜索当前会话" : "Search Current Chat"}</h2>
              <button
                type="button"
                className="chat-search-close"
                onClick={closeSearch}
                title={zh ? "鍏抽棴鎼滅储" : "Close search"}
                aria-label={zh ? "鍏抽棴鎼滅储" : "Close search"}
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
            title={zh ? "鍏抽棴鎼滅储" : "Close search"}
            aria-label={zh ? "鍏抽棴鎼滅储" : "Close search"}
          >
            <X size={15} />
          </button>
          </div>
            </div>
          </section>
        </div>
      )}
      {!emptyChat && (
      <div className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
        {messages.filter((message) => message.id !== "welcome").map((message) => {
          const assistantContent = message.role === "assistant"
            ? getAssistantDisplayContent(message)
            : message.content;
          return (
          <article
            key={message.id}
            className={`message ${message.role} ${message.error ? "error" : ""} ${searchMatches.includes(message.id) ? "search-match" : ""} ${activeMatchId === message.id ? "search-active" : ""} ${message.structuredTurn?.turnId === highlightedTurnId ? "structured-turn-focus" : ""}`}
            data-message-id={message.id}
            data-structured-turn-id={message.structuredTurn?.turnId}
          >
            <strong className="message-author">{message.role === "user" ? "You" : "OpenDrSai"}</strong>
            <div className="message-body">
              {message.role === "assistant" && message.replyFailed ? (
                <button type="button" className="chat-reply-failed" onClick={onOpenDebug}>
                  <Bug size={14} aria-hidden />
                  <span>{zh ? "回复未完成 · 查看调试" : "Reply incomplete · View debug"}</span>
                </button>
              ) : message.content && message.role === "user" ? (
                <p>{highlightPlainText(message.content, searchQuery)}</p>
              ) : message.role === "assistant" && message.structuredTurn ? (
                message.structuredTurn.parts.length ? (
                  <StructuredMessageParts
                    turn={message.structuredTurn}
                    language={language}
                    respondedRequestIds={respondedInputRequests}
                    onOpenLink={handleMarkdownLink}
                    onOpenArtifact={openStructuredArtifact}
                    onOpenCitation={openStructuredCitation}
                    onRespondInteraction={respondToStructuredInteraction}
                    onRequestTextInteraction={requestStructuredTextInput}
                  />
                ) : (
                  <StreamingStatus message={message} now={now} zh={zh} />
                )
              ) : message.content ? (
                <ChatMessageContent
                  content={assistantContent}
                  streaming={message.streaming}
                  language={language}
                  onOpenLink={handleMarkdownLink}
                />
              ) : (
                <StreamingStatus message={message} now={now} zh={zh} />
              )}
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
              {!message.structuredTurn && message.inputRequest ? (
                <section className="chat-agent-input-request" aria-label={zh ? "智能体请求输入" : "Agent input request"}>
                  <strong>{zh ? "智能体需要你的输入" : "Agent needs your input"}</strong>
                  <p>{message.inputRequest.prompt}</p>
                  <div>
                    {message.inputRequest.inputType === "approval" ? (
                      <>
                        <button type="button" disabled={respondedInputRequests.has(message.inputRequest.requestId)} onClick={() => void respondToAgentInput(message.inputRequest!, { approved: false })}>{zh ? "拒绝" : "Reject"}</button>
                        <button type="button" disabled={respondedInputRequests.has(message.inputRequest.requestId)} onClick={() => void respondToAgentInput(message.inputRequest!, { approved: true })}>{zh ? "批准" : "Approve"}</button>
                      </>
                    ) : (
                      <button type="button" disabled={respondedInputRequests.has(message.inputRequest.requestId)} onClick={() => requestTextAgentInput(message.inputRequest!)}>{zh ? "回复" : "Respond"}</button>
                    )}
                    {respondedInputRequests.has(message.inputRequest.requestId) && <span>{zh ? "已发送" : "Sent"}</span>}
                  </div>
                </section>
              ) : null}
              {message.role === "assistant" && !message.streaming && !message.error && assistantContent ? (
                <MessageActions
                  content={assistantContent}
                  messageId={message.id}
                  playback={voicePlayback}
                  playbackDisabled={showAnyVoiceCaptureBar || isVoiceCaptureActive(voiceTurnState.phase)}
                  playbackRate={voicePreferences.playbackRate}
                  synthesisMode={resolveVoiceSynthesisMode(voicePreferences.synthesisMode, voicePreferences.remoteTtsConsent)}
                  voiceName={voicePreferences.voiceName}
                  zh={zh}
                />
              ) : null}
            </div>
          </article>
          );
        })}
      </div>
      )}
      {!emptyChat && turnRailMarkers.length > 0 ? (
        <nav className="conversation-turn-rail" aria-label={zh ? "用户输入定位" : "User message navigation"}>
          {turnRailMarkers.map((marker, index) => {
            const message = messages.find((item) => item.id === marker.id);
            const label = message?.content.trim().replace(/\s+/g, " ") || `${zh ? "用户输入" : "User message"} ${index + 1}`;
            return (
              <button
                key={marker.id}
                type="button"
                className={marker.id === activeTurnRailId ? "active" : ""}
                style={{ top: `${marker.top}%` }}
                title={label}
                aria-label={`${zh ? "定位到用户输入" : "Go to user message"} ${index + 1}: ${label.slice(0, 80)}`}
                onClick={() => scrollToUserTurn(marker.id)}
              />
            );
          })}
        </nav>
      ) : null}
      {emptyChat && (
        <div className="empty-chat-intro" role="group" aria-label={zh ? "新建会话" : "New conversation"}>
          <img className="empty-chat-logo" src={drsaiLogo} alt="OpenDrSai" />
          <h1>
            <span>
              {zh ? "在" : "In"}
              <span className="empty-chat-selector" ref={introMenuOpen === "workspace" ? introPickerRef : undefined}>
                <button
                  type="button"
                  className="empty-chat-selector-trigger"
                  title={`${activeWorkspaceName} · ${workspaceLocationLabel}`}
                  aria-expanded={introMenuOpen === "workspace"}
                  onClick={() => toggleIntroMenu("workspace")}
                >
                  <strong>{activeWorkspaceName}</strong>
                  <ChevronDown size={17} aria-hidden />
                </button>
                {introMenuOpen === "workspace" ? (
                  <div className="empty-chat-selector-menu" role="dialog" aria-label={zh ? "切换工作区" : "Switch workspace"}>
                    <label className="empty-chat-selector-search">
                      <Search size={15} aria-hidden />
                      <input
                        autoFocus
                        value={introSearchQuery}
                        onChange={(event) => setIntroSearchQuery(event.target.value)}
                        placeholder={zh ? "搜索工作区" : "Search workspaces"}
                      />
                    </label>
                    <div className="empty-chat-selector-list">
                      {filteredIntroWorkspaces.map((workspace) => (
                        <button
                          type="button"
                          key={workspace.id}
                          className={workspace.id === selectedWorkspaceId ? "active" : ""}
                          onClick={() => selectWorkspace(workspace.id)}
                        >
                          {workspace.location === "remote" ? <Globe2 size={16} /> : <Folder size={16} />}
                          <span><b>{workspace.name}</b><small>{workspace.location === "remote" ? (zh ? "远程" : "Remote") : (zh ? "本机" : "Local")}</small></span>
                          {workspace.id === selectedWorkspaceId ? <Check size={16} aria-label={zh ? "当前工作区" : "Current workspace"} /> : null}
                        </button>
                      ))}
                      {filteredIntroWorkspaces.length === 0 ? <p>{zh ? "没有匹配的工作区" : "No matching workspaces"}</p> : null}
                    </div>
                  </div>
                ) : null}
              </span>
              {zh ? "工作区，" : "workspace,"}
            </span>
            <span>
              {zh ? "用" : "What should we do with"}
              <span className="empty-chat-selector" ref={introMenuOpen === "agent" ? introPickerRef : undefined}>
                <button
                  type="button"
                  className="empty-chat-selector-trigger"
                  disabled={!hasAgentOptions}
                  aria-expanded={introMenuOpen === "agent"}
                  onClick={() => toggleIntroMenu("agent")}
                >
                  <strong>{activeAgentName}</strong>
                  <ChevronDown size={17} aria-hidden />
                </button>
                {introMenuOpen === "agent" ? (
                  <div className="empty-chat-selector-menu" role="dialog" aria-label={zh ? "切换智能体" : "Switch agent"}>
                    <label className="empty-chat-selector-search">
                      <Search size={15} aria-hidden />
                      <input
                        autoFocus
                        value={introSearchQuery}
                        onChange={(event) => setIntroSearchQuery(event.target.value)}
                        placeholder={zh ? "搜索智能体" : "Search agents"}
                      />
                    </label>
                    <div className="empty-chat-selector-list">
                      {filteredIntroAgents.map((agent) => (
                        <button
                          type="button"
                          key={agent.id}
                          className={agent.id === selectedAgentId ? "active" : ""}
                          onClick={() => selectAgent(agent.id)}
                        >
                          <Bot size={16} />
                          <span><b>{agent.name}</b><small>{getAgentOptionMeta(agent, zh)}</small></span>
                          {agent.id === selectedAgentId ? <Check size={16} aria-label={zh ? "当前智能体" : "Current agent"} /> : null}
                        </button>
                      ))}
                      {filteredIntroAgents.length === 0 ? <p>{zh ? "没有匹配的智能体" : "No matching agents"}</p> : null}
                    </div>
                  </div>
                ) : null}
              </span>
              {zh ? "智能体，做什么呢？" : "?"}
            </span>
          </h1>
          {emptyChatPreferenceNotice ? (
            <div className="remembered-preferences-notice" data-testid="remembered-preferences-notice" role="status">
              {emptyChatPreferenceNotice}
            </div>
          ) : null}
        </div>
      )}
      {emptyChat && (
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
        ref={composerRef}
        className="composer"
        data-voice-turn-phase={displayedVoicePhase}
        data-streaming-speech-segments={assistantSpeechSegments.segments.length}
        data-streaming-speech-completed={assistantSpeechSegments.completed ? "true" : "false"}
        onSubmit={handleSubmit}
      >
        <div className="composer-shell">
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
            {attachments.map((attachment) => {
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
              return (
                <span
                  className={`composer-attachment-chip ${(attachment.importFile?.status && attachment.importFile.status !== "ready") || attachment.folderImport?.phase === "failed" ? "import-failed" : ""} ${attachment.folderImport?.phase === "scanning" ? "import-scanning" : ""}`}
                  key={attachment.id}
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
                  <Icon size={14} />
                  <span className="composer-attachment-copy">
                    <strong>{attachment.name}</strong>
                    {attachment.importFile ? <small>{formatPickedFileMeta(attachment.importFile, zh)}</small> : null}
                    {attachment.importFile?.message ? <small data-testid="composer-file-status-message">{attachment.importFile.message}</small> : null}
                    {attachment.importFile?.recoveryAction ? <small data-testid="composer-file-recovery-action">{attachment.importFile.recoveryAction}</small> : null}
                    {attachment.importFile?.privacyNotice ? <small data-testid="composer-file-privacy-notice">{attachment.importFile.privacyNotice}</small> : null}
                    {attachment.folderImport ? <small>{formatFolderImportMeta(attachment.folderImport, zh)}</small> : null}
                  </span>
                  <button
                    type="button"
                    aria-label={zh ? `绉婚櫎 ${attachment.name}` : `Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X size={13} />
                  </button>
                </span>
              );
            })}
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
                  {name}
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
                  {(["previous_report", "latest_data", "result_image", "reference_material"] as const).map((role) => (
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

          {materialRolePhase === "ready" && !input.trim() && materialTaskSuggestions.length > 0 ? (
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
              <div className="composer-tools">
                <button
                  ref={attachmentButtonRef}
                  type="button"
                  className="composer-icon-button"
                  aria-expanded={toolsOpen}
                  aria-label={zh ? "添加附件" : "Add attachment"}
                  title={zh ? "添加附件" : "Add attachment"}
                  onClick={() => setToolsOpen((open) => !open)}
                >
                  <Plus size={18} />
                </button>
                {toolsOpen && (
                  <div className="composer-tool-menu">
                    <button type="button" onClick={() => openPreviewBrowser()}>
                      <Globe2 size={15} />
                      Open Preview
                    </button>
                    <button
                      type="button"
                      disabled={!canAttachIdeCurrentFile}
                      onClick={() => {
                        onAttachIdeCurrentFile?.();
                        setToolsOpen(false);
                      }}
                    >
                      <FileCode2 size={15} />
                      IDE current file
                    </button>
                    <button
                      type="button"
                      disabled={!canAttachIdeCurrentSelection}
                      onClick={() => {
                        onAttachIdeCurrentSelection?.();
                        setToolsOpen(false);
                      }}
                    >
                      <TextCursorInput size={15} />
                      IDE selection
                    </button>
                    <button type="button" onClick={() => onRefreshIdeContext?.()}>
                      <RefreshCw size={15} />
                      Refresh IDE context
                    </button>
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
                )}
              </div>

              {voiceReviewText !== null ? (
                <VoiceReviewBar
                  value={voiceReviewText}
                  disclosure={voiceRuntimeDisclosure}
                  onChange={setVoiceReviewText}
                  onAccept={acceptVoiceReview}
                  onRetry={() => void retryVoiceReview()}
                  onDiscard={discardVoiceReview}
                />
              ) : showStreamingVoiceCaptureBar ? (
                <StreamingVoiceCaptureBar
                  committedText={streamingVoiceInput.transcript.committedText}
                  elapsedSeconds={streamingVoiceInput.elapsedSeconds}
                  levels={streamingVoiceInput.levels}
                  phase={streamingVoiceInput.phase}
                  transportMessage={streamingVoiceInput.flowControl.paused ? (zh ? "连接较慢，正在控制音频发送速度…" : "Connection is slow; audio flow is being limited…") : undefined}
                  unstableText={streamingVoiceInput.transcript.unstableText}
                  onStop={() => void streamingVoiceInput.stop()}
                />
              ) : showVoiceCaptureBar ? (
                <VoiceCaptureBar
                  elapsedSeconds={voiceElapsedSeconds}
                  levels={voiceLevels}
                  state={voiceState}
                  onStop={voiceState === "processing" ? cancelVoiceTranscription : () => stopVoiceRecording("transcribe")}
                />
              ) : (
                <textarea
                  data-testid="composer-input"
                ref={textareaRef}
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={
                  canChat
                    ? zh ? "向 OpenDrSai 提问..." : "Ask OpenDrSai..."
                    : chatUnavailableReason ?? (zh ? "请稍候，当前任务正在处理..." : "Please wait while the current task is running...")
                }
                rows={1}
              />
              )}

            </div>

            {voiceError || streamingVoiceInput.error || voiceState === "processing" ? (
              <div
                className={`composer-voice-status ${voiceState === "failed" || streamingVoiceInput.phase === "failed" ? "error" : ""}`}
                aria-live="polite"
              >
                <span>
                  {voiceState === "processing" && voiceProgressMessage
                    ? voiceProgressMessage
                    : getVoiceStatusLabel(voiceState, voiceElapsedSeconds)}
                </span>
                {voiceError || streamingVoiceInput.error ? <small>{voiceError ?? streamingVoiceInput.error}</small> : null}
                {voiceConsentRequired ? (
                  <span className="composer-voice-error-actions">
                    <button
                      type="button"
                      onClick={() => {
                        updateVoicePreferences({ remoteSttConsent: true });
                        setVoiceConsentRequired(false);
                        setVoiceError(null);
                        setVoiceState("idle");
                      }}
                    >
                      {zh ? "允许在线识别" : "Allow online transcription"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceConsentRequired(false);
                        setVoiceError(null);
                        setVoiceState("idle");
                      }}
                    >
                      {zh ? "暂不使用" : "Not now"}
                    </button>
                  </span>
                ) : null}
                {voiceError && voiceRetryBlobRef.current ? (
                  <span className="composer-voice-error-actions">
                    <button type="button" onClick={() => void retryVoiceTranscription()}>Retry</button>
                    <button type="button" onClick={discardVoiceReview}>Discard</button>
                  </span>
                ) : null}
                {streamingVoiceInput.phase === "failed" ? (
                  <span className="composer-voice-error-actions" aria-label="Streaming voice recovery actions">
                    <button type="button" onClick={() => void startStreamingVoiceRecording()}>Retry streaming</button>
                    <button
                      type="button"
                      onClick={() => {
                        streamingVoiceInput.reset();
                        setStreamingVoiceReadyToSend(false);
                        setStreamingVoiceResponseArmed(false);
                        updateVoicePreferences({ interactionMode: "serial" });
                      }}
                    >
                      Use serial next turn
                    </button>
                  </span>
                ) : null}
              </div>
            ) : null}
            {streamingVoiceResponseArmed && !["idle", "completed", "cancelled"].includes(streamingVoiceOutput.phase) ? (
              <StreamingVoiceOutputBar
                output={streamingVoiceOutput}
                onStop={() => {
                  streamingVoiceOutput.stop();
                  if (activeRequestId || hasStreamingMessage) onAbort();
                }}
              />
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
              <div className="composer-meta-item">
                <button
                  className="composer-meta-chip composer-meta-button"
                  type="button"
                  disabled={!hasAgentOptions}
                  aria-expanded={metaMenuOpen === "agent"}
                  onClick={() => toggleMetaMenu("agent")}
                >
                  <Bot size={14} />
                  {zh ? "智能体" : "Agent"}: {activeAgentName}
                  <ChevronDown size={13} />
                </button>
                {metaMenuOpen === "agent" && (
                  <div className="composer-meta-menu">
                    {agentOptions.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        className={agent.id === selectedAgentId ? "active" : ""}
                        onClick={() => selectAgent(agent.id)}
                      >
                        <span>{agent.name}</span>
                        <small>{getAgentOptionMeta(agent, zh)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="composer-meta-item">
                <button
                  className="composer-meta-chip composer-meta-button"
                  type="button"
                  aria-expanded={metaMenuOpen === "model"}
                  onClick={() => toggleMetaMenu("model")}
                >
                  <Brain size={14} />
                  {zh ? "模型：" : "Model: "}
                  {activeModelName}
                  <ChevronDown size={13} />
                </button>
                {metaMenuOpen === "model" && (
                  <div className="composer-meta-menu wide">
                    {hasModelOptions ? modelOptions.map((model) => (
                      <button
                        key={model.alias || model.model}
                        type="button"
                        className={(model.alias || model.model) === selectedModelName ? "active" : ""}
                        onClick={() => selectModel(model.alias || model.model || "")}
                      >
                        <span>{getModelOptionLabel(model)}</span>
                        <small>{getModelOptionMeta(model)}</small>
                      </button>
                    )) : <p className="composer-meta-menu-empty">{zh ? "暂无可用模型" : "No models available"}</p>}
                  </div>
                )}
              </div>
              <div className="composer-meta-item">
              <button
                className="composer-meta-chip composer-meta-button"
                type="button"
                aria-expanded={metaMenuOpen === "thinking"}
                onClick={() => toggleMetaMenu("thinking")}
                title="Switch thinking effort"
              >
                <Gauge size={14} />
                {zh ? "推理：" : "Thinking: "}
                {thinkingEffortLabel}
                <ChevronDown size={13} />
              </button>
              {metaMenuOpen === "thinking" && (
                <div className="composer-meta-menu compact">
                  {THINKING_EFFORTS.map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      className={effort === thinkingEffort ? "active" : ""}
                      onClick={() => selectThinkingEffort(effort)}
                    >
                      <span>{getThinkingEffortLabel(effort, zh)}</span>
                    </button>
                  ))}
                </div>
              )}
              </div>
              <div className="composer-actions composer-actions-meta">
                <select
                  className="composer-voice-mode"
                  data-testid="composer-voice-mode"
                  value={voicePreferences.interactionMode}
                  onChange={(event) => updateVoicePreferences({ interactionMode: event.target.value as DesktopVoiceInteractionMode })}
                  disabled={!canSwitchVoiceMode(voiceTurnState.phase) || showStreamingVoiceCaptureBar || streamingVoiceInput.phase === "reviewing" || streamingVoiceReadyToSend || streamingVoiceResponseArmed}
                  aria-label={zh ? "语音交互模式" : "Voice interaction mode"}
                  title={streamingVoiceAvailability.reason ?? voiceRuntimeDisclosure ?? voiceRuntimeLabel}
                >
                  <option value="serial">{zh ? "串行" : "Serial"}</option>
                  <option value="streaming" disabled={!streamingVoiceAvailability.available}>{zh ? "流式" : "Streaming"}</option>
                </select>
                {voiceDevices.length > 1 ? (
                  <select
                    className="composer-voice-device"
                    value={voiceDeviceId}
                    onChange={(event) => updateVoicePreferences({ inputDeviceId: event.target.value })}
                    disabled={showAnyVoiceCaptureBar}
                    aria-label="Microphone device"
                    title="Microphone device"
                  >
                    <option value="">Default mic</option>
                    {voiceDevices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
                ) : null}
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
                {input.trim() && !showStop ? (
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
                <button
                  type="button"
                  className={`composer-icon-button composer-voice-button ${voiceState === "recording" ? "recording" : ""}`}
                  disabled={showStop || voiceState === "requesting_permission" || voiceState === "processing"}
                  aria-pressed={voiceState === "recording"}
                  aria-label={
                    voiceState === "recording" || streamingVoiceInput.phase === "streaming"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  title={
                    voiceState === "recording" || streamingVoiceInput.phase === "streaming"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  onClick={() => {
                    void toggleVoiceRecording();
                  }}
                >
                  {voiceState === "recording" || streamingVoiceInput.phase === "streaming" ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                {showStop ? (
                  <button className="composer-submit stop" type="button" onClick={onAbort}>
                    <Square size={16} />
                    {zh ? "停止" : "Stop"}
                  </button>
                ) : (
                  <button className="composer-submit" type="submit" disabled={!input.trim() || (!canChat && !materialSuggestionRuntimeReady && !canSaveLocalPreference && !canAnswerMaterialInventoryLocally && !canAnswerMaterialQuestionLocally)}>
                    <Send size={16} />
                    {zh ? "发送" : "Send"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}

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

function StreamingStatus({
  message,
  now,
  zh,
}: {
  message: UiMessage;
  now: number;
  zh: boolean;
}): React.JSX.Element {
  if (!message.streaming) {
    return <p>{"No response content."}</p>;
  }

  const startedAt = message.startedAt ?? now;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const lastEventAt = message.lastEventAt ?? startedAt;
  const idleSeconds = Math.max(0, Math.floor((now - lastEventAt) / 1000));
  const detail = elapsedSeconds < 3
    ? zh ? "正在连接本地运行时..." : "Connecting to the local runtime..."
    : idleSeconds >= 10
      ? zh ? `等待模型输出 ${elapsedSeconds} 秒。` : `Waiting ${elapsedSeconds}s for model output.`
      : zh ? `正在推理 ${elapsedSeconds} 秒。` : `Thinking for ${elapsedSeconds}s.`;

  return (
    <p className="streaming-status" aria-live="polite">
      <span className="streaming-dot" aria-hidden />
      {detail}
    </p>
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
}: {
  content: string;
  messageId: string;
  playback: SystemVoicePlayback;
  playbackDisabled: boolean;
  playbackRate: number;
  synthesisMode: "system" | "provider";
  voiceName: string;
  zh: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const isActive = playback.activeMessageId === messageId;
  const isPlaying = isActive && playback.phase === "playing";
  const isPaused = isActive && playback.phase === "paused";
  const isSynthesizing = isActive && playback.phase === "synthesizing";
  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className={`message-actions ${isActive || playback.error ? "active" : ""}`} aria-live="polite">
      <button type="button" onClick={() => void handleCopy()} title={zh ? "复制回答" : "Copy response"}>
        {copied ? "✓" : <ClipboardList size={13} />}
        <span>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</span>
      </button>
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
          onClick={() => playback.play(messageId, content, zh ? "zh" : "en", { mode: synthesisMode, rate: playbackRate, voiceName })}
          title={zh ? "朗读回复" : "Read response aloud"}
        >
          <Volume2 size={13} />
          <span>{zh ? "朗读" : "Read"}</span>
        </button>
      )}
      {isActive ? (
        <button type="button" onClick={playback.stop} title={zh ? "停止朗读" : "Stop reading"}>
          <Square size={12} />
          <span>{zh ? "停止" : "Stop"}</span>
        </button>
      ) : null}
      {playback.error && !playback.activeMessageId ? (
        <span className="message-action-error" role="status">{playback.error}</span>
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
  const visibleText = [
    `Clipboard image: ${name}.`,
    `MIME type: ${file.type || "unknown"}.`,
    `Size: ${formatBytes(file.size)}.`,
    tooLarge
      ? `Image data URL was not attached because it exceeds ${formatBytes(MAX_CLIPBOARD_IMAGE_BYTES)}.`
      : "Image data URL captured from an explicit paste event.",
    "No OCR, vision model, filesystem write, network call, or provider send was performed while preparing this clipboard context.",
  ].join("\n");
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
  const prefix = [
    "Reviewed pasted local path context.",
    "No clipboard polling, filesystem read, network call, or provider send was performed while preparing these mentions.",
  ].join(" ");
  return `${prefix}\n${mentions.join("\n")}`;
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
): string {
  if (!selectedModelName) return "";
  const model = models.find(
    (item) => item.alias === selectedModelName || item.model === selectedModelName,
  );
  return model ? getModelOptionLabel(model) : "";
}

function findSelectedModelConfig(
  models: MyDrSaiModelConfig[],
  selectedModelName?: string,
): MyDrSaiModelConfig | undefined {
  if (!selectedModelName) return undefined;
  const normalized = selectedModelName.trim().toLowerCase();
  return models.find((model) =>
    [model.alias, model.model, model.display_name]
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

function getModelOptionMeta(model: MyDrSaiModelConfig): string {
  return [model.client_type, model.model]
    .filter((item): item is string => Boolean(item))
    .join(" / ");
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

function getThinkingEffortLabel(effort: ThinkingEffort, zh: boolean): string {
  if (zh) {
    return {
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "XHigh",
    }[effort];
  }
  return {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Ultra",
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

function getAssistantDisplayContent(message: UiMessage): string {
  return getAssistantSpeechText(message, getVisibleChatText);
}

function parseAgentExamples(
  raw: DesktopAgent["examples"] | undefined,
  language: AppLanguage,
): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    const parsed = parseJsonIfObject(raw);
    if (isLocalizedExample(parsed)) {
      const localized = pickLocalizedExample(parsed, language);
      return localized ? [localized] : [];
    }
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(raw)) return [];
  const hasLocalized = raw.some((item) => isLocalizedExample(item));
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const parsed = parseJsonIfObject(item);
        if (hasLocalized && isLocalizedExample(parsed)) {
          return pickLocalizedExample(parsed, language);
        }
        return item.trim();
      }
      if (isLocalizedExample(item)) return pickLocalizedExample(item, language);
      return "";
    })
    .filter((item) => item.length > 0);
}

function getEmptyChatPrompts(agentPrompts: string[], zh: boolean): string[] {
  const fallbacks = zh
    ? [
        "探索并理解当前工作区",
        "构建新功能、应用或工具",
        "审查现有内容并提出改进建议",
        "定位并修复问题或失败",
      ]
    : [
        "Explore and understand this workspace",
        "Build a new feature, app, or tool",
        "Review the current work and suggest improvements",
        "Find and fix a problem or failure",
      ];
  return [...new Set([...agentPrompts, ...fallbacks])].slice(0, 4);
}

function getWorkspaceDisplayName(workspacePath: string | undefined, zh: boolean): string {
  const normalized = workspacePath?.trim().replace(/[\\/]+$/, "") ?? "";
  const name = normalized.split(/[\\/]/).filter(Boolean).at(-1);
  return name || (zh ? "当前" : "current workspace");
}

function parseJsonIfObject(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isLocalizedExample(value: unknown): value is { en?: string; zh?: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (typeof (value as { en?: unknown }).en === "string" ||
      typeof (value as { zh?: unknown }).zh === "string")
  );
}

function pickLocalizedExample(
  item: { en?: string; zh?: string },
  language: AppLanguage,
): string {
  const text = language === "zh" ? item.zh ?? item.en : item.en ?? item.zh;
  return text?.trim() ?? "";
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
