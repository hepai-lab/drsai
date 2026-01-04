import React, { useState, useRef, useEffect } from "react";
import { Globe2 } from "lucide-react";
import { Run, Message, RunLogEntry } from "../../types/datamodel";
import { RenderMessage, messageUtils } from "./rendermessage";
import { getStatusIcon } from "../statusicon";
import { IPlanStep, IPlan } from "../../types/plan";
import ApprovalButtons from "./approval_buttons";
import ChatInput from "./chat/chatinput";
import { IStatus } from "../../types/app";
import { RcFile } from "antd/es/upload";
import AgentPanel from "./panels/AgentPanel";
import { AgentConfiguration } from "./config/agentConfigs";
import { BESIIITask } from "./panels/types";

const DETAIL_VIEWER_CONTAINER_ID = "detail-viewer-container";
const CHAT_INPUT_BASE_HEIGHT_PX = 78;

interface RunViewProps {
  run: Run;
  onSavePlan?: (plan: IPlanStep[]) => void;
  onPause?: () => void;
  onRegeneratePlan?: () => void;
  // Panel control props (renamed for generalization)
  isPanelMinimized: boolean;
  setIsPanelMinimized: (minimized: boolean) => void;
  showPanel: boolean;
  setShowPanel: (show: boolean) => void;
  // Agent configuration (from parent)
  agentConfig: AgentConfiguration;
  onApprove?: () => void;
  onDeny?: () => void;
  onAcceptPlan?: (text: string) => void;
  // Add new props needed for ChatInput
  onInputResponse?: (
    query: string,
    accepted?: boolean,
    plan?: IPlan,
    files?: RcFile[] | Array<{
      name: string;
      type: string;
      path: string;
      suffix: string;
      size: number;
      uuid: string;
      url?: string;
    }>
  ) => void;
  onRunTask?: (
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
    plan?: IPlan,
    fresh_socket?: boolean
  ) => void;
  onCancel?: () => void;
  error?: IStatus | null;
  chatInputRef?: React.RefObject<any>;
  onExecutePlan?: (plan: IPlan) => void;
  enable_upload?: boolean;
}

