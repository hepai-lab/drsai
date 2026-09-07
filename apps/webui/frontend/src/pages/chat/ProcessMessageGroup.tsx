import React, { useRef, useEffect, useState, useCallback, memo } from "react";
import { Message } from "../../components/types/datamodel";
import {
  RenderMessage,
  RenderToolCallSummaryCard,
  extractToolLabel,
  isHiddenProcessToolName,
} from "./rendermessage";
import MarkdownRenderer from "../../components/common/markdownrender";
import TypewriterMessage from "./TypewriterMessage";
import { streamMessageId } from "./chatStreamReducer";
import {
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
} from "lucide-react";

interface ProcessMessageGroupItem {
  idx: number;
  msg: Message;
}

interface ProcessMessageGroupProps {
  items: ProcessMessageGroupItem[];
  runStatus: string;
  onLogMessageClick?: () => void;
}

const SCROLL_PARENT_SELECTOR = ".question-nav-scroll";

function cfgMeta(msg: Message): { cfg: any; meta: Record<string, unknown> } {
  const cfg = msg.config as any;
  return { cfg, meta: (cfg.metadata || {}) as Record<string, unknown> };
}

function isToolsCallLog(msg: Message): boolean {
  const { cfg, meta } = cfgMeta(msg);
  return meta.content_type === "tools" || cfg.content_type === "tools";
}

function isToolSummaryMsg(msg: Message): boolean {
  const { cfg, meta } = cfgMeta(msg);
  return (
    cfg.type === "ToolCallSummaryMessage" ||
    meta.type === "ToolCallSummaryMessage"
  );
}

function messageText(msg: Message): string {
  return typeof msg.config.content === "string" ? msg.config.content : "";
}

function toolLabelOf(msg: Message): string {
  const { cfg } = cfgMeta(msg);
  const title = typeof cfg.title === "string" ? cfg.title : "";
  return extractToolLabel(title || messageText(msg));
}

function toolResultText(log: Message, result: Message): string {
  const fromResult = messageText(result).trim();
  if (fromResult) return fromResult;
  const summary = cfgMeta(log).meta.tool_call_summary;
  return typeof summary === "string" ? summary.trim() : "";
}

function measureFillHeight(root: HTMLElement): number {
  const scrollParent = root.closest(
    SCROLL_PARENT_SELECTOR
  ) as HTMLElement | null;
  if (!scrollParent) return 288;

  const scrollRect = scrollParent.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const offsetTop = rootRect.top - scrollRect.top;
  const available = scrollParent.clientHeight - offsetTop - 8;
  return Math.max(160, Math.min(available, scrollParent.clientHeight - 24));
}

