import React, { useState, memo, useEffect } from "react";
import {
  Globe2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  FileTextIcon,
  ImageIcon,
  CheckCircle,
  RefreshCw,
  Clock,
  Bot,
  Copy,
  Edit,
  Check,
  X,
  Send,
  Zap,
  Settings,
} from "lucide-react";
import {
  AgentMessageConfig,
  FunctionCall,
  FunctionExecutionResult,
  ImageContent,
} from "../../types/datamodel";
import { ClickableImage } from "../atoms";
import MarkdownRenderer from "../../common/markdownrender";
import PlanView from "./plan";
import { IPlanStep, convertToIPlanSteps } from "../../types/plan";
import RenderFile from "../../common/filerenderer";
import LearnPlanButton from "../../features/Plans/LearnPlanButton";
import { appContext } from "../../../hooks/provider";

// Types
interface MessageProps {
  message: AgentMessageConfig;
  sessionId: number;
  messageIdx: number;
  isLast?: boolean;
  className?: string;
  isEditable?: boolean;
  hidden?: boolean;
  is_step_repeated?: boolean;
  is_step_failed?: boolean;
  onSavePlan?: (plan: IPlanStep[]) => void;
  onImageClick?: (index: number) => void;
  onToggleHide?: (expanded: boolean) => void;
  onRegeneratePlan?: () => void;
  onEditMessage?: (messageIdx: number, newContent: string) => void;
  onResendMessage?: (content: string) => void;
  runStatus?: string;
  forceCollapsed?: boolean;
  onLogMessageClick?: () => void;
}

interface RenderPlanProps {
  content: any;
  isEditable: boolean;
  onSavePlan?: (plan: IPlanStep[]) => void;
  onRegeneratePlan?: () => void;
  forceCollapsed?: boolean;
}

interface RenderStepExecutionProps {
  content: {
    index: number;
    title: string;
    plan_length: number;
    agent_name: string;
    instruction?: string;
    progress_summary: string;
    details: string;
  };
  hidden?: boolean;
  is_step_repeated?: boolean;
  is_step_failed?: boolean;
  runStatus: string;
  onToggleHide?: (expanded: boolean) => void;
}

interface ParsedContent {
  text:
  | string
  | FunctionCall[]
  | (string | ImageContent)[]
  | FunctionExecutionResult[];
  metadata?: Record<string, string>;
  plan?: IPlanStep[];
}

interface AttachedFile {
  name: string;
  type: string;
}

// Helper functions
const getImageSource = (item: ImageContent): string => {
  if (item.url) return item.url;
  if (item.data) return `data:image/png;base64,${item.data}`;
  return "/api/placeholder/400/320";
};

const getStepIcon = (
  status: string,
  runStatus: string,
  is_step_repeated?: boolean,
  is_step_failed?: boolean
) => {
  if (is_step_failed)
    return <AlertTriangle size={16} className="text-magenta-800" />;
  if (is_step_repeated)
    return <AlertTriangle size={16} className="text-magenta-800" />;
  if (status === "completed")
    return <CheckCircle size={16} className="text-magenta-800" />;
  if (status === "current" && runStatus === "active")
    return <RefreshCw size={16} className="text-magenta-800 animate-spin" />;
  if (status === "upcoming")
    return <Clock size={16} className="text-gray-400" />;
  if (status === "failed")
    return <AlertTriangle size={16} className="text-magenta-500" />;
  return null;
};

const parseUserContent = (content: AgentMessageConfig): ParsedContent => {
  const message_content = content.content;

  if (Array.isArray(message_content)) {
    return { text: message_content, metadata: content.metadata };
  }

  // If content is not a string, convert it to string
  if (typeof message_content !== "string") {
    return { text: String(message_content), metadata: content.metadata };
  }

  try {
    const parsedContent = JSON.parse(message_content);

    // Handle case where content is in content field
    if (parsedContent.content) {
      // If parsedContent.content is an object, extract text from it
      // Otherwise, use it directly (it's already a string or array)
      let text: string | (string | ImageContent)[];
      if (typeof parsedContent.content === "object" && parsedContent.content !== null && !Array.isArray(parsedContent.content)) {
        // Object: try to extract content/text field, or stringify if not found
        text = parsedContent.content.content || parsedContent.content.text || JSON.stringify(parsedContent.content);
      } else {
        // String or array: use directly
        text = parsedContent.content;
      }
      // If text is an array, it might contain images
      if (Array.isArray(text)) {
        return { text, metadata: content.metadata };
      }
      return { text, metadata: content.metadata };
    }

    // Handle case where plan exists
    let planSteps: IPlanStep[] = [];
    if (parsedContent.plan && typeof parsedContent.plan === "string") {
      try {
        planSteps = convertToIPlanSteps(parsedContent.plan);
      } catch (e) {
        console.error("Failed to parse plan:", e);
        planSteps = [];
      }
    }

    // Return both the content and plan if they exist
    // Ensure text is always a string
    let textValue: string | (string | ImageContent)[];
    if (parsedContent.content) {
      if (typeof parsedContent.content === "string") {
        textValue = parsedContent.content;
      } else if (Array.isArray(parsedContent.content)) {
        textValue = parsedContent.content;
      } else if (typeof parsedContent.content === "object") {
        // If it's an object, try to extract text or stringify
        textValue = parsedContent.content.content ||
          parsedContent.content.text ||
          JSON.stringify(parsedContent.content);
      } else {
        textValue = String(parsedContent.content);
      }
    } else {
      // Fallback to original content, ensuring it's a string
      textValue = typeof content === "string" ? content : String(content);
    }

    return {
      text: textValue,
      plan: planSteps.length > 0 ? planSteps : undefined,
      metadata: content.metadata,
    };
  } catch (e) {
    // If JSON parsing fails, return original content
    return { text: message_content, metadata: content.metadata };
  }
};