const RunView: React.FC<RunViewProps> = ({
  run,
  onSavePlan,
  onPause,
  onRegeneratePlan,
  isPanelMinimized,
  setIsPanelMinimized,
  showPanel,
  setShowPanel,
  agentConfig, // 从 parent 接收
  onApprove,
  onDeny,
  onAcceptPlan,
  // Add new props here
  onInputResponse,
  onRunTask,
  onCancel,
  error,
  chatInputRef,
  onExecutePlan,
  enable_upload = false,
}) => {
  const threadContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollLockedRef = useRef(false);
  const [autoScrollLocked, setAutoScrollLocked] = useState(false);
  const [novncPort, setNovncPort] = useState<string | undefined>();
  const [detailViewerExpanded, setDetailViewerExpanded] = useState(false);
  const [detailViewerTab, setDetailViewerTab] = useState<
    "screenshots" | "live"
  >("live");
  const [hiddenMessageIndices, setHiddenMessageIndices] = useState<
    Set<number>
  >(new Set());
  const [hiddenStepExecutionIndices, setHiddenStepExecutionIndices] =
    useState<Set<number>>(new Set());
  const [localMessages, setLocalMessages] = useState<Message[]>([]);

  const isTogglingRef = useRef(false);

  // Add this state to track repeated step indices and their earlier occurrences
  const [repeatedStepIndices, setRepeatedStepIndices] = useState<Set<number>>(
    new Set()
  );
  const [failedStepIndices, setFailedStepIndices] = useState<Set<number>>(
    new Set()
  );

  // Add ref for the latest user message
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);

  // Add state to track the last plan message index
  const [lastPlanIndex, setLastPlanIndex] = useState<number>(-1);

  // Add this with other refs near the top of the component
  const buttonsContainerRef = useRef<HTMLDivElement | null>(null);
  const [chatInputHeight, setChatInputHeight] = useState<number>(
    CHAT_INPUT_BASE_HEIGHT_PX
  );

  useEffect(() => {
    const container = buttonsContainerRef.current;
    if (!container) return;

    const updateHeight = () => {
      const nextHeight = container.offsetHeight || CHAT_INPUT_BASE_HEIGHT_PX;
      setChatInputHeight(nextHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const scrollToBottom = (behavior: "auto" | "smooth" = "auto") => {
    const container = threadContainerRef.current;
    if (!container) return;

    autoScrollLockedRef.current = false;
    setAutoScrollLocked(false);

    const scroll = () => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(scroll);
    } else {
      scroll();
    }
  };

  // Agent configuration - 从 parent (chat.tsx) 接收

  // 将 run.task 转换为 BESIIITask 格式的辅助函数
  const convertTaskToBESIIITask = React.useCallback((task: any): BESIIITask[] => {
    if (!task) {
      return [];
    }

    // TaskEvent 的结构: { content: str | Dict, type: "TaskEvent", source: ..., ... }
    // 处理不同的数据结构
    let taskContent: any = null;

    if (task.content) {
      // 如果 task 有 content 字段
      if (typeof task.content === 'string') {
        try {
          // 尝试解析 JSON 字符串
          taskContent = JSON.parse(task.content);
        } catch (e) {
          // 如果不是 JSON，可能是纯文本，创建一个简单的任务结构
          taskContent = { content: task.content };
        }
      } else if (typeof task.content === 'object') {
        // 如果 content 是对象，直接使用
        taskContent = task.content;
      }
    } else {
      // 如果没有 content 字段，可能 task 本身就是内容
      taskContent = task;
    }

    if (!taskContent) {
      return [];
    }

    const childTasks = taskContent.child_tasks || [];

    // 将子任务转换为 BESIIISubTask 格式
    const subtasks = childTasks.map((childTask: any) => {
      let status: 'completed' | 'running' | 'waiting' = 'waiting';
      if (childTask.status === 'completed') {
        status = 'completed';
      } else if (childTask.status === 'running' || childTask.status === 'active' || childTask.status === 'queued') {
        status = 'running';
      }

      // 处理时间戳：如果是数字（秒级），转换为毫秒；如果已经是字符串，直接使用
      const formatTimestamp = (ts: any): string | undefined => {
        if (!ts) return undefined;
        if (typeof ts === 'number') {
          // 判断是秒级还是毫秒级时间戳
          const timestamp = ts > 1e12 ? ts : ts * 1000;
          return new Date(timestamp).toISOString();
        }
        if (typeof ts === 'string') {
          return ts;
        }
        return undefined;
      };

      return {
        id: childTask.id || '',
        name: childTask.content || '未命名任务',
        status: status,
        startTime: formatTimestamp(childTask.created_at),
        endTime: formatTimestamp(childTask.completed_at),
        error: childTask.error || undefined,
      };
    });

    // 返回主任务
    // 如果没有子任务，至少显示主任务本身
    const mainTaskName = taskContent.content || taskContent.name || taskContent.task || '主任务';
    return [{
      id: task.id || taskContent.id || taskContent.task_id || 'main-task',
      name: typeof mainTaskName === 'string' ? mainTaskName : JSON.stringify(mainTaskName),
      subtasks: subtasks,
      isExpanded: true,
      metadata: {
        status: taskContent.status || task.status,
        executor: taskContent.executor,
        created_at: taskContent.created_at,
        completed_at: taskContent.completed_at,
        solution: taskContent.solution,
        raw: taskContent, // 保存原始数据用于调试
      }
    }];
  }, []);

  // BESIII Panel states - 从 run.task 初始化
  const [besiiiTasks, setBesiiiTasks] = useState<BESIIITask[]>(() => {
    return convertTaskToBESIIITask(run.task);
  });
  const [logs, setLogs] = useState<RunLogEntry[]>([]);
  const [terminalOutput, setTerminalOutput] = useState<string>('[INFO] Starting BESIII analysis workflow...\n[INFO] Loading detector configuration...\n[SUCCESS] Detector configuration loaded\n[INFO] Processing event data...');

  // Track manual scrolling so users can inspect earlier messages without being forced to bottom
  useEffect(() => {
    const container = threadContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const isAtBottom = distanceFromBottom <= 48;

      if (!isAtBottom && !autoScrollLockedRef.current) {
        autoScrollLockedRef.current = true;
        setAutoScrollLocked(true);
      } else if (isAtBottom && autoScrollLockedRef.current) {
        autoScrollLockedRef.current = false;
        setAutoScrollLocked(false);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Combine scroll behavior when messages or status change
  useEffect(() => {
    if (
      run.messages.length === 0 ||
      !threadContainerRef.current ||
      autoScrollLockedRef.current
    ) {
      return;
    }

    // Use a small delay to ensure the DOM has updated
    const timeout = setTimeout(() => {
      scrollToBottom("auto");
    }, 100);

    return () => clearTimeout(timeout);
  }, [run.messages, run.status, autoScrollLocked]);

  useEffect(() => {
    autoScrollLockedRef.current = false;
    setAutoScrollLocked(false);

    const timeout = setTimeout(() => {
      scrollToBottom("auto");
    }, 100);

    return () => clearTimeout(timeout);
  }, [run.id]);

  // Effect to handle browser_address message (for VNC panel)
  useEffect(() => {
    if (agentConfig.panel.type !== 'vnc') return;

    const browserAddressMessages = run.messages.filter(
      (msg: Message) => msg.config.metadata?.type === "browser_address"
    );
    const lastBrowserAddressMsg =
      browserAddressMessages[browserAddressMessages.length - 1];
    // only update if novncPort is it is different from the current novncPort
    if (
      lastBrowserAddressMsg &&
      lastBrowserAddressMsg.config.metadata?.novnc_port !== novncPort
    ) {
      setNovncPort(lastBrowserAddressMsg.config.metadata?.novnc_port);
      // Show Panel when novncPort becomes available
      setShowPanel(true);
      setIsPanelMinimized(false);
    }
  }, [run.messages, agentConfig.panel.type]);

  // Effect to handle BESIII tasks from run.task (for BESIII panel)
  useEffect(() => {
    if (agentConfig.panel.type !== 'besiii') return;

    // 从 run.task 更新任务数据
    if (run.task) {
      const convertedTasks = convertTaskToBESIIITask(run.task);
      // 即使 convertedTasks 为空，也要更新状态，以便清空之前的任务
      setBesiiiTasks(convertedTasks);
      if (convertedTasks.length > 0) {
        setShowPanel(true);
        setIsPanelMinimized(false);
      }
    } else {
      // 如果 run.task 为空，清空任务列表
      setBesiiiTasks([]);
    }

    // Also handle terminal output
    const terminalMessages = run.messages.filter(
      (msg: Message) => msg.config.metadata?.type === "besiii_terminal"
    );
    if (terminalMessages.length > 0) {
      const allOutput = terminalMessages
        .map((msg: Message) => msg.config.metadata?.output || '')
        .join('\n');
      setTerminalOutput(allOutput);
    }
  }, [run.task, run.messages, agentConfig.panel.type, convertTaskToBESIIITask]);

  // Effect to handle logs from run.logs (for BESIII panel LogExecution)
  useEffect(() => {
    if (agentConfig.panel.type !== 'besiii') return;

    // 从 run.logs 更新日志数据
    if (run.logs && Array.isArray(run.logs)) {
      const normalizedLogs = (run.logs as Array<RunLogEntry | string>).map((entry) =>
        typeof entry === "string" ? { content: entry } : entry
      );
      setLogs(normalizedLogs);
    }
  }, [run.logs, agentConfig.panel.type]);

  const isEditable =
    run.status === "awaiting_input" &&
    messageUtils.isPlanMessage(
      run.messages[run.messages.length - 1]?.config.metadata
    );

  // Add state for tracking images from multimodal messages
  const [messageImages, setMessageImages] = useState<{
    urls: string[];
    titles: string[];
    messageIndices: number[];
    currentIndex?: number;
  }>({
    urls: [],
    titles: [],
    messageIndices: [],
  });

  // Function to collect images from multimodal messages for browser steps
  const collectImagesFromMessages = (messages: Message[]) => {
    const images: {
      urls: string[];
      titles: string[];
      messageIndices: number[];
      currentIndex?: number;
    } = {
      urls: [],
      titles: [],
      messageIndices: [],
    };

    let latestImageIndex = -1;

    messages.forEach((msg: Message, msgIndex: number) => {
      if (
        Array.isArray(msg.config.content) &&
        msg.config.metadata?.type === "browser_screenshot"
      ) {
        msg.config.content.forEach((item: any, itemIndex: number) => {
          if (
            typeof item === "object" &&
            ("url" in item || "data" in item)
          ) {
            const imageUrl =
              ("url" in item && item.url) ||
              ("data" in item && item.data
                ? `data:image/png;base64,${item.data}`
                : "");
            images.urls.push(imageUrl);
            images.messageIndices.push(msgIndex);
            latestImageIndex = images.urls.length - 1;
          }
          if (typeof item === "string") {
            images.titles.push(item);
          }
        });
      }
    });

    setMessageImages({
      ...images,
      currentIndex: latestImageIndex >= 0 ? latestImageIndex : undefined,
    });
  };

  // Update images when messages change
  useEffect(() => {
    collectImagesFromMessages(run.messages);
  }, [run.messages]);

  const handleMaximize = () => {
    setIsPanelMinimized(false);
    setShowPanel(true);
  };

  // Update handleImageClick to use the correct image index
  const handleImageClick = (messageIndex: number) => {
    const imageIndices = messageImages.messageIndices
      .map((msgIdx, imgIdx) => ({ msgIdx, imgIdx }))
      .filter(({ msgIdx }) => msgIdx === messageIndex)
      .map(({ imgIdx }) => imgIdx);

    if (imageIndices.length > 0) {
      const lastImageIndex = imageIndices[imageIndices.length - 1];
      setMessageImages((prev) => ({
        ...prev,
        currentIndex: lastImageIndex,
      }));
      setDetailViewerTab("screenshots");
      handleMaximize();
    }
  };

  const handleToggleHide = async (
    messageIndex: number,
    expanded: boolean
  ) => {
    // If a toggle operation is already in progress, ignore this request
    if (isTogglingRef.current) {
      console.log(
        "Something bad: Toggle operation already in progress, ignoring request"
      );
      return;
    }

    try {
      isTogglingRef.current = true;
      const newIndicesToHide = new Set();

      // Find the next significant message index
      let nextSignificantIndex = run.messages.length; // Default to end of messages
      for (let i = messageIndex + 1; i < run.messages.length; i++) {
        const msg = run.messages[i];
        const content = msg.config.content;

        // Check if this is a significant message that should stop the hiding
        if (
          typeof content === "string" &&
          (messageUtils.isFinalAnswer(msg.config.metadata) ||
            messageUtils.isPlanMessage(msg.config.metadata))
        ) {
          nextSignificantIndex = i;
          break;
        }

        // Check for messages with title and details that aren't duplicates
        if (
          messageUtils.isStepExecution(msg.config.metadata) &&
          typeof content === "string"
        ) {
          try {
            const currentStep = JSON.parse(content);
            if (currentStep.title && currentStep.details) {
              // Check if this step is a duplicate of any previous step
              const earlierMessages = run.messages.slice(0, i);
              const isDuplicate = earlierMessages.some(
                (earlierMsg: Message) => {
                  if (
                    typeof earlierMsg.config.content !==
                    "string"
                  )
                    return false;
                  try {
                    const earlierContent = JSON.parse(
                      earlierMsg.config.content
                    );
                    return (
                      earlierContent.title ===
                      currentStep.title &&
                      earlierContent.details ===
                      currentStep.details
                    );
                  } catch {
                    return false;
                  }
                }
              );

              if (!isDuplicate) {
                nextSignificantIndex = i;
                break;
              }
            }
          } catch {
            // If we can't parse the JSON, continue to next message
            continue;
          }
        }
      }

      // Update hidden states for messages between current and next significant message
      for (let i = messageIndex + 1; i < nextSignificantIndex; i++) {
        newIndicesToHide.add(i);
      }
      if (!expanded) {
        setHiddenMessageIndices((prevSet) => {
          const updatedSet = new Set(prevSet);
          newIndicesToHide.forEach((index: any) =>
            updatedSet.add(index)
          );
          return updatedSet;
        });
      } else {
        setHiddenMessageIndices((prevSet) => {
          const updatedSet = new Set(prevSet);
          newIndicesToHide.forEach((index: any) =>
            updatedSet.delete(index)
          );
          return updatedSet;
        });
      }
    } finally {
      // Always reset the toggling flag when done
      isTogglingRef.current = false;
    }
  };

  // Add this function to check if a message is a step execution
  const isStepExecution = (message: Message): boolean => {
    return messageUtils.isStepExecution(message.config.metadata);
  };

  // Add this effect to update repeated steps whenever messages change
  useEffect(() => {
    const newRepeatedIndices = new Set<number>();
    const newFailedIndices = new Set<number>();
    const newRepeatedHistory = new Map<number, number[]>();

    // For each message that is a step execution
    run.messages.forEach((msg: Message, msgIndex: number) => {
      if (!isStepExecution(msg)) return;

      try {
        const content = JSON.parse(String(msg.config.content));

        // Look for earlier messages with same step details
        const earlierMessages = run.messages.slice(0, msgIndex);
        const identicalStepIndices: number[] = [];

        // Find all identical steps
        earlierMessages.forEach((earlierMsg: Message, idx: number) => {
          if (typeof earlierMsg.config.content !== "string") return;
          try {
            const earlierContent = JSON.parse(
              earlierMsg.config.content
            );
            if (
              earlierContent.index === content.index &&
              earlierContent.title === content.title &&
              earlierContent.details === content.details
            ) {
              identicalStepIndices.push(idx);
            }
          } catch {
            return;
          }
        });

        // If we found identical steps, check for Final Answer or Plan after the last one
        if (identicalStepIndices.length > 0) {
          const messagesBetween = run.messages.slice(
            identicalStepIndices[identicalStepIndices.length - 1] +
            1,
            msgIndex
          );

          const hasSeparator = messagesBetween.some(
            (msg: Message) => {
              if (typeof msg.config.content !== "string")
                return false;
              return (
                messageUtils.isPlanMessage(
                  msg.config.metadata
                ) ||
                messageUtils.isFinalAnswer(msg.config.metadata)
              );
            }
          );

          // Only mark as repeated if there's no separator
          if (!hasSeparator) {
            newRepeatedIndices.add(msgIndex);
            newRepeatedHistory.set(msgIndex, identicalStepIndices);
          }
        }

        // Separate step failure detection
        const nextMessages = run.messages.slice(msgIndex + 1);
        for (const nextMsg of nextMessages) {
          if (typeof nextMsg.config.content !== "string") continue;

          // If we find a step execution, plan, or final answer before finding "Replanning...", break
          try {
            if (
              messageUtils.isStepExecution(
                nextMsg.config.metadata
              )
            )
              break;
            if (messageUtils.isPlanMessage(nextMsg.config.metadata))
              break;
            if (nextMsg.config.metadata?.type === "replanning") {
              newFailedIndices.add(msgIndex);
              break;
            }
          } catch {
            if (messageUtils.isFinalAnswer(nextMsg.config.metadata))
              break;
          }
        }
      } catch {
        // Skip if we can't parse the message
      }
    });
    setRepeatedStepIndices(newRepeatedIndices);
    setFailedStepIndices(newFailedIndices);

    // handle auto-hiding of previous step execution messages
    const newHiddenStepExecutionIndices = new Set(
      hiddenStepExecutionIndices
    );
    // Process messages in order
    (async () => {
      for (let i = 0; i < run.messages.length; i++) {
        const msg: Message = run.messages[i];
        if (typeof msg.config.content !== "string") continue;

        try {
          // If this is a final answer, hide all previous step executions
          if (messageUtils.isFinalAnswer(msg.config.metadata)) {
            for (let j = 0; j < i; j++) {
              const prevMsg: Message = run.messages[j];
              if (typeof prevMsg.config.content === "string") {
                try {
                  if (
                    messageUtils.isStepExecution(
                      prevMsg.config.metadata
                    )
                  ) {
                    newHiddenStepExecutionIndices.add(j);
                    handleToggleHide(j, false);
                    // delay for 100ms
                    await new Promise((resolve) =>
                      setTimeout(resolve, 100)
                    );
                  }
                } catch { }
              }
            }
            continue;
          }
          const content = JSON.parse(msg.config.content);

          // If this is a step execution that's not repeated
          if (
            messageUtils.isStepExecution(msg.config.metadata) &&
            !newRepeatedIndices.has(i)
          ) {
            // Hide all previous step executions
            for (let j = 0; j < i; j++) {
              const prevMsg: Message = run.messages[j];
              if (typeof prevMsg.config.content === "string") {
                try {
                  if (
                    messageUtils.isStepExecution(
                      prevMsg.config.metadata
                    )
                  ) {
                    if (!newRepeatedIndices.has(j)) {
                      handleToggleHide(j, false);
                      newHiddenStepExecutionIndices.add(
                        j
                      );
                      // delay for 100ms
                      await new Promise((resolve) =>
                        setTimeout(resolve, 100)
                      );
                    }
                  }
                } catch { }
              }
            }
          }
        } catch { }
      }

      if (
        newHiddenStepExecutionIndices.size > 0 &&
        newHiddenStepExecutionIndices !== hiddenStepExecutionIndices
      ) {
        setHiddenStepExecutionIndices((prevSet) => {
          const updatedSet = new Set(prevSet);
          for (const index of newHiddenStepExecutionIndices) {
            updatedSet.add(index);
          }
          return updatedSet;
        });
      }
    })();
  }, [run.messages]);

  useEffect(() => {
    if (!run.messages.length) return;

    const updatedMessages = [...run.messages];

    updatedMessages.forEach((msg: Message, idx: number) => {
      if (idx === 0) return;

      const userPlans = messageUtils.findUserPlan(msg.config.content);

      // Check if this is a user message with a plan
      if (
        messageUtils.isUser(msg.config.source) &&
        userPlans.length > 0
      ) {
        const prevIdx = idx - 1;
        const prevMsg = updatedMessages[prevIdx];

        // Check if previous message is a plan
        if (
          prevMsg &&
          messageUtils.isPlanMessage(prevMsg.config.metadata)
        ) {
          try {
            // Create a new message object with updated content
            const updatedContent = messageUtils.updatePlan(
              prevMsg.config.content,
              userPlans
            );

            if (updatedContent !== prevMsg.config.content) {
              updatedMessages[prevIdx] = {
                ...prevMsg,
                config: {
                  ...prevMsg.config,
                  content: updatedContent,
                  version: (prevMsg.config.version || 0) + 1,
                },
              };
            }
          } catch (error) {
            console.error(
              `Error updating plan for message at index ${prevIdx}:`,
              error
            );
          }
        }
      }
    });

    setLocalMessages(updatedMessages);
  }, [run.messages]);

  // Update useEffect to find the last plan message
  useEffect(() => {
    let lastIdx = -1;
    run.messages.forEach((msg: Message, idx: number) => {
      if (
        typeof msg.config.content === "string" &&
        messageUtils.isPlanMessage(msg.config.metadata)
      ) {
        lastIdx = idx;
      }
    });
    setLastPlanIndex(lastIdx);
  }, [run.messages]);

  // Update handleRegeneratePlan to work with the effect
  const handleRegeneratePlan = () => {
    if (onRegeneratePlan) {
      onRegeneratePlan();
    }
  };

  // Add this before the return statement
  const lastMessage = localMessages[localMessages.length - 1];
  const isPlanMsg =
    lastMessage && messageUtils.isPlanMessage(lastMessage.config.metadata);

  // Add this effect to handle scrolling when status changes
  useEffect(() => {
    if (run.status === "awaiting_input" && buttonsContainerRef.current) {
      // Use a small delay to ensure the DOM has updated
      setTimeout(() => {
        buttonsContainerRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 100);
    }
  }, [run.status]);

  return (
    <div className="flex w-full gap-4 h-full">
      {/* Messages section */}
      <div
        className={`items-start relative flex flex-col h-full ${showPanel &&
          novncPort !== undefined &&
          !isPanelMinimized
          ? detailViewerExpanded
            ? "w-0"
            : "w-[40%]"
          : "w-full"
          } transition-all duration-300`}
      >
        {/* Thread Section - use flex-1 for height, but remove overflow-y-auto */}
        <div
          ref={threadContainerRef}
          className="w-full max-w-4xl mx-auto flex-1"
          style={{
            height: `calc(100% - ${chatInputHeight}px)`,
            overflowY: "auto",
          }}
        >
          {localMessages.length > 0 &&
            localMessages.map((msg: Message, idx: number) => {
              const isCurrentMessagePlan =
                typeof msg.config.content === "string" &&
                messageUtils.isPlanMessage(msg.config.metadata);

              const isLatestPlan =
                isCurrentMessagePlan &&
                idx === localMessages.length - 1;

              const shouldForceCollapse =
                isCurrentMessagePlan && idx !== lastPlanIndex;

              return (
                <div
                  key={`message-${idx}-${run.id}`}
                  className="w-full"
                  ref={
                    messageUtils.isUser(msg.config.source)
                      ? latestUserMessageRef
                      : null
                  }
                >
                  <RenderMessage
                    key={`render-${idx}-${msg.config.version || 0
                      }`}
                    message={msg.config}
                    sessionId={msg.session_id}
                    messageIdx={idx}
                    isLast={
                      idx === localMessages.length - 1
                    }
                    isEditable={
                      isEditable &&
                      idx === localMessages.length - 1
                    }
                    hidden={
                      hiddenMessageIndices.has(idx) ||
                      hiddenStepExecutionIndices.has(idx)
                    }
                    is_step_repeated={repeatedStepIndices.has(
                      idx
                    )}
                    is_step_failed={failedStepIndices.has(
                      idx
                    )}
                    onSavePlan={onSavePlan}
                    onImageClick={() =>
                      handleImageClick(idx)
                    }
                    onToggleHide={(expanded: boolean) =>
                      handleToggleHide(idx, expanded)
                    }
                    runStatus={run.status}
                    onRegeneratePlan={
                      isLatestPlan
                        ? handleRegeneratePlan
                        : undefined
                    }
                    forceCollapsed={shouldForceCollapse}
                  />
                </div>
              );
            })}

          {/* Status Icon at top */}
          <div className="pt-2 pb-2 flex-shrink-0">
            <div className="inline-block">
              {getStatusIcon(
                run.status,
                run.error_message,
                run.team_result?.task_result?.stop_reason,
                run.input_request
              )}
            </div>
          </div>

          {/* Approval Buttons after status */}
          <div className="flex-shrink-0">
            <ApprovalButtons
              status={run.status}
              inputRequest={run.input_request}
              isPlanMessage={isPlanMsg}
              onApprove={onApprove}
              onDeny={onDeny}
              onAcceptPlan={onAcceptPlan}
              onRegeneratePlan={onRegeneratePlan}
            />
          </div>
        </div>

        {/* ChatInput - use sticky positioning to keep at bottom with full width */}
        <div
          ref={buttonsContainerRef}
          className="sticky bottom-0 flex-shrink-0 w-full bg-background"
          style={{
            width: "100%", // Always take full width of parent
          }}
        >
          <ChatInput
            ref={chatInputRef}
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
              plan?: IPlan
            ) => {
              scrollToBottom("smooth");
              if (
                run.status === "awaiting_input" ||
                run.status === "paused"
              ) {
                onInputResponse?.(
                  query,
                  accepted,
                  plan,
                  files // 添加files参数
                );
              } else {
                onRunTask?.(
                  query,
                  files,
                  plan,
                  true
                );
              }
            }}
            error={error ?? null}
            onCancel={onCancel}
            runStatus={run.status}
            isPlanMessage={isPlanMsg}
            onPause={onPause}
            enable_upload={enable_upload}
            inputRequest={run.input_request}
            onExecutePlan={onExecutePlan}
            sessionId={run.session_id}
          />
        </div>
      </div>

      {/* Agent Panel section - Dynamic panel based on agent type */}
      {isPanelMinimized && agentConfig.panel.type !== 'none' && (
        <button
          onClick={() => setIsPanelMinimized(false)}
          className="self-start sticky top-0 h-full inline-flex text-magenta-800 hover:text-magenta-900 cursor-pointer"
          title={`Show ${agentConfig.panel.title}`}
        >
          <Globe2 size={20} />
        </button>
      )}

      {showPanel &&
        agentConfig.panel.type !== 'none' &&
        !isPanelMinimized && (
          <div
            className={`${detailViewerExpanded ? "w-full" : "w-[60%]"
              } self-start sticky top-0 h-full`}
          >
            <div className="h-full flex-1">
              {/* Dynamic Agent Panel - renders different panels based on agent type */}
              <AgentPanel
                panelConfig={agentConfig.panel}
                onMinimize={() => setIsPanelMinimized(true)}

                // VNC Panel props
                vncProps={{
                  images: messageImages.urls,
                  imageTitles: messageImages.titles,
                  currentIndex: messageImages.currentIndex || 0,
                  onIndexChange: (index: number) =>
                    setMessageImages((prev) => ({
                      ...prev,
                      currentIndex: index,
                    })),
                  novncPort: novncPort,
                  onPause: onPause,
                  runStatus: run.status,
                  activeTab: detailViewerTab,
                  onTabChange: setDetailViewerTab,
                  detailViewerContainerId: DETAIL_VIEWER_CONTAINER_ID,
                  onInputResponse: onInputResponse,
                  isExpanded: detailViewerExpanded,
                  onToggleExpand: () =>
                    setDetailViewerExpanded(!detailViewerExpanded),
                }}

                // BESIII Panel props
                besiiiProps={{
                  tasks: besiiiTasks,
                  terminalOutput: terminalOutput,
                  logs: logs,
                  onTaskClick: (taskId: string) => {
                    console.log('Task clicked:', taskId);
                    // TODO: Handle task click
                  },
                  onSubtaskClick: (taskId: string, subtaskId: string) => {
                    console.log('Subtask clicked:', taskId, subtaskId);
                    // TODO: Handle subtask click
                  },
                }}
              />
            </div>
          </div>
        )}
    </div>
  );
};

export default RunView;
