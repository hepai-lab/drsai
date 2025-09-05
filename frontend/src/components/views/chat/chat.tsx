import { message } from "antd";
import { RcFile } from "antd/es/upload";
import * as React from "react";
import { appContext } from "../../../hooks/provider";
import { GeneralConfig, useSettingsStore } from "../../store";
import { IStatus } from "../../types/app";
import {
  AgentMessageConfig,
  RunStatus as BaseRunStatus,
  InputRequest,
  InputRequestMessage,
  Message,
  Run,
  Session,
  TeamConfig,
  TeamResult,
  WebSocketMessage,
} from "../../types/datamodel";
import {
  IPlan,
  IPlanStep,
  convertPlanStepsToJsonString,
} from "../../types/plan";
import { convertFilesToBase64, getServerUrl } from "../../utils";
import { sessionAPI, settingsAPI } from "../api";
import { useMessageCacheStore } from "../../../store/messageCache";
import ChatInput from "./chat/chatinput";
import ProgressBar from "./progressbar";
import { messageUtils } from "./rendermessage";
import RunView from "./runview";
import SampleTasks from "./sampletasks";
import { useModeConfigStore } from "../../../store/modeConfig";

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
}

type PlanUpdateHandler = (plan: IPlanStep[]) => void;

interface StepProgress {
  currentStep: number;
  totalSteps: number;
  plan?: {
    task: string;
    steps: Array<{
      title: string;
      details: string;
      agent_name?: string;
    }>;
    response?: string;
    plan_summary?: string;
  };
}