const parseContent = (content: any): string => {
  if (typeof content !== "string") return String(content);

  try {
    const parsedContent = JSON.parse(content);
    // If parsedContent has a content field
    if (parsedContent.content !== undefined) {
      // If content is an object, extract text from it
      if (typeof parsedContent.content === "object" && parsedContent.content !== null && !Array.isArray(parsedContent.content)) {
        return parsedContent.content.content || parsedContent.content.text || JSON.stringify(parsedContent.content);
      }
      // Otherwise, use content directly (string or array)
      return typeof parsedContent.content === "string" ? parsedContent.content : String(parsedContent.content);
    }
    // If no content field, return original content
    return content;
  } catch {
    return content;
  }
};

const parseorchestratorContent = (
  content: string,
  metadata?: Record<string, any>
) => {
  if (messageUtils.isFinalAnswer(metadata)) {
    const prefix = "Final Answer:";
    return {
      type: "final-answer" as const,
      content: content.startsWith(prefix)
        ? content.substring(prefix.length).trim()
        : content,
    };
  }

  try {
    const parsedContent = JSON.parse(content);
    if (messageUtils.isPlanMessage(metadata)) {
      return { type: "plan" as const, content: parsedContent };
    }
    if (messageUtils.isStepExecution(metadata)) {
      return { type: "step-execution" as const, content: parsedContent };
    }
  } catch { }

  return { type: "default" as const, content };
};

const RenderMultiModalBrowserStep: React.FC<{
  content: (string | ImageContent)[];
  onImageClick?: (index: number) => void;
}> = memo(({ content, onImageClick }) => (
  <div className="text-sm">
    {content.map((item, index) => {
      if (typeof item !== "string") return null;

      const hasNextImage =
        index < content.length - 1 && typeof content[index + 1] === "object";

      return (
        <div key={index} className="relative pl-4">
          {/* Full-height connector line */}
          <div
            className="absolute top-0 bottom-0 left-0 w-2 border-l-[2px] border-b-[2px] rounded-bl-lg"
            style={{ borderColor: "var(--color-border-secondary)" }}
          />

          {/* Content container */}
          <div className="flex items-center h-full">
            {hasNextImage && (
              <div className="flex-shrink-0 mr-1 -ml-1 mt-2">
                <Globe2
                  size={16}
                  className="text-magenta-800 hover:text-magenta-900 cursor-pointer"
                  onClick={() => onImageClick?.(index)}
                />
              </div>
            )}

            {/* Text content */}
            <div
              className="flex-1 cursor-pointer mt-2"
              onClick={() => onImageClick?.(index)}
            >
              <MarkdownRenderer content={item} indented={true} />
            </div>
          </div>
        </div>
      );
    })}
  </div>
));

const RenderMultiModal: React.FC<{
  content: (string | ImageContent)[];
}> = memo(({ content }) => (
  <div className="space-y-2 text-sm">
    {content.map((item, index) => (
      <div key={index}>
        {typeof item === "string" ? (
          <MarkdownRenderer content={item} indented={true} />
        ) : (
          <ClickableImage
            src={getImageSource(item)}
            alt={`Content ${index}`}
            className="max-w-[400px]  max-h-[30vh] rounded-lg"
          />
        )}
      </div>
    ))}
  </div>
));

const RenderToolCall: React.FC<{ content: FunctionCall[] }> = memo(
  ({ content }) => (
    <div className="space-y-2 text-sm">
      {content.map((call) => (
        <div key={call.id} className="border border-secondary rounded p-2">
          <div className="font-medium">Function: {call.name}</div>
          <MarkdownRenderer
            content={JSON.stringify(JSON.parse(call.arguments), null, 2)}
            indented={true}
          />
        </div>
      ))}
    </div>
  )
);

