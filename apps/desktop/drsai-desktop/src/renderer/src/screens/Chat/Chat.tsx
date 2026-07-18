import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatHeader } from "./ChatHeader";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatIPC } from "./hooks/useChatIPC";
import { useChatActions } from "./hooks/useChatActions";
import { useModelConfig } from "./hooks/useModelConfig";
import { useFastMode } from "./hooks/useFastMode";
import { useLocalCommands } from "./hooks/useLocalCommands";
import type { ChatMessage, UsageState } from "./types";

export type { ChatMessage } from "./types";

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  profile,
  onSessionStarted,
  onNewChat,
}: ChatProps): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [drsaiSessionId, setDrsaiSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const chatInputRef = useRef<ChatInputHandle>(null);

  const { containerRef, bottomRef } = useChatScroll(messages);
  const modelConfig = useModelConfig(profile);
  const {
    fastMode,
    toggle: toggleFastMode,
    set: setFastTier,
  } = useFastMode(profile);

  useChatIPC({
    setMessages,
    setDrsaiSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
  });

  // Reset DrSai session when the parent clears messages (new chat).
  // Effect-driven sync because `messages` is owned by the parent; a key-based
  // remount would discard unrelated local state (model picker, etc.).
  useEffect(() => {
    if (messages.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrsaiSessionId(null);
    }
  }, [messages]);

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter(
        (m) =>
          (m.role === "user" || m.role === "agent") &&
          (m.content || "").toLowerCase().includes(q),
      )
      .map((m) => m.id);
  }, [messages, searchQuery]);

  const activeMatchId =
    searchMatches.length > 0
      ? searchMatches[activeMatchIndex % searchMatches.length]
      : null;

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!activeMatchId) return;
    const node = document.querySelector(
      `[data-message-id="${activeMatchId}"]`,
    );
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchId]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
  }, []);

  const selectNextMatch = useCallback(() => {
    setActiveMatchIndex((i) =>
      searchMatches.length > 0 ? (i + 1) % searchMatches.length : 0,
    );
  }, [searchMatches.length]);

  const selectPreviousMatch = useCallback(() => {
    setActiveMatchIndex((i) =>
      searchMatches.length > 0
        ? (i - 1 + searchMatches.length) % searchMatches.length
        : 0,
    );
  }, [searchMatches.length]);

  // Cmd/Ctrl+N —new chat
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        onNewChat?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewChat, openSearch]);

  const addAgentMessage = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `agent-local-${Date.now()}`, role: "agent", content },
      ]);
    },
    [setMessages],
  );

  const handleClear = useCallback(() => {
    if (isLoading) {
      window.drsaiAPI.abortChat();
      setIsLoading(false);
    }
    setMessages([]);
    setDrsaiSessionId(null);
    setUsage(null);
    setToolProgress(null);
  }, [isLoading, setMessages]);

  const localCommands = useLocalCommands({
    profile,
    usage,
    setFastMode: setFastTier,
    onNewChat,
    onClear: handleClear,
    addAgentMessage,
  });

  const actions = useChatActions({
    profile,
    drsaiSessionId,
    messages,
    isLoading,
    setIsLoading,
    setMessages,
    onSessionStarted,
    chatInputRef,
    localCommands,
  });

  const handleSuggestion = useCallback((text: string) => {
    chatInputRef.current?.setText(text);
  }, []);

  return (
    <div className="chat-container">
      <ChatHeader
        sessionId={sessionId}
        usage={usage}
        fastMode={fastMode}
        hasMessages={messages.length > 0}
        onToggleFast={toggleFastMode}
        onNewChat={onNewChat}
        onOpenSearch={openSearch}
        onClear={handleClear}
      />

      {searchOpen && (
        <ChatSearchBar
          query={searchQuery}
          current={
            searchMatches.length > 0
              ? (activeMatchIndex % searchMatches.length) + 1
              : 0
          }
          total={searchMatches.length}
          onQueryChange={setSearchQuery}
          onNext={selectNextMatch}
          onPrevious={selectPreviousMatch}
          onClose={closeSearch}
        />
      )}

      <div className="chat-messages" ref={containerRef}>
        {messages.length === 0 ? (
          <ChatEmptyState onSelectSuggestion={handleSuggestion} />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            toolProgress={toolProgress}
            searchQuery={searchQuery}
            matchingMessageIds={searchMatches}
            activeMatchId={activeMatchId}
            onApprove={actions.handleApprove}
            onDeny={actions.handleDeny}
          />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <ChatInput
          ref={chatInputRef}
          isLoading={isLoading}
          hasSession={!!drsaiSessionId}
          onSubmit={actions.handleSend}
          onQuickAsk={actions.handleQuickAsk}
          onAbort={actions.handleAbort}
        />
        <ModelPicker
          currentModel={modelConfig.currentModel}
          currentProvider={modelConfig.currentProvider}
          currentBaseUrl={modelConfig.currentBaseUrl}
          modelGroups={modelConfig.modelGroups}
          displayModel={modelConfig.displayModel}
          onOpen={modelConfig.reload}
          onSelectModel={modelConfig.selectModel}
        />
      </div>
    </div>
  );
}

export default Chat;
