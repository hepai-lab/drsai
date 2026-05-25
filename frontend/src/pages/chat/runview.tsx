import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactDOM from "react-dom";
import { Run, Message, RunLogEntry } from "../../components/types/datamodel";
import { RenderMessage, messageUtils } from "./rendermessage";
import { getStatusIcon } from "../../components/views/statusicon";
import { IPlanStep, IPlan } from "../../components/types/plan";
import ApprovalButtons from "./approval_buttons";
import ChatInput from "./chat/chatinput";
import type { ServerUploadedFileInfo } from "./chat/hooks/useFileUpload";
import { IStatus } from "../../components/types/app";
import { RcFile } from "antd/es/upload";
import AgentPanel from "./panels/AgentPanel";
import { AgentConfiguration } from "./config/agentConfigs";
import { BESIIITask, BESIIIServerGlobalInfo } from "./panels/types";
import { useRightPanelStore } from "../../store/rightPanel";
import {
  formatApiDateTimeZhCN,
  formatUnixForDisplayZhCN,
} from "../../utils/apiDatetime";
const DETAIL_VIEWER_CONTAINER_ID = "detail-viewer-container";
const CHAT_INPUT_BASE_HEIGHT_PX = 78;

/** Next index that bounds the "segment" after messageIndex (plan, final answer, or next non-duplicate step). */
function getNextSignificantMessageIndex(
  messages: Message[],
  messageIndex: number
): number {
  let nextSignificantIndex = messages.length;
  for (let i = messageIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    const content = msg.config.content;

    if (
      typeof content === "string" &&
      (messageUtils.isFinalAnswer(msg.config.metadata) ||
        messageUtils.isPlanMessage(msg.config.metadata))
    ) {
      nextSignificantIndex = i;
      break;
    }

    if (
      messageUtils.isStepExecution(msg.config.metadata) &&
      typeof content === "string"
    ) {
      try {
        const currentStep = JSON.parse(content);
        if (currentStep.title && currentStep.details) {
          const earlierMessages = messages.slice(0, i);
          const isDuplicate = earlierMessages.some((earlierMsg: Message) => {
            if (typeof earlierMsg.config.content !== "string") return false;
            try {
              const earlierContent = JSON.parse(earlierMsg.config.content);
              return (
                earlierContent.title === currentStep.title &&
                earlierContent.details === currentStep.details
              );
            } catch {
              return false;
            }
          });

          if (!isDuplicate) {
            nextSignificantIndex = i;
            break;
          }
        }
      } catch {
        continue;
      }
    }
  }
  return nextSignificantIndex;
}

interface RunViewProps {
  run: Run;
  /** Explicit session id for model binding (run.session_id may be absent from API) */
  sessionId?: number;
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
    }>,
    llm?: { label: string; value: string },
    inputMetadata?: Record<string, unknown>
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
    fresh_socket?: boolean,
    llm?: { label: string; value: string }
  ) => void;
  onCancel?: () => void;
  error?: IStatus | null;
  chatInputRef?: React.RefObject<any>;
  onExecutePlan?: (plan: IPlan) => void;
  enable_upload?: boolean;
  serverFilesPrefill?: ServerUploadedFileInfo[] | null;
  /** Read-only viewer (e.g. shared session link); hides input and actions */
  viewOnly?: boolean;
}

