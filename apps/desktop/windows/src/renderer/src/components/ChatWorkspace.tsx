import {
  FormEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileCode2,
  FolderPlus,
  Gauge,
  Globe2,
  Info,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  TextCursorInput,
  Terminal,
  X,
} from "lucide-react";
import { canHandleMemoryRequestLocally } from "../userPreferenceIntent";
import type {
  ChatMessage,
  DesktopAgent,
  DesktopHealth,
  DesktopIdeContextSnapshot,
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
import { getStructuredVisibleText, StructuredMessageParts } from "./StructuredMessageParts";
import { getReasoningChatText, getVisibleChatText } from "../chatOutputModel";

export type UiMessage = ChatMessage & {
  id: string;
  streaming?: boolean;
  error?: boolean;
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
const VOICE_LEVEL_COUNT = 72;
const VOICE_LEVEL_SAMPLE_INTERVAL_MS = 32;
const VOICE_NOISE_FLOOR = 0.018;
type VoiceRecordingState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "processing"
  | "failed";

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
  workspacePath?: string;
  workspaceLocation?: "local" | "remote";
  onAbort: () => void;
  onClearExternalAttachments?: () => void;
  onClearRuntimeMode?: () => void;
  onInputChange: (value: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectModel?: (model: string) => void;
  onOpenExternal: (url: string) => void;
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
  workspacePath = "",
  workspaceLocation = "local",
  onAbort,
  onClearExternalAttachments,
  onClearRuntimeMode,
  onInputChange,
  onSelectAgent,
  onSelectModel,
  onOpenExternal,
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
  const [forkQueueAgentSelections, setForkQueueAgentSelections] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [voiceState, setVoiceState] = useState<VoiceRecordingState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceElapsedSeconds, setVoiceElapsedSeconds] = useState(0);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(() => createSilentVoiceLevels());
  const [voiceReviewText, setVoiceReviewText] = useState<string | null>(null);
  const [voiceRuntimeDisclosure, setVoiceRuntimeDisclosure] = useState<string | null>(null);
  const [voiceLanguage, setVoiceLanguage] = useState<"auto" | "zh-CN" | "en-US">("auto");
  const [voiceDeviceId, setVoiceDeviceId] = useState("");
  const [voiceDevices, setVoiceDevices] = useState<MediaDeviceInfo[]>([]);
  const [voiceProgressMessage, setVoiceProgressMessage] = useState("");
  const [voiceRuntimeLabel, setVoiceRuntimeLabel] = useState("Voice STT");
  const [respondedInputRequests, setRespondedInputRequests] = useState<Set<string>>(() => new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStartedAtRef = useRef<number>(0);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceAnimationFrameRef = useRef<number | null>(null);
  const voiceLastSampleAtRef = useRef(0);
  const voiceSmoothedLevelRef = useRef(0);
  const voiceStopModeRef = useRef<"transcribe" | "discard">("transcribe");
  const voiceRequestIdRef = useRef<string | null>(null);
  const voiceRetryBlobRef = useRef<Blob | null>(null);
  const voiceSelectionRef = useRef<{ start: number; end: number } | null>(null);
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
  const [samplePromptsExpanded, setSamplePromptsExpanded] = useState(false);
  const visibleSamplePrompts = samplePromptsExpanded
    ? parsedSamplePrompts
    : parsedSamplePrompts.slice(0, 4);
  const hiddenSamplePromptCount = Math.max(0, parsedSamplePrompts.length - 4);
  const showSamplePrompts =
    emptyChat && !input.trim() && parsedSamplePrompts.length > 0;
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
    setSamplePromptsExpanded(false);
  }, [samplePrompts, language]);

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

  function handleMessageListScroll(): void {
    const list = messageListRef.current;
    if (!list) return;
    shouldFollowOutputRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
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
      setVoiceRuntimeDisclosure(runtime.providerDisclosure);
      setVoiceRuntimeLabel(runtime.runtimeId === "gateway-provider" ? "Online STT" : "Fixture STT");
    }).catch(() => setVoiceRuntimeLabel("STT unavailable"));
  }, []);

  useEffect(() => {
    return () => {
      stopVoiceTimer();
      stopVoiceAnalyzer();
      if (voiceRequestIdRef.current) void desktopApi.cancelVoiceTranscription(voiceRequestIdRef.current);
      stopVoiceStream();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        voiceStopModeRef.current = "discard";
        recorder.stop();
      }
    };
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
    }
  }

  function clearInput(): void {
    onInputChange("");
    textareaRef.current?.focus();
  }

  async function toggleVoiceRecording(): Promise<void> {
    if (voiceState === "recording") {
      stopVoiceRecording("transcribe");
      return;
    }
    await startVoiceRecording();
  }

  async function startVoiceRecording(): Promise<void> {
    if (!voiceApiAvailable) {
      setVoiceState("failed");
      setVoiceError("Voice recording is unavailable in this desktop runtime.");
      return;
    }
    setVoiceError(null);
    voiceSelectionRef.current = textareaRef.current
      ? { start: textareaRef.current.selectionStart, end: textareaRef.current.selectionEnd }
      : { start: input.length, end: input.length };
    setVoiceElapsedSeconds(0);
    setVoiceLevels(createSilentVoiceLevels());
    setVoiceState("requesting_permission");
    try {
      if (hasDesktopApi() && typeof desktopApi.getVoiceRuntimeStatus === "function") {
        const runtime = await desktopApi.getVoiceRuntimeStatus();
        setVoiceRuntimeDisclosure(runtime.providerDisclosure);
        if (runtime.state !== "ready") throw new Error(runtime.message);
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: voiceDeviceId ? { exact: voiceDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVoiceDevices(devices.filter((device) => device.kind === "audioinput"));
      const mimeType = getPreferredVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      voiceStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      voiceStopModeRef.current = "transcribe";
      voiceStartedAtRef.current = Date.now();
      startVoiceAnalyzer(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setVoiceState("failed");
        setVoiceError("Voice recording failed. Please try again.");
        stopVoiceTimer();
        stopVoiceAnalyzer();
        stopVoiceStream();
      };
      recorder.onstop = () => {
        void finishVoiceRecording(recorder.mimeType || mimeType || "audio/webm");
      };
      recorder.start();
      setVoiceState("recording");
      startVoiceTimer();
    } catch (error) {
      setVoiceState("failed");
      setVoiceError(getVoicePermissionError(error));
      stopVoiceTimer();
      stopVoiceAnalyzer();
      stopVoiceStream();
    }
  }

  function stopVoiceRecording(mode: "transcribe" | "discard"): void {
    const recorder = mediaRecorderRef.current;
    voiceStopModeRef.current = mode;
    stopVoiceTimer();
    stopVoiceAnalyzer();
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    stopVoiceStream();
    setVoiceLevels(createSilentVoiceLevels());
    setVoiceState("idle");
  }

  async function finishVoiceRecording(mimeType: string): Promise<void> {
    const chunks = voiceChunksRef.current;
    const durationSeconds = voiceStartedAtRef.current
      ? Math.max(0, Math.round((Date.now() - voiceStartedAtRef.current) / 1000))
      : voiceElapsedSeconds;
    stopVoiceStream();
    stopVoiceAnalyzer();
    mediaRecorderRef.current = null;
    voiceChunksRef.current = [];
    if (voiceStopModeRef.current === "discard") {
      setVoiceState("idle");
      setVoiceError(null);
      setVoiceElapsedSeconds(0);
      return;
    }
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) {
      setVoiceState("failed");
      setVoiceError("Voice recording was empty. Please try again.");
      return;
    }
    setVoiceState("processing");
    setVoiceProgressMessage("Preparing audio...");
    voiceRetryBlobRef.current = blob;
    try {
      const result = await transcribeVoiceRecordingAsync(
        blob,
        durationSeconds,
      );
      setVoiceReviewText(result.transcript);
      setVoiceRuntimeDisclosure(result.providerDisclosure);
      setVoiceState("idle");
      setVoiceError(null);
      setVoiceElapsedSeconds(0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setVoiceState("idle");
        setVoiceError(null);
      } else {
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

  function startVoiceTimer(): void {
    stopVoiceTimer();
    voiceTimerRef.current = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - voiceStartedAtRef.current) / 1000));
      setVoiceElapsedSeconds(elapsed);
      if (elapsed >= 120) stopVoiceRecording("transcribe");
    }, 250);
  }

  function stopVoiceTimer(): void {
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function stopVoiceStream(): void {
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }

  async function transcribeVoiceRecordingAsync(
    blob: Blob,
    durationSeconds: number,
  ): Promise<DesktopVoiceTranscriptionResult> {
    if (!hasDesktopApi()) {
      throw new Error("Voice transcription requires the desktop runtime.");
    }
    const audioData = new Uint8Array(await blob.arrayBuffer());
    return new Promise((resolve, reject) => {
      let settled = false;
      const unsubscribe = desktopApi.onVoiceTranscriptionEvent((event) => {
        if (event.requestId !== voiceRequestIdRef.current || settled) return;
        if (event.type === "progress") {
          setVoiceProgressMessage(event.message);
        } else if (event.type === "completed") {
          settled = true;
          voiceRequestIdRef.current = null;
          unsubscribe();
          resolve(event.result);
        } else if (event.type === "failed") {
          settled = true;
          voiceRequestIdRef.current = null;
          unsubscribe();
          reject(new Error(event.error.message));
        } else if (event.type === "cancelled") {
          settled = true;
          voiceRequestIdRef.current = null;
          unsubscribe();
          reject(new DOMException("Voice transcription was cancelled.", "AbortError"));
        }
      });
      void desktopApi.startVoiceTranscription({
        workspacePath: workspacePath || undefined,
        audioData,
        mimeType: blob.type || "audio/webm",
        durationSeconds,
        languageHint: voiceLanguage === "auto" ? undefined : voiceLanguage,
        sourceLabel: "Desktop composer microphone",
      }).then(({ requestId }) => {
        voiceRequestIdRef.current = requestId;
      }).catch((error) => {
        settled = true;
        unsubscribe();
        reject(error);
      });
    });
  }

  function cancelVoiceTranscription(): void {
    const requestId = voiceRequestIdRef.current;
    if (requestId) void desktopApi.cancelVoiceTranscription(requestId);
  }

  async function retryVoiceTranscription(): Promise<void> {
    const blob = voiceRetryBlobRef.current;
    if (!blob) return;
    setVoiceError(null);
    setVoiceProgressMessage("Preparing audio...");
    setVoiceReviewText(null);
    setVoiceState("processing");
    try {
      const result = await transcribeVoiceRecordingAsync(blob, voiceElapsedSeconds);
      setVoiceReviewText(result.transcript);
      setVoiceRuntimeDisclosure(result.providerDisclosure);
      setVoiceState("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setVoiceState("idle");
        setVoiceError(null);
      } else {
        setVoiceState("failed");
        setVoiceError(error instanceof Error ? error.message : "Voice transcription failed.");
      }
    }
  }

  function acceptVoiceReview(): void {
    const text = voiceReviewText?.trim();
    if (text) {
      const selection = voiceSelectionRef.current ?? { start: input.length, end: input.length };
      onInputChange(`${input.slice(0, selection.start)}${text}${input.slice(selection.end)}`);
    }
    discardVoiceReview();
  }

  function discardVoiceReview(): void {
    setVoiceReviewText(null);
    setVoiceRuntimeDisclosure(null);
    setVoiceError(null);
    voiceRetryBlobRef.current = null;
    setVoiceState("idle");
  }

  function startVoiceAnalyzer(stream: MediaStream): void {
    stopVoiceAnalyzer();
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    voiceAudioContextRef.current = audioContext;
    voiceSourceRef.current = source;
    voiceAnalyserRef.current = analyser;
    voiceLastSampleAtRef.current = 0;
    voiceSmoothedLevelRef.current = 0;

    const samples = new Float32Array(analyser.fftSize);
    const sampleLevel = (timestamp: number): void => {
      if (voiceAnalyserRef.current !== analyser) return;
      if (timestamp - voiceLastSampleAtRef.current >= VOICE_LEVEL_SAMPLE_INTERVAL_MS) {
        analyser.getFloatTimeDomainData(samples);
        const level = calculateVoiceLevel(samples, voiceSmoothedLevelRef.current);
        voiceSmoothedLevelRef.current = level;
        voiceLastSampleAtRef.current = timestamp;
        setVoiceLevels((current) => [...current.slice(1), level]);
      }
      voiceAnimationFrameRef.current = window.requestAnimationFrame(sampleLevel);
    };
    voiceAnimationFrameRef.current = window.requestAnimationFrame(sampleLevel);
  }

  function stopVoiceAnalyzer(): void {
    if (voiceAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceAnimationFrameRef.current);
      voiceAnimationFrameRef.current = null;
    }
    voiceSourceRef.current?.disconnect();
    voiceSourceRef.current = null;
    voiceAnalyserRef.current = null;
    const audioContext = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
    voiceSmoothedLevelRef.current = 0;
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
        {messages.map((message) => {
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
              {message.content && message.role === "user" ? (
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
              {message.role === "assistant" && !message.streaming && assistantContent ? (
                <MessageActions content={assistantContent} zh={zh} />
              ) : null}
            </div>
          </article>
          );
        })}
      </div>
      )}
      {emptyChat && (
        <div className="empty-chat-agent-title" role="group" aria-label={zh ? "当前智能体" : "Current Agent"}>
          <strong>{activeAgentName}</strong>
          <span>{workspaceLocationLabel}</span>
          {emptyChatPreferenceNotice ? (
            <div className="remembered-preferences-notice" data-testid="remembered-preferences-notice" role="status">
              {emptyChatPreferenceNotice}
            </div>
          ) : null}
        </div>
      )}
      <form className="composer" onSubmit={handleSubmit}>
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
                  onRetry={() => void retryVoiceTranscription()}
                  onDiscard={discardVoiceReview}
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
                    : chatUnavailableReason ?? (zh ? "正在连接本地网关..." : "Preparing the local agent runtime...")
                }
                rows={1}
              />
              )}

            </div>

            {voiceError || voiceState === "processing" ? (
              <div
                className={`composer-voice-status ${voiceState === "failed" ? "error" : ""}`}
                aria-live="polite"
              >
                <span>
                  {voiceState === "processing" && voiceProgressMessage
                    ? voiceProgressMessage
                    : getVoiceStatusLabel(voiceState, voiceElapsedSeconds)}
                </span>
                {voiceError ? <small>{voiceError}</small> : null}
                {voiceError && voiceRetryBlobRef.current ? (
                  <span className="composer-voice-error-actions">
                    <button type="button" onClick={() => void retryVoiceTranscription()}>Retry</button>
                    <button type="button" onClick={discardVoiceReview}>Discard</button>
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
                  disabled={!hasModelOptions}
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
                    {modelOptions.map((model) => (
                      <button
                        key={model.alias || model.model}
                        type="button"
                        className={(model.alias || model.model) === selectedModelName ? "active" : ""}
                        onClick={() => selectModel(model.alias || model.model || "")}
                      >
                        <span>{getModelOptionLabel(model)}</span>
                        <small>{getModelOptionMeta(model)}</small>
                      </button>
                    ))}
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
                <span className="composer-voice-runtime-label" title={voiceRuntimeDisclosure || voiceRuntimeLabel}>
                  {voiceRuntimeLabel}
                </span>
                {voiceDevices.length > 1 ? (
                  <select
                    className="composer-voice-device"
                    value={voiceDeviceId}
                    onChange={(event) => setVoiceDeviceId(event.target.value)}
                    disabled={showVoiceCaptureBar}
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
                  onChange={(event) => setVoiceLanguage(event.target.value as "auto" | "zh-CN" | "en-US")}
                  disabled={showVoiceCaptureBar}
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
                  disabled={!canChat || showStop || voiceState === "requesting_permission" || voiceState === "processing"}
                  aria-pressed={voiceState === "recording"}
                  aria-label={
                    voiceState === "recording"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  title={
                    voiceState === "recording"
                      ? "Stop voice recording"
                      : "Start voice recording"
                  }
                  onClick={() => {
                    void toggleVoiceRecording();
                  }}
                >
                  {voiceState === "recording" ? <MicOff size={16} /> : <Mic size={16} />}
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
      {showSamplePrompts && (
        <section className="sample-prompts" aria-label="Example prompts">
          {visibleSamplePrompts.map((prompt, index) => (
            <button
              className="sample-prompt-row"
              key={`${index}-${prompt.slice(0, 32)}`}
              type="button"
              title={prompt}
              onClick={() => selectSamplePrompt(prompt)}
            >
              <span>{prompt}</span>
              <ArrowUpRight size={15} aria-hidden />
            </button>
          ))}
          {hiddenSamplePromptCount > 0 && (
            <button
              className="sample-prompt-more"
              type="button"
              onClick={() => setSamplePromptsExpanded((expanded) => !expanded)}
            >
              <span>
                {samplePromptsExpanded
                  ? "Less examples"
                  : `More (${hiddenSamplePromptCount})`}
              </span>
              <ChevronDown
                className={samplePromptsExpanded ? "expanded" : ""}
                size={15}
                aria-hidden
              />
            </button>
          )}
        </section>
      )}
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

function MessageActions({ content, zh }: { content: string; zh: boolean }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
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
    <div className="message-actions">
      <button type="button" onClick={() => void handleCopy()} title={zh ? "复制回答" : "Copy response"}>
        {copied ? "✓" : <ClipboardList size={13} />}
        <span>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</span>
      </button>
    </div>
  );
}

function VoiceCaptureBar({
  elapsedSeconds,
  levels,
  state,
  onStop,
}: {
  elapsedSeconds: number;
  levels: number[];
  state: VoiceRecordingState;
  onStop: () => void;
}): React.JSX.Element {
  const processing = state === "processing" || state === "requesting_permission";
  const bars = levels.map((level, index) => {
    const height = Math.max(2, Math.round(level * 30));
    return (
      <span
        className="composer-voice-wave-bar"
        key={index}
        style={{
          height: `${height}px`,
          opacity: level > 0.01 ? 1 : 0,
        }}
      />
    );
  });

  return (
    <div
      className={`composer-voice-capture ${processing ? "processing" : "recording"}`}
      aria-label={processing ? "Preparing voice input" : "Recording voice input"}
    >
      <div className="composer-voice-wave" aria-hidden>
        {bars}
      </div>
      <span className="composer-voice-time">{formatVoiceDuration(elapsedSeconds)}</span>
      <button
        className="composer-voice-stop"
        type="button"
        disabled={state === "requesting_permission"}
        onClick={onStop}
        aria-label="Stop voice recording"
        title="Stop voice recording"
      >
        <Square size={11} fill="currentColor" />
      </button>
    </div>
  );
}

function VoiceReviewBar({
  value,
  disclosure,
  onChange,
  onAccept,
  onRetry,
  onDiscard,
}: {
  value: string;
  disclosure: string | null;
  onChange: (value: string) => void;
  onAccept: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}): React.JSX.Element {
  return (
    <div className="composer-voice-review">
      <textarea value={value} onChange={(event) => onChange(event.target.value)} aria-label="Review voice transcript" rows={2} />
      <div className="composer-voice-review-actions">
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" onClick={onDiscard}>Discard</button>
        <button className="primary" type="button" onClick={onAccept} disabled={!value.trim()}>Insert</button>
      </div>
      {disclosure ? <small>{disclosure}</small> : null}
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

function getPreferredVoiceMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/wav",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function createSilentVoiceLevels(): number[] {
  return Array.from({ length: VOICE_LEVEL_COUNT }, () => 0);
}

function calculateVoiceLevel(samples: Float32Array, previousLevel: number): number {
  if (!samples.length) return 0;
  let sumOfSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(sumOfSquares / samples.length);
  const signal = Math.max(rms * 2.8, peak * 0.75);
  const normalized = signal <= VOICE_NOISE_FLOOR
    ? 0
    : Math.min(1, (signal - VOICE_NOISE_FLOOR) / (0.5 - VOICE_NOISE_FLOOR));
  const attack = normalized > previousLevel ? 0.62 : 0.28;
  const smoothed = previousLevel + (normalized - previousLevel) * attack;
  return smoothed < 0.012 ? 0 : smoothed;
}

function getVoicePermissionError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone was found.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The microphone is already in use or unavailable.";
    }
  }
  return error instanceof Error ? error.message : "Unable to start voice recording.";
}

function getVoiceStatusLabel(state: VoiceRecordingState, elapsedSeconds: number): string {
  if (state === "requesting_permission") return "Requesting microphone permission...";
  if (state === "recording") return `Recording ${formatVoiceDuration(elapsedSeconds)}`;
  if (state === "processing") return "Preparing voice transcript...";
  if (state === "failed") return "Voice input needs attention.";
  return "";
}

function formatVoiceDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
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

function getAgentOptionMeta(agent: DesktopAgent, _zh: boolean): string {
  const source = agent.source === "local" ? "Local" : "Online";
  const status =
    agent.status === "running"
      ? "Running"
      : agent.status === "stopped"
        ? "Stopped"
        : "Unreachable";
  return `${source} 路 ${status}`;
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
  if (message.structuredTurn) return getStructuredVisibleText(message.structuredTurn);
  if (!message.reasoningContent) return message.content;
  const content = getVisibleChatText(message.content);
  return removeDuplicatedReasoning(content, getVisibleChatText(message.reasoningContent));
}

function removeDuplicatedReasoning(content: string, reasoning: string): string {
  const visible = content.trim();
  const thought = reasoning.trim();
  if (!visible || !thought) return visible;

  // Some providers send the same reasoning once in a dedicated event and again
  // in the text stream. Keep it in Think and remove only an exact leading copy.
  if (normalizeChatText(visible) === normalizeChatText(thought)) return "";
  if (normalizeChatText(visible).startsWith(normalizeChatText(thought))) {
    const directPrefix = visible.slice(0, thought.length);
    if (normalizeChatText(directPrefix) === normalizeChatText(thought)) {
      return visible.slice(thought.length).trimStart();
    }
  }
  return visible;
}

function normalizeChatText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
