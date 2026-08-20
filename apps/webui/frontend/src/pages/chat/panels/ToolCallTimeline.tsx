import React, { useMemo } from "react";
import { Run, Message, FunctionCall, FunctionExecutionResult } from "../../../components/types/datamodel";
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, Terminal } from "lucide-react";

export interface ToolCallTimelineProps {
  run: Run | null;
}

interface ToolCallEntry {
  /** Sequential index (1-based) */
  index: number;
  /** Tool name from the function call */
  toolName: string;
  /** Parameters (JSON string) */
  arguments: string;
  /** Status */
  status: "running" | "success" | "error";
  /** Result content (success output or error message) */
  resultContent?: string;
  /** Timestamp */
  timestamp?: number;
}

/**
 * ToolCallTimeline — 工具调用时间线面板
 *
 * 从 run.messages 中提取 AgentLogEvent (content_type="tools")
 * 和 FunctionExecutionResult，配对展示为时间线条目。
 */
const ToolCallTimeline: React.FC<ToolCallTimelineProps> = ({ run }) => {
  // Parse tool calls from messages
  const entries = useMemo((): ToolCallEntry[] => {
    if (!run?.messages?.length) return [];

    const result: ToolCallEntry[] = [];
    const messages = run.messages;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const config = (msg.config || msg) as any;
      const meta = config.metadata || {};

      // Case 1: AgentLogEvent with content_type === "tools"
      const isToolsLog =
        config.type === "AgentLogEvent" ||
        meta.type === "AgentLogEvent" ||
        config.content_type === "tools" ||
        meta.content_type === "tools";

      if (isToolsLog && (config.content_type === "tools" || meta.content_type === "tools")) {
        // Extract tool names from title: "I am using tools: tool1 tool2"
        const title: string = config.title || config.content || "";
        const toolNames = title
          .replace(/^I am using tools:\s*/i, "")
          .split(/\s+/)
          .filter(Boolean);

        // Raw content is str(FunctionCall[]) — try to parse
        let rawContent = config.log_content || meta.log_content || "";
        if (!rawContent && typeof config.content === "string" && config.content !== title) {
          rawContent = config.content;
        }

        // Try to parse FunctionCall objects from the raw content
        let parsedCalls: FunctionCall[] = [];
        try {
          const parsed = JSON.parse(rawContent);
          if (Array.isArray(parsed)) {
            parsedCalls = parsed as FunctionCall[];
          }
        } catch {
          // Not JSON — use tool names only
        }

        for (let t = 0; t < toolNames.length; t++) {
          const fnName = toolNames[t];
          const fnCall = parsedCalls.find((c) => c.name === fnName);
          result.push({
            index: result.length + 1,
            toolName: fnName,
            arguments: fnCall?.arguments
              ? (() => {
                  try {
                    return JSON.stringify(JSON.parse(fnCall.arguments), null, 2);
                  } catch {
                    return fnCall.arguments;
                  }
                })()
              : "{}",
            status: "running",
            timestamp: typeof config.send_time_stamp === "number" ? config.send_time_stamp : undefined,
          });
        }

        // Look ahead for matching FunctionExecutionResult (from next messages)
        for (let j = i + 1; j < messages.length && j < i + 10; j++) {
          const nextMsg = messages[j];
          const nextConfig = (nextMsg.config || nextMsg) as any;
          const nextContent = nextConfig.content || "";

          if (typeof nextContent === "string") continue;

          // Check if it's a ToolCallResultMessage (FunctionExecutionResult[])
          if (Array.isArray(nextContent)) {
            const execResults = nextContent as FunctionExecutionResult[];
            if (execResults.length > 0 && "call_id" in execResults[0]) {
              // Match results to tool calls by order
              for (let k = 0; k < Math.min(execResults.length, result.length); k++) {
                const entry = result[result.length - toolNames.length + k];
                if (entry) {
                  entry.status = execResults[k].content?.startsWith("Error")
                    ? "error"
                    : "success";
                  entry.resultContent = execResults[k].content?.slice(0, 500);
                }
              }
              break;
            }
          }
        }
      }

      // Case 2: Standalone ToolCallResultMessage (when tools log not emitted)
      if (Array.isArray(config.content) && config.content.length > 0) {
        const first = config.content[0];
        if (typeof first === "object" && first !== null && "call_id" in first) {
          // Already handled above by look-ahead
        }
      }
    }

    return result;
  }, [run]);

  if (!run || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 py-12">
        <Terminal size={32} className="mb-2 opacity-50" />
        <span className="text-sm">暂无工具调用记录</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-secondary/30">
        <div className="flex items-center gap-2">
          <Terminal size={15} className="text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-medium">工具调用</span>
        </div>
        <span className="text-xs text-gray-400">
          {entries.filter((e) => e.status === "success").length}/{entries.length} 成功
        </span>
      </div>

      {/* Timeline list — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {entries.map((entry) => (
          <ToolCallCard key={`${entry.index}-${entry.toolName}`} entry={entry} />
        ))}
      </div>
    </div>
  );
};

/* ─── Single timeline card ─────────────────────────────── */

const ToolCallCard: React.FC<{ entry: ToolCallEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = React.useState(false);

  const statusIcon = (() => {
    switch (entry.status) {
      case "running":
        return <Loader2 size={14} className="animate-spin text-violet-500" />;
      case "success":
        return <CheckCircle size={14} className="text-green-500" />;
      case "error":
        return <XCircle size={14} className="text-red-500" />;
    }
  })();

  const statusLabel = (() => {
    switch (entry.status) {
      case "running":
        return "执行中";
      case "success":
        return "成功";
      case "error":
        return "失败";
    }
  })();

  return (
    <div className="border-b border-secondary/20 last:border-b-0">
      {/* Clickable header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/10 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand/collapse */}
        <span className="shrink-0 text-gray-400">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>

        {/* Status icon */}
        <span className="shrink-0">{statusIcon}</span>

        {/* Tool name */}
        <span className="flex-1 text-sm font-mono truncate">{entry.toolName}</span>

        {/* Status badge */}
        <span
          className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-full ${
            entry.status === "success"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : entry.status === "error"
              ? "bg-red-500/10 text-red-600 dark:text-red-400"
              : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
          }`}
        >
          {statusLabel}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-2 pl-9 space-y-2">
          {/* Arguments */}
          {entry.arguments && entry.arguments !== "{}" && (
            <div>
              <div className="text-[11px] text-gray-400 mb-0.5">参数</div>
              <pre className="text-xs bg-secondary/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
                {entry.arguments}
              </pre>
            </div>
          )}

          {/* Result */}
          {entry.resultContent && (
            <div>
              <div className="text-[11px] text-gray-400 mb-0.5">返回值</div>
              <pre className="text-xs bg-secondary/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
                {entry.resultContent}
              </pre>
            </div>
          )}

          {/* No details */}
          {(!entry.arguments || entry.arguments === "{}") && !entry.resultContent && (
            <div className="text-xs text-gray-400 italic">暂无详情</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallTimeline;
