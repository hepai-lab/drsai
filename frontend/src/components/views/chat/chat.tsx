import { message } from "antd";
import { RcFile } from "antd/es/upload";
import * as React from "react";
import { appContext } from "../../../hooks/provider";
import { useMessageCacheStore } from "../../../store/messageCache";
import { useSettingsStore } from "../../store";
import { IStatus } from "../../types/app";
import {
  RunStatus as BaseRunStatus,
  Run,
  RunLogEntry,
  Session,
  TeamConfig,
  WebSocketMessage,
} from "../../types/datamodel";
import { IPlan } from "../../types/plan";
import { sessionAPI } from "../api";
import { getAgentConfig } from "./config/agentConfigs";
import { useChatWebSocket } from "./hooks/useChatWebSocket";
import { usePlanManagement } from "./hooks/usePlanManagement";
import { useProgressTracking } from "./hooks/useProgressTracking";
import { useTaskActions } from "./hooks/useTaskActions";
import ProgressBar from "./progressbar";
import { messageUtils } from "./rendermessage";
import RunView from "./runview";
import WelcomeScreen from "./WelcomeScreen";

// Extend RunStatus for sidebar status reporting
type SidebarRunStatus = BaseRunStatus | "final_answer_awaiting_input";

const defaultTeamConfig: TeamConfig = {
  name: "Default Team",
  participants: [],
  team_type: "RoundRobinGroupChat",
  component_type: "team",
};

interface ChatViewProps {
  session: Session | null;
  onSessionNameChange: (sessionData: Partial<Session>) => void;
  getSessionSocket: (
    sessionId: number,
    runId: string,
    fresh_socket: boolean,
    only_retrieve_existing_socket: boolean
  ) => WebSocket | null;
  visible?: boolean;
  onRunStatusChange: (sessionId: number, status: BaseRunStatus) => void;
  pendingFirstMessage?: {
    query: string;
    files: any[];
    plan?: any;
  } | null;
  onPendingMessageSent?: () => void;
}

