import { useCallback, useEffect, useRef } from "react";
import type { ChatInputHandle } from "../ChatInput";
import type { ChatMessage } from "../types";

interface LocalCommands {
  isLocal: (text: string) => boolean;
  executeLocal: (text: string) => Promise<boolean>;
}

interface UseChatActionsArgs {
  profile?: string;
  hermesSessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onSessionStarted?: () => void;
  chatInputRef: React.RefObject<ChatInputHandle | null>;
  localCommands: LocalCommands;
}

interface UseChatActionsResult {
  handleSend: (text: string) => Promise<void>;
  handleQuickAsk: (text: string) => Promise<void>;
  handleAbort: () => void;
  handleApprove: () => void;
  handleDeny: () => void;
}

/**
 * Encapsulates the chat's user-facing actions (send, quick-ask, abort,
 * approve, deny). All returned callbacks have stable identities so that
 * memoized children don't re-render on every streaming chunk — `messages`
 * and `isLoading` are read via live refs that update via `useEffect`.
 */
export function useChatActions({
  profile,
  hermesSessionId,
  messages,
  isLoading,
  setIsLoading,
  setMessages,
  onSessionStarted,
  chatInputRef,
  localCommands,
}: UseChatActionsArgs): UseChatActionsResult {
  const messagesRef = useRef(messages);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    messagesRef.current = messages;
    isLoadingRef.current = isLoading;
  });

  const pushUser = useCallback(
    (content: string, idPrefix = "user") => {
      setMessages((prev) => [
        ...prev,
        { id: `${idPrefix}-${Date.now()}`, role: "user", content },
      ]);
    },
    [setMessages],
  );

  const sendToAgent = useCallback(
    async (text: string): Promise<void> => {
      try {
        await window.hermesAPI.sendMessage(
          text,
          profile,
          hermesSessionId || undefined,
          messagesRef.current.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        );
      } catch {
        // onChatError IPC already surfaces this to the user
      }
    },
    [profile, hermesSessionId],
  );

  const handleSend = useCallback(
    async (text: string): Promise<void> => {
      if (!text || isLoadingRef.current) return;

      if (localCommands.isLocal(text)) {
        const cmd = text.split(/\s+/)[0].toLowerCase();
        if (cmd !== "/new" && cmd !== "/clear") pushUser(text);
        await localCommands.executeLocal(text);
        return;
      }

      setIsLoading(true);
      pushUser(text);
      onSessionStarted?.();
      await sendToAgent(text);
    },
    [localCommands, pushUser, onSessionStarted, sendToAgent, setIsLoading],
  );

  const handleQuickAsk = useCallback(
    async (text: string): Promise<void> => {
      if (!text || isLoadingRef.current) return;
      setIsLoading(true);
      pushUser(`💭 ${text}`, "user-btw");
      await sendToAgent(`/btw ${text}`);
    },
    [pushUser, sendToAgent, setIsLoading],
  );

  const handleAbort = useCallback(() => {
    window.hermesAPI.abortChat();
    setIsLoading(false);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, [chatInputRef, setIsLoading]);

  const handleApprove = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    pushUser("/approve", "user-approve");
    sendToAgent("/approve").catch(() => setIsLoading(false));
  }, [chatInputRef, pushUser, sendToAgent, setIsLoading]);

  const handleDeny = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    pushUser("/deny", "user-deny");
    sendToAgent("/deny").catch(() => setIsLoading(false));
  }, [chatInputRef, pushUser, sendToAgent, setIsLoading]);

  return { handleSend, handleQuickAsk, handleAbort, handleApprove, handleDeny };
}
