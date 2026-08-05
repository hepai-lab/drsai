import {
  FormEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileCode2,
  FileText,
  FolderPlus,
  Gauge,
  Globe2,
  Info,
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
import type {
  ChatMessage,
  DesktopAgent,
  DesktopHealth,
  DesktopIdeContextSnapshot,
  ChatToolTimelineEvent,
  ChatMessagePart,
  MyDrSaiModelConfig,
  PickDialogResult,
  WorkspaceFolderSummaryRequest,
  WorkspaceFolderSummaryResult,
  WorkspaceInstructionSummary,
} from "@shared/desktopApi";
import type { ChatAttachment } from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi, hasDesktopApi } from "../desktopApi";
import {
  CHAT_COMMAND_NAMES,
  parseForkQueueEntries,
  type ChatCommandName,
  type ChatRuntimeMode,
} from "../chatCommands";
import { ChatMessageContent } from "./ChatMessageContent";
import { getAssistantVisibleAnswer, getReasoningChatText, getVisibleChatText, isUserVisibleChatStatus, mergeReasoningText, sanitizeChatToolTimelineEvents } from "../chatOutputModel";
import { copyTextReliable } from "../threadShareClient";

export type UiMessage = ChatMessage & {
  id: string;
  streaming?: boolean;
  error?: boolean;
  statusContent?: string;
  reasoningContent?: string;
  toolTimeline?: ChatToolTimelineEvent[];
  parts?: ChatMessagePart[];
  /** File/folder chips rendered inside the user message bubble. */
  attachments?: ChatAttachment[];
  startedAt?: number;
  lastEventAt?: number;
};

type ComposerAttachment = ChatAttachment & {
  id: string;
  sizeBytes?: number;
};

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
  agentName?: string;
  forkQueueAgentAssignments?: ChatForkQueueAgentAssignment[];
  model?: string;
  runtimeMode?: ChatRuntimeMode | null;
  thinkingEffort: ThinkingEffort;
}

interface ChatWorkspaceProps {
  /** Stable session id — used to reset local composer UI without remounting the workspace. */
  threadId: string;
  activeRequestId: string | null;
  canChat: boolean;
  health: DesktopHealth | null;
  input: string;
  language: AppLanguage;
  messages: UiMessage[];
  currentRuntimeMode?: ChatRuntimeMode | null;
  searchRequestNonce?: number;
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
  onAbort: () => void;
  onClearExternalAttachments?: () => void;
  onClearRuntimeMode?: () => void;
  onInputChange: (value: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectModel?: (model: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenPreviewBrowser?: (url?: string) => void;
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
  threadId,
  activeRequestId,
  canChat,
  input,
  language,
  messages,
  currentRuntimeMode,
  searchRequestNonce = 0,
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
  onAbort,
  onClearExternalAttachments,
  onClearRuntimeMode,
  onInputChange,
  onSelectAgent,
  onSelectModel,
  onOpenExternal,
  onOpenPreviewBrowser,
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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>("medium");
  const [searchOpen, setSearchOpen] = useState(false);
  const [metaMenuOpen, setMetaMenuOpen] = useState<"agent" | "model" | "thinking" | null>(null);
  const [forkQueueAgentSelections, setForkQueueAgentSelections] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowOutputRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const zh = language === "zh";
  const [now, setNow] = useState(Date.now());
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const showStop = Boolean(activeRequestId || hasStreamingMessage);
  const emptyChat = messages.every((message) => message.id === "welcome");
  const activeAgentName = selectedAgentName?.trim() || "OpenDrSai";
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

  // Session switch reuse: keep this component mounted; only reset local UI for the new thread.
  useEffect(() => {
    setToolsOpen(false);
    setAttachments([]);
    setSearchOpen(false);
    setMetaMenuOpen(null);
    setForkQueueAgentSelections({});
    setSearchQuery("");
    setActiveMatchIndex(0);
    setSamplePromptsExpanded(false);
    shouldFollowOutputRef.current = true;
  }, [threadId]);

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
  const queuedContextAttachments = useMemo(
    () =>
      mergeUniqueAttachments([
        ...attachments.map(({ id: _id, ...attachment }) => attachment),
        ...externalAttachments,
        ...inlineMentionAttachments,
      ]),
    [attachments, externalAttachments, inlineMentionAttachments],
  );
  const contextPreviewItems = useMemo(
    () => createContextPreviewItems(queuedContextAttachments, workspaceInstructions),
    [queuedContextAttachments, workspaceInstructions],
  );
  const contextBudget = useMemo(
    () => estimateContextBudget(contextPreviewItems, activeModelConfig),
    [contextPreviewItems, activeModelConfig],
  );
  const hasAdvancedContextSources =
    workspaceInstructions.length > 0 ||
    queuedContextAttachments.some((attachment) => attachment.kind !== "file" && attachment.kind !== "folder");
  const showContextPreview =
    contextPreviewItems.length > 0 &&
    (contextBudget.level !== "ok" || hasAdvancedContextSources);
  const hasAttachmentPreview =
    attachments.length > 0 ||
    externalAttachments.some((attachment) => attachment.kind !== "terminal");
  const canSubmit =
    canChat &&
    !showStop &&
    (Boolean(input.trim()) ||
      attachments.length > 0 ||
      externalAttachments.length > 0 ||
      inlineMentionAttachments.length > 0);
  const canAttachIdeCurrentFile = Boolean(ideContext?.currentFile);
  const canAttachIdeCurrentSelection = Boolean(ideContext?.currentSelection);
  const searchableMessages = useMemo(
    () => messages.filter((message) =>
      message.role === "assistant"
        ? getAssistantVisibleAnswer(message.content, message.reasoningContent)
        : getVisibleChatText(message.content),
    ),
    [messages],
  );

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchableMessages
      .filter((message) => {
        const text = message.role === "assistant"
          ? getAssistantVisibleAnswer(message.content, message.reasoningContent)
          : getVisibleChatText(message.content);
        return text.toLowerCase().includes(query);
      })
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
    textarea.style.height = "40px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 116)}px`;
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
    scrollMessageListToLatest(messages.some((message) => message.streaming) ? "auto" : "smooth");
  }, [messages]);

