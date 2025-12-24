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
import { AgentModeConfig, DEFAULT_AGENT_MODE_CONFIG, normalizeAgentModeConfig } from "@/utils/agent";

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
  const { getSessionRun, setSessionRun } = useMessageCacheStore();

  // Local state
  const [error, setError] = React.useState<IStatus | null>({
    status: true,
    message: "All good",
  });
  const [currentRun, setCurrentRun] = React.useState<Run | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [noMessagesYet, setNoMessagesYet] = React.useState(true);
  const chatContainerRef = React.useRef<HTMLDivElement | null>(null);

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
  const [currentSessionConfig, setCurrentSessionConfig] = React.useState<AgentModeConfig>(DEFAULT_AGENT_MODE_CONFIG);

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
    setSessionRun,
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

  const { progress, isPlanning, hasFinalAnswer, currentPlan } = useProgressTracking(currentRun);

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
    currentSessionConfig,
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

  const loadSessionRun = React.useCallback(async () => {
    if (!session?.id || !user?.email) return null;

    // 首先尝试从缓存加载
    const cachedRun = getSessionRun(session.id);
    if (cachedRun) {
      return cachedRun;
    }

    // 如果缓存中没有，则从数据库加载
    try {
      const response = await sessionAPI.getSessionRuns(
        session.id,
        user?.email
      );
      const latestRun = response.runs[response.runs.length - 1];

      // 将从数据库加载的数据存入缓存
      if (latestRun) {
        setSessionRun(session.id, latestRun);
      }

      return latestRun;
    } catch (error) {
      console.error("Error loading session runs:", error);
      messageApi.error("Failed to load chat history");
      return null;
    }
  }, [session?.id, user?.email, getSessionRun, setSessionRun, messageApi]);


  React.useEffect(() => {
    const loadCurrentSession = async () => {
      if (session?.id && user?.email) {
        try {
          const res = await sessionAPI.getSession(session?.id, user?.email)
          const normalizedConfig =
            normalizeAgentModeConfig(res.agent_mode_config) || DEFAULT_AGENT_MODE_CONFIG;
          setCurrentSessionConfig(normalizedConfig);
        } catch (error) {
          console.error("Error loading current session:", error);
          // 如果获取session失败，清除可能无效的session状态
          if (error instanceof Error && error.message.includes("Failed to fetch session")) {
            console.warn("Session not found, it may have been deleted");
            // 可以在这里添加清理逻辑，比如清除localStorage等
          }
        }
      } else {
        setCurrentSessionConfig(DEFAULT_AGENT_MODE_CONFIG);
      }
    };

    loadCurrentSession();
  }, [session?.id, user?.email]);

  React.useEffect(() => {
    const initializeSession = async () => {
      if (session?.id) {
        // Reset plan state via hook
        setLocalPlan(null);
        setPlanProcessed(false);

        // Only load data if component is visible
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
      pendingFirstMessage &&
      currentRun &&
      noMessagesYet &&
      (currentRun.status === "created" || currentRun.status === "connected")
    ) {
      // Auto-send the pending first message
      const { query, files, plan } = pendingFirstMessage;

      // Send the message
      runTask(query, files as any[], plan, true);

      // Clear the pending message
      if (onPendingMessageSent) {
        onPendingMessageSent();
      }
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
    <div className="text-primary h-[calc(100vh-100px)] bg-primary relative rounded flex-1 scroll w-full">
      {contextHolder}
      <div className="flex flex-col h-full w-full">
        {/* Progress Bar - Sticky at top */}
        <div
          className="progress-container"
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
            className={`${showPanel && !isPanelMinimized
              ? "w-full max-w-sm sm:max-w-md md:max-w-4xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-7xl [&>*]:max-w-none [@media(min-width:1920px)]:max-w-[1600px] [@media(min-width:2560px)]:max-w-[2000px]"
              : "w-full max-w-sm sm:max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl [@media(min-width:1920px)]:max-w-[1200px] [@media(min-width:2560px)]:max-w-[1400px]"
              } mx-auto px-2 sm:px-3 md:px-4 h-full ${noMessagesYet && currentRun ? "hidden" : ""
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
                files: RcFile[],
                accepted = false,
                plan?: IPlan
              ) => {
                if (
                  currentRun?.status === "awaiting_input" ||
                  currentRun?.status === "paused"
                ) {
                  handleInputResponse(query, accepted, plan, files);
                } else {
                  runTask(query, files, plan, true);
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