const RunView: React.FC<RunViewProps> = ({
  run,
  sessionId: sessionIdProp,
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
  serverFilesPrefill,
  viewOnly = false,
}) => {
  const resolvedSessionId =
    sessionIdProp && sessionIdProp > 0
      ? sessionIdProp
      : run.session_id && run.session_id > 0
        ? run.session_id
        : -1;
  const setIsRightPanelOpen = useRightPanelStore((s) => s.setIsOpen);
  const overviewSlot = useRightPanelStore((s) => s.overviewSlot);
  const threadContainerRef = useRef<HTMLDivElement | null>(null);
  /** Inner content wrapper ref — observed for size changes during streaming.
   *  threadContainerRef has fixed height (flex-1 constrained by parent), so its
   *  ResizeObserver does NOT fire when scroll content grows.  This inner div DOES
   *  resize as messages are added, giving us a reliable streaming-follow trigger. */
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const autoScrollLockedRef = useRef(false);
  const [autoScrollLocked, setAutoScrollLocked] = useState(false);
  /** Last scroll metrics — used so ResizeObserver can tell "was pinned to bottom" when content height grows (streaming). */
  const scrollMetricsRef = useRef({
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
  });
  /** True while we are scrolling programmatically — ignore scroll-lock so streaming doesn't falsely lock. */
  const programmaticScrollRef = useRef(false);
  const programmaticScrollClearTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [novncPort, setNovncPort] = useState<string | undefined>();
  const [detailViewerExpanded, setDetailViewerExpanded] = useState(false);
  const [detailViewerTab, setDetailViewerTab] = useState<
    "screenshots" | "live"
  >("live");
  const [besiiiActiveTab, setBesiiiActiveTab] = useState<
    "logs" | "global_info" | "terminal"
  >("global_info");
  const [hiddenMessageIndices, setHiddenMessageIndices] = useState<
    Set<number>
  >(new Set());
  const [hiddenStepExecutionIndices, setHiddenStepExecutionIndices] =
    useState<Set<number>>(new Set());
  const [localMessages, setLocalMessages] = useState<Message[]>([]);

  /** Step indices where the user explicitly expanded; auto-collapse skips these. */
  const userPinnedExpandedStepIndicesRef = useRef<Set<number>>(new Set());

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

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    const container = threadContainerRef.current;
    if (!container) return;

    if (programmaticScrollClearTimerRef.current != null) {
      clearTimeout(programmaticScrollClearTimerRef.current);
      programmaticScrollClearTimerRef.current = null;
    }

    autoScrollLockedRef.current = false;
    setAutoScrollLocked(false);

    programmaticScrollRef.current = true;

    const syncScrollMetrics = () => {
      const el = threadContainerRef.current;
      if (!el) return;
      scrollMetricsRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
      };
    };

    const scroll = () => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
      syncScrollMetrics();
    };

    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(() => {
        scroll();
        window.requestAnimationFrame(syncScrollMetrics);
      });
    } else {
      scroll();
    }

    const clearMs = behavior === "smooth" ? 450 : 80;
    programmaticScrollClearTimerRef.current = setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollClearTimerRef.current = null;
      syncScrollMetrics();
    }, clearMs);
  }, []);

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

      // 后端 naive ISO 按 UTC；Unix 为瞬时秒/毫秒 → 统一格式化为北京时间
      const formatTimestamp = (ts: any): string | undefined => {
        if (!ts) return undefined;
        if (typeof ts === "number") {
          return formatUnixForDisplayZhCN(ts);
        }
        if (typeof ts === "string") {
          return formatApiDateTimeZhCN(ts);
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
  const [terminalOutput, setTerminalOutput] = useState<string>("");

  const besiiiServerGlobalInfo = React.useMemo((): BESIIIServerGlobalInfo | null => {
    if (agentConfig.panel.type !== "besiii") return null;
    for (let i = run.messages.length - 1; i >= 0; i--) {
      const m = run.messages[i];
      const meta = m.config.metadata as Record<string, unknown> | undefined;
      if (meta?.type !== "global_info") continue;
      const c = m.config.content;
      if (typeof c !== "string") continue;
      try {
        const parsed = JSON.parse(c) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(
            parsed as Record<string, unknown>
          )) {
            out[k] = v == null ? "" : String(v);
          }
          if (!Object.prototype.hasOwnProperty.call(out, "root_path")) {
            out.root_path = "";
          }
          return { revision: `${i}:${c}`, fields: out };
        }
      } catch {
        continue;
      }
    }
    return null;
  }, [run.messages, agentConfig.panel.type]);

  // New global_info from the run → show BESIII Global Info tab and bring user to 运行概览 in the right rail
  useEffect(() => {
    if (agentConfig.panel.type !== "besiii") return;
    if (!besiiiServerGlobalInfo?.revision) return;
    setBesiiiActiveTab("global_info");
    setShowPanel(true);
    setIsPanelMinimized(false);
  }, [
    agentConfig.panel.type,
    besiiiServerGlobalInfo?.revision,
    setShowPanel,
    setIsPanelMinimized,
  ]);

  // Track manual scrolling so users can inspect earlier messages without being forced to bottom
  useEffect(() => {
    const container = threadContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        // During programmatic scroll, record the target (bottom) position rather than the
        // intermediate animated position. This keeps wasAtBottom=true in the ResizeObserver
        // so it keeps following new content even while the scroll animation plays.
        scrollMetricsRef.current = {
          scrollHeight: container.scrollHeight,
          scrollTop: container.scrollHeight - container.clientHeight,
          clientHeight: container.clientHeight,
        };
        return;
      }

      scrollMetricsRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
      };

      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const isAtBottom = distanceFromBottom <= 32;

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

  // When thread content height grows (streaming, collapsible blocks), scrollHeight can jump before scrollTop
  // catches up — the scroll handler may think the user left the bottom and lock auto-scroll. If metrics show we
  // were pinned to the bottom before the growth, keep following.
  useEffect(() => {
    const container = threadContainerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      const el = threadContainerRef.current;
      if (!el) return;

      const prev = scrollMetricsRef.current;
      const wasAtBottom =
        prev.scrollHeight > 0 &&
        prev.scrollTop >= prev.scrollHeight - prev.clientHeight - 48;

      if (wasAtBottom && el.scrollHeight > prev.scrollHeight) {
        scrollToBottom("auto");
        return;
      }

      scrollMetricsRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
      };
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // Observe the inner messages content div — unlike threadContainerRef (fixed height via flex),
  // this div actually grows as messages render during streaming, so ResizeObserver fires reliably.
  useEffect(() => {
    const content = messagesContentRef.current;
    if (!content) return;

    const ro = new ResizeObserver(() => {
      if (autoScrollLockedRef.current) return;
      // If a programmatic scroll is already in progress, its RAF will read the
      // latest scrollHeight when it fires — no need to queue another scroll.
      if (programmaticScrollRef.current) return;
      scrollToBottom("auto");
    });

    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // Combine scroll behavior when messages or status change
  useEffect(() => {
    if (run.messages.length === 0 || !threadContainerRef.current) {
      return;
    }

    // When the user sends a new message, always unlock auto-scroll so the view
    // follows the new content regardless of where the user was previously scrolled.
    const lastMsg = run.messages[run.messages.length - 1];
    if (lastMsg && messageUtils.isUser(lastMsg.config.source)) {
      autoScrollLockedRef.current = false;
      setAutoScrollLocked(false);
    }

    if (autoScrollLockedRef.current) {
      return;
    }

    // Use a small delay to ensure the DOM has updated
    const timeout = setTimeout(() => {
      scrollToBottom("auto");
    }, 100);

    return () => clearTimeout(timeout);
  }, [run.messages, run.status, autoScrollLocked, scrollToBottom]);

  useEffect(() => {
    autoScrollLockedRef.current = false;
    setAutoScrollLocked(false);

    const timeout = setTimeout(() => {
      scrollToBottom("auto");
    }, 100);

    return () => clearTimeout(timeout);
  }, [run.id, scrollToBottom]);

  useEffect(() => {
    userPinnedExpandedStepIndicesRef.current = new Set();
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

    // 规范化 logs：处理可能的 string 类型，转换为 RunLogEntry[]
    if (run.logs && Array.isArray(run.logs)) {
      const normalizedLogs: RunLogEntry[] = run.logs.map((log) =>
        typeof log === "string" ? { content: log } : log
      );
      setLogs(normalizedLogs);
    } else {
      // 如果 run.logs 不存在或为空，清空日志列表
      setLogs([]);
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

  // Control right panel open state based on panel visibility
  useEffect(() => {
    const shouldShow = showPanel && !isPanelMinimized && agentConfig.panel.type !== 'none';
    setIsRightPanelOpen(shouldShow);
    return () => {
      setIsRightPanelOpen(false);
    };
  }, [showPanel, isPanelMinimized, agentConfig.panel.type, setIsRightPanelOpen]);

  const handleMaximize = () => {
    setIsPanelMinimized(false);
    setShowPanel(true);
  };

  // Handle switching to logExecution panel when clicking log messages
  const handleSwitchToLogExecution = React.useCallback(() => {

    if (agentConfig.panel.type === 'besiii') {
      setBesiiiActiveTab('logs');
      setIsPanelMinimized(false);
      setShowPanel(true);
    }
  }, [agentConfig.panel.type]);


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
    expanded: boolean,
    isUserAction = false
  ) => {
    // If a toggle operation is already in progress, ignore this request
    if (isTogglingRef.current) {
      return;
    }

    try {
      isTogglingRef.current = true;
      const newIndicesToHide = new Set();

      const nextSignificantIndex = getNextSignificantMessageIndex(
        run.messages,
        messageIndex
      );

      // Update hidden states for messages between current and next significant message
      for (let i = messageIndex + 1; i < nextSignificantIndex; i++) {
        newIndicesToHide.add(i);
      }

      if (isUserAction) {
        if (expanded) {
          const next = new Set(userPinnedExpandedStepIndicesRef.current);
          next.add(messageIndex);
          userPinnedExpandedStepIndicesRef.current = next;
        } else {
          const next = new Set(userPinnedExpandedStepIndicesRef.current);
          next.delete(messageIndex);
          userPinnedExpandedStepIndicesRef.current = next;
        }
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

  /** True when no messages in this step's segment (before next significant) are hidden. */
  const getStepFollowingExpanded = (messageIndex: number): boolean => {
    const next = getNextSignificantMessageIndex(run.messages, messageIndex);
    for (let i = messageIndex + 1; i < next; i++) {
      if (hiddenMessageIndices.has(i)) return false;
    }
    return true;
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
                    if (!userPinnedExpandedStepIndicesRef.current.has(j)) {
                      handleToggleHide(j, false);
                    }
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
                      if (!userPinnedExpandedStepIndicesRef.current.has(j)) {
                        handleToggleHide(j, false);
                      }
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
      // Parse and validate attached_files from metadata if present
      if (msg.config.metadata?.attached_files) {
        try {
          const attachedFilesStr = msg.config.metadata.attached_files;
          // If it's a string, parse it to validate and ensure it's valid JSON
          if (typeof attachedFilesStr === "string") {
            const parsed = JSON.parse(attachedFilesStr);
            // Ensure it's an array, then stringify it back to keep metadata type consistent
            const validArray = Array.isArray(parsed) ? parsed : [];
            // Update the message with validated attached_files (as JSON string)
            updatedMessages[idx] = {
              ...msg,
              config: {
                ...msg.config,
                metadata: {
                  ...msg.config.metadata,
                  attached_files: JSON.stringify(validArray),
                },
              },
            };
          }
        } catch (e) {
          // If parsing fails, set to empty array as JSON string
          updatedMessages[idx] = {
            ...msg,
            config: {
              ...msg.config,
              metadata: {
                ...msg.config.metadata,
                attached_files: "[]",
              },
            },
          };
        }
      }

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

    const mergedMessages: Message[] = [];
    for (const msg of updatedMessages) {
      const last = mergedMessages[mergedMessages.length - 1];
      const isToolSummary = (m: Message | undefined) =>
        !!m && (m.config as any)?.type === "ToolCallSummaryMessage";

      if (
        isToolSummary(last) &&
        isToolSummary(msg) &&
        typeof last!.config.content === "string" &&
        typeof msg.config.content === "string"
      ) {
        const prev = last!.config.content.trim();
        const next = msg.config.content.trim();
        mergedMessages[mergedMessages.length - 1] = {
          ...last!,
          config: {
            ...last!.config,
            content: prev ? `${prev}\n\n${next}` : next,
            version: ((last!.config as any).version || 0) + 1,
          } as any,
        };
        continue;
      }

      mergedMessages.push(msg);
    }

    setLocalMessages(mergedMessages);
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
    <div className="flex w-full h-full">
      {/* Messages section — always full width, panel is in the right sidebar */}
      <div className="items-start relative flex flex-col h-full w-full transition-all duration-300">
        {/* Thread Section */}
        <div
          ref={threadContainerRef}
          className="w-full max-w-4xl mx-auto flex-1 min-h-0 overflow-y-auto scroll px-3 sm:px-6 lg:px-8 pt-4 pb-4"
        >
          {/* Inner wrapper observed by ResizeObserver — grows with streaming content */}
          <div ref={messagesContentRef}>
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

              // Check if current message is log message
              const isLogMessage =
                msg.config.metadata?.type === "log" ||
                (msg.config as any).content_type === "log" ||
                (msg.config as any).type === "AgentLogEvent" ||
                msg.config.metadata?.type === "AgentLogEvent";

              // Check if next message is chunk message (streaming message)
              const nextMessage = idx < localMessages.length - 1 ? localMessages[idx + 1] : null;
              const isNextChunkMessage = nextMessage && (
                // Chunk messages typically have start_flag or are streaming messages from assistant
                (nextMessage.config.metadata?.start_flag?.toLowerCase() === "yes") ||
                // Or it's an assistant message that's not a log message and has stream_source_label
                ((nextMessage.config.source === "assistant" ||
                  nextMessage.config.metadata?.stream_source_label) &&
                  !messageUtils.isUser(nextMessage.config.source) &&
                  nextMessage.config.metadata?.type !== "log" &&
                  (nextMessage.config as any).type !== "AgentLogEvent" &&
                  nextMessage.config.metadata?.type !== "AgentLogEvent")
              );

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
                      handleToggleHide(idx, expanded, true)
                    }
                    stepFollowingExpanded={
                      messageUtils.isStepExecution(msg.config.metadata)
                        ? getStepFollowingExpanded(idx)
                        : undefined
                    }
                    runStatus={run.status}
                    onRegeneratePlan={
                      isLatestPlan
                        ? handleRegeneratePlan
                        : undefined
                    }
                    onResendMessage={(content: string) => {
                      // awaiting_input: answer HITL via input_response. Paused: continue with new start (not input_response — that sends accepted:false and replans / re-prompts).
                      if (run.status === "awaiting_input") {
                        onInputResponse?.(content, false, undefined, []);
                      } else {
                        onRunTask?.(content, [], undefined, true);
                      }
                    }}
                    onActionButtonClick={(action: string) => {
                      if (run.status === "awaiting_input") {
                        onInputResponse?.(action, false, undefined, []);
                      } else {
                        onRunTask?.(action, [], undefined, true);
                      }
                    }}
                    forceCollapsed={shouldForceCollapse}
                    onLogMessageClick={handleSwitchToLogExecution}
                    className={isLogMessage && isNextChunkMessage ? "!mb-8" : ""}
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

          {!viewOnly && (
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
          )}
          </div>{/* end messagesContentRef wrapper */}
        </div>

        {!viewOnly && (
        <div
          ref={buttonsContainerRef}
          className="flex-shrink-0 w-full relative"
        >
          {/* Fade gradient so content scrolls under smoothly */}
          <div className="absolute -top-8 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-primary to-transparent" />
          <div className="px-3 sm:px-4 pb-3 pt-1 max-w-4xl mx-auto w-full">
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
                plan?: IPlan,
                llm?: { label: string; value: string }
              ) => {
                scrollToBottom("auto");
                if (run.status === "awaiting_input") {
                  onInputResponse?.(
                    query,
                    accepted,
                    plan,
                    files,
                    llm
                  );
                } else {
                  onRunTask?.(
                    query,
                    files,
                    plan,
                    true,
                    llm
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
              sessionId={resolvedSessionId}
              serverFilesPrefill={serverFilesPrefill}
            />
          </div>
        </div>
        )}
      </div>

      {/* Portal AgentPanel into the right panel's overview slot */}
      {showPanel &&
        agentConfig.panel.type !== 'none' &&
        !isPanelMinimized &&
        overviewSlot &&
        ReactDOM.createPortal(
          <div className="h-full w-full overflow-auto">
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
                fileEvents: run.file_events || [],
                serverGlobalInfo: besiiiServerGlobalInfo,
                activeTab: besiiiActiveTab,
                onTabChange: setBesiiiActiveTab,
                isExpanded: detailViewerExpanded,
                onTaskClick: (taskId: string) => {
                  // TODO: Handle task click
                },
                onSubtaskClick: (taskId: string, subtaskId: string) => {
                  // TODO: Handle subtask click
                },
                onInputResponse,
              }}
            />
          </div>,
          overviewSlot
        )}
    </div>
  );
};

export default RunView;
