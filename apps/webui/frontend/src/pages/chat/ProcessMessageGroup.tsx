import React, { useRef, useEffect, useState, useCallback, memo } from "react";
import { Message } from "../../components/types/datamodel";
import { RenderMessage } from "./rendermessage";
import MarkdownRenderer from "../../components/common/markdownrender";
import TypewriterMessage from "./TypewriterMessage";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ProcessMessageGroupItem {
  idx: number;
  msg: Message;
}

interface ProcessMessageGroupProps {
  items: ProcessMessageGroupItem[];
  runStatus: string;
  onLogMessageClick?: () => void;
}

const ProcessMessageGroup: React.FC<ProcessMessageGroupProps> = memo(
  ({ items, runStatus, onLogMessageClick }) => {
    const isRunning = runStatus === "active" || runStatus === "streaming" || runStatus === "connected" || runStatus === "pausing" || runStatus === "resuming";
    // Expand while running, collapse when done
    const [collapsed, setCollapsed] = useState(!isRunning);
    // Tick to force re-render when a typewriter completes, advancing the reveal cursor
    const [revealTick, setRevealTick] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const prevRunningRef = useRef(isRunning);

    const onBurstComplete = useCallback(() => {
      setRevealTick((t) => t + 1);
    }, []);

    // Auto-expand when run starts, auto-collapse when run finishes
    useEffect(() => {
      if (!prevRunningRef.current && isRunning) {
        setCollapsed(false);
      } else if (prevRunningRef.current && !isRunning) {
        setCollapsed(true);
      }
      prevRunningRef.current = isRunning;
    }, [isRunning]);

    // Auto-scroll to bottom when items change while expanded
    useEffect(() => {
      if (!collapsed) {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    }, [items, collapsed, revealTick]);

    if (items.length === 0) return null;

    const stepLabel = `${items.length} 步`;

    // Determine the reveal cutoff: find the FIRST intermediate burst that is
    // currently animating (not yet in animatedIntermediateBurstKeys). Everything
    // after that index is hidden until its typewriter calls onBurstComplete.
    // We compute this on every render (revealTick drives re-renders when a burst
    // completes, so the cutoff naturally advances item by item).
    let revealCutoff = items.length; // default: show all
    for (let i = 0; i < items.length; i++) {
      const { idx, msg } = items[i];
      const meta = (msg.config as any).metadata;
      if (meta?._is_burst && !meta?._is_final_reply) {
        const burstKey = `intermediate-burst-${idx}`;
        if (!animatedIntermediateBurstKeys.has(burstKey)) {
          // This burst is currently animating — hide everything after it
          revealCutoff = i + 1; // include this burst itself, cut everything after
          break;
        }
      }
    }

    return (
      <div className="relative mb-3 border border-secondary/30 rounded-lg overflow-hidden bg-secondary/5">
        {/* Header — always visible, click to toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 border-b border-secondary/20 bg-secondary/10 hover:bg-secondary/20 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-secondary/60 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-secondary/60 shrink-0" />
          )}
          <span className="text-xs text-secondary/60 font-medium">智能体处理过程</span>
          {collapsed && (
            <span className="ml-auto text-xs text-secondary/40">{stepLabel}</span>
          )}
          {isRunning && !collapsed && (
            <span className="ml-auto flex items-center gap-1 text-xs text-secondary/40">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              处理中
            </span>
          )}
        </button>

        {/* Content — only rendered when expanded */}
        {!collapsed && (
          <div
            ref={containerRef}
            className="overflow-y-auto scroll-smooth px-2 py-1 max-h-80"
          >
            {items.map(({ idx, msg }, listIdx) => {
              // Hide items beyond the current animation cutoff
              if (listIdx >= revealCutoff) return null;

              const cfg = msg.config as any;
              const meta = cfg.metadata;

              // Backend-buffered intermediate burst: render with typewriter effect
              // so the user sees the content animate in as if it's streaming.
              if (meta?._is_burst && !meta?._is_final_reply) {
                const content =
                  typeof msg.config.content === "string" ? msg.config.content : "";
                const burstKey = `intermediate-burst-${idx}`;
                if (animatedIntermediateBurstKeys.has(burstKey)) {
                  return (
                    <div key={burstKey} className="py-2 px-1 text-sm leading-relaxed">
                      <MarkdownRenderer content={content} />
                    </div>
                  );
                }
                animatedIntermediateBurstKeys.add(burstKey);
                return (
                  <div key={burstKey} className="py-2 px-1 text-sm leading-relaxed">
                    <TypewriterMessage content={content} speed={600} onComplete={onBurstComplete} />
                  </div>
                );
              }

              // Active streaming chunk OR sealed chunk (prior burst): both render as
              // static markdown inside the box at their natural chronological position.
              if (meta?._is_streaming_chunk || meta?._sealed_chunk) {
                const content =
                  typeof msg.config.content === "string" ? msg.config.content : "";
                return (
                  <div key={`pg-chunk-${idx}`} className="py-2 px-1 text-sm leading-relaxed">
                    <MarkdownRenderer content={content} />
                  </div>
                );
              }

              // FilesEvent messages render as FilesEventCards OUTSIDE the box (in runview),
              // at the end of the turn. Skip them here.
              if (cfg.type === "FilesEvent" || meta?.type === "FilesEvent") {
                return null;
              }

              // ThoughtEvent (or synthetic streaming-think from <think> tags): render as
              // a muted italic annotation with a left border, visually distinct from tool
              // logs and reply chunks.
              if (cfg.type === "ThoughtEvent" || meta?.type === "ThoughtEvent") {
                const content = typeof msg.config.content === "string" ? msg.config.content : "";
                return (
                  <div key={`pg-thought-${idx}`} className="py-1.5 px-2 text-xs leading-relaxed text-secondary/50 italic border-l-2 border-secondary/20 ml-1 my-1">
                    <MarkdownRenderer content={content} />
                  </div>
                );
              }

              return (
                <RenderMessage
                  key={`pg-${idx}-${msg.config.version || 0}`}
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
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="w-full flex items-center justify-center gap-1 py-1.5 mt-1 border-t border-secondary/20 text-xs text-secondary/40 hover:text-secondary/70 hover:bg-secondary/10 transition-colors rounded-b"
            >
              <ChevronDown className="w-3.5 h-3.5 rotate-180" />
              收起
            </button>
          </div>
        )}
      </div>
    );
  }
);

ProcessMessageGroup.displayName = "ProcessMessageGroup";

// Module-level — survives component unmount/remount (tab switches).
const animatedIntermediateBurstKeys = new Set<string>();

export default ProcessMessageGroup;
