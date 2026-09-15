import React, { memo } from "react";
import { Message } from "../../components/types/datamodel";
import { RenderMessage } from "./rendermessage";
import MarkdownRenderer from "../../components/common/markdownrender";
import TypewriterMessage from "./TypewriterMessage";

export interface ProcessItemProps {
  idx: number;
  msg: Message;
  runStatus: string;
  maximized: boolean;
  onLogMessageClick?: () => void;
  onBurstComplete?: () => void;
  animatedBurstKeys: Set<string>;
  revealCutoff: number;
  listIdx: number;
}

/**
 * Memoized single item for ProcessMessageGroup.
 *
 * The parent passes a stable `msg` reference (same object until the
 * message actually changes), so React.memo skips re-rendering items
 * whose props haven't changed — even when the parent's `items` array
 * is a new reference on every streaming token batch.
 */
const ProcessMessageGroupItem: React.FC<ProcessItemProps> = memo(
  ({
    idx,
    msg,
    runStatus,
    maximized,
    onLogMessageClick,
    onBurstComplete,
    animatedBurstKeys,
    revealCutoff,
    listIdx,
  }) => {
    if (listIdx >= revealCutoff) return null;

    const cfg = msg.config as any;
    const meta = cfg.metadata;

    if (meta?._is_burst && !meta?._is_final_reply) {
      const content =
        typeof msg.config.content === "string" ? msg.config.content : "";
      const burstKey = `intermediate-burst-${idx}`;
      if (animatedBurstKeys.has(burstKey)) {
        return (
          <div className="py-1 text-xs leading-relaxed text-secondary/65">
            <MarkdownRenderer content={content} />
          </div>
        );
      }
      animatedBurstKeys.add(burstKey);
      return (
        <div className="py-1 text-xs leading-relaxed text-secondary/65">
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
        typeof msg.config.content === "string" ? msg.config.content : "";
      return (
        <div
          key={`pg-chunk-${idx}`}
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
        typeof msg.config.content === "string" ? msg.config.content : "";
      if (!content.trim()) return null;
      return (
        <div
          key={`pg-thought-${idx}`}
          className={`py-1 text-[11px] leading-relaxed text-secondary/45 ${maximized ? "" : "line-clamp-3"}`}
        >
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
  },
  (prev, next) => {
    // Only re-render if the item's identity or content actually changed.
    // This is the key optimization: during streaming, only the last item
    // (the one being appended to) should re-render.
    return (
      prev.idx === next.idx &&
      prev.msg === next.msg &&
      prev.runStatus === next.runStatus &&
      prev.maximized === next.maximized &&
      prev.revealCutoff === next.revealCutoff &&
      prev.listIdx === next.listIdx
    );
  }
);

ProcessMessageGroupItem.displayName = "ProcessMessageGroupItem";

export default ProcessMessageGroupItem;