const RenderToolResult: React.FC<{ content: FunctionExecutionResult[] }> = memo(
  ({ content }) => {
    const [expandedResults, setExpandedResults] = useState<{ [key: string]: boolean }>({});

    const toggleExpand = (callId: string) => {
      setExpandedResults(prev => ({
        ...prev,
        [callId]: !prev[callId]
      }));
    };

    return (
      <div className="space-y-2 text-sm">
        {content.map((result) => {
          const isExpanded = expandedResults[result.call_id];
          const displayContent = isExpanded ? result.content : result.content.slice(0, 100) + (result.content.length > 100 ? "..." : "");

          return (
            <div key={result.call_id} className="rounded p-2">
              <div className="font-medium">Result ID: {result.call_id}</div>
              <div
                className="cursor-pointer hover:bg-secondary/50 rounded p-1"
                onClick={() => toggleExpand(result.call_id)}
              >
                <MarkdownRenderer content={displayContent} indented={true} />
                {result.content.length > 100 && (
                  <div className="text-xs text-gray-500 mt-1">
                    {isExpanded ? "Click to minimize" : "Click to expand"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);

const RenderPlan: React.FC<RenderPlanProps> = memo(
  ({ content, isEditable, onSavePlan, onRegeneratePlan, forceCollapsed }) => {
    // Make sure content.steps is an array before using it
    const initialSteps = Array.isArray(content.steps) ? content.steps : [];

    // Convert to IPlanStep[] if needed
    const initialPlanSteps: IPlanStep[] = initialSteps.map((step: any) => ({
      title: step.title || "",
      details: step.details || "",
      enabled: step.enabled !== false,
      open: step.open || false,
      agent_name: step.agent_name || "",
    }));

    const [planSteps, setPlanSteps] = useState<IPlanStep[]>(initialPlanSteps);

    return (
      <div className="space-y-2 text-sm">
        <PlanView
          task={content.task || "Untitled Task"}
          plan={planSteps}
          setPlan={setPlanSteps}
          viewOnly={!isEditable}
          onSavePlan={onSavePlan}
          onRegeneratePlan={onRegeneratePlan}
          forceCollapsed={forceCollapsed}
          fromMemory={content.from_memory || false}
        />
      </div>
    );
  }
);

const RenderStepExecution: React.FC<RenderStepExecutionProps> = memo(
  ({
    content,
    hidden,
    is_step_repeated, // is_step_repeated means the step is being re-tried
    is_step_failed, // is_step_failed means the step is being re-planned
    runStatus,
    onToggleHide,
  }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    useEffect(() => {
      if (hidden && isExpanded) {
        setIsExpanded(false);
      } else if (!hidden && !isExpanded) {
        setIsExpanded(true);
      }
    }, [hidden]);

    const handleToggle = () => {
      const newExpanded = !isExpanded;
      setIsExpanded(newExpanded);
      onToggleHide?.(newExpanded);
    };

    const isUserProxyInstruction = content.agent_name === "user_proxy";

    if (is_step_repeated && !hidden) {
      return (
        <div id={`step-execution-${content.index}`} className="">
          {isUserProxyInstruction && content.instruction && (
            <div className="flex items-start">
              <MarkdownRenderer content={content.instruction} />
            </div>
          )}

          {!isUserProxyInstruction && content.instruction && (
            <MarkdownRenderer
              content={content.progress_summary}
              indented={true}
            />
          )}
        </div>
      );
    }
    if (is_step_repeated && hidden) {
      return null;
    }
    // if hidden add success green thingy

    return (
      <div id={`step-execution-${content.index}`} className="flex flex-col">
        {!isUserProxyInstruction &&
          content.instruction &&
          content.index !== 0 && (
            <div className=" mb-2">
              <MarkdownRenderer
                content={content.progress_summary}
                indented={true}
              />
            </div>
          )}
        <div
          className={`relative border-2 border-transparent hover:border-gray-300 rounded-lg p-2 cursor-pointer overflow-hidden bg-secondary`}
          onClick={handleToggle}
        >
          <div className="flex items-center w-full">
            <button
              className="flex-none flex items-center justify-center w-8 h-8 rounded-full bg-secondary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
              aria-label={
                isExpanded
                  ? "Hide following messages"
                  : "Show following messages"
              }
            >
              {isExpanded ? (
                <ChevronDown size={16} className="text-primary" />
              ) : (
                <ChevronRight size={16} className="text-primary" />
              )}
            </button>
            <div className="flex-1 mx-2">
              <div className="font-semibold text-primary">
                Step {content.index + 1}: {content.title}
              </div>
            </div>
            <div className="flex-none">
              {getStepIcon(
                hidden ? "completed" : "current",
                runStatus,
                is_step_repeated,
                is_step_failed
              )}
            </div>
          </div>
        </div>
        <div>
          {isUserProxyInstruction && content.instruction && isExpanded && (
            <div className="flex items-start">
              <MarkdownRenderer content={content.instruction} />
            </div>
          )}
        </div>
      </div>
    );
  }
);

interface RenderFinalAnswerProps {
  content: string;
  sessionId: number;
  messageIdx: number;
}

const RenderFinalAnswer: React.FC<RenderFinalAnswerProps> = memo(
  ({ content, sessionId, messageIdx }) => {
    return (
      <div className="border-2 border-secondary rounded-lg p-4">
        <div className="flex justify-between items-center">
          <div className="font-semibold text-primary">Final Answer</div>
          <LearnPlanButton
            sessionId={sessionId}
            messageId={messageIdx}
            onSuccess={(planId: string) => {
            }}
          />
        </div>
        <div className="">
          <MarkdownRenderer content={content} />
        </div>
      </div>
    );
  }
);

RenderFinalAnswer.displayName = "RenderFinalAnswer";

// Message type checking utilities
export const messageUtils = {
  isToolCallContent(content: unknown): content is FunctionCall[] {
    if (!Array.isArray(content)) return false;
    return content.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "arguments" in item &&
        "name" in item
    );
  },

  isMultiModalContent(content: unknown): content is (string | ImageContent)[] {
    if (!Array.isArray(content)) return false;
    return content.every(
      (item) =>
        typeof item === "string" ||
        (typeof item === "object" &&
          item !== null &&
          ("url" in item || "data" in item))
    );
  },

  isFunctionExecutionResult(
    content: unknown
  ): content is FunctionExecutionResult[] {
    if (!Array.isArray(content)) return false;
    return content.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "call_id" in item &&
        "content" in item
    );
  },

  isFinalAnswer(metadata?: Record<string, any>): boolean {
    return metadata?.type === "final_answer";
  },

  isPlanMessage(metadata?: Record<string, any>): boolean {
    return metadata?.type === "plan_message";
  },

  isStepExecution(metadata?: Record<string, any>): boolean {
    return metadata?.type === "step_execution";
  },

  findUserPlan(content: unknown): IPlanStep[] {
    if (typeof content !== "string") return [];
    try {
      const parsedContent = JSON.parse(content);
      let plan = [];
      if (parsedContent.plan && typeof parsedContent.plan === "string") {
        plan = JSON.parse(parsedContent.plan);
      }
      return plan;
    } catch {
      return [];
    }
  },

  updatePlan(content: unknown, planSteps: IPlanStep[]): string {
    if (typeof content !== "string") return "";

    try {
      const parsedContent = JSON.parse(content);

      if (typeof parsedContent === "object" && parsedContent !== null) {
        parsedContent.steps = planSteps;
        return JSON.stringify(parsedContent);
      }

      return "";
    } catch (error) {
      return "";
    }
  },

  isUser(source: string): boolean {
    return source === "user" || source === "user_proxy";
  },
};

const RenderUserMessage: React.FC<{
  parsedContent: ParsedContent;
  isUserProxy: boolean;
  messageIdx: number;
  onEditMessage?: (messageIdx: number, newContent: string) => void;
  onResendMessage?: (content: string) => void;
  runStatus?: string;
  isEditing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
}> = memo(({ parsedContent, isUserProxy, messageIdx, onEditMessage, onResendMessage, runStatus, isEditing: externalIsEditing, onStartEdit, onCancelEdit }) => {
  const { darkMode } = React.useContext(appContext);
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const isEditing = externalIsEditing !== undefined ? externalIsEditing : internalIsEditing;
  const setIsEditing = externalIsEditing !== undefined ? (onStartEdit || (() => { })) : setInternalIsEditing;

  // Parse attached files from metadata if present
  const attachedFiles: AttachedFile[] = React.useMemo(() => {
    if (parsedContent.metadata?.attached_files) {
      try {
        return JSON.parse(parsedContent.metadata.attached_files);
      } catch (e) {
        return [];
      }
    }
    return [];
  }, [parsedContent.metadata?.attached_files]);

  // Get the text content for editing/copying
  const getTextContent = (): string => {
    if (messageUtils.isMultiModalContent(parsedContent.text)) {
      return parsedContent.text
        .filter((item): item is string => typeof item === "string")
        .map((item) => parseContent(item))
        .join("\n");
    }
    return String(parsedContent.text);
  };

  // Initialize editValue when entering edit mode
  React.useEffect(() => {
    if (isEditing && !editValue) {
      const textContent = getTextContent();
      setEditValue(textContent);
    }
    // Reset editValue when exiting edit mode
    if (!isEditing) {
      setEditValue("");
    }
  }, [isEditing]);

  const handleSend = () => {
    if (onResendMessage && editValue.trim()) {
      onResendMessage(editValue);
    }
    if (externalIsEditing !== undefined) {
      // Controlled mode - parent will handle state
      setInternalIsEditing(false);
    } else {
      setIsEditing(false);
    }
    setEditValue("");
  };

  const handleCancel = () => {
    if (externalIsEditing !== undefined) {
      // Controlled mode - notify parent to exit edit mode
      if (onCancelEdit) {
        onCancelEdit();
      }
      setInternalIsEditing(false);
    } else {
      setIsEditing(false);
    }
    setEditValue("");
  };

  return (
    <div className="space-y-2">
      {/* Show attached file icons if present */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachedFiles.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-1  rounded px-2 py-1 text-xs"
              title={file.name}
            >
              {file.type.startsWith("image") ? (
                <ImageIcon className="w-3 h-3" />
              ) : (
                <FileTextIcon className="w-3 h-3" />
              )}
              <span className="truncate max-w-[150px]">{file.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Edit mode */}
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className={`w-full p-2 border border-secondary rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary ${darkMode === "dark" ? "bg-[#0f0f0f] text-gray-200 border-gray-700" : "bg-background text-primary"}`}
            rows={Math.min(editValue.split('\n').length + 2, 10)}
            autoFocus
            onKeyDown={(e) => {
              // Allow Ctrl/Cmd+Enter to send
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
              // Allow Escape to cancel
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
              }
            }}
          />
          <div className="flex items-center gap-2">
            {onResendMessage && (
              <button
                onClick={handleSend}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary rounded-lg hover:bg-primary/90 transition-colors"
                title="Send edited message"
              >
                <Send size={14} />
                <span className="text-sm">Send</span>
              </button>
            )}
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-primary rounded-lg hover:bg-secondary/80 transition-colors"
              title="Cancel editing"
            >
              <X size={14} />
              <span className="text-sm">Cancel</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Existing content rendering */}
          {messageUtils.isMultiModalContent(parsedContent.text) ? (
            <div className="space-y-2">
              {parsedContent.text.map((item, index) => (
                <div key={index}>
                  {typeof item === "string" ? (
                    <div className="break-words whitespace-pre-wrap overflow-wrap-anywhere">
                      {parseContent(item)}
                    </div>
                  ) : (
                    <ClickableImage
                      src={getImageSource(item)}
                      alt={item.alt || `Attachment ${index + 1}`}
                      className="max-w-[400px] max-h-[30vh] rounded-lg"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="break-words whitespace-pre-wrap overflow-wrap-anywhere">
              {String(parsedContent.text)}
            </div>
          )}

          {parsedContent.plan &&
            Array.isArray(parsedContent.plan) &&
            parsedContent.plan.length > 0 && (
              <PlanView
                task={""}
                plan={parsedContent.plan}
                setPlan={() => { }} // No-op since it's read-only
                viewOnly={true}
                onSavePlan={() => { }} // No-op since it's read-only
              />
            )}
        </>
      )}
    </div>
  );
});

RenderUserMessage.displayName = "RenderUserMessage";

// Main component
export const RenderMessage: React.FC<MessageProps> = memo(
  ({
    message,
    sessionId,
    messageIdx,
    runStatus,
    isLast = false,
    className = "",
    isEditable = false,
    hidden = false,
    is_step_repeated = false,
    is_step_failed = false,
    onSavePlan,
    onImageClick,
    onToggleHide,
    onRegeneratePlan,
    onEditMessage,
    onResendMessage,
    forceCollapsed = false,
    onLogMessageClick,
  }) => {
    const { darkMode } = React.useContext(appContext);
    const [isEditing, setIsEditing] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const editTriggerRef = React.useRef<(() => void) | null>(null);

    if (!message) return null;
    if (message.metadata?.type === "browser_address") return null;

    // Check if this is a FilesEvent - these should only be shown in panel, not in main chat
    const messageAny = message as any;
    if (messageAny.type === "FilesEvent" || message.metadata?.type === "FilesEvent") {
      return null;
    }

    const isUser = messageUtils.isUser(message.source);
    const isUserProxy = message.source === "user_proxy";
    const isOrchestrator = ["Orchestrator"].includes(message.source);

    // Check if this is a log message (from historical data or WebSocket)
    // Historical messages may have content_type="log" or type="AgentLogEvent" in config
    const isLogMessage =
      message.metadata?.type === "log" ||
      messageAny.content_type === "log" ||
      messageAny.type === "AgentLogEvent" ||
      message.metadata?.type === "AgentLogEvent";

    // For historical log messages, extract title and content, and normalize metadata
    let normalizedMessage = message;
    if (isLogMessage && !message.metadata?.type) {
      // Historical message: normalize to have metadata.type = "log"
      let contentValue: string;

      // 处理 title（优先使用 title 作为显示内容）
      if (messageAny.title) {
        contentValue = typeof messageAny.title === "string"
          ? messageAny.title
          : String(messageAny.title);
      }
      // 处理 content（可能是对象或字符串）
      else if (messageAny.content) {
        if (typeof messageAny.content === "string") {
          contentValue = messageAny.content;
        } else if (typeof messageAny.content === "object" && messageAny.content !== null) {
          // 如果是对象，尝试提取文本内容或序列化
          contentValue = messageAny.content.content ||
            messageAny.content.text ||
            JSON.stringify(messageAny.content);
        } else {
          contentValue = String(messageAny.content);
        }
      }
      // 回退到 message.content
      else if (message.content) {
        contentValue = typeof message.content === "string"
          ? message.content
          : String(message.content);
      }
      else {
        contentValue = "";
      }

      // 处理 log_content（保存原始的 content 用于 logExecution 面板）
      let logContentValue: string | undefined;
      if (messageAny.content) {
        if (typeof messageAny.content === "string") {
          logContentValue = messageAny.content;
        } else if (typeof messageAny.content === "object" && messageAny.content !== null) {
          logContentValue = messageAny.content.content ||
            messageAny.content.text ||
            JSON.stringify(messageAny.content);
        } else {
          logContentValue = String(messageAny.content);
        }
      } else if (message.content && typeof message.content === "string") {
        logContentValue = message.content;
      }

      normalizedMessage = {
        ...message,
        metadata: {
          ...message.metadata,
          type: "log",
          log_content: logContentValue,
        },
        content: contentValue,
      } as AgentMessageConfig;
    }

    const parsedContent: ParsedContent =
      isUser || isUserProxy
        ? parseUserContent(normalizedMessage)
        : (() => {
          // For non-user messages, ensure text is always a string or array
          let textValue: ParsedContent['text'];
          const contentValue = normalizedMessage.content;

          if (Array.isArray(contentValue)) {
            textValue = contentValue;
          } else if (typeof contentValue === "string") {
            textValue = contentValue;
          } else if (typeof contentValue === "object" && contentValue !== null) {
            // If it's an object, try to extract text or stringify
            const extracted = (contentValue as any).content ||
              (contentValue as any).text;
            if (typeof extracted === "string") {
              textValue = extracted;
            } else if (Array.isArray(extracted)) {
              textValue = extracted;
            } else {
              textValue = JSON.stringify(contentValue);
            }
          } else {
            textValue = String(contentValue || "");
          }

          return {
            text: textValue,
            metadata: normalizedMessage.metadata
          } as ParsedContent;
        })();
    // Use new plan message check
    const isPlanMsg = messageUtils.isPlanMessage(normalizedMessage.metadata);
    const orchestratorContent =
      isOrchestrator && typeof normalizedMessage.content === "string"
        ? parseorchestratorContent(normalizedMessage.content, normalizedMessage.metadata)
        : null;

    // Derive plan content by message type, not by source
    let planContent: any = null;
    if (isPlanMsg) {
      if (orchestratorContent?.content) {
        planContent = orchestratorContent.content;
      } else {
        const rawContent = normalizedMessage.content;
        if (typeof rawContent === "string") {
          try {
            planContent = JSON.parse(rawContent);
          } catch {
            planContent = rawContent;
          }
        } else {
          planContent = rawContent;
        }
      }

      // Basic shape guard
      if (!planContent || typeof planContent !== "object") {
        planContent = {};
      } else if (!Array.isArray((planContent as any).steps)) {
        planContent = { ...planContent, steps: [] };
      }
    }

    const startFlagValue = normalizedMessage.metadata?.start_flag;
    const isStartFlagActive =
      typeof startFlagValue === "string" &&
      startFlagValue.toLowerCase() === "yes";
    const streamSourceLabel =
      typeof normalizedMessage.metadata?.stream_source_label === "string"
        ? normalizedMessage.metadata.stream_source_label
        : undefined;
    const sourceBadgeText = streamSourceLabel || normalizedMessage.source;

    // 判断是否是 TextMessage 类型（使用已存在的 messageAny）
    const normalizedMessageAny = normalizedMessage as any;
    const isTextMessage = normalizedMessageAny.type === "TextMessage";

    // 判断是否是历史消息（没有 start_flag 或 metadata.is_save === "yes"）
    const isHistoricalMessage =
      !startFlagValue ||
      normalizedMessage.metadata?.is_save === "yes" ||
      normalizedMessage.metadata?.internal === "yes";

    // 对于 TextMessage 类型的历史消息，直接显示 source badge；对于流式消息，需要 start_flag 判断
    const shouldShowSourceBadge = !isUser && !isUserProxy && (
      (isTextMessage && isHistoricalMessage) || isStartFlagActive
    );

    // Hide regeneration request messages
    if (
      parsedContent.text ===
      "Regenerate a plan that improves on the current plan"
    ) {
      return null;
    }

    // Helper functions for user message actions
    const getTextContent = (): string => {
      if (messageUtils.isMultiModalContent(parsedContent.text)) {
        return parsedContent.text
          .filter((item): item is string => typeof item === "string")
          .map((item) => parseContent(item))
          .join("\n");
      }
      return String(parsedContent.text);
    };

    const handleCopy = async () => {
      const textToCopy = getTextContent();
      if (textToCopy.trim()) {
        try {
          // Check if clipboard API is available
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(textToCopy);
          } else {
            // Fallback for environments where clipboard API is not available
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
          }
          setIsCopied(true);
          // Reset after 2 seconds
          setTimeout(() => {
            setIsCopied(false);
          }, 2000);
        } catch (err) {
          console.error('Failed to copy text:', err);
        }
      }
    };

    // Get text content for non-user messages
    const getNonUserTextContent = (): string => {
      if (orchestratorContent?.type === "final-answer") {
        return orchestratorContent.content;
      }
      if (orchestratorContent?.type === "step-execution") {
        const stepContent = orchestratorContent.content;
        return stepContent.details || stepContent.progress_summary || "";
      }
      if (messageUtils.isToolCallContent(parsedContent.text)) {
        return JSON.stringify(parsedContent.text, null, 2);
      }
      if (messageUtils.isMultiModalContent(parsedContent.text)) {
        return parsedContent.text
          .filter((item): item is string => typeof item === "string")
          .map((item) => parseContent(item))
          .join("\n");
      }
      if (messageUtils.isFunctionExecutionResult(parsedContent.text)) {
        return parsedContent.text.map((result) => result.content).join("\n\n");
      }
      return String(parsedContent.text);
    };

    const handleNonUserCopy = async () => {
      const textToCopy = getNonUserTextContent();
      if (textToCopy.trim()) {
        try {
          // Check if clipboard API is available
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(textToCopy);
          } else {
            // Fallback for environments where clipboard API is not available
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
          }
          setIsCopied(true);
          // Reset after 2 seconds
          setTimeout(() => {
            setIsCopied(false);
          }, 2000);
        } catch (err) {
          console.error('Failed to copy text:', err);
        }
      }
    };

    const canEditUserMessage = (isUser || isUserProxy) &&
      !messageUtils.isMultiModalContent(parsedContent.text) &&
      !parsedContent.plan;

    return (
      <div
        className={`relative ${isUser || isUserProxy ? "mb-8" : "mb-3"} ${className} w-full break-words ${hidden &&
          (!orchestratorContent ||
            orchestratorContent.type !== "step-execution")
          ? "hidden"
          : ""
          }`}
      >
        <div
          className={`flex group ${isUser || isUserProxy ? "justify-end" : "justify-start"
            } items-start w-full transition-all duration-200`}
        >
          <div className="relative flex flex-col items-end">
            <div
              className={`${isUser || isUserProxy
                ? `text-primary rounded-2xl bg-tertiary rounded-tr-sm px-4 py-2 ${parsedContent.plan && parsedContent.plan.length > 0
                  ? "w-[100%]"
                  : "max-w-[100%]"
                }`
                : "w-full text-primary"
                } break-words overflow-hidden`}
            >
              {/* Show user message content first */}
              {(isUser || isUserProxy) && (
                <RenderUserMessage
                  parsedContent={parsedContent}
                  isUserProxy={isUserProxy}
                  messageIdx={messageIdx}
                  onEditMessage={(idx, content) => {
                    onEditMessage?.(idx, content);
                    setIsEditing(false);
                  }}
                  onResendMessage={(content) => {
                    onResendMessage?.(content);
                    setIsEditing(false);
                  }}
                  runStatus={runStatus}
                  isEditing={isEditing}
                  onStartEdit={() => setIsEditing(true)}
                  onCancelEdit={() => setIsEditing(false)}
                />
              )}
            </div>

            {/* Action buttons - absolutely positioned at bottom of message bubble */}
            {(isUser || isUserProxy) && !isEditing && (
              <div className={`flex items-center gap-1 absolute ${isUser || isUserProxy ? 'right-0' : 'left-0'} top-full z-10 px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto`}>
                <button
                  onClick={handleCopy}
                  className="p-1.5 text-secondary hover:text-primary transition-colors rounded hover:bg-secondary/50"
                  title={isCopied ? "Copied!" : "Copy message"}
                >
                  {isCopied ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
                {canEditUserMessage && (onEditMessage || onResendMessage) && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 text-secondary hover:text-primary transition-colors rounded hover:bg-secondary/50"
                    title="Edit message"
                  >
                    <Edit size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Non-user message content */}
          {!isUser && !isUserProxy && (
            <div className="w-full text-primary break-words overflow-hidden">
              {shouldShowSourceBadge && (
                <div className="relative mb-2 inline-flex items-center py-1.5 text-base font-semibold text-primary gap-2">
                  <span className=""><Bot /></span>
                  <span>{sourceBadgeText}</span>
                </div>
              )}
              {/* Handle other content types */}
              {!isUser &&
                !isUserProxy &&
                (isPlanMsg ? (
                  <RenderPlan
                    content={planContent || {}}
                    isEditable={isEditable}
                    onSavePlan={onSavePlan}
                    onRegeneratePlan={onRegeneratePlan}
                    forceCollapsed={forceCollapsed}
                  />
                ) : orchestratorContent?.type === "step-execution" ? (
                  <RenderStepExecution
                    content={orchestratorContent.content}
                    hidden={hidden}
                    is_step_repeated={is_step_repeated}
                    is_step_failed={is_step_failed}
                    runStatus={runStatus || ""}
                    onToggleHide={onToggleHide}
                  />
                ) : orchestratorContent?.type === "final-answer" ? (
                  <RenderFinalAnswer
                    content={orchestratorContent.content}
                    sessionId={sessionId}
                    messageIdx={messageIdx}
                  />
                ) : messageUtils.isToolCallContent(parsedContent.text) ? (
                  <RenderToolCall content={parsedContent.text} />
                ) : messageUtils.isMultiModalContent(parsedContent.text) ? (
                  normalizedMessage.metadata?.type === "browser_screenshot" ? (
                    <RenderMultiModalBrowserStep
                      content={parsedContent.text}
                      onImageClick={onImageClick}
                    />
                  ) : (
                    <RenderMultiModal content={parsedContent.text} />
                  )
                ) : messageUtils.isFunctionExecutionResult(parsedContent.text) ? (
                  <RenderToolResult content={parsedContent.text} />
                ) : (
                  <div className="break-words">
                    {normalizedMessage.metadata?.type === "file" ? (
                      <RenderFile message={normalizedMessage} />
                    ) : isLogMessage ? (
                      <div
                        className={`flex items-start gap-2 ${onLogMessageClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                        onClick={onLogMessageClick ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onLogMessageClick) {
                            onLogMessageClick();
                          }
                        } : undefined}
                        title={onLogMessageClick ? "点击查看详细日志" : undefined}
                      >
                        <Settings size={18}
                          className="text-purple-500 flex-shrink-0 mt-0.5"
                          onClick={onLogMessageClick ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onLogMessageClick();
                          } : undefined} />

                        <div
                          className="flex-1"
                          onClick={onLogMessageClick ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onLogMessageClick();
                          } : undefined}
                        >
                          <div style={{ pointerEvents: onLogMessageClick ? 'none' : 'auto' }}>
                            <MarkdownRenderer
                              content={(() => {
                                if (typeof parsedContent.text === "string") {
                                  return parsedContent.text;
                                } else if (Array.isArray(parsedContent.text)) {
                                  // Filter out non-string items and join
                                  const textArray = parsedContent.text as any[];
                                  const stringItems = textArray.filter(
                                    (item: any): item is string => typeof item === "string"
                                  );
                                  return stringItems.join("\n");
                                } else {
                                  return String(parsedContent.text || "");
                                }
                              })()}
                              indented={
                                !orchestratorContent ||
                                orchestratorContent.type !== "default"
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <MarkdownRenderer
                        content={(() => {
                          if (typeof parsedContent.text === "string") {
                            return parsedContent.text;
                          } else if (Array.isArray(parsedContent.text)) {
                            // Filter out non-string items and join
                            const textArray = parsedContent.text as any[];
                            const stringItems = textArray.filter(
                              (item: any): item is string => typeof item === "string"
                            );
                            return stringItems.join("\n");
                          } else {
                            return String(parsedContent.text || "");
                          }
                        })()}
                        indented={
                          !orchestratorContent ||
                          orchestratorContent.type !== "default"
                        }
                      />
                    )}
                  </div>
                )
                )}
              {/* Copy button for non-user messages (excluding plan messages) */}
              {!isPlanMsg && (
                <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={handleNonUserCopy}
                    className="p-1.5 text-secondary hover:text-primary transition-colors rounded hover:bg-secondary/50"
                    title={isCopied ? "Copied!" : "Copy message"}
                  >
                    {isCopied ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

RenderMessage.displayName = "RenderMessage";