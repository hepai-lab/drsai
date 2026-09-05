import React, { useRef, useEffect, useState, useCallback, memo } from "react";
import { Message } from "../../components/types/datamodel";
import { RenderMessage } from "./rendermessage";
import MarkdownRenderer from "../../components/common/markdownrender";
import TypewriterMessage from "./TypewriterMessage";
import ProcessMessageGroupItem from "./ProcessMessageGroupItem";
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
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
    const [collapsed, setCollapsed] = useState(!isRunning);
    const [maximized, setMaximized] = useState(false);
    const [fillHeight, setFillHeight] = useState<number | null>(null);
    const [revealTick, setRevealTick] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const prevRunningRef = useRef(isRunning);

    const onBurstComplete = useCallback(() => {
      setRevealTick((t) => t + 1);
    }, []);

    const updateFillHeight = useCallback(() => {
      if (!maximized || !rootRef.current) {
        setFillHeight(null);
        return;
      }
      setFillHeight(measureFillHeight(rootRef.current));
    }, [maximized]);

    useEffect(() => {
      if (!prevRunningRef.current && isRunning) {
        setCollapsed(false);
      } else if (prevRunningRef.current && !isRunning) {
        setCollapsed(true);
        setMaximized(false);
      }
      prevRunningRef.current = isRunning;
    }, [isRunning]);

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

    useEffect(() => {
      if (!collapsed && !maximized) {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    }, [items, collapsed, maximized, revealTick]);

    useEffect(() => {
      if (!collapsed && maximized) {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
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
        if (c) return false;
        setMaximized(false);
        return true;
      });
    };

    const handleToggleMaximized = () => {
      if (collapsed) {
        setCollapsed(false);
        setMaximized(true);
        return;
      }
      setMaximized((m) => !m);
    };

    const contentScrollClass = maximized
      ? "overflow-y-auto scroll-smooth min-h-0"
      : "overflow-y-auto scroll-smooth max-h-72";

    const contentStyle: React.CSSProperties | undefined = maximized
      ? { height: fillHeight ?? 288, maxHeight: fillHeight ?? 288 }
      : undefined;

    return (
      <div
        ref={rootRef}
        className={`relative mb-3 w-full ${maximized ? "min-h-0" : ""}`}
      >
        <div
          className="flex items-center gap-0.5 px-1 py-0.5 rounded-lg transition-colors hover:bg-secondary/[0.06]"
        >
          <button
            type="button"
            onClick={handleToggleCollapsed}
            className="group flex flex-1 min-w-0 items-center gap-2 px-1 py-1 rounded-md text-left transition-colors hover:bg-secondary/10"
          >
            {collapsed ? (
              <ChevronRight
                className="w-3.5 h-3.5 text-secondary/50 shrink-0"
                aria-hidden
              />
            ) : (
              <ChevronDown
                className="w-3.5 h-3.5 text-secondary/50 shrink-0"
                aria-hidden
              />
            )}
            <Sparkles
              className="w-3.5 h-3.5 text-secondary/40 shrink-0"
              aria-hidden
            />
            <span className="text-xs font-medium text-secondary/70">
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
            className={`mt-1 ml-1 pl-3 border-l border-secondary/20 space-y-0.5 ${contentScrollClass} ${maximized ? "rounded-md border border-secondary/15 bg-secondary/[0.03] pr-2 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md" : ""}`}
            style={contentStyle}
          >
            {items.map(({ idx, msg }, listIdx) => (
              <ProcessMessageGroupItem
                key={`pg-item-${idx}`}
                idx={idx}
                msg={msg}
                runStatus={runStatus}
                maximized={maximized}
                onLogMessageClick={onLogMessageClick}
                onBurstComplete={onBurstComplete}
                animatedBurstKeys={animatedIntermediateBurstKeys}
                revealCutoff={revealCutoff}
                listIdx={listIdx}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

ProcessMessageGroup.displayName = "ProcessMessageGroup";

const animatedIntermediateBurstKeys = new Set<string>();

export default ProcessMessageGroup;
