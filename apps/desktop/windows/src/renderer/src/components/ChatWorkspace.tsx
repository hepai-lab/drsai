import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Brain,
  ChevronDown,
  FilePlus,
  FolderPlus,
  Paperclip,
  Plus,
  Search,
  Send,
  Square,
  X,
} from "lucide-react";
import type { ChatMessage, DesktopHealth } from "@shared/desktopApi";
import type { ChatAttachment } from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi } from "../desktopApi";

export type UiMessage = ChatMessage & {
  id: string;
  streaming?: boolean;
  error?: boolean;
  startedAt?: number;
  lastEventAt?: number;
};

type ComposerAttachment = ChatAttachment & {
  id: string;
};

interface ChatWorkspaceProps {
  activeRequestId: string | null;
  canChat: boolean;
  health: DesktopHealth | null;
  input: string;
  language: AppLanguage;
  messages: UiMessage[];
  searchRequestNonce?: number;
  onAbort: () => void;
  onInputChange: (value: string) => void;
  onOpenExternal: (url: string) => void;
  onSubmit: (attachments?: ChatAttachment[]) => Promise<boolean>;
}

export function ChatWorkspace({
  activeRequestId,
  canChat,
  health,
  input,
  language,
  messages,
  searchRequestNonce = 0,
  onAbort,
  onInputChange,
  onOpenExternal,
  onSubmit,
}: ChatWorkspaceProps): React.JSX.Element {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const zh = language === "zh";
  const [now, setNow] = useState(Date.now());
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const showStop = Boolean(activeRequestId || hasStreamingMessage);

  const searchableMessages = useMemo(
    () => messages.filter((message) => message.content.trim()),
    [messages],
  );

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchableMessages
      .filter((message) => message.content.toLowerCase().includes(query))
      .map((message) => message.id);
  }, [searchQuery, searchableMessages]);

  const activeMatchId =
    searchMatches.length > 0
      ? searchMatches[activeMatchIndex % searchMatches.length]
      : null;

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

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
    if (!messages.some((message) => message.streaming && !message.content.trim())) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [messages]);

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

  async function submitWithAttachments(): Promise<void> {
    const submitted = await onSubmit(attachments.map(({ kind, path, name }) => ({ kind, path, name })));
    if (submitted) {
      setAttachments([]);
    }
  }

  function clearInput(): void {
    onInputChange("");
    textareaRef.current?.focus();
  }

  async function addFiles(): Promise<void> {
    const result = await desktopApi.pickFiles();
    if (!result.canceled) addAttachments("file", result.paths);
  }

  async function addFolder(): Promise<void> {
    const result = await desktopApi.pickFolder();
    if (!result.canceled) addAttachments("folder", result.paths);
  }

  function addAttachments(kind: ComposerAttachment["kind"], paths: string[]): void {
    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.path));
      const next = paths
        .filter((path) => !existing.has(path))
        .map((path) => ({
          id: crypto.randomUUID(),
          kind,
          path,
          name: getPathName(path),
        }));
      return [...current, ...next];
    });
    setToolsOpen(false);
  }

  function removeAttachment(id: string): void {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  const gatewayLabel = health?.gateway.externalConflict
    ? zh ? "网关冲突" : "Gateway conflict"
    : health?.gatewayReady
      ? zh ? "网关就绪" : "Gateway ready"
      : zh ? "网关启动中" : "Gateway starting";
  const keyLabel = health?.install.apiKeyConfigured
    ? zh ? "API Key 已配置" : "API key configured"
    : zh ? "API Key 缺失" : "API key missing";

  return (
    <div className="chat-workspace">
      {searchOpen && (
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
                : zh ? "无结果" : "No results"
              : zh ? "输入关键词" : "Type to search"}
          </span>
          <button
            type="button"
            className="chat-search-step previous"
            disabled={searchMatches.length === 0}
            onClick={selectPreviousMatch}
            title={zh ? "上一处匹配" : "Previous match"}
            aria-label={zh ? "上一处匹配" : "Previous match"}
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="chat-search-step"
            disabled={searchMatches.length === 0}
            onClick={selectNextMatch}
            title={zh ? "下一处匹配" : "Next match"}
            aria-label={zh ? "下一处匹配" : "Next match"}
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
      )}
      <div className="message-list">
        {messages.map((message) => (
          <article
            key={message.id}
            className={`message ${message.role} ${message.error ? "error" : ""} ${searchMatches.includes(message.id) ? "search-match" : ""} ${activeMatchId === message.id ? "search-active" : ""}`}
            data-message-id={message.id}
          >
            <strong>{message.role === "user" ? (zh ? "你" : "You") : "OpenDrSai"}</strong>
            <div className="message-body">
              {message.content && message.role === "user" ? (
                <p>{highlightPlainText(message.content, searchQuery)}</p>
              ) : message.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <button
                        className="markdown-link"
                        type="button"
                        onClick={() => href && onOpenExternal(href)}
                      >
                        {children}
                      </button>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                <StreamingStatus message={message} now={now} zh={zh} />
              )}
            </div>
          </article>
        ))}
      </div>
      <form className="composer" onSubmit={handleSubmit}>
        <div className="composer-shell">
          <div className="composer-attachments" aria-live="polite">
            {attachments.map((attachment) => {
              const Icon = attachment.kind === "folder" ? FolderPlus : Paperclip;
              return (
                <span className="composer-attachment-chip" key={attachment.id} title={attachment.path}>
                  <Icon size={14} />
                  {attachment.name}
                  <button
                    type="button"
                    aria-label={zh ? `移除 ${attachment.name}` : `Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X size={13} />
                  </button>
                </span>
              );
            })}
          </div>

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
                    <button type="button" onClick={addFiles}>
                      <Paperclip size={15} />
                      {zh ? "添加文件" : "Add File"}
                    </button>
                    <button type="button" onClick={addFolder}>
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
                placeholder={
                  canChat
                    ? zh ? "向 OpenDrSai 提问..." : "Ask OpenDrSai..."
                    : zh ? "正在准备本地智能体运行时..." : "Preparing the local agent runtime..."
                }
                rows={1}
              />

              <div className="composer-actions">
                {input.trim() && !showStop ? (
                  <button
                    type="button"
                    className="composer-icon-button"
                    onClick={clearInput}
                    aria-label={zh ? "清空输入" : "Clear input"}
                    title={zh ? "清空" : "Clear"}
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
                  <button className="composer-submit" type="submit" disabled={!input.trim() || !canChat}>
                    <Send size={16} />
                    {zh ? "发送" : "Send"}
                  </button>
                )}
              </div>
            </div>

            <div className="composer-meta-bar">
              <span>
                <Brain size={14} />
                {zh ? "模型：默认" : "Model: Default"}
                <ChevronDown size={13} />
              </span>
              <span>
                <FilePlus size={14} />
                {gatewayLabel}
              </span>
              <span>{keyLabel}</span>
            </div>
          </div>
        </div>
      </form>
    </div>
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
    return <p>{zh ? "暂无回复内容。" : "No response content."}</p>;
  }

  const startedAt = message.startedAt ?? now;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const lastEventAt = message.lastEventAt ?? startedAt;
  const idleSeconds = Math.max(0, Math.floor((now - lastEventAt) / 1000));
  const detail = elapsedSeconds < 3
    ? zh ? "正在连接本地网关..." : "Connecting to the local gateway..."
    : idleSeconds >= 10
      ? zh ? `已等待 ${elapsedSeconds} 秒，仍在等待模型输出。` : `Waiting ${elapsedSeconds}s for model output.`
      : zh ? `正在思考，已等待 ${elapsedSeconds} 秒。` : `Thinking for ${elapsedSeconds}s.`;

  return (
    <p className="streaming-status" aria-live="polite">
      <span className="streaming-dot" aria-hidden />
      {detail}
    </p>
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