export default function ChatView({
  session,
  onSessionNameChange,
  getSessionSocket,
  visible = true,
  onRunStatusChange,
  pendingFirstMessage,
  onPendingMessageSent,
}: ChatViewProps) {
  // Context and store
  const settingsConfig = useSettingsStore((state) => state.config);
  const { user } = React.useContext(appContext);
  const setSessionRunCache = useMessageCacheStore((state) => state.setSessionRun);
  const getSessionRunCache = useMessageCacheStore((state) => state.getSessionRun);

  // Local state
  const [error, setError] = React.useState<IStatus | null>({
    status: true,
    message: "All good",
  });
  const [currentRun, setCurrentRun] = React.useState<Run | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [noMessagesYet, setNoMessagesYet] = React.useState(true);
  const chatContainerRef = React.useRef<HTMLDivElement | null>(null);
  const pendingMessageSentRef = React.useRef(false);

  // TODO: 根据当前run的task的metadata或session的agent_mode_config来确定agent类型
  // Panel state - initialized based on agent configuration
  // Dynamically detect agent type from session or current run
  const agentType = React.useMemo(() => {
    // 如果组件不可见，返回默认值，避免不必要的计算
    if (!visible) {
      return 'besiii';
    }

    // 根据 session 的 agent_mode_config 判断 agent 类型
    if (session?.agent_mode_config?.mode === 'magentic-one') {
      return 'magentic-one';
    } else if (session?.agent_mode_config?.mode === 'besiii') {
      return 'besiii';
    } else {
      // 默认返回 besiii（如果 session 为空或没有配置）
      return 'besiii';
    }
  }, [visible, session]);

  const agentConfig = React.useMemo(() => getAgentConfig(agentType), [agentType]);

  const [isPanelMinimized, setIsPanelMinimized] = React.useState(
    agentConfig.panel.defaultMinimized
  );
  const [showPanel, setShowPanel] = React.useState(
    agentConfig.panel.type !== 'none'
  );

  const [teamConfig, setTeamConfig] = React.useState<TeamConfig | null>(defaultTeamConfig);

  // ChatInput ref
  const chatInputRef = React.useRef<{
    focus: () => void;
    setValue: (value: string) => void;
  }>(null);

  // Custom hooks
  const {
    activeSocket,
    activeSocketRef,
    setupWebSocket,
    ensureWebSocketConnection,
    inputTimeoutRef,
  } = useChatWebSocket({
    session,
    getSessionSocket,
    setCurrentRun,
    setSessionRun: setSessionRunCache,
    userEmail: user?.email,
  });

  const {
    localPlan,
    planProcessed,
    updatedPlan,
    setLocalPlan,
    setPlanProcessed,
    processPlan,
    handleExecutePlan,
    handlePlanUpdate,
  } = usePlanManagement({
    session,
    currentRun,
    settingsConfig,
    teamConfig,
    setupWebSocket,
    activeSocketRef,
    setNoMessagesYet,
  });

  const { progress, isPlanning, hasFinalAnswer } = useProgressTracking(currentRun);

  // 添加滚动到指定 step 的函数
  const scrollToStep = React.useCallback((stepIndex: number) => {
    // 查找对应的 step execution 元素
    const selector = `#step-execution-${stepIndex}`;
    const stepElement = document.querySelector(selector) as HTMLElement;

    if (!stepElement) {
      console.warn(`[scrollToStep] Step element not found for index ${stepIndex}`);
      return;
    }

    // 查找实际的滚动容器 - 向上查找父元素，找到有 overflow-y-auto 或 scroll 类的元素
    let scrollContainer: HTMLElement | null = stepElement.parentElement;
    while (scrollContainer) {
      const style = window.getComputedStyle(scrollContainer);
      const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll' ||
        scrollContainer.classList.contains('scroll') ||
        scrollContainer.classList.contains('overflow-y-auto');

      if (hasOverflow || scrollContainer.scrollHeight > scrollContainer.clientHeight) {
        break;
      }

      scrollContainer = scrollContainer.parentElement;
    }

    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = stepElement.getBoundingClientRect();

      // 计算滚动位置：元素相对于容器的位置，居中显示
      const scrollTop =
        scrollContainer.scrollTop +
        elementRect.top -
        containerRect.top -
        containerRect.height / 2 +
        elementRect.height / 2;

      scrollContainer.scrollTo({
        top: Math.max(0, scrollTop), // 确保不为负数
        behavior: "smooth",
      });
    } else {
      // 如果找不到滚动容器，使用标准的 scrollIntoView
      stepElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, []);

  const {
    handleInputResponse,
    handleRegeneratePlan,
    handleCancel,
    handlePause,
    runTask,
    handleApprove,
    handleDeny,
    handleAcceptPlan,
  } = useTaskActions({
    currentRun,
    session,
    teamConfig,
    settingsConfig,
    updatedPlan,
    userEmail: user?.email,
    activeSocketRef,
    inputTimeoutRef,
    setCurrentRun,
    setNoMessagesYet,
    setError,
    setupWebSocket,
    ensureWebSocketConnection,
    onSessionNameChange,
  });

  // 从 messages 中提取 FilesEvent 类型的消息
  const extractFileEventsFromMessages = React.useCallback((run: Run | null): any[] => {
    if (!run || !run.messages || !Array.isArray(run.messages)) {
      return [];
    }

    const fileEvents: any[] = [];

    run.messages.forEach((message: any) => {
      const config = message.config || {};
      const content = config.content as any;
      const rawTimestamp = config.send_time_stamp ?? content?.send_time_stamp ?? message.created_at;

      // 检查是否是 FilesEvent 类型：content 是对象且包含 files 数组
      if (
        content &&
        typeof content === 'object' &&
        !Array.isArray(content) &&
        content.files &&
        Array.isArray(content.files)
      ) {
        // 转换为 FilesEvent 格式
        const filesEvent: any = {
          source: config.source,
          models_usage: config.models_usage || null,
          metadata: config.metadata || {},
          content: {
            files: content.files,
            title: content.title,
            description: content.description,
            send_time_stamp:
              typeof rawTimestamp === "number"
                ? rawTimestamp
                : typeof rawTimestamp === "string"
                  ? Number(rawTimestamp) || Date.parse(rawTimestamp) / 1000
                  : undefined,
          },
          // 优先使用后端发送的 send_time_stamp；如果没有则回退到 message.created_at
          send_time_stamp:
            typeof rawTimestamp === "number"
              ? rawTimestamp
              : typeof rawTimestamp === "string"
                ? Number(rawTimestamp) || Date.parse(rawTimestamp) / 1000
                : undefined,
          type: config.type || 'FilesEvent',
        };
        fileEvents.push(filesEvent);
      }
    });

    return fileEvents;
  }, []);

  // 从 messages 中提取 AgentLogEvent 类型的消息并转换为 RunLogEntry
  const extractLogEventsFromMessages = React.useCallback((run: Run | null): RunLogEntry[] => {
    if (!run || !run.messages || !Array.isArray(run.messages)) {
      return [];
    }

    const logEntries: RunLogEntry[] = [];

    run.messages.forEach((message: any) => {
      const config = message.config || {};
      const messageAny = config as any;
      const rawTimestamp = config.send_time_stamp ?? message.created_at;

      // 检查是否是 AgentLogEvent 类型
      const isAgentLogEvent =
        messageAny.type === "AgentLogEvent" ||
        message.metadata?.type === "AgentLogEvent" ||
        messageAny.content_type === "log";

      if (isAgentLogEvent) {
        // 提取 content（参考 rendermessage.tsx 的处理方式）
        // content 可能在 messageAny.content 中（直接在 config 对象中）
        let contentValue: string = "";

        // 优先使用 messageAny.content（在 config 对象中）
        if (messageAny.content) {
          if (typeof messageAny.content === "string") {
            contentValue = messageAny.content;
          } else if (typeof messageAny.content === "object" && messageAny.content !== null) {
            // 如果是对象，尝试提取文本内容
            contentValue = messageAny.content.content ||
              messageAny.content.text ||
              JSON.stringify(messageAny.content);
          } else {
            contentValue = String(messageAny.content);
          }
        }
        // 回退到 message.content
        else if (message.content) {
          if (typeof message.content === "string") {
            contentValue = message.content;
          } else {
            contentValue = String(message.content);
          }
        }

        // 提取其他字段
        const logEntry: RunLogEntry = {
          content: contentValue,
          title: messageAny.title,
          source: messageAny.source || config.source,
          send_time_stamp:
            typeof rawTimestamp === "number"
              ? rawTimestamp
              : typeof rawTimestamp === "string"
                ? Number(rawTimestamp) || Date.parse(rawTimestamp) / 1000
                : undefined,
          send_level: messageAny.send_level,
          content_type: messageAny.content_type || "log",
        };

        logEntries.push(logEntry);
      }
    });

    return logEntries;
  }, []);

  const loadSessionRun = React.useCallback(async () => {
    if (!session?.id || !user?.email) return null;

    const applyExtractions = (run: Run): Run => {
      run.file_events = extractFileEventsFromMessages(run);
      const extractedLogs = extractLogEventsFromMessages(run);
      if (extractedLogs.length > 0) {
        if (run.logs && Array.isArray(run.logs)) {
          const existingLogs = run.logs.map(log =>
            typeof log === "string" ? { content: log } : log
          );
          const existingKeys = new Set(
            existingLogs.map(log => `${log.send_time_stamp}-${log.content}`)
          );
          const newLogs = extractedLogs.filter(log =>
            !existingKeys.has(`${log.send_time_stamp}-${log.content}`)
          );
          run.logs = [...existingLogs, ...newLogs];
        } else {
          run.logs = extractedLogs;
        }
      }
      return run;
    };

    try {
      // Prefer cache when it has more messages (streamed content preserved from before switch)
      const cachedRun = getSessionRunCache(session.id);
      const response = await sessionAPI.getSessionRuns(
        session.id,
        user?.email
      );
      let latestRun = response.runs[response.runs.length - 1];

      if (cachedRun && latestRun && cachedRun.id === latestRun.id) {
        if (cachedRun.messages.length >= latestRun.messages.length) {
          latestRun = { ...cachedRun };
        }
      }

      if (latestRun) {
        applyExtractions(latestRun);
      }

      return latestRun;
    } catch (error) {
      console.error("Error loading session runs:", error);
      messageApi.error("Failed to load chat history");
      return null;
    }
  }, [session?.id, user?.email, messageApi, getSessionRunCache, extractFileEventsFromMessages, extractLogEventsFromMessages]);


  React.useEffect(() => {
    const initializeSession = async () => {
      if (session?.id) {
        // When not visible, skip load to avoid overwriting streamed messages in currentRun
        if (!visible) return;

        // When switching back: we already have currentRun (preserved when we switched away),
        // don't overwrite with API data - just ensure WebSocket is connected for further chunks
        let skipLoad = false;
        setCurrentRun((prev) => {
          if (prev?.id) {
            setupWebSocket(prev.id, false, true);
            skipLoad = true;
            return prev;
          }
          return prev;
        });
        if (skipLoad) return;

        // Initial load: currentRun is null
        pendingMessageSentRef.current = false;
        setLocalPlan(null);
        setPlanProcessed(false);

        const latestRun = await loadSessionRun();

        if (latestRun) {
          setCurrentRun(latestRun);
          setNoMessagesYet(latestRun.messages.length === 0);

          if (latestRun.id) {
            setupWebSocket(latestRun.id, false, true);
          }
        } else {
          setError({
            status: false,
            message: "No run found",
          });
        }
      } else {
        setCurrentRun(null);
      }
    };

    initializeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, visible, loadSessionRun]);

  // Update noMessagesYet when messages change
  React.useEffect(() => {
    if (currentRun) {
      setNoMessagesYet(currentRun.messages.length === 0);
    }
  }, [currentRun?.messages?.length]);

  // Track previous status for sidebar updates
  const previousStatus = React.useRef<SidebarRunStatus | null>(null);

  // Add effect to update run status when currentRun changes
  React.useEffect(() => {
    if (currentRun && session?.id) {
      // Only call onRunStatusChange if the status has actually changed
      let statusToReport: SidebarRunStatus = currentRun.status;
      const lastMsg =
        currentRun.messages?.[currentRun.messages.length - 1];
      const beforeLastMsg =
        currentRun.messages?.[currentRun.messages.length - 2];
      if (
        lastMsg &&
        ((typeof lastMsg.config?.content === "string" &&
          messageUtils.isFinalAnswer(lastMsg.config?.metadata)) ||
          (beforeLastMsg &&
            typeof beforeLastMsg.config?.content === "string" &&
            messageUtils.isFinalAnswer(
              beforeLastMsg.config?.metadata
            ))) &&
        currentRun.status == "awaiting_input"
      ) {
        statusToReport = "final_answer_awaiting_input";
      }
      if (statusToReport !== previousStatus.current) {
        onRunStatusChange(session.id, statusToReport as BaseRunStatus);
        previousStatus.current = statusToReport; // Update the previous status
        // Clear error state when status changes
        setError(null);
      }
    }
  }, [
    currentRun?.status,
    currentRun?.messages,
    session?.id,
    onRunStatusChange,
  ]);

  // Handle pending first message - auto-send when run is ready
  React.useEffect(() => {
    if (
      !pendingFirstMessage ||
      !currentRun ||
      !noMessagesYet ||
      (currentRun.status !== "created" && currentRun.status !== "connected")
    ) {
      return;
    }
    // Guard: prevent duplicate sends (e.g. from Strict Mode or rapid effect runs)
    if (pendingMessageSentRef.current) {
      return;
    }
    pendingMessageSentRef.current = true;

    const { query, files, plan } = pendingFirstMessage;
    runTask(query, files as any[], plan, true);

    if (onPendingMessageSent) {
      onPendingMessageSent();
    }
  }, [
    pendingFirstMessage,
    currentRun,
    noMessagesYet,
    currentRun?.status,
    runTask,
    onPendingMessageSent,
  ]);

  // Scroll to bottom when a new message appears or message is updated
  React.useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [currentRun?.messages]);

  // Add effect to focus input when session changes
  React.useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [session?.id]); // Focus when session changes

  // Add this effect to handle WebSocket messages even when not visible
  React.useEffect(() => {
    if (session?.id && !visible && activeSocket) {
      // Keep the socket connection alive but still process status updates
      const messageHandler = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          if (
            message.type === "system" &&
            message.status &&
            session.id
          ) {
            // Update the run status even when not visible
            onRunStatusChange(
              session.id,
              message.status as BaseRunStatus
            );
          }
        } catch (error) {
          console.error("WebSocket message parsing error:", error);
        }
      };

      activeSocket.addEventListener("message", messageHandler);

      return () => {
        activeSocket.removeEventListener("message", messageHandler);
      };
    }
  }, [session?.id, visible, activeSocket, onRunStatusChange]);


  // Process plan when it becomes available
  React.useEffect(() => {
    if (localPlan && !planProcessed && visible && session?.id && currentRun) {
      if (localPlan.sessionId === session.id) {
        processPlan(localPlan);
      } else {
        setLocalPlan(null);
      }
    }
  }, [localPlan, planProcessed, visible, session?.id, currentRun, processPlan, setLocalPlan]);

  const lastMessage = currentRun?.messages.slice(-1)[0];
  const isPlanMessage =
    lastMessage && messageUtils.isPlanMessage(lastMessage.config.metadata);

  if (!visible) {
    return null;
  }

  return (
    <div className="text-primary h-full bg-primary relative flex-1 w-full overflow-hidden">
      {contextHolder}
      <div className="flex flex-col h-full w-full">
        {/* Progress Bar - Sticky at top */}
        <div
          className="progress-container w-full max-w-full overflow-hidden"
          style={{ height: "3.5rem" }}
        >
          <div
            className="transition-opacity duration-300"
            style={{
              opacity:
                currentRun?.status === "active" ||
                  currentRun?.status === "awaiting_input" ||
                  currentRun?.status === "paused" ||
                  currentRun?.status === "pausing"
                  ? 1
                  : 0,
            }}
          >
            <ProgressBar
              isPlanning={isPlanning}
              progress={progress}
              hasFinalAnswer={hasFinalAnswer}
              onStepClick={scrollToStep}
            />
          </div>
        </div>

        <div
          ref={chatContainerRef}
          className={`flex-1 overflow-y-auto scroll mt-1 min-h-0 relative w-full h-full ${noMessagesYet && currentRun
            ? "flex items-center justify-center"
            : ""
            }`}
        >
          <div
            className={`w-full max-w-sm sm:max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl [@media(min-width:1920px)]:max-w-[1200px] [@media(min-width:2560px)]:max-w-[1400px] mx-auto px-2 sm:px-3 md:px-4 h-full ${noMessagesYet && currentRun ? "hidden" : ""
              }`}
          >
            {
              <>
                {/* Current Run */}
                {currentRun && (
                  <RunView
                    run={currentRun}
                    onSavePlan={handlePlanUpdate}
                    onPause={handlePause}
                    onRegeneratePlan={handleRegeneratePlan}
                    isPanelMinimized={isPanelMinimized}
                    setIsPanelMinimized={setIsPanelMinimized}
                    showPanel={showPanel}
                    setShowPanel={setShowPanel}
                    agentConfig={agentConfig}
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                    onAcceptPlan={handleAcceptPlan}
                    onInputResponse={handleInputResponse}
                    onRunTask={runTask}
                    onCancel={handleCancel}
                    error={error}
                    chatInputRef={chatInputRef}
                    onExecutePlan={handleExecutePlan}
                    enable_upload={true} // Enable file upload functionality
                  />
                )}
              </>
            }
          </div>

          {/* No existing messages in run - centered content */}
          {currentRun && noMessagesYet && teamConfig && session?.id && (
            <WelcomeScreen
              currentRun={currentRun}
              sessionId={session.id}
              error={error}
              isPlanMessage={isPlanMessage}
              chatInputRef={chatInputRef}
              onSubmit={(
                query: string,
                files: RcFile[] | Array<{
                  name: string;
                  type: string;
                  path: string;
                  suffix: string;
                  size: number;
                  uuid: string;
                  url?: string;
                }>,
                accepted = false,
                plan?: IPlan,
                llm?: { label: string; value: string }
              ) => {
                if (
                  currentRun?.status === "awaiting_input" ||
                  currentRun?.status === "paused"
                ) {
                  handleInputResponse(query, accepted, plan, files, llm);
                } else {
                  runTask(query, files, plan, true, llm);
                }
              }}
              onCancel={handleCancel}
              onPause={handlePause}
              onExecutePlan={handleExecutePlan}
            />
          )}
        </div>
      </div>
    </div>
  );
}
