import { useEffect, useRef, useState } from "react";
import type { ChatAttachment, ChatEvent, ChatMessage, WorkspaceInstructionSummary } from "@shared/desktopApi";
import type { UiMessage } from "../components/ChatWorkspace";
import { desktopApi } from "../desktopApi";

export interface DesktopChatAdapter {
  activeRequestId: string | null;
  input: string;
  messages: UiMessage[];
  setInput: (value: string) => void;
  submit: (attachments?: ChatAttachment[]) => Promise<boolean>;
  abort: () => Promise<void>;
}

export interface ChatThreadSnapshot {
  threadId: string;
  title: string;
  messages: UiMessage[];
  updatedAt: number;
  messageCount: number;
}

export function useDesktopChatAdapter({
  canChat,
  language,
  onChatComplete,
  onThreadUpdated,
  threadId,
  threadSnapshot,
  workspaceInstructions,
  workspacePath,
}: {
  canChat: boolean;
  language: "en" | "zh";
  onChatComplete: () => void;
  onThreadUpdated?: (snapshot: ChatThreadSnapshot) => void;
  threadId: string;
  threadSnapshot?: ChatThreadSnapshot | null;
  workspaceInstructions?: WorkspaceInstructionSummary[];
  workspacePath?: string;
}): DesktopChatAdapter {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([createWelcomeMessage(language)]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const streamingAssistantByRequest = useRef<Record<string, string>>({});
  const threadIdRef = useRef(threadId);
  const languageRef = useRef(language);

  useEffect(() => {
    threadIdRef.current = threadId;
    languageRef.current = language;
    streamingAssistantByRequest.current = {};
    setActiveRequestId(null);
    setInput("");
    setMessages(threadSnapshot?.messages?.length ? threadSnapshot.messages : [createWelcomeMessage(language)]);
  }, [language, threadId]);

  useEffect(() => {
    return desktopApi.onChatEvent((event) => {
      applyChatEvent(event);
    });
  }, []);

  async function submit(attachments: ChatAttachment[] = []): Promise<boolean> {
    const text = input.trim();
    if (!text || activeRequestId || !canChat) return false;

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
      const requestMessages = buildRequestMessages(
        [...messages, userMessage]
          .filter((message) => !message.error)
          .map(({ role, content }) => ({ role, content })),
        workspaceInstructions,
      );
      await desktopApi.startChat({
        requestId,
        sessionId: threadIdRef.current,
        runId: requestId,
        workspacePath,
        attachments,
        metadata: {
          workspace_instructions: workspaceInstructions || [],
        },
        messages: requestMessages,
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
            ? { ...item, streaming: false, error: true, content: message }
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

  function applyChatEvent(event: ChatEvent): void {
    if (event.sessionId && event.sessionId !== threadIdRef.current) return;
    if (event.type === "start") {
      touchStreamingAssistant(event.requestId);
      setActiveRequestId(event.requestId);
      return;
    }
    if (event.type === "chunk") {
      setMessages((current) =>
        publishAndReturn(
          appendAssistantChunk(
            current,
            streamingAssistantByRequest.current[event.requestId],
            event.content ?? "",
          ),
        ),
      );
      return;
    }
    if (event.type === "done" || event.type === "aborted") {
      const assistantId = streamingAssistantByRequest.current[event.requestId];
      setMessages((current) =>
        publishAndReturn(
          updateAssistantByIdOrLatestStreaming(current, assistantId, (message) => ({
            ...message,
            streaming: false,
          })),
        ),
      );
      delete streamingAssistantByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
      onChatComplete();
      return;
    }
    if (event.type === "error") {
      const assistantId = streamingAssistantByRequest.current[event.requestId];
      setMessages((current) =>
        publishAndReturn(
          updateAssistantByIdOrLatestStreaming(current, assistantId, (message) => ({
            ...message,
            streaming: false,
            error: true,
            content: event.error || (languageRef.current === "zh" ? "聊天失败。" : "Chat failed."),
          })),
        ),
      );
      delete streamingAssistantByRequest.current[event.requestId];
      setActiveRequestId((current) => (current === event.requestId ? null : current));
    }
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

  return {
    activeRequestId,
    input,
    messages,
    setInput,
    submit,
    abort,
  };
}

function buildRequestMessages(
  messages: ChatMessage[],
  workspaceInstructions: WorkspaceInstructionSummary[] | undefined,
): ChatMessage[] {
  if (!workspaceInstructions?.length) return messages;
  const content = [
    "Workspace instructions for this project:",
    ...workspaceInstructions.map((instruction) =>
      `# ${instruction.name}\n${instruction.content}${instruction.truncated ? "\n[truncated]" : ""}`,
    ),
  ].join("\n\n");
  return [{ role: "system", content }, ...messages];
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
  next[index].lastEventAt = Date.now();
  return next;
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
