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
  // Temporarily unused while composer Skills picker is hidden — keep for later reuse.
  // Zap,
} from "lucide-react";
import drsaiLogo from "../assets/drsai.png";
import { canHandleMemoryRequestLocally } from "../userPreferenceIntent";
import { isTextCompositionEvent, shouldSubmitTextInput } from "../imeKeyboardPolicy";
import type {
  ChatMessage,
  DesktopAgent,
  DesktopHealth,
  DesktopIdeContextSnapshot,
  DiagnosticEventInput,
  DesktopVoiceInteractionMode,
  DesktopVoiceRuntimeStatus,
  DesktopStreamingVoiceCapabilities,
  DesktopDuplexVoiceCapabilities,
  DesktopThreadHistoryState,
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
  GatewaySkill,
} from "@shared/desktopApi";
import type { ChatAttachment, InteractionOption } from "@shared/desktopApi";
import type { RunReproducibilityLevel } from "@shared/runInspection";
import type { ArtifactPart, CitationPart, InteractionPart, StructuredAssistantPart, StructuredTurnState } from "@shared/structuredConversation";
import type { AppLanguage } from "../navigation";
import { getAgentEmptyChatPrompts, parseCatalogAgentExamples } from "../agentExamplePrompts";
import { desktopApi, hasDesktopApi } from "../desktopApi";
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
import { getReasoningChatText, getVisibleChatText } from "../chatOutputModel";
import { createSmoothFollowOutputController } from "../smoothFollowOutput";
import { VoiceCaptureBar } from "./voice/VoiceCaptureBar";
import { VoiceReviewBar } from "./voice/VoiceReviewBar";
import { StreamingComposerProjectionEditor } from "./voice/StreamingComposerProjectionEditor";
import { TranscriptRepairDiff } from "./voice/TranscriptRepairDiff";
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
import { useDuplexVoiceInput } from "../voice/duplex/useDuplexVoiceInput";
import { canSubmitStreamingVoiceTurn } from "../voice/streaming/streamingVoiceTurnReducer";
import { useAssistantSpeechSegments } from "../voice/streaming/assistantSpeechStream";
import { useStreamingVoiceOutput } from "../voice/streaming/useStreamingVoiceOutput";
import { createStreamingVoiceDiagnostic } from "../voice/streaming/streamingVoiceDiagnostics";
import {
  createStreamingComposerProjection,
  rebaseStreamingComposerUserText,
  setStreamingComposerComposition,
  updateStreamingComposerTranscript,
  type StreamingComposerProjectionState,
} from "../voice/streaming/streamingComposerProjection";
import {
  acceptTranscriptRepair,
  buildContextualTranscriptRepair,
  createTranscriptRepairState,
  proposeTranscriptRepair,
  rejectTranscriptRepair,
  undoTranscriptRepair,
  type TranscriptRepairState,
} from "../voice/streaming/contextualTranscriptRepair";
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
const MAX_CLIPBOARD_IMAGE_BYTES = 1_250_000;
const MAX_CLIPBOARD_IMAGE_COUNT = 4;
const MAX_CLIPBOARD_PATH_MENTIONS = 6;
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
  forkQueueAgentAssignments?: ChatForkQueueAgentAssignment[];
  goalConfirmationRequired?: boolean;
  model?: string;
  runtimeMode?: ChatRuntimeMode | null;
  skillName?: string | null;
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