export default function ChatView({
  session,
  onSessionNameChange,
  getSessionSocket,
  visible = true,
  onRunStatusChange,
}: ChatViewProps) {
  const serverUrl = getServerUrl();
  const [error, setError] = React.useState<IStatus | null>({
    status: true,
    message: "All good",
  });
  const [updatedPlan, setUpdatedPlan] = React.useState<IPlanStep[]>([]);
  const [localPlan, setLocalPlan] = React.useState<IPlan | null>(null);
  const [planProcessed, setPlanProcessed] = React.useState(false);
  const processedPlanIds = React.useRef(new Set<string>()).current;

  const settingsConfig = useSettingsStore((state) => state.config);
  const { user } = React.useContext(appContext);

  // 使用消息缓存 store
  const {
    getSessionRun,
    setSessionRun,
    addMessageToSession,
    updateMessageInSession,
    updateSessionMessages,
  } = useMessageCacheStore();

  // Core state
  const [currentRun, setCurrentRun] = React.useState<Run | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [noMessagesYet, setNoMessagesYet] = React.useState(true);
  const chatContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [isDetailViewerMinimized, setIsDetailViewerMinimized] =
    React.useState(true);
  const [showDetailViewer, setShowDetailViewer] = React.useState(true);
  const [hasFinalAnswer, setHasFinalAnswer] = React.useState(false);

  // Context and config
  const [activeSocket, setActiveSocket] = React.useState<WebSocket | null>(
    null
  );
  const [teamConfig, setTeamConfig] = React.useState<TeamConfig | null>(
    defaultTeamConfig
  );

  const inputTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const activeSocketRef = React.useRef<WebSocket | null>(null);
  // 用于跟踪正在流式输出的消息，避免重复渲染
  const streamingMessageRef = React.useRef<{ source: string, content: string } | null>(null);

  // Add ref for ChatInput component
  const chatInputRef = React.useRef<{
    focus: () => void;
    setValue: (value: string) => void;
  }>(null);

  // Add state for progress tracking
  const [progress, setProgress] = React.useState<StepProgress>({
    currentStep: -1,
    totalSteps: -1,
  });
  const [isPlanning, setIsPlanning] = React.useState(false);

  // Replace stepTitles state with currentPlan state
  const [currentPlan, setCurrentPlan] =
    React.useState<StepProgress["plan"]>();

  const { config } = useSettingsStore();
  const {
    mode,
    config: newConfig,
    setMode,
    setConfig,
  } = useModeConfigStore();

  // Create a Message object from AgentMessageConfig
  const createMessage = (
    config: AgentMessageConfig,
    runId: string,
    sessionId: number
  ): Message => ({
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    config,
    session_id: sessionId,
    run_id: runId,
    user_id: user?.email || undefined,
  });

  const loadSessionRun = async () => {
    if (!session?.id || !user?.email) return null;

    // 首先尝试从缓存加载
    const cachedRun = getSessionRun(session.id);
    if (cachedRun) {
      return cachedRun;
    }

    // 如果缓存中没有，则从数据库加载
    try {
      console.log("Loading session run from database:", session.id);
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
  };

  React.useEffect(() => {
    const initializeSession = async () => {
      if (session?.id) {
        // Reset plan state ONLY when session ID changes
        setLocalPlan(null);
        setPlanProcessed(false);
        processedPlanIds.clear();
        setUpdatedPlan([]);

        // Reset socket
        setActiveSocket(null);
        activeSocketRef.current = null;

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
  }, [session?.id, visible]);

  // Keep the planReady event handler in a separate effect
  React.useEffect(() => {
    if (session?.id) {
      const handlePlanReady = (event: CustomEvent) => {
        // Check if this event belongs to current session
        if (event.detail.sessionId !== session.id) {
          return;
        }

        // Add a unique ID for deduplication if not present
        const planId = event.detail.messageId || `plan_${Date.now()}`;

        // Only set if we haven't processed this plan already
        if (!processedPlanIds.has(planId)) {
          const planData = {
            ...event.detail.planData,
            sessionId: session.id,
            messageId: planId,
          };

          setLocalPlan(planData);
          setPlanProcessed(false);
        }
      };

      window.addEventListener(
        "planReady",
        handlePlanReady as EventListener
      );

      return () => {
        window.removeEventListener(
          "planReady",
          handlePlanReady as EventListener
        );
      };
    }
  }, [session?.id]);

  // Add ref to track previous status
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

  const handleWebSocketMessage = (message: WebSocketMessage) => {
    setCurrentRun((current: Run | null) => {
      if (!current || !session?.id) return null;

      let updatedRun: Run | null = null;

      switch (message.type) {
        case "error":
          if (inputTimeoutRef.current) {
            clearTimeout(inputTimeoutRef.current);
            inputTimeoutRef.current = null;
          }
          if (activeSocket) {
            activeSocket.close();
            setActiveSocket(null);
            activeSocketRef.current = null;
          }
        case "message":
          if (!message.data) return current;

          // Check if we already have a message with the same content from chunks
          const messageData = message.data as AgentMessageConfig;

          const lastMessageIndex = current.messages.length - 1;

          if (lastMessageIndex >= 0) {
            const lastMessage = current.messages[lastMessageIndex];

            // If the last message is from the same source and has similar content,
            // update it instead of creating a new one (防止流式消息重复渲染)
            if (
              (lastMessage.config.source === "assistant" ||
                lastMessage.config.source === messageData.source) &&
              typeof lastMessage.config.content === "string" &&
              typeof messageData.content === "string"
            ) {
              // 检查内容相似度，防止流式消息重复渲染
              const lastContent = lastMessage.config.content.trim();
              const newContent = messageData.content.trim();

              // 检查是否是流式消息的重复发送
              const streamingMessage = streamingMessageRef.current;
              if (streamingMessage &&
                streamingMessage.source === messageData.source &&
                (newContent === streamingMessage.content ||
                  newContent.includes(streamingMessage.content) ||
                  streamingMessage.content.includes(newContent))) {
                console.log("Skipping duplicate message rendering - streaming message detected");
                // 清除流式消息跟踪
                streamingMessageRef.current = null;
                return current;
              }

              // 如果新消息内容与最后一条消息内容相同或包含关系，则跳过重复渲染
              if (lastContent === newContent ||
                newContent.includes(lastContent) ||
                lastContent.includes(newContent)) {
                console.log("Skipping duplicate message rendering - content similarity detected");
                return current;
              }
            }
          }

          // Create new Message object from websocket data
          const newMessage = createMessage(
            messageData,
            current.id,
            session.id
          );

          updatedRun = {
            ...current,
            messages: [...current.messages, newMessage],
          };

          // 同步到缓存，添加错误处理
          try {
            setSessionRun(session.id, updatedRun);
          } catch (error) {
            console.warn('Failed to cache message, storage may be full:', error);
            // 可以选择显示用户提示
            if (error instanceof Error && error.message.includes('quota')) {
              messageApi.warning('存储空间不足，消息缓存已清理');
            }
          }

          return updatedRun;

        case "message_chunk":
          // console.log("Received message_chunk:", message.data);yo
          if (!message.data) return current;

          // Handle streaming chunks for typewriter effect
          const chunkData = message.data as any;
          if (
            chunkData.content &&
            typeof chunkData.content === "string"
          ) {
            let processedContent = chunkData.content;

            // Find the last message to append the chunk
            const lastMessageIndex = current.messages.length - 1;
            if (lastMessageIndex >= 0) {
              const lastMessage =
                current.messages[lastMessageIndex];

              // This prevents creating duplicate messages when we receive both chunks and full messages
              if (
                lastMessage.config.source === "assistant" ||
                lastMessage.config.source === chunkData.source
              ) {
                const updatedMessages = [...current.messages];

                // Update the last message with the new chunk
                const newContent = (lastMessage.config.content as string) + processedContent;
                updatedMessages[lastMessageIndex] = {
                  ...lastMessage,
                  config: {
                    ...lastMessage.config,
                    content: newContent,
                  },
                };

                // 记录流式消息信息，用于后续去重
                streamingMessageRef.current = {
                  source: chunkData.source || "assistant",
                  content: newContent,
                };

                updatedRun = {
                  ...current,
                  messages: updatedMessages,
                };

                // 同步到缓存
                setSessionRun(session.id, updatedRun);

                return updatedRun;
              }
            }

            // Only create a new message if no suitable existing message was found
            const newChunkMessage = createMessage(
              {
                source: "assistant", // Force assistant source for message_chunk
                content: processedContent,
                metadata: chunkData.metadata || {},
              } as AgentMessageConfig,
              current.id,
              session.id
            );

            // 记录流式消息信息，用于后续去重
            streamingMessageRef.current = {
              source: chunkData.source || "assistant",
              content: processedContent,
            };

            updatedRun = {
              ...current,
              messages: [...current.messages, newChunkMessage],
            };

            // 同步到缓存
            setSessionRun(session.id, updatedRun);

            return updatedRun;
          }
          return current;

        case "input_request":
          //console.log("InputRequest: " + JSON.stringify(message))

          var input_request: InputRequest;
          switch (message.input_type) {
            case "text_input":
            case null:
            default:
              input_request = { input_type: "text_input" };
              break;
            case "approval":
              var input_request_message =
                message as InputRequestMessage;
              input_request = {
                input_type: "approval",
                prompt: input_request_message.prompt,
              } as InputRequest;
              break;
          }

          // reset Updated Plan
          setUpdatedPlan([]);
          // Create new Message object from websocket data only if its for URL approval
          if (input_request.input_type === "approval") {
            updatedRun = {
              ...current,
              status: "awaiting_input",
              input_request: input_request,
            };
          } else {
            updatedRun = {
              ...current,
              status: "awaiting_input",
              input_request: input_request,
            };
          }

          // 同步到缓存
          setSessionRun(session.id, updatedRun);

          return updatedRun;
        case "system":
          // update run status
          updatedRun = {
            ...current,
            status: message.status as BaseRunStatus,
          };

          // 同步到缓存
          setSessionRun(session.id, updatedRun);

          return updatedRun;

        case "result":
        case "completion":
          const status: BaseRunStatus =
            message.status === "complete"
              ? "complete"
              : message.status === "error"
                ? "error"
                : "stopped";

          const isTeamResult = (data: any): data is TeamResult => {
            return (
              data &&
              "task_result" in data &&
              "usage" in data &&
              "duration" in data
            );
          };

          // close socket on completion
          if (activeSocket) {
            activeSocket.close();
            setActiveSocket(null);
            activeSocketRef.current = null;
          }

          updatedRun = {
            ...current,
            status,
            team_result:
              message.data && isTeamResult(message.data)
                ? message.data
                : null,
          };

          // 同步到缓存
          setSessionRun(session.id, updatedRun);

          return updatedRun;

        default:
          return current;
      }
    });
  };

  const handleError = (error: any) => {
    console.error("Error:", error);
    message.error("Error during request processing");

    setError({
      status: false,
      message:
        error instanceof Error
          ? error.message
          : "Unknown error occurred",
    });
  };

  // 确保WebSocket连接可用的辅助函数
  const ensureWebSocketConnection = async (runId: string, needsContinue: boolean = false): Promise<WebSocket> => {

    if (activeSocketRef.current?.readyState === WebSocket.OPEN) {
      console.log("Using existing WebSocket connection");
      return activeSocketRef.current;
    }

    console.log("WebSocket not available, attempting to reconnect...");
    // 显示重连提示
    message.loading("正在重新连接...", 0.5);

    const socket = setupWebSocket(runId, true, false);
    if (!socket) {
      console.error("setupWebSocket returned null");
      throw new Error("Failed to establish WebSocket connection");
    }

    console.log("New socket created, readyState:", socket.readyState);

    if (socket.readyState !== WebSocket.OPEN) {
      console.log("Waiting for socket to open...");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error("WebSocket connection timeout");
          reject(new Error("WebSocket connection timeout"));
        }, 5000);

        const checkState = () => {
          console.log("Checking socket state:", socket.readyState);
          if (socket.readyState === WebSocket.OPEN) {
            clearTimeout(timeout);
            console.log("WebSocket reconnected successfully");
            message.success("重新连接成功", 1);
            resolve();
          } else if (
            socket.readyState === WebSocket.CLOSED ||
            socket.readyState === WebSocket.CLOSING
          ) {
            clearTimeout(timeout);
            console.error("WebSocket connection failed");
            reject(new Error("WebSocket connection failed"));
          } else {
            setTimeout(checkState, 100);
          }
        };

        checkState();
      });
    }

    // 如果需要发送continue消息来恢复会话
    if (needsContinue && currentRun) {
      console.log("Sending continue message to resume session...");
      const continueMessage = {
        type: "continue",
        task: "continue", // 继续当前任务
        team_config: teamConfig,
        settings_config: settingsConfig,
      };

      socket.send(JSON.stringify(continueMessage));
      console.log("Continue message sent:", continueMessage);
    }

    console.log("Returning socket with readyState:", socket.readyState);
    return socket;
  };

  const handleInputResponse = async (
    response: string,
    accepted = false,
    plan?: IPlan,
    uploadedFileData?: Record<string, any>,
    files: RcFile[] = [] // 添加files参数
  ) => {
    if (!currentRun) {
      console.error("No current run available");
      handleError(new Error("No active run"));
      return;
    }

    try {
      // 检查是否需要重连
      const needsReconnect = !activeSocketRef.current || activeSocketRef.current.readyState !== WebSocket.OPEN;
      console.log("Needs reconnect:", needsReconnect);

      // 尝试获取或重新建立WebSocket连接
      console.log("Attempting to ensure WebSocket connection...");
      const socket = await ensureWebSocketConnection(currentRun.id, needsReconnect);
      console.log("WebSocket connection ensured, socket:", socket);

      // Check if the last message is a plan
      const lastMessage = currentRun.messages.slice(-1)[0];
      var planString = "";
      if (plan) {
        planString = convertPlanStepsToJsonString(plan.steps);
      } else if (
        lastMessage &&
        messageUtils.isPlanMessage(lastMessage.config.metadata)
      ) {
        planString = convertPlanStepsToJsonString(updatedPlan);
      }

      // 处理文件上传
      const processedFiles = await convertFilesToBase64(files);

      const responseJson = {
        accepted: accepted,
        content: response,
        ...(planString !== "" && { plan: planString }),
        ...(uploadedFileData &&
          Object.keys(uploadedFileData).length > 0 && {
          uploadedFileData,
        }),
        ...(processedFiles.length > 0 && { files: processedFiles }),
      };
      const responseString = JSON.stringify(responseJson);
      console.log("Sending input response:", { type: "input_response", response: responseString });

      socket.send(
        JSON.stringify({
          type: "input_response",
          response: responseString,
        })
      );

      console.log("Input response sent successfully");

      setCurrentRun((current: Run | null) => {
        if (!current) return null;
        const updatedRun = {
          ...current,
          status: "active" as BaseRunStatus,
          input_request: undefined, // Changed null to undefined
        };
        console.log("Updated run status to active:", updatedRun);
        return updatedRun;
      });
    } catch (error) {
      console.error("handleInputResponse error:", error);
      handleError(error);
    }
  };

  const handleRegeneratePlan = async () => {
    if (!currentRun) {
      handleError(new Error("No active run"));
      return;
    }

    try {
      // 检查是否需要重连
      const needsReconnect = !activeSocketRef.current || activeSocketRef.current.readyState !== WebSocket.OPEN;

      // 尝试获取或重新建立WebSocket连接
      const socket = await ensureWebSocketConnection(currentRun.id, needsReconnect);

      // Check if the last message is a plan
      const lastMessage = currentRun.messages.slice(-1)[0];
      var planString = "";
      if (
        lastMessage &&
        messageUtils.isPlanMessage(lastMessage.config.metadata)
      ) {
        planString = convertPlanStepsToJsonString(updatedPlan);
      }

      const responseJson = {
        content: "Regenerate a plan that improves on the current plan",
        ...(planString !== "" && { plan: planString }),
      };
      const responseString = JSON.stringify(responseJson);

      socket.send(
        JSON.stringify({
          type: "input_response",
          response: responseString,
        })
      );
    } catch (error) {
      handleError(error);
    }
  };

  const handleCancel = async () => {
    if (!currentRun) return;

    // Clear timeout when manually cancelled
    if (inputTimeoutRef.current) {
      clearTimeout(inputTimeoutRef.current);
      inputTimeoutRef.current = null;
    }
    try {
      // 检查是否需要重连
      const needsReconnect = !activeSocketRef.current || activeSocketRef.current.readyState !== WebSocket.OPEN;

      // 尝试获取或重新建立WebSocket连接
      const socket = await ensureWebSocketConnection(currentRun.id, needsReconnect);

      socket.send(
        JSON.stringify({
          type: "stop",
          reason: "Cancelled by user",
        })
      );

      setCurrentRun((current: Run | null) => {
        if (!current) return null;
        const updatedRun = {
          ...current,
          status: "stopped" as BaseRunStatus, // Cast "stopped" to BaseRunStatus
          input_request: undefined, // Changed null to undefined
        };
        return updatedRun;
      });
    } catch (error) {
      handleError(error);
    }
  };

  const handlePause = async () => {
    if (!currentRun) return;

    try {
      if (
        currentRun.status == "awaiting_input" ||
        currentRun.status == "connected"
      ) {
        return; // Do not pause if awaiting input or connected
      }

      // 检查是否需要重连
      const needsReconnect = !activeSocketRef.current || activeSocketRef.current.readyState !== WebSocket.OPEN;

      // 尝试获取或重新建立WebSocket连接
      const socket = await ensureWebSocketConnection(currentRun.id, needsReconnect);

      socket.send(
        JSON.stringify({
          type: "pause",
        })
      );

      setCurrentRun((current: Run | null) => {
        if (!current) return null;
        return {
          ...current,
          status: "pausing",
        };
      });
    } catch (error) {
      handleError(error);
    }
  };

  const runTask = async (
    query: string,
    files: RcFile[] = [],
    plan?: IPlan,
    fresh_socket: boolean = false,
    uploadedFileData?: Record<string, any>
  ) => {
    setError(null);
    setNoMessagesYet(false);

    console.log("Running task:", query, files);

    try {
      // Make sure run is setup first
      let run = currentRun;
      if (!run) {
        run = await loadSessionRun();
        if (run) {
          setCurrentRun(run);
        } else {
          throw new Error("Could not setup run");
        }
      }

      // Load latest settings from database
      let currentSettings = settingsConfig;
      if (user?.email) {
        try {
          currentSettings = (await settingsAPI.getSettings(
            user.email
          )) as GeneralConfig;
          useSettingsStore.getState().updateConfig(currentSettings);
        } catch (error) {
          console.error("Failed to load settings:", error);
        }
      }

      // Setup websocket connection
      const socket = setupWebSocket(run.id, fresh_socket, false);
      if (!socket) {
        throw new Error("WebSocket connection not available");
      }

      // Wait for socket to be ready
      await new Promise<void>((resolve, reject) => {
        const checkState = () => {
          if (socket.readyState === WebSocket.OPEN) {
            resolve();
          } else if (
            socket.readyState === WebSocket.CLOSED ||
            socket.readyState === WebSocket.CLOSING
          ) {
            reject(new Error("Socket failed to connect"));
          } else {
            setTimeout(checkState, 100);
          }
        };
        checkState();
      });
      console.log("Socket connected");
      const processedFiles = await convertFilesToBase64(files);
      // Send start message

      var planString = plan
        ? convertPlanStepsToJsonString(plan.steps)
        : "";

      const taskJson = {
        content: query,
        ...(planString !== "" && { plan: planString }),
      };

      console.log("runTask - uploadedFileData:", uploadedFileData);
      const messageToSend = {
        type: "start",
        task: JSON.stringify(taskJson),
        files: processedFiles,
        ...(uploadedFileData &&
          Object.keys(uploadedFileData).length > 0 && {
          uploadedFileData,
        }),
        team_config: teamConfig,
        settings_config: {
          ...currentSettings,
          agent_mode_config: {
            mode,
            config: newConfig,
          },
        },
      };
      console.log("runTask - messageToSend:", messageToSend);
      socket.send(JSON.stringify(messageToSend));
      const sessionData = {
        id: session?.id,
        name: query.slice(0, 50),
      };
      onSessionNameChange(sessionData);
    } catch (error) {
      setError({
        status: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to start task",
      });
    }
  };

  const setupWebSocket = (
    runId: string,
    fresh_socket: boolean = false,
    only_retrieve_existing_socket: boolean = false
  ): WebSocket | null => {
    if (!session?.id) {
      throw new Error("Invalid session configuration");
    }

    const socket = getSessionSocket(
      session.id,
      runId,
      fresh_socket,
      only_retrieve_existing_socket
    );
    if (!socket) {
      return null;
    }

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error("WebSocket message parsing error:", error);
      }
    };

    socket.onclose = () => {
      activeSocketRef.current = null;
      setActiveSocket(null);
    };

    socket.onerror = (error) => {
      handleError(error);
    };

    setActiveSocket(socket);
    // set up socket ref
    activeSocketRef.current = socket;
    console.log("Socket setup complete");
    return socket;
  };

  const lastMessage = currentRun?.messages.slice(-1)[0];
  const isPlanMessage =
    lastMessage && messageUtils.isPlanMessage(lastMessage.config.metadata);

  // Update the handler to be more specific about its purpose
  const handlePlanUpdate: PlanUpdateHandler = (plan: IPlanStep[]) => {
    setUpdatedPlan(plan);
  };

  React.useEffect(() => {
    if (
      localPlan &&
      !planProcessed &&
      visible &&
      session?.id &&
      currentRun
    ) {
      // Only process if the plan belongs to current session
      if (localPlan.sessionId === session.id) {
        processPlan(localPlan);
      } else {
        setLocalPlan(null);
      }
    }
  }, [localPlan, planProcessed, visible, session?.id, currentRun]);

  const processPlan = async (newPlan: IPlan) => {
    if (!currentRun || !session?.id) return;

    // Verify the plan belongs to current session
    if (newPlan.sessionId !== session.id) {
      return;
    }

    try {
      // Always get a fresh socket connection
      const socket =
        activeSocketRef.current?.readyState === WebSocket.OPEN
          ? activeSocketRef.current
          : setupWebSocket(currentRun.id, true, false);

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error("WebSocket not available or not open");
        return;
      }

      // Create a copy of the settings config instead of modifying directly
      const sessionSettingsConfig = {
        ...settingsConfig,
        plan: {
          task: newPlan.task,
          steps: newPlan.steps,
          plan_summary: "Saved plan for task: " + newPlan.task,
        },
      };

      // Use the current session's team config
      const currentTeamConfig = teamConfig || defaultTeamConfig;

      const message = {
        type: "start",
        id: `plan_${Date.now()}`,
        task: newPlan.task,
        team_config: currentTeamConfig,
        settings_config: sessionSettingsConfig,
        sessionId: session.id,
      };

      socket.send(JSON.stringify(message));

      // Mark as no longer first message
      setNoMessagesYet(false);

      // Mark plan as processed
      setPlanProcessed(true);
      if (newPlan.messageId) {
        processedPlanIds.add(newPlan.messageId);
      }
    } catch (err) {
      console.error(
        "Error processing plan for session:",
        session.id,
        err
      );
    }
  };

  const handleExecutePlan = React.useCallback(
    (plan: IPlan) => {
      plan.sessionId = session?.id || undefined; // Ensure session ID is set
      processPlan(plan);
    },
    [processPlan]
  );

  // Update effect to extract full plan
  React.useEffect(() => {
    if (!currentRun?.messages) return;

    // Find the last plan message
    const lastPlanMessage = [...currentRun.messages]
      .reverse()
      .find((msg) => {
        if (typeof msg.config.content !== "string") return false;
        return messageUtils.isPlanMessage(msg.config.metadata);
      });

    if (
      lastPlanMessage &&
      typeof lastPlanMessage.config.content === "string"
    ) {
      try {
        const content = JSON.parse(lastPlanMessage.config.content);
        if (
          messageUtils.isPlanMessage(lastPlanMessage.config.metadata)
        ) {
          setCurrentPlan({
            task: content.task,
            steps: content.steps,
            response: content.response,
            plan_summary: content.plan_summary,
          });
        }
      } catch {
        setCurrentPlan(undefined);
      }
    }
  }, [currentRun?.messages]);

  // Add effect to detect plan and final answer messages
  React.useEffect(() => {
    if (!currentRun?.messages.length) return;

    let currentStepIndex = -1;
    let planLength = 0;

    // Find the last final answer index
    const lastFinalAnswerIndex = currentRun.messages.findLastIndex(
      (msg: Message) =>
        typeof msg.config.content === "string" &&
        messageUtils.isFinalAnswer(msg.config.metadata)
    );

    // Calculate step progress only for messages after the last final answer
    const relevantMessages =
      lastFinalAnswerIndex === -1
        ? currentRun.messages
        : currentRun.messages.slice(lastFinalAnswerIndex + 1);

    relevantMessages.forEach((msg: Message) => {
      if (typeof msg.config.content === "string") {
        try {
          const content = JSON.parse(msg.config.content);
          if (content.index !== undefined) {
            currentStepIndex = content.index;
            if (content.plan_length) {
              planLength = content.plan_length;
            }
          }
        } catch {
          // Skip if we can't parse the message
        }
      }
    });

    setProgress({
      currentStep: currentStepIndex,
      totalSteps: planLength,
      plan: currentPlan,
    });

    // Check if we have a final answer
    const hasFinalAnswer = lastFinalAnswerIndex !== -1;

    // If we have a final answer, check for plans after it
    if (hasFinalAnswer) {
      // Look for plans after the final answer
      const messagesAfterFinalAnswer = currentRun.messages.slice(
        lastFinalAnswerIndex + 1
      );
      const hasPlanAfterFinalAnswer = messagesAfterFinalAnswer.some(
        (msg) =>
          typeof msg.config.content === "string" &&
          messageUtils.isPlanMessage(msg.config.metadata)
      );

      if (hasPlanAfterFinalAnswer) {
        // Reset to planning state if there's a plan after final answer
        setIsPlanning(progress.currentStep === -1);
        setHasFinalAnswer(false);
      } else {
        // Mark as completed if there's no plan after final answer
        setIsPlanning(false);
        setHasFinalAnswer(true);
      }
    } else {
      // No final answer - check for recent plans as before
      const recentMessages = currentRun.messages.slice(-3);
      const hasPlan = recentMessages.some(
        (msg: Message) =>
          typeof msg.config.content === "string" &&
          messageUtils.isPlanMessage(msg.config.metadata)
      );

      setHasFinalAnswer(false);
      // Only set planning to true if we have a plan but haven't started executing it yet
      setIsPlanning(hasPlan && progress.currentStep === -1);
    }

    // Hide progress if run is not in an active state
    if (
      currentRun.status !== "active" &&
      currentRun.status !== "awaiting_input" &&
      currentRun.status !== "paused" &&
      currentRun.status !== "pausing"
    ) {
      setIsPlanning(false);
      setProgress({ currentStep: -1, totalSteps: -1 }); // Reset progress
    }
  }, [
    currentRun?.messages,
    currentRun?.status,
    progress.currentStep,
    currentPlan,
  ]);

  // Add these handlers before the return statement
  const handleApprove = () => {
    if (currentRun?.status === "awaiting_input") {
      handleInputResponse("approve", true);
    }
  };

  const handleDeny = () => {
    if (currentRun?.status === "awaiting_input") {
      handleInputResponse("deny", false);
    }
  };

  const handleAcceptPlan = (text: string) => {
    if (currentRun?.status === "awaiting_input") {
      const query = text || "Plan Accepted";
      console.log("handleAcceptPlan - query:", query);
      handleInputResponse(query, true).catch(error => {
        console.error("handleAcceptPlan error:", error);
        handleError(error);
      });
    } else {
      console.log("Cannot accept plan - run status is not awaiting_input");
    }
  };

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
            className={`${showDetailViewer && !isDetailViewerMinimized
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
                    isDetailViewerMinimized={
                      isDetailViewerMinimized
                    }
                    setIsDetailViewerMinimized={
                      setIsDetailViewerMinimized
                    }
                    showDetailViewer={showDetailViewer}
                    setShowDetailViewer={
                      setShowDetailViewer
                    }
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                    onAcceptPlan={handleAcceptPlan}
                    // Add these to connect the functions from chat.tsx to RunView
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
          {currentRun &&
            noMessagesYet &&
            teamConfig &&
            session?.id && (
              <div
                className={`text-center ${showDetailViewer && !isDetailViewerMinimized
                  ? "w-full"
                  : "w-full"
                  } mx-auto px-2 sm:px-3 md:px-4`}
              >
                <div className="animate-fade-in text-center mb-8">
                  {/* Welcome Message */}
                  <div className="space-y-4">
                    <h1 className="text-5xl font-bold">
                      <span className="text-6xl bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-extrabold">
                        Welcome to Dr.Sai
                      </span>
                    </h1>
                    <p
                      className="text-xl text-secondary animate-slide-up"
                      style={{ animationDelay: "0.2s" }}
                    >
                      Enter a message to get started or
                      try a sample task below
                    </p>
                    {/* Current Model Indicator */}
                    {newConfig?.name && (
                      <div
                        className="text-sm text-secondary animate-slide-up"
                        style={{
                          animationDelay: "0.4s",
                        }}
                      >
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">
                          <span className="w-2 h-2 bg-accent rounded-full mr-2"></span>
                          {newConfig.name}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full space-y-6">
                  <ChatInput
                    ref={chatInputRef}
                    onSubmit={(
                      query: string,
                      files: RcFile[],
                      accepted = false,
                      plan?: IPlan,
                      uploadedFileData?: Record<
                        string,
                        any
                      >
                    ) => {
                      if (
                        currentRun?.status ===
                        "awaiting_input" ||
                        currentRun?.status === "paused"
                      ) {
                        handleInputResponse(
                          query,
                          accepted,
                          plan
                        );
                      } else {
                        runTask(
                          query,
                          files,
                          plan,
                          true,
                          uploadedFileData
                        );
                      }
                    }}
                    error={error}
                    onCancel={handleCancel}
                    runStatus={currentRun?.status}
                    inputRequest={currentRun?.input_request}
                    isPlanMessage={isPlanMessage}
                    onPause={handlePause}
                    enable_upload={true}
                    onExecutePlan={handleExecutePlan}
                    sessionId={session!.id}
                  />
                </div>
                <SampleTasks
                  onSelect={(task: string) => {
                    // 延迟执行以确保模型切换完成
                    setTimeout(() => {
                      if (chatInputRef.current) {
                        // 使用新的setValue方法
                        chatInputRef.current.setValue(
                          task
                        );
                      }
                    }, 200); // 增加延迟以确保模型切换完成
                  }}
                />
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