  function getMessageListMaxScrollTop(list: HTMLDivElement): number {
    return Math.max(0, list.scrollHeight - list.clientHeight);
  }

  function scrollMessageListToLatest(behavior: ScrollBehavior = "auto"): void {
    const list = messageListRef.current;
    if (!list) return;
    const target = getMessageListMaxScrollTop(list);
    list.scrollTo({ top: target, behavior });
    window.requestAnimationFrame(() => {
      if (!shouldFollowOutputRef.current) return;
      const nextTarget = getMessageListMaxScrollTop(list);
      if (Math.abs(list.scrollTop - nextTarget) > 2) {
        list.scrollTop = nextTarget;
      }
    });
  }

  function handleMessageListScroll(): void {
    const list = messageListRef.current;
    if (!list) return;
    shouldFollowOutputRef.current = getMessageListMaxScrollTop(list) - list.scrollTop < 80;
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
      ...attachments.map(({ id: _id, ...attachment }) => attachment),
      ...externalAttachments,
      ...inlineMentionAttachments,
    ], folderSummaryProvider);
    const submitted = await onSubmit(
      submittedAttachments.filter((attachment) => !attachment.blockedReason),
      {
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
    try {
      const result = await onPickFiles();
      if (result.canceled) return;
      const sizeByPath = new Map(
        (result.entries ?? []).map((entry) => [entry.path, entry.size]),
      );
      addAttachments("file", result.paths, sizeByPath);
    } catch (error) {
      console.error("Failed to pick files:", error);
    }
  }

  async function addFolder(): Promise<void> {
    if (!onPickFolder) return;
    try {
      const result = await onPickFolder();
      if (!result.canceled) await addFolderAttachments(result.paths);
    } catch (error) {
      console.error("Failed to pick folder:", error);
    }
  }

  function addAttachments(
    kind: ComposerAttachment["kind"],
    paths: string[],
    sizeByPath?: Map<string, number | undefined>,
  ): void {
    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.path));
      const next = paths
        .filter((path) => !existing.has(path))
        .map((path) => ({
          id: crypto.randomUUID(),
          kind,
          path,
          name: getPathName(path),
          sizeBytes: sizeByPath?.get(path),
        }));
      return [...current, ...next];
    });
    setToolsOpen(false);
  }

  async function addFolderAttachments(paths: string[]): Promise<void> {
    const folderAttachments = await Promise.all(
      paths.map(async (path): Promise<ComposerAttachment> => {
        const base = {
          id: crypto.randomUUID(),
          kind: "folder" as const,
          path,
          name: getPathName(path),
        };
        if (!onSummarizeWorkspaceFolder) return base;
        try {
          const summary = await onSummarizeWorkspaceFolder({
            path,
            maxDepth: 3,
            maxEntries: 240,
            maxSampleFiles: 16,
          });
          return {
            ...base,
            path: summary.path,
            name: summary.name,
            title: `Folder summary: ${summary.name}`,
            visibleText: summary.summary,
            note: [
              `${summary.fileCount} files`,
              `${summary.directoryCount} folders`,
              `${summary.estimatedTokens} estimated tokens`,
              summary.truncated ? "truncated" : "",
            ].filter(Boolean).join(", "),
          };
        } catch (error) {
          return {
            ...base,
            note: error instanceof Error
              ? `Folder summary unavailable: ${error.message}`
              : "Folder summary unavailable.",
          };
        }
      }),
    );
    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.path));
      return [
        ...current,
        ...folderAttachments.filter((attachment) => !existing.has(attachment.path)),
      ];
    });
    setToolsOpen(false);
  }

  function removeAttachment(id: string): void {
    setAttachments((current) => current.filter((item) => item.id !== id));
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
          const visibleAnswer =
            message.role === "assistant"
              ? getAssistantVisibleAnswer(message.content, message.reasoningContent)
              : message.content;
          const reasoningText =
            message.role === "assistant"
              ? mergeReasoningText(message.reasoningContent, getReasoningChatText(message.content))
              : "";
          const toolTimeline =
            message.role === "assistant"
              ? sanitizeChatToolTimelineEvents(message.toolTimeline)
              : [];
          return (
          <article
            key={message.id}
            className={`message ${message.role} ${message.error ? "error" : ""} ${searchMatches.includes(message.id) ? "search-match" : ""} ${activeMatchId === message.id ? "search-active" : ""}`}
            data-message-id={message.id}
          >
            <strong className="message-author">{message.role === "user" ? "You" : "OpenDrSai"}</strong>
            <div className="message-body">
              {reasoningText ? (
                <CollapsibleReasoning
                  content={reasoningText}
                  streaming={Boolean(message.streaming)}
                  language={language}
                  onOpenLink={handleMarkdownLink}
                />
              ) : null}
              {message.role === "user" && message.attachments?.length ? (
                <div className="message-attachment-badges" aria-label={zh ? "附件" : "Attachments"}>
                  {message.attachments.map((attachment, index) => (
                    <span
                      className="message-attachment-badge"
                      key={`${message.id}-attachment-${index}-${attachment.path}`}
                      title={attachment.path}
                    >
                      {renderAttachmentCardIcon(attachment.kind)}
                      <span>{attachment.name}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {message.content && message.role === "user" ? (
                <p>{highlightPlainText(message.content, searchQuery)}</p>
              ) : visibleAnswer ? (
                <ChatMessageContent
                  content={visibleAnswer}
                  streaming={message.streaming}
                  language={language}
                  onOpenLink={handleMarkdownLink}
                />
              ) : message.role === "user" && message.attachments?.length ? null : (
                <StreamingStatus message={message} now={now} zh={zh} />
              )}
              {message.statusContent && isUserVisibleChatStatus(message.statusContent) && (
                <div className="message-status">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.statusContent}
                  </ReactMarkdown>
                </div>
              )}
              {toolTimeline.length ? (
                <ToolTimeline events={toolTimeline} />
              ) : null}
              {message.role === "assistant" && !message.streaming && visibleAnswer ? (
                <MessageActions content={visibleAnswer} zh={zh} />
              ) : null}
            </div>
          </article>
          );
        })}
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
          {hasAttachmentPreview && (
            <div className="composer-attachment-preview" aria-live="polite">
              {attachments.map((attachment) => (
                <article
                  className="composer-attachment-card"
                  key={attachment.id}
                  title={attachment.path}
                >
                  {renderAttachmentCardIcon(attachment.kind)}
                  <div className="composer-attachment-card-body">
                    <strong>{attachment.name}</strong>
                    <span>{getAttachmentCardSubtitle(attachment, zh)}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={zh ? `移除 ${attachment.name}` : `Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X size={13} />
                  </button>
                </article>
              ))}
              {externalAttachments.map((attachment, index) => {
                if (attachment.kind === "terminal") return null;
                const name =
                  attachment.title ||
                  attachment.name ||
                  attachment.url ||
                  (zh ? "浏览器上下文" : "Browser context");
                return (
                  <article
                    className="composer-attachment-card"
                    key={`external-attachment-${index}-${attachment.path}`}
                    title={attachment.path}
                  >
                    {renderAttachmentCardIcon(attachment.kind)}
                    <div className="composer-attachment-card-body">
                      <strong>{name}</strong>
                      <span>{getAttachmentCardSubtitle(attachment, zh)}</span>
                    </div>
                    <button
                      type="button"
                      aria-label={zh ? `移除 ${name}` : `Remove ${name}`}
                      onClick={() => onRemoveExternalAttachment?.(index)}
                    >
                      <X size={13} />
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {showContextPreview && (
            <section className="context-assembly-preview" aria-label="Context assembly preview">
              <div className="context-assembly-preview-header">
                <strong>
                  <Info size={13} />
                  {zh ? "上下文预览" : "Context preview"}
                </strong>
                <span
                  className={`context-budget-meter ${contextBudget.level}`}
                  title={`Estimated prompt context budget: ${contextBudget.estimatedTokens} / ${contextBudget.limit} tokens. Raw estimate ${contextBudget.rawEstimatedTokens} tokens. ${contextBudget.source}. ${contextBudget.calibrationSource ?? "No tokenizer calibration samples."} ${contextBudget.calibrationDrift ?? ""} ${contextBudget.reservedOutputTokens} tokens reserved for output.`}
                >
                  {contextPreviewItems.length}{" "}
                  {zh
                    ? `个可见来源 · ${formatApproxTokens(contextBudget.estimatedTokens, zh)}`
                    : `visible source${contextPreviewItems.length === 1 ? "" : "s"} · ${formatApproxTokens(contextBudget.estimatedTokens, zh)}`}
                  <small>{contextBudget.calibrationSource ?? contextBudget.source}</small>
                  {contextBudget.calibrationDrift ? <small>{contextBudget.calibrationDrift}</small> : null}
                </span>
              </div>
              <div className="context-assembly-preview-list">
                {contextPreviewItems.map((item) => (
                  <span className="context-assembly-preview-item" key={item.key} title={item.detail}>
                    <b>{getContextKindLabelLocalized(item.kind, zh)}</b>
                    {item.label}
                    <small>{formatApproxTokens(item.estimatedTokens, zh)}</small>
                  </span>
                ))}
              </div>
              <p>
                {getContextBudgetMessage(contextBudget, zh)}{" "}
                {zh
                  ? "发送时将仅包含这些可见来源与工作区指令。"
                  : "Only these visible sources and workspace instructions are sent with the next message."}
              </p>
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
                          {entry.agentHint ? `Use @${entry.agentHint}` : `Default: ${activeAgentName}`}
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
                    <button type="button" onClick={() => void addFiles()}>
                      <Paperclip size={15} />
                      {zh ? "添加文件" : "Add File"}
                    </button>
                    <button type="button" onClick={() => void addFolder()}>
                      <FolderPlus size={15} />
                      {zh ? "添加文件夹" : "Add Folder"}
                    </button>
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={
                  canChat
                    ? zh ? "向 OpenDrSai 提问..." : "Ask OpenDrSai..."
                    : zh ? "正在连接本地网关..." : "Preparing the local agent runtime..."
                }
                rows={1}
              />

            </div>

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
                  Agent: {activeAgentName}
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
                {showStop ? (
                  <button className="composer-submit stop" type="button" onClick={onAbort}>
                    <Square size={16} />
                    {zh ? "停止" : "Stop"}
                  </button>
                ) : (
                  <button className="composer-submit" type="submit" disabled={!canSubmit}>
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

function CollapsibleReasoning({
  content,
  streaming,
  language,
  onOpenLink,
}: {
  content: string;
  streaming: boolean;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const zh = language === "zh";
  const title = streaming
    ? zh ? "正在思考…" : "Thinking…"
    : zh ? "思考过程" : "Reasoning";
  const expanded = streaming || open;
  return (
    <details
      className="chat-reasoning chat-event-reasoning"
      open={expanded}
      onToggle={(event) => {
        if (!streaming) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
      </summary>
      <div className="chat-reasoning-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <button className="markdown-link" type="button" onClick={() => onOpenLink(href)}>
                {children}
              </button>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </details>
  );
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
    ? zh ? "正在连接本地网关..." : "Connecting to the local gateway..."
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

function ToolTimeline({ events }: { events: ChatToolTimelineEvent[] }): React.JSX.Element {
  return (
    <div className="message-tool-timeline" aria-label="Tool timeline">
      {events.slice(-8).map((event) => <ToolTimelineItem event={event} key={event.id} />)}
    </div>
  );
}

function MessageActions({ content, zh }: { content: string; zh: boolean }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  async function handleCopy(): Promise<void> {
    if (!content.trim()) return;
    try {
      await copyTextReliable(content);
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

function ToolTimelineItem({ event }: { event: ChatToolTimelineEvent }): React.JSX.Element {
  return (
    <div className="message-tool-event compact">
      <span>{event.status === "failed" ? "失败" : "完成"}</span>
      <strong>{event.title}</strong>
      {event.toolName ? <code>{event.toolName}</code> : null}
    </div>
  );
}

function ToolDiffContent({ value }: { value: string }): React.JSX.Element {
  return (
    <pre className="chat-diff">
      {value.split("\n").map((line, index) => {
        const kind = line.startsWith("+") && !line.startsWith("+++") ? "add"
          : line.startsWith("-") && !line.startsWith("---") ? "remove"
            : line.startsWith("@@") ? "hunk" : "context";
        return <span className={`chat-diff-line ${kind}`} key={`${index}-${line}`}>{line || " "}</span>;
      })}
    </pre>
  );
}

function CopyTimelineContent({ value }: { value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  async function handleCopy(): Promise<void> {
    if (!value) return;
    try {
      await copyTextReliable(value);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return <button type="button" className="tool-copy-button" onClick={() => void handleCopy()}>{copied ? "Copied" : "Copy output"}</button>;
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

function formatApproxTokens(tokens: number, zh = false): string {
  if (tokens >= 1000) {
    const value = (tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1);
    return zh ? `约 ${value}k tokens` : `~${value}k tokens`;
  }
  return zh ? `约 ${tokens} tokens` : `~${tokens} tokens`;
}

function getContextKindLabelLocalized(kind: string, zh: boolean): string {
  if (!zh) return kind;
  const labels: Record<string, string> = {
    Browser: "浏览器",
    File: "文件",
    Folder: "文件夹",
    Selection: "选区",
    Terminal: "终端",
    Instruction: "指令",
  };
  return labels[kind] ?? kind;
}

function getContextBudgetMessage(budget: ContextBudgetEstimate, zh: boolean): string {
  if (zh) {
    const source = budget.source.startsWith("Fallback budget")
      ? `备用预算 ${formatApproxTokens(CONTEXT_TOKEN_BUDGET, true)}`
      : budget.source.replace(/^Model limit /, "模型上限 ");
    if (budget.level === "over") {
      return `上下文估算已超过 ${source.toLowerCase()}（已扣除输出预留），请先移除较大的来源再发送。`;
    }
    if (budget.level === "high") {
      return `上下文估算已接近 ${source.toLowerCase()}（已扣除输出预留）。`;
    }
    return `上下文估算在 ${source.toLowerCase()}（已扣除输出预留）范围内。`;
  }
  return budget.message;
}

function renderAttachmentCardIcon(kind: ChatAttachment["kind"]): ReactElement {
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
  return <Icon size={15} aria-hidden="true" />;
}

function getAttachmentCardSubtitle(
  attachment: ChatAttachment & { sizeBytes?: number },
  zh: boolean,
): string {
  if (attachment.blockedReason) return attachment.blockedReason;
  if (typeof attachment.sizeBytes === "number") {
    return formatBytes(attachment.sizeBytes);
  }
  if (attachment.note) return attachment.note;
  if (attachment.kind === "folder") {
    return zh ? "文件夹摘要" : "Folder summary";
  }
  return zh ? "本地文件" : "Local file";
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