interface ChatWorkspaceProps {
  activeRequestId: string | null;
  cancellingRequestId?: string | null;
  canChat: boolean;
  chatUnavailableReason?: string;
  composerFocusRequest?: number;
  conversationId: string;
  conversationTitle?: string;
  conversationSource?: "opendrsai" | "codex";
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
  searchRequestNonce?: number;
  structuredTurnFocus?: { turnId: string; nonce: number } | null;
  selectedAgentId?: string;
  selectedAgentName?: string;
  selectedModelName?: string;
  selectedModelProviderId?: string;
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
  onAbort: () => void | Promise<void>;
  onClearExternalAttachments?: () => void;
  onClearRuntimeMode?: () => void;
  onInputChange: (value: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onSelectModel?: (model: string, providerId?: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenDebug?: (runId?: string, view?: "activity" | "app-errors") => void;
  onOpenRun?: (runId: string, itemId?: string) => void;
  onCreateRunExperiment?: (runId: string, itemId?: string) => void;
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
  onRetryMessage?: (assistantMessageId: string, mode: "same_session" | "new_session") => void | Promise<void>;
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
  conversationHistoryPending = false,
  conversationHistory,
  operationalStateControl,
  continuesExistingTask = false,
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
  selectedModelProviderId,
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
  onOpenRun,
  onCreateRunExperiment,
  onOpenPreviewBrowser,
  onOpenWorkspaceArtifact,
  onPickFiles,
  onPickFolder,
  onSummarizeWorkspaceFolder,
  onRemoveExternalAttachment,
  onAttachIdeCurrentFile,
  onAttachIdeCurrentSelection,
  onRefreshIdeContext,
  onRetryMessage,
  onRecoveryAction,
  onLoadEarlierHistory,
  onSubmit,
}: ChatWorkspaceProps): React.JSX.Element {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [runReproducibility, setRunReproducibility] = useState<Record<string, RunReproducibilityLevel>>({});

  useEffect(() => {
    if (!workspacePath || typeof desktopApi.getRunReproductionManifest !== "function") return;
    const runIds = [...new Set(messages
      .map((message) => message.runtimeRunId)
      // RuntimeEngine owns the `run-` namespace. Request IDs and platform-run
      // IDs may also travel through ChatEvent.runId, but they have no Runtime
      // manifest and must never be sent to a run-scoped Runtime endpoint.
      .filter((runId): runId is string => Boolean(runId?.startsWith("run-"))))]
      .slice(-50);
    if (!runIds.length) return;
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
  }, [messages, selectedWorkspaceId, workspacePath]);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
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
  const [taskInteractionMode, setTaskInteractionMode] = useState<"normal" | "confirm_goal">("normal");
  const [searchOpen, setSearchOpen] = useState(false);
  const [metaMenuOpen, setMetaMenuOpen] = useState<"configuration" | "skill" | null>(null);
  const [configurationSection, setConfigurationSection] = useState<"agent" | "model" | "thinking" | "task" | null>(null);
  const [configurationSubmenuPosition, setConfigurationSubmenuPosition] = useState({ top: 0, left: 0, maxHeight: 220 });
  const [installedSkills, setInstalledSkills] = useState<GatewaySkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsLoadError, setSkillsLoadError] = useState<string | null>(null);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [introMenuOpen, setIntroMenuOpen] = useState<"workspace" | "agent" | null>(null);
  const [introSearchQuery, setIntroSearchQuery] = useState("");
  const [forkQueueAgentSelections, setForkQueueAgentSelections] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [voiceReviewText, setVoiceReviewText] = useState<string | null>(null);
  const [voiceReviewSource, setVoiceReviewSource] = useState<"serial" | "streaming" | null>(null);
  const [streamingVoiceReadyToSend, setStreamingVoiceReadyToSend] = useState(false);
  const [streamingVoiceResponseArmed, setStreamingVoiceResponseArmed] = useState(false);
  const [streamingComposerProjection, setStreamingComposerProjection] = useState<StreamingComposerProjectionState | null>(null);
  const [streamingTranscriptRepair, setStreamingTranscriptRepair] = useState<TranscriptRepairState | null>(null);
  const [voiceRuntimeDisclosure, setVoiceRuntimeDisclosure] = useState<string | null>(null);
  const [voiceRuntimeStatus, setVoiceRuntimeStatus] = useState<DesktopVoiceRuntimeStatus | null>(null);
  const [streamingVoiceCapabilities, setStreamingVoiceCapabilities] = useState<DesktopStreamingVoiceCapabilities | null>(null);
  const [duplexVoiceCapabilities, setDuplexVoiceCapabilities] = useState<DesktopDuplexVoiceCapabilities | null>(null);
  const [duplexPrivacyDisclosure, setDuplexPrivacyDisclosure] = useState("Realtime voice sends microphone audio to the configured remote Provider.");
  const [duplexPrivacyConfirmed, setDuplexPrivacyConfirmed] = useState(false);
  const [voiceConsentRequired, setVoiceConsentRequired] = useState(false);
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences();
  const [voiceTurnState, dispatchVoiceTurnBase] = useReducer(reduceVoiceTurn, initialVoiceTurnState);
  const voiceRecordingProcessTimerRef = useRef<number | null>(null);
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
    duplexCapabilities: duplexVoiceCapabilities,
    duplexEnabled: Boolean(duplexVoiceCapabilities),
  });
  const streamingVoiceAvailability = getVoiceModeAvailability("streaming", voiceModeCapabilities);
  const duplexVoiceAvailability = getVoiceModeAvailability("duplex", voiceModeCapabilities);
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
  const streamingVoiceInput = useStreamingVoiceInput({
    deviceId: voiceDeviceId,
    languageHint: voiceLanguage === "auto" ? undefined : voiceLanguage,
    onReview: (transcript) => {
      setStreamingComposerProjection(null);
      const repairBase = createTranscriptRepairState(transcript);
      const candidate = buildContextualTranscriptRepair({
        transcript,
        revision: 1,
        glossary: [
          { canonical: "OpenDrSai", aliases: ["open dr sai", "open doctor sai"], source: { type: "user_dictionary", label: "Product name" } },
          { canonical: "流式语音", aliases: ["留是语音", "流逝语音"], source: { type: "workspace_term", label: "Voice architecture" } },
        ],
      });
      const repair = candidate ? proposeTranscriptRepair(repairBase, candidate) : repairBase;
      setStreamingTranscriptRepair(candidate ? repair : null);
      setVoiceReviewSource("streaming");
      setVoiceReviewText(repair.acceptedText);
      setVoiceRuntimeDisclosure(voiceRuntimeStatus?.providerDisclosure ?? "Live transcription completed.");
    },
  });
  const duplexVoiceInput = useDuplexVoiceInput({
    threadId: conversationId,
    deviceId: voiceDeviceId,
    languageHint: voiceLanguage === "auto" ? undefined : voiceLanguage,
    voice: voicePreferences.voiceName,
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
  useEffect(() => {
    if (!streamingTranscriptRepair?.candidate || streamingVoiceInput.turnState.phase !== "review") return;
    streamingVoiceInput.beginRepair();
    streamingVoiceInput.completeRepair(!streamingTranscriptRepair.candidate.policy.autoAccept);
  }, [streamingTranscriptRepair?.candidate?.id, streamingVoiceInput.turnState.phase]);
  useEffect(() => {
    setStreamingComposerProjection((current) => current
      ? updateStreamingComposerTranscript(current, {
          stableVoiceText: streamingVoiceInput.transcript.committedText,
          provisionalVoiceText: streamingVoiceInput.transcript.unstableText,
          revision: streamingVoiceInput.transcript.revision,
        })
      : current);
  }, [
    streamingVoiceInput.transcript.committedText,
    streamingVoiceInput.transcript.revision,
    streamingVoiceInput.transcript.unstableText,
  ]);
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
  const [configuredCapabilityRequests, setConfiguredCapabilityRequests] = useState<Set<string>>(() => new Set());
  const [activeTurnRailId, setActiveTurnRailId] = useState<string | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const turnRailNavigationTargetRef = useRef<string | null>(null);
  const turnRailNavigationTimerRef = useRef<number | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

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
      if (!e.dataTransfer?.files.length) return;
      const getPath = hasDesktopApi()
        ? (f: File): string => desktopApi.getPathForFile(f)
        : (f: File): string => `C:\\Users\\Demo\\Downloads\\${f.name}`;
      const added: ComposerAttachment[] = [];
      for (const f of Array.from(e.dataTransfer.files)) {
        const p = getPath(f);
        if (!p) continue;
        added.push({ id: crypto.randomUUID(), kind: "file", path: p, name: f.name || p.split(/[\\/]/).pop() || "unknown", importFile: { path: p, name: f.name || p.split(/[\\/]/).pop() || "unknown", extension: (f.name || "").includes(".") ? ((f.name || "").split(".").pop() || "") : "", category: "other", status: "ready" } });
      }
      if (!added.length) return;
      setAttachments((c) => { const ex = new Set(c.map((i) => i.path)); return [...c, ...added.filter((a) => !ex.has(a.path))]; });
      setToolsOpen(false);
    };
    form.addEventListener("dragover", onDrag, true);
    form.addEventListener("drop", onDrop, true);
    (form as any).__drsaiDropOff = () => { form.removeEventListener("dragover", onDrag, true); form.removeEventListener("drop", onDrop, true); };
    return () => { (form as any).__drsaiDropOff?.(); };
  }, []);
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);
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
    setTaskInteractionMode("normal");
  }, [conversationId]);

  useEffect(() => {
    if (!agentOptions.some((agent) => agent.id === selectedAgentId && agent.source === "local" && agent.id !== "my-codex")) setTaskInteractionMode("normal");
  }, [agentOptions, selectedAgentId]);

  async function respondToAgentInput(
    request: NonNullable<UiMessage["inputRequest"]>,
    response: string | Record<string, unknown>,
    transportRequestId = request.requestId,
  ): Promise<void> {
    const accepted = await desktopApi.respondChatInput(transportRequestId, response);
    if (!accepted) return;
    if (typeof response === "object" && response.decision === "revise") return;
    setRespondedInputRequests((current) => new Set(current).add(request.requestId));
  }

  const respondToStructuredInteraction = useEventCallback((turnId: string, part: InteractionPart, response: InteractionResponse): void => {
    void desktopApi.respondChatInput(turnId, response).then((accepted) => {
      if (!accepted) return;
      if (typeof response === "object" && response.decision === "revise") return;
      setRespondedInputRequests((current) => new Set(current).add(part.requestId));
      if (response.capabilityAction === "configured") {
        setConfiguredCapabilityRequests((current) => new Set(current).add(part.requestId));
      }
    });
  });

  const requestStructuredTextInput = useEventCallback((turnId: string, part: InteractionPart): void => {
    const response = window.prompt(part.prompt);
    if (response?.trim()) respondToStructuredInteraction(turnId, part, { response: response.trim() });
  });

  function respondToActiveInput(response: string | Record<string, unknown>): void {
    if (!activeInputRequest || !activeInputMessage) return;
    const transportRequestId = activeInputMessage.structuredTurn?.turnId ?? activeInputRequest.requestId;
    void respondToAgentInput(activeInputRequest, response, transportRequestId);
  }

  function submitInteractionDraft(): void {
    const response = interactionDraft.trim();
    if (!response) return;
    respondToActiveInput(response);
    setInteractionDraft("");
  }
  const shouldFollowOutputRef = useRef(true);
  const finalScrollSettleTimerRef = useRef<number | null>(null);
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
  const [now, setNow] = useState(Date.now());
  const activeInputMessage = useMemo(
    () => [...messages]
      .reverse()
      .find((message) => Boolean(message.inputRequest
        && !respondedInputRequests.has(message.inputRequest.requestId))) ?? null,
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
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const showStop = Boolean(activeRequestId || hasStreamingMessage);
  const emptyChat = messages.every((message) => message.id === "welcome");
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
  })), [duplexVoiceInput.history, zh]);
  const visibleMessages = useMemo(() => {
    const existing = new Set(conversationMessages.map((message) => message.id));
    return [...conversationMessages, ...duplexHistoryMessages.filter((message) => !existing.has(message.id))];
  }, [conversationMessages, duplexHistoryMessages]);
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
  const activeAgentName = selectedAgentName?.trim() || "OpenDrSai";
  const isLocalOpenDrSaiAgent = agentOptions.some(
    (agent) => agent.id === selectedAgentId && agent.source === "local" && agent.id !== "my-codex",
  );
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
  const compactModelName = getCompactComposerModelLabel(activeModelName);
  const activeModelConfig = useMemo(
    () => findSelectedModelConfig(modelOptions, selectedModelName, selectedModelProviderId),
    [modelOptions, selectedModelName, selectedModelProviderId],
  );
  const supportedThinkingEfforts = useMemo<ThinkingEffort[]>(() => {
    if (!isLocalOpenDrSaiAgent) return THINKING_EFFORTS;
    if (!activeModelConfig?.operations?.includes("reasoning")) return [];
    const configured = activeModelConfig.reasoning_efforts ?? [];
    return THINKING_EFFORTS.filter((effort) => configured.includes(effort));
  }, [activeModelConfig, isLocalOpenDrSaiAgent]);
  useEffect(() => {
    if (supportedThinkingEfforts.length > 0 && !supportedThinkingEfforts.includes(thinkingEffort)) {
      setThinkingEffort(supportedThinkingEfforts.includes("high") ? "high" : supportedThinkingEfforts[0]);
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
    thinkingEffortSupported ? thinkingEffort : supportedThinkingEfforts.includes("high") ? "high" : supportedThinkingEfforts[0] ?? thinkingEffort,
    zh,
  );
  const thinkingEffortMenuLabel = showThinkingEffort
    ? thinkingEffortLabel
    : (zh ? "当前模型不支持" : "Not supported by this model");
  const taskInteractionModeLabel = taskInteractionMode === "confirm_goal"
    ? (zh ? "目标" : "Goal")
    : (zh ? "常规" : "Normal");
  const composerConfigurationSummary = [
    activeAgentName,
    compactModelName,
    ...(showThinkingEffort ? [thinkingEffortLabel] : []),
    taskInteractionModeLabel,
  ].join(" · ");
  const hasAgentOptions = agentOptions.length > 0;
  const hasModelOptions = modelOptions.length > 0;
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
    voiceState === "recording";
  const showStreamingVoiceCaptureBar = ["starting", "streaming", "stopping", "cancelling"].includes(streamingVoiceInput.phase);
  const showDuplexVoiceCaptureBar = ["starting", "active", "stopping", "recovering"].includes(duplexVoiceInput.phase);
  const showAnyVoiceCaptureBar = showVoiceCaptureBar || voiceState === "processing" || showStreamingVoiceCaptureBar || showDuplexVoiceCaptureBar;
  const displayedVoicePhase = voicePreferences.interactionMode === "duplex"
    ? duplexVoiceInput.phase
    : voicePreferences.interactionMode === "streaming" ? streamingVoiceInput.phase : voiceTurnState.phase;
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
    void duplexVoiceInput.cancel();
    streamingVoiceInput.reset();
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
      void streamingVoiceInput.cancel();
      void duplexVoiceInput.cancel();
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
    if (voiceState === "failed") onOpenDebug?.(undefined, "app-errors");
  }, [onOpenDebug, voiceDeviceId, voiceError, voiceState]);

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
      if (shouldFollowOutputRef.current) {
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
    if (!hasStreamingMessage) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasStreamingMessage]);

  function getMessageListMaxScrollTop(list: HTMLDivElement): number {
    return Math.max(0, list.scrollHeight - list.clientHeight);
  }

  function scrollMessageListToLatest(behavior: ScrollBehavior = "auto"): void {
    const list = messageListRef.current;
    if (!list) return;
    const target = getMessageListMaxScrollTop(list);
    list.scrollTo({ top: target, behavior });
  }

  useEffect(() => {
    if (!messageListRef.current || !shouldFollowOutputRef.current) return;
    if (!hasStreamingMessage) {
      scrollMessageListToLatest("smooth");
      if (finalScrollSettleTimerRef.current !== null) window.clearTimeout(finalScrollSettleTimerRef.current);
      finalScrollSettleTimerRef.current = window.setTimeout(() => {
        finalScrollSettleTimerRef.current = null;
        if (shouldFollowOutputRef.current && smoothFollowOutput.isFollowing()) scrollMessageListToLatest("auto");
      }, 360);
      return;
    }
    smoothFollowOutput.handleHeightChange(messageListRef.current.scrollHeight);
  }, [hasStreamingMessage, messages, smoothFollowOutput]);

  useEffect(() => () => smoothFollowOutput.dispose(), [smoothFollowOutput]);

  useEffect(() => {
    const list = messageListRef.current;
    const lastMessage = list?.lastElementChild;
    if (!list || !lastMessage) return undefined;
    const observer = new ResizeObserver(() => {
      if (shouldFollowOutputRef.current) smoothFollowOutput.handleHeightChange(list.scrollHeight);
    });
    observer.observe(lastMessage);
    smoothFollowOutput.handleHeightChange(list.scrollHeight);
    return () => observer.disconnect();
  }, [visibleMessages.at(-1)?.id, smoothFollowOutput]);

  useEffect(() => () => {
    if (finalScrollSettleTimerRef.current !== null) window.clearTimeout(finalScrollSettleTimerRef.current);
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
    const message = list?.querySelector<HTMLElement>(
      `.message.user[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!list || !message) return;
    shouldFollowOutputRef.current = false;
    smoothFollowOutput.pause();
    turnRailNavigationTargetRef.current = messageId;
    if (turnRailNavigationTimerRef.current !== null) {
      window.clearTimeout(turnRailNavigationTimerRef.current);
    }
    setActiveTurnRailId(messageId);
    list.scrollTo({ top: Math.max(0, message.offsetTop - 18), behavior: "smooth" });
    turnRailNavigationTimerRef.current = window.setTimeout(() => {
      turnRailNavigationTargetRef.current = null;
      turnRailNavigationTimerRef.current = null;
    }, 600);
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
    smoothFollowOutput.handleScroll(list.scrollTop, getMessageListMaxScrollTop(list));
    shouldFollowOutputRef.current = smoothFollowOutput.isFollowing();
    setAwayFromLatest((current) => current === !shouldFollowOutputRef.current ? current : !shouldFollowOutputRef.current);
  }

  function handleMessageListWheel(event: React.WheelEvent<HTMLDivElement>): void {
    if (event.deltaY >= 0) return;
    const list = messageListRef.current;
    if (!list) return;
    smoothFollowOutput.handleUserScrollIntent(list.scrollTop);
    shouldFollowOutputRef.current = false;
    setAwayFromLatest(true);
  }

  function pauseMessageListFollowForUserIntent(): void {
    const list = messageListRef.current;
    if (!list) return;
    smoothFollowOutput.handleUserScrollIntent(list.scrollTop);
    shouldFollowOutputRef.current = false;
    setAwayFromLatest(true);
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
    shouldFollowOutputRef.current = true;
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
    if (!hasDesktopApi() || typeof desktopApi.getVoiceRuntimeStatus !== "function") return;
    void desktopApi.getVoiceRuntimeStatus().then((runtime) => {
      setVoiceRuntimeStatus(runtime);
      setVoiceRuntimeDisclosure(runtime.providerDisclosure);
      setVoiceRuntimeLabel(runtime.runtimeId === "gateway-provider" ? "Online STT" : "Fixture STT");
    }).catch(() => setVoiceRuntimeLabel("STT unavailable"));
    void desktopApi.getStreamingVoiceCapabilities()
      .then(setStreamingVoiceCapabilities)
      .catch(() => setStreamingVoiceCapabilities(null));
    void desktopApi.getDuplexVoiceCapabilities()
      .then(setDuplexVoiceCapabilities)
      .catch(() => setDuplexVoiceCapabilities(null));
    void desktopApi.getMyDrSaiAgentModelPolicy().then((policy) => {
      const ref = policy.effective_realtime_voice_ref ?? policy.realtime_voice_model?.ref;
      setDuplexPrivacyDisclosure(ref
        ? `Realtime voice sends microphone audio to remote Provider ${ref.provider_id}, model ${ref.model_id}. Audio is streamed only while the Session is active; stable transcripts are saved to this Thread.`
        : "Realtime voice requires an explicitly configured remote Provider and model before microphone audio can be sent.");
    }).catch(() => undefined);
  }, []);

  useEffect(() => { setDuplexPrivacyConfirmed(false); }, [duplexPrivacyDisclosure, conversationId]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (["starting", "active", "recovering", "stopping"].includes(duplexVoiceInput.phase)) {
      setVoiceError(zh ? "实时语音会话期间暂不发送文字；草稿已保留，请先结束会话。" : "Text sending is paused during a Realtime voice session. Your draft is preserved; end the session first.");
      return;
    }
    void submitWithAttachments();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (!shouldSubmitTextInput(event.nativeEvent)) return;
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
    if (["starting", "active", "recovering", "stopping"].includes(duplexVoiceInput.phase)) {
      setVoiceError(zh ? "实时语音会话期间暂不发送文字；草稿已保留，请先结束会话。" : "Text sending is paused during a Realtime voice session. Your draft is preserved; end the session first.");
      return;
    }
    if (showStreamingVoiceCaptureBar || streamingVoiceInput.turnState.phase === "repairing") {
      setVoiceError("Finish live transcription and review the stable text before sending.");
      return;
    }
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
        goalConfirmationRequired: isLocalOpenDrSaiAgent && taskInteractionMode === "confirm_goal",
        model: selectedModelName,
        runtimeMode: currentRuntimeMode,
        skillName: selectedSkillName,
        thinkingEffort: !isLocalOpenDrSaiAgent || thinkingEffortSupported ? thinkingEffort : undefined,
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
      setAttachments([]);
      onClearExternalAttachments?.();
      setSelectedSkillName(null);
      if (isVoiceSubmission) dispatchVoiceTurn({ type: "response_started" });
      if (isStreamingVoiceSubmission) {
        streamingVoiceInput.acceptReview();
        streamingVoiceInput.markAssistantTextStarted();
        setStreamingVoiceReadyToSend(false);
        setStreamingVoiceResponseArmed(true);
      }
    } else if (isVoiceSubmission) {
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

  function retryVoiceChatSubmission(): void {
    const requestId = voiceTurnState.sttRequestId;
    if (voiceTurnState.phase !== "failed" || voiceTurnState.error?.stage !== "submitting" || !requestId) return;
    voiceAutoSubmitRequestRef.current = requestId;
    setVoiceState("idle");
    setVoiceError(null);
    dispatchVoiceTurn({ type: "retry" });
  }

  function clearInput(): void {
    onInputChange("");
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
        streamingCapturePhase: streamingVoiceInput.phase,
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

  async function startDuplexVoiceRecording(privacyAlreadyConfirmed: boolean): Promise<void> {
    if (!duplexVoiceAvailability.available) { setVoiceError(duplexVoiceAvailability.reason ?? "Realtime voice is unavailable."); return; }
    if (!privacyAlreadyConfirmed && !duplexPrivacyConfirmed) { setVoiceError(duplexPrivacyDisclosure); return; }
    voicePlayback.stop(); streamingVoiceOutput.stop(); setVoiceError(null); await duplexVoiceInput.start();
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
    setStreamingComposerProjection(createStreamingComposerProjection(input, voiceSelectionRef.current));
    const started = await streamingVoiceInput.start();
    if (!started) setStreamingComposerProjection(null);
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
    onOpenDebug?.(undefined, "app-errors");
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
    onOpenDebug?.(undefined, "app-errors");
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
      onInputChange(insertion.value);
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
    onInputChange(insertion.value);
    setVoiceReviewSource(null);
    setVoiceReviewText(null);
    voiceAutoSubmitRequestRef.current = requestId;
    voiceRetryBlobRef.current = null;
    voiceRetryDurationRef.current = 0;
    dispatchVoiceTurn({ type: "stt_completed", requestId });
  }

  function acceptVoiceReview(): void {
    const text = voiceReviewText?.trim();
    const streamingReview = voiceReviewSource === "streaming";
    if (streamingReview && !canSubmitStreamingVoiceTurn(streamingVoiceInput.turnState)) {
      setVoiceError("Live transcript repair is still running. Review the result before inserting it.");
      return;
    }
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
    voiceAutoSubmitRequestRef.current = null;
    if (voiceReviewSource === "serial") {
      dispatchVoiceTurn({ type: "cancel" });
      dispatchVoiceTurn({ type: "cancelled" });
    } else {
      streamingVoiceInput.reset();
    }
    clearVoiceReview();
    setStreamingComposerProjection(null);
    restoreComposerFocus(null);
  }

  function clearVoiceReview(): void {
    setVoiceReviewText(null);
    setVoiceReviewSource(null);
    setStreamingTranscriptRepair(null);
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

  function toggleMetaMenu(menu: "configuration" | "skill"): void {
    setMetaMenuOpen((current) => {
      const next = current === menu ? null : menu;
      if (next === "skill") void loadInstalledSkillsForPicker();
      setConfigurationSection(null);
      return next;
    });
  }

  function revealConfigurationSection(
    section: "agent" | "model" | "thinking" | "task",
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
      setSkillsLoadError(zh ? "当前环境不支持读取 Skills。" : "Skills are unavailable in this environment.");
      return;
    }
    setSkillsLoading(true);
    setSkillsLoadError(null);
    try {
      const skills = await desktopApi.listInstalledSkills();
      setInstalledSkills(Array.isArray(skills) ? skills : []);
    } catch (error) {
      setInstalledSkills([]);
      setSkillsLoadError(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setSkillsLoading(false);
    }
  }

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
    if (cleaned !== input) onInputChange(cleaned);
    setSelectedSkillName(skillName);
    setMetaMenuOpen(null);
    textareaRef.current?.focus();
  }

  function clearSelectedSkill(): void {
    const cleaned = stripSkillPrefixFromInput(input, selectedSkillName);
    if (cleaned !== input) onInputChange(cleaned);
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

  function selectThinkingEffort(effort: ThinkingEffort): void {
    setThinkingEffort(effort);
    setMetaMenuOpen(null);
    textareaRef.current?.focus();
  }

  function selectTaskInteractionMode(mode: "normal" | "confirm_goal"): void {
    setTaskInteractionMode(mode);
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

  const openStructuredArtifact = useEventCallback((part: ArtifactPart): void => {
    if (part.url && isSafeWebUrl(part.url)) {
      openPreviewBrowser(part.url);
      return;
    }
    if (part.path) onOpenWorkspaceArtifact?.(part.path);
  });

  const openStructuredCitation = useEventCallback((part: CitationPart): void => {
    if (part.url && isSafeWebUrl(part.url)) {
      openPreviewBrowser(part.url);
      return;
    }
    if (part.path) onOpenWorkspaceArtifact?.(part.path);
  });

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
          {conversationHistory?.truncated && conversationHistory.nextCursor && onLoadEarlierHistory ? (
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
        {visibleMessages.filter((message) => !isEmptyAssistantShell(message)).map((message, messageIndex) => {
          const assistantContent = message.role === "assistant"
            ? getAssistantDisplayContent(message)
            : message.content;
          return (
          <VirtualizedMessage
            key={message.id}
            message={message}
            className={`message ${message.role} ${message.error ? "error" : ""} ${searchMatches.includes(message.id) ? "search-match" : ""} ${activeMatchId === message.id ? "search-active" : ""} ${message.structuredTurn?.turnId === highlightedTurnId ? "structured-turn-focus" : ""}`}
            pinned={message.streaming === true || visibleMessages.length - messageIndex <= 12}
            scrollRootRef={messageListRef}
          >
            {message.role === "user" || !message.structuredTurn ? <strong className="message-author">{message.role === "user" ? "You" : "OpenDrSai"}</strong> : null}
            <div className="message-body">
              {message.role === "user" && message.attachments?.length ? (
                <div className="message-attachment-badges" aria-label={zh ? "附件" : "Attachments"}>
                  {message.attachments.map((attachment, index) => (
                    <span
                      className="message-attachment-badge"
                      key={`${message.id}-attachment-${index}-${attachment.path || attachment.name}`}
                      title={attachment.path || attachment.name}
                    >
                      {renderMessageAttachmentIcon(attachment.kind)}
                      <span>{attachment.name}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {message.role === "assistant" && message.replyFailed ? (
                <div className="chat-reply-failed">
                  <button type="button" onClick={() => onOpenDebug?.(message.runtimeRunId)}><Bug size={14} aria-hidden /><span>{zh ? "回复未完成 · 查看调试" : "Reply incomplete · View debug"}</span></button>
                  {onRetryMessage ? <span className="chat-retry-actions">
                    <button type="button" onClick={() => void onRetryMessage(message.id, "same_session")}>{zh ? "在当前会话重试" : "Retry in this session"}</button>
                    <button type="button" onClick={() => void onRetryMessage(message.id, "new_session")}>{zh ? "分支到新会话" : "Branch to a new session"}</button>
                  </span> : null}
                </div>
              ) : message.content && message.role === "user" ? (
                <p>{highlightPlainText(message.content, searchQuery)}</p>
              ) : message.role === "assistant" && message.structuredTurn ? (
                message.structuredTurn.parts.length || message.structuredTurn.activities.length ? (
                  <StructuredMessageParts
                    turn={message.structuredTurn}
                    runId={message.runtimeRunId}
                    language={language}
                    respondedRequestIds={respondedInputRequests}
                    configuredCapabilityRequestIds={configuredCapabilityRequests}
                    onOpenLink={handleMarkdownLink}
                    onOpenArtifact={openStructuredArtifact}
                    onOpenCitation={openStructuredCitation}
                    onRespondInteraction={(part, response) => respondToStructuredInteraction(message.structuredTurn!.turnId, part, response)}
                    onRequestTextInteraction={(part) => requestStructuredTextInput(message.structuredTurn!.turnId, part)}
                      onOpenDebug={onOpenDebug ? () => onOpenDebug(message.runtimeRunId) : undefined}
                      onOpenRun={onOpenRun}
                      onCreateRunExperiment={onCreateRunExperiment}
                      reproducibilityLevel={message.runtimeRunId ? runReproducibility[message.runtimeRunId] : undefined}
                    now={now}
                    startedAt={message.startedAt}
                    completedAt={message.lastEventAt}
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
              ) : message.role === "user" && message.attachments?.length ? null : (
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
              {message.role === "assistant" && message.recoveryActions?.length && onRecoveryAction ? (
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
                  playbackDisabled={showAnyVoiceCaptureBar || isVoiceCaptureActive(voiceTurnState.phase)}
                  playbackRate={voicePreferences.playbackRate}
                  synthesisMode={resolveVoiceSynthesisMode(voicePreferences.synthesisMode, voicePreferences.remoteTtsConsent)}
                  voiceName={voicePreferences.voiceName}
                  zh={zh}
                />
              ) : null}
            </div>
          </VirtualizedMessage>
          );
        })}
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
              <div className="composer-tools" ref={toolsMenuRef}>
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
                      <button type="button" onClick={() => respondToActiveInput({ approved: false })}>{zh ? "拒绝" : "Reject"}</button>
                      <button type="button" className="primary" onClick={() => respondToActiveInput({ approved: true })}>{zh ? "批准" : "Approve"}</button>
                    </div>
                  ) : activeInputRequest.inputType === "confirmation" ? (
                    <div className="composer-agent-interaction-controls">
                      <button type="button" onClick={() => respondToActiveInput({ decision: "decline" })}>{zh ? "取消" : "Cancel"}</button>
                      <button type="button" className="primary" onClick={() => respondToActiveInput({ decision: "accept" })}>{zh ? "确认" : "Confirm"}</button>
                    </div>
                  ) : activeInputRequest.inputType === "choice" && activeInputRequest.options?.length ? (
                    <div className="composer-agent-interaction-controls">
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
                  {streamingTranscriptRepair?.candidate ? (
                    <TranscriptRepairDiff
                      candidate={streamingTranscriptRepair.candidate}
                      accepted={streamingTranscriptRepair.status === "accepted"}
                      onAccept={() => setStreamingTranscriptRepair((current) => {
                        if (!current) return current;
                        const next = acceptTranscriptRepair(current);
                        setVoiceReviewText(next.acceptedText);
                        return next;
                      })}
                      onReject={() => setStreamingTranscriptRepair((current) => {
                        if (!current) return current;
                        const next = rejectTranscriptRepair(current);
                        setVoiceReviewText(next.acceptedText);
                        return next;
                      })}
                      onUndo={() => setStreamingTranscriptRepair((current) => {
                        if (!current) return current;
                        const next = undoTranscriptRepair(current);
                        setVoiceReviewText(next.acceptedText);
                        return next;
                      })}
                    />
                  ) : null}
                </div>
              ) : showDuplexVoiceCaptureBar ? (
                <div className="composer-voice-status" data-testid="duplex-voice-status" aria-live="polite">
                  <span>{zh ? "实时语音" : "Realtime voice"}: {duplexVoiceInput.turn.phase}</span>
                  {duplexVoiceInput.inputTranscript ? <small>{duplexVoiceInput.inputTranscript}</small> : null}
                  {duplexVoiceInput.outputTranscript ? <small>{duplexVoiceInput.outputTranscript}</small> : null}
                  {duplexVoiceInput.flowControl.paused ? <small>{zh ? "音频上行暂缓" : "Audio uplink paused"}</small> : null}
                  {duplexVoiceInput.usageWarning ? <small>{duplexVoiceInput.usageWarning}</small> : null}
                  {Object.values(duplexVoiceInput.toolStatuses).slice(-1).map((tool, index) => <small key={`${tool.status}-${index}`}>{tool.detail ?? tool.status}</small>)}
                  <button type="button" onClick={() => void duplexVoiceInput.stop()}>{zh ? "结束" : "Stop"}</button>
                </div>
              ) : showStreamingVoiceCaptureBar && streamingComposerProjection ? (
                <StreamingComposerProjectionEditor
                  elapsedSeconds={streamingVoiceInput.elapsedSeconds}
                  levels={streamingVoiceInput.levels}
                  phase={streamingVoiceInput.phase}
                  projection={streamingComposerProjection}
                  textareaRef={textareaRef}
                  transportMessage={streamingVoiceInput.flowControl.paused ? (zh ? "连接较慢，正在控制音频发送速度…" : "Connection is slow; audio flow is being limited…") : undefined}
                  onCompositionChange={(composing) => setStreamingComposerProjection((current) => current ? setStreamingComposerComposition(current, composing) : current)}
                  onUserTextChange={(value) => {
                    onInputChange(value);
                    setStreamingComposerProjection((current) => current ? rebaseStreamingComposerUserText(current, value) : current);
                  }}
                  onStop={() => void streamingVoiceInput.stop()}
                />
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
                </div>
              )}

            </div>

            {voiceError || streamingVoiceInput.error || duplexVoiceInput.error ? (
              <div
                className={`composer-voice-status ${voiceState === "failed" || streamingVoiceInput.phase === "failed" || duplexVoiceInput.phase === "failed" ? "error" : ""}`}
                aria-live="polite"
              >
                <span>
                  {getVoiceStatusLabel(voiceState, voiceElapsedSeconds)}
                </span>
                {voiceError || streamingVoiceInput.error || duplexVoiceInput.error ? <small>{voiceError ?? streamingVoiceInput.error ?? duplexVoiceInput.error}</small> : null}
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
                {voicePreferences.interactionMode === "duplex" && !duplexPrivacyConfirmed && voiceError === duplexPrivacyDisclosure ? (
                  <span className="composer-voice-error-actions" aria-label="Realtime voice privacy confirmation">
                    <button type="button" onClick={() => { setDuplexPrivacyConfirmed(true); void startDuplexVoiceRecording(true); }}>{zh ? "了解并开始实时语音" : "I understand—start Realtime voice"}</button>
                    <button type="button" onClick={() => setVoiceError(null)}>{zh ? "暂不使用" : "Not now"}</button>
                  </span>
                ) : null}
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
              <div className="composer-meta-item composer-configuration" data-meta-menu="configuration">
                <button
                  className="composer-meta-chip composer-meta-button composer-configuration-trigger"
                  data-testid="composer-configuration-trigger"
                  type="button"
                  aria-expanded={metaMenuOpen === "configuration"}
                  aria-haspopup="dialog"
                  onClick={() => toggleMetaMenu("configuration")}
                  title={zh ? "智能体、模型、推理强度和任务模式" : "Agent, model, reasoning effort, and task mode"}
                >
                  <Bot size={14} />
                  <span>{composerConfigurationSummary}</span>
                  <ChevronDown size={13} />
                </button>
                {metaMenuOpen === "configuration" ? (
                  <div className="composer-configuration-menu" role="dialog" aria-label={zh ? "任务设置" : "Task settings"} onMouseLeave={() => setConfigurationSection(null)}>
                    <div className="composer-configuration-rows">
                      <button type="button" disabled={!hasAgentOptions} aria-expanded={configurationSection === "agent"} onMouseEnter={(event) => revealConfigurationSection("agent", event.currentTarget)} onFocus={(event) => revealConfigurationSection("agent", event.currentTarget)} onClick={(event) => revealConfigurationSection("agent", event.currentTarget)}><span><strong>{zh ? "智能体" : "Agent"}</strong><small>{activeAgentName}</small></span><ChevronRight size={14} /></button>
                      <button type="button" aria-expanded={configurationSection === "model"} onMouseEnter={(event) => revealConfigurationSection("model", event.currentTarget)} onFocus={(event) => revealConfigurationSection("model", event.currentTarget)} onClick={(event) => revealConfigurationSection("model", event.currentTarget)}><span><strong>{zh ? "模型" : "Model"}</strong><small>{activeModelName}</small></span><ChevronRight size={14} /></button>
                      <button type="button" disabled={!showThinkingEffort} aria-expanded={configurationSection === "thinking"} onMouseEnter={(event) => revealConfigurationSection("thinking", event.currentTarget)} onFocus={(event) => revealConfigurationSection("thinking", event.currentTarget)} onClick={(event) => revealConfigurationSection("thinking", event.currentTarget)}><span><strong>{zh ? "推理强度" : "Reasoning effort"}</strong><small>{thinkingEffortMenuLabel}</small></span><ChevronRight size={14} /></button>
                      <button type="button" data-testid="composer-task-mode" disabled={!isLocalOpenDrSaiAgent || showStop} aria-expanded={configurationSection === "task"} onMouseEnter={(event) => revealConfigurationSection("task", event.currentTarget)} onFocus={(event) => revealConfigurationSection("task", event.currentTarget)} onClick={(event) => revealConfigurationSection("task", event.currentTarget)}><span><strong>{zh ? "任务模式" : "Task mode"}</strong><small>{taskInteractionModeLabel}</small></span><ChevronRight size={14} /></button>
                    </div>
                    {configurationSection ? <div className="composer-configuration-submenu" style={configurationSubmenuPosition} role="menu" aria-label={configurationSection === "agent" ? (zh ? "选择智能体" : "Choose agent") : configurationSection === "model" ? (zh ? "选择模型" : "Choose model") : configurationSection === "thinking" ? (zh ? "选择推理强度" : "Choose reasoning effort") : (zh ? "选择任务模式" : "Choose task mode")}>
                      <div className="composer-configuration-options">
                        {configurationSection === "agent" ? agentOptions.map((agent) => (
                          <button key={agent.id} type="button" role="menuitemradio" aria-checked={agent.id === selectedAgentId} className={agent.id === selectedAgentId ? "active" : ""} onClick={() => selectAgent(agent.id)}>
                            <span><strong>{agent.name}</strong><small>{getAgentOptionMeta(agent, zh)}</small></span>
                            {agent.id === selectedAgentId ? <Check size={14} aria-hidden /> : null}
                          </button>
                        )) : configurationSection === "model" ? (hasModelOptions ? modelOptions.map((model) => (
                          <button key={`${model.provider_id || "backend"}:${model.alias || model.model}`} type="button" role="menuitemradio" aria-checked={(model.alias || model.model) === selectedModelName && (!selectedModelProviderId || model.provider_id === selectedModelProviderId)} className={(model.alias || model.model) === selectedModelName && (!selectedModelProviderId || model.provider_id === selectedModelProviderId) ? "active" : ""} onClick={() => selectModel(model.alias || model.model || "", model.provider_id)}>
                            <span><strong>{getModelOptionLabel(model)}</strong><small>{getModelProviderLabel(model, zh)}</small></span>
                            {(model.alias || model.model) === selectedModelName && (!selectedModelProviderId || model.provider_id === selectedModelProviderId) ? <Check size={14} aria-hidden /> : null}
                          </button>
                        )) : <p className="composer-meta-menu-empty">{zh ? "暂无可用模型" : "No models available"}</p>) : configurationSection === "thinking" ? supportedThinkingEfforts.map((effort) => (
                          <button key={effort} type="button" role="menuitemradio" aria-checked={effort === thinkingEffort} className={effort === thinkingEffort ? "active" : ""} onClick={() => selectThinkingEffort(effort)}>
                            <span><strong>{getThinkingEffortLabel(effort, zh)}</strong></span>
                            {effort === thinkingEffort ? <Check size={14} aria-hidden /> : null}
                          </button>
                        )) : (["normal", "confirm_goal"] as const).map((mode) => (
                          <button key={mode} type="button" role="menuitemradio" aria-checked={mode === taskInteractionMode} data-testid={`composer-task-mode-${mode}`} disabled={!isLocalOpenDrSaiAgent || showStop} className={mode === taskInteractionMode ? "active" : ""} onClick={() => selectTaskInteractionMode(mode)}>
                            <span><strong>{mode === "normal" ? (zh ? "常规" : "Normal") : (zh ? "目标" : "Goal")}</strong><small>{mode === "normal" ? (zh ? "适合日常问答和简单任务，立即开始" : "Best for everyday questions and simple tasks; starts right away") : (zh ? "适合复杂任务，开始前与你核对需求和预期结果" : "Best for complex tasks; reviews your needs and expected result first")}</small></span>
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
                <select
                  className="composer-voice-mode"
                  data-testid="composer-voice-mode"
                  value={voicePreferences.interactionMode}
                  onChange={(event) => updateVoicePreferences({ interactionMode: event.target.value as DesktopVoiceInteractionMode })}
                  disabled={!canSwitchVoiceMode(voiceTurnState.phase) || showStreamingVoiceCaptureBar || showDuplexVoiceCaptureBar || streamingVoiceInput.phase === "reviewing" || streamingVoiceReadyToSend || streamingVoiceResponseArmed}
                  aria-label={zh ? "语音交互模式" : "Voice interaction mode"}
                  title={streamingVoiceAvailability.reason ?? voiceRuntimeDisclosure ?? voiceRuntimeLabel}
                >
                  <option value="serial">{zh ? "串行" : "Serial"}</option>
                  <option value="streaming" disabled={!streamingVoiceAvailability.available}>{zh ? "流式" : "Streaming"}</option>
                  <option value="duplex" disabled={!duplexVoiceAvailability.available}>{zh ? "实时" : "Realtime"}</option>
                </select>
                {(voicePreferences.interactionMode === "duplex" ? duplexVoiceInput.devices : voiceDevices).length > 1 ? (
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
                  className={`composer-icon-button composer-voice-button ${voiceState === "recording" || duplexVoiceInput.phase === "active" ? "recording" : ""}`}
                  disabled={voiceState === "requesting_permission" || voiceState === "processing" || duplexVoiceInput.phase === "starting" || duplexVoiceInput.phase === "stopping"}
                  aria-pressed={voiceState === "recording" || streamingVoiceInput.phase === "streaming" || duplexVoiceInput.phase === "active"}
                  aria-label={
                    voiceState === "processing"
                      ? "Transcribing voice input"
                      : voiceState === "recording" || streamingVoiceInput.phase === "streaming" || duplexVoiceInput.phase === "active" || duplexVoiceInput.phase === "recovering"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  title={
                    voiceState === "processing"
                      ? "Transcribing voice input"
                      : voiceState === "recording" || streamingVoiceInput.phase === "streaming" || duplexVoiceInput.phase === "active" || duplexVoiceInput.phase === "recovering"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  onClick={() => {
                    void toggleVoiceRecording();
                  }}
                >
                  {voiceState === "processing" ? (
                    <ThreadActivityBubble state={{ kind: "running" }} language={zh ? "zh" : "en"} />
                  ) : voiceState === "recording" || streamingVoiceInput.phase === "streaming" || duplexVoiceInput.phase === "active" || duplexVoiceInput.phase === "recovering" ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                {showStop ? (
                  <>
                    {input.trim() ? <button className="composer-submit" type="submit" title={zh ? "默认排在当前任务之后" : "Queue after the current task"}>
                      <Send size={16} />{zh ? "排队发送" : "Queue"}
                    </button> : null}
                    {input.trim() ? <button className="composer-submit" type="button"
                      onClick={() => void Promise.resolve(onAbort()).then(() => submitWithAttachments())}
                      title={zh ? "明确停止当前任务并改为执行这条消息" : "Explicitly stop the active task and run this message"}>
                      {zh ? "停止并替换" : "Stop & replace"}
                    </button> : null}
                    <button className="composer-submit stop" type="button" disabled={cancellingRequestId === activeRequestId} onClick={() => void onAbort()}>
                      <Square size={16} />
                      {cancellingRequestId === activeRequestId
                        ? (zh ? "正在取消…" : "Cancelling…")
                        : messages.some((message) => message.structuredTurn?.turnId === activeRequestId && message.structuredTurn.status === "pending")
                        ? (zh ? "取消排队" : "Cancel queued") : (zh ? "停止" : "Stop")}
                    </button>
                  </>
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

function shallowArrayEqual(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((item, index) => Object.is(item, right[index]));
}

function chatWorkspacePropsEqual(previous: ChatWorkspaceProps, next: ChatWorkspaceProps): boolean {
  const arrayProps = new Set<keyof ChatWorkspaceProps>([
    "messages", "agentOptions", "modelOptions", "samplePrompts", "externalAttachments",
    "workspaceInstructions", "workspaceOptions",
  ]);
  return (Object.keys(next) as Array<keyof ChatWorkspaceProps>).every((key) => {
    const nextValue = next[key];
    if (typeof nextValue === "function") return true;
    const previousValue = previous[key];
    if (arrayProps.has(key)) {
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

function VirtualizedMessage({
  message,
  className,
  pinned,
  scrollRootRef,
  children,
}: {
  message: UiMessage;
  className: string;
  pinned: boolean;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}): React.JSX.Element {
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
      {renderContent ? children : null}
    </article>
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
}): React.JSX.Element | null {
  if (!message.streaming) {
    // Empty completed shells are filtered elsewhere; never show the literal placeholder.
    if (message.error) {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function getAssistantDisplayContent(message: UiMessage): string {
  return getAssistantSpeechText(message, getVisibleChatText);
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