const ProcessMessageGroup: React.FC<ProcessMessageGroupProps> = memo(
  ({ items, runStatus, onLogMessageClick }) => {
    const isRunning =
      runStatus === "active" ||
      runStatus === "streaming" ||
      runStatus === "connected" ||
      runStatus === "pausing" ||
      runStatus === "resuming";
    const [collapsed, setCollapsed] = useState(false);
    const [maximized, setMaximized] = useState(false);
    const [fillHeight, setFillHeight] = useState<number | null>(null);
    const [revealTick, setRevealTick] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    /** Inner-box only: follow latest process steps until the user scrolls inside. */
    const followBottomRef = useRef(true);
    const programmaticScrollRef = useRef(false);

    const onBurstComplete = useCallback(() => {
      setRevealTick((t) => t + 1);
    }, []);

    const handleProcessScroll = useCallback(() => {
      const el = containerRef.current;
      if (!el || programmaticScrollRef.current) return;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      followBottomRef.current = distanceFromBottom <= 32;
    }, []);

    const updateFillHeight = useCallback(() => {
      if (!maximized || !rootRef.current) {
        setFillHeight(null);
        return;
      }
      setFillHeight(measureFillHeight(rootRef.current));
    }, [maximized]);

    useEffect(() => {
      updateFillHeight();
      if (!maximized) return;

      const root = rootRef.current;
      const scrollParent = root?.closest(SCROLL_PARENT_SELECTOR) as
        | HTMLElement
        | undefined;
      window.addEventListener("resize", updateFillHeight);
      scrollParent?.addEventListener("scroll", updateFillHeight, {
        passive: true,
      });

      const ro =
        scrollParent && typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(updateFillHeight)
          : null;
      if (ro && scrollParent) ro.observe(scrollParent);

      return () => {
        window.removeEventListener("resize", updateFillHeight);
        scrollParent?.removeEventListener("scroll", updateFillHeight);
        ro?.disconnect();
      };
    }, [maximized, updateFillHeight, collapsed]);

    // Keep inner follow independent of the thread. Never let wheel/touch
    // inside this box scroll or lock `.question-nav-scroll`.
    useEffect(() => {
      const el = containerRef.current;
      if (!el || collapsed) return;

      const onWheel = (event: WheelEvent) => {
        event.stopPropagation();
        const overflowing = el.scrollHeight > el.clientHeight + 1;
        const atTop = el.scrollTop <= 0;
        const distanceFromBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight;
        const atBottom = distanceFromBottom <= 1;

        if (!overflowing || (atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) {
          event.preventDefault();
        }

        if (event.deltaY < 0) {
          followBottomRef.current = false;
        } else if (distanceFromBottom <= 32) {
          followBottomRef.current = true;
        }
      };

      const stopThreadScroll = (event: Event) => {
        event.stopPropagation();
      };

      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("touchmove", stopThreadScroll, { passive: true });
      return () => {
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("touchmove", stopThreadScroll);
      };
    }, [collapsed, maximized, fillHeight]);

    useEffect(() => {
      if (collapsed) return;
      const el = containerRef.current;
      if (!el || !followBottomRef.current) return;
      programmaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    }, [items, collapsed, maximized, revealTick, fillHeight]);

    if (items.length === 0) return null;

    const stepLabel = `${items.length} 步`;

    let revealCutoff = items.length;
    for (let i = 0; i < items.length; i++) {
      const { idx, msg } = items[i];
      const meta = (msg.config as any).metadata;
      if (meta?._is_burst && !meta?._is_final_reply) {
        const burstKey = `intermediate-burst-${idx}`;
        if (!animatedIntermediateBurstKeys.has(burstKey)) {
          revealCutoff = i + 1;
          break;
        }
      }
    }

    const handleToggleCollapsed = () => {
      setCollapsed((c) => {
        if (c) {
          followBottomRef.current = true;
          return false;
        }
        setMaximized(false);
        return true;
      });
    };

    const handleToggleMaximized = () => {
      if (collapsed) {
        followBottomRef.current = true;
        setCollapsed(false);
        setMaximized(true);
        return;
      }
      setMaximized((m) => !m);
    };

    const contentScrollClass = maximized
      ? "overflow-y-auto overscroll-y-contain min-h-0"
      : "overflow-y-auto overscroll-y-contain max-h-72";

    const contentStyle: React.CSSProperties | undefined = maximized
      ? { height: fillHeight ?? 288, maxHeight: fillHeight ?? 288 }
      : undefined;

    return (
      <div
        ref={rootRef}
        className={`relative mb-3 w-full ${maximized ? "min-h-0" : ""}`}
      >
        <div className="flex items-center rounded-lg transition-colors hover:bg-secondary/[0.06]">
          <button
            type="button"
            onClick={handleToggleCollapsed}
            className="group flex flex-1 min-w-0 items-center gap-1.5 py-0.5 rounded-md text-left text-xs font-normal text-secondary/50 transition-colors hover:bg-secondary/10"
          >
            {collapsed ? (
              <ChevronRight size={16} className="shrink-0 text-secondary/45" aria-hidden />
            ) : (
              <ChevronDown size={16} className="shrink-0 text-secondary/45" aria-hidden />
            )}
            <span>
              处理过程
            </span>
            <span className="text-[11px] text-secondary/40 tabular-nums">
              {stepLabel}
            </span>
            {isRunning && !collapsed && (
              <span className="flex items-center gap-1.5 text-[11px] text-secondary/45">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-magenta-500/70 animate-pulse"
                  aria-hidden
                />
                进行中
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleToggleMaximized}
            className="shrink-0 p-1.5 rounded-md text-secondary/45 hover:text-secondary/70 hover:bg-secondary/15 transition-colors"
            title={
              maximized
                ? "退出全屏展开"
                : collapsed
                  ? "展开并填满剩余区域"
                  : "填满剩余区域"
            }
            aria-label={
              maximized
                ? "退出全屏展开"
                : collapsed
                  ? "展开并填满剩余区域"
                  : "填满剩余区域"
            }
            aria-pressed={maximized}
          >
            {maximized ? (
              <Minimize2 className="w-3.5 h-3.5" aria-hidden />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" aria-hidden />
            )}
          </button>
        </div>

        {!collapsed && (
          <div
            ref={containerRef}
            onScroll={handleProcessScroll}
            className={`mt-1 pl-5 border-l border-secondary/20 space-y-0.5 ${contentScrollClass} ${maximized ? "rounded-md border border-secondary/15 bg-secondary/[0.03] pr-2 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md" : ""}`}
            style={contentStyle}
          >
            {items.map(({ idx, msg }, listIdx) => {
              if (listIdx >= revealCutoff) return null;

              const cfg = msg.config as any;
              const meta = cfg.metadata;

              if (meta?._is_burst && !meta?._is_final_reply) {
                const content =
                  typeof msg.config.content === "string"
                    ? msg.config.content
                    : "";
                const burstKey = `intermediate-burst-${idx}`;
                if (animatedIntermediateBurstKeys.has(burstKey)) {
                  return (
                    <div
                      key={burstKey}
                      className="py-1 text-xs leading-relaxed text-secondary/65"
                    >
                      <MarkdownRenderer content={content} />
                    </div>
                  );
                }
                animatedIntermediateBurstKeys.add(burstKey);
                return (
                  <div
                    key={burstKey}
                    className="py-1 text-xs leading-relaxed text-secondary/65"
                  >
                    <TypewriterMessage
                      content={content}
                      speed={600}
                      onComplete={onBurstComplete}
                    />
                  </div>
                );
              }

              if (meta?._is_streaming_chunk || meta?._sealed_chunk) {
                const content =
                  typeof msg.config.content === "string"
                    ? msg.config.content
                    : "";
                return (
                  <div
                    key={`pg-chunk-${streamMessageId(msg) || msg.id || idx}`}
                    className="py-1 text-xs leading-relaxed text-secondary/65"
                  >
                    <MarkdownRenderer content={content} />
                  </div>
                );
              }

              if (cfg.type === "FilesEvent" || meta?.type === "FilesEvent") {
                return null;
              }

              if (cfg.type === "ThoughtEvent" || meta?.type === "ThoughtEvent") {
                const content =
                  typeof msg.config.content === "string"
                    ? msg.config.content
                    : "";
                if (!content.trim()) return null;
                return (
                  <div
                    key={`pg-thought-${streamMessageId(msg) || msg.id || idx}`}
                    className={`py-1 text-[11px] leading-relaxed text-secondary/45 ${maximized ? "" : "line-clamp-3"}`}
                  >
                    <MarkdownRenderer content={content} />
                  </div>
                );
              }

              if (
                listIdx + 1 < revealCutoff &&
                isToolsCallLog(msg) &&
                isToolSummaryMsg(items[listIdx + 1].msg)
              ) {
                if (isHiddenProcessToolName(toolLabelOf(msg))) return null;
                const result = items[listIdx + 1];
                return (
                  <div
                    key={`pg-tool-${streamMessageId(msg) || msg.id || idx}`}
                    className="py-0.5"
                  >
                    <RenderToolCallSummaryCard
                      content={toolResultText(msg, result.msg)}
                      label={toolLabelOf(msg)}
                      defaultCollapsed={true}
                      compact={true}
                    />
                  </div>
                );
              }

              if (isToolSummaryMsg(msg) && listIdx > 0 && isToolsCallLog(items[listIdx - 1].msg)) {
                return null;
              }

              if (isToolsCallLog(msg) && isHiddenProcessToolName(toolLabelOf(msg))) {
                return null;
              }

              return (
                <RenderMessage
                  key={`pg-${streamMessageId(msg) || msg.id || idx}`}
                  message={msg.config}
                  sessionId={msg.session_id}
                  messageIdx={idx}
                  runStatus={runStatus}
                  isCompact={true}
                  onLogMessageClick={onLogMessageClick}
                  isLast={false}
                  isEditable={false}
                  hidden={false}
                  forceCollapsed={false}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }
);

ProcessMessageGroup.displayName = "ProcessMessageGroup";

const animatedIntermediateBurstKeys = new Set<string>();

export default ProcessMessageGroup;
