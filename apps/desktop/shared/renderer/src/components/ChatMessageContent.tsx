import { memo, Profiler, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseChatOutput } from "../chatOutputModel";
import { copyTextSafely } from "../clipboard";
import { copyTextReliable } from "../threadShareClient";
import { createStreamingTextFadePlugin, useStreamingTextSegments } from "../streamingTextFade";
import { splitStreamingMarkdown } from "../streamingMarkdown";
import { useStreamingDisplayBuffer } from "../streamingDisplayBuffer";
import { observeStreamingRenderMetric } from "../streamingRenderMetrics";

interface ChatMessageContentProps {
  content: string;
  streaming?: boolean;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
  /** When true, treat the whole string as markdown and do not emit nested reasoning blocks. */
  plainMarkdown?: boolean;
}

function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    if (!value) return;
    try {
      if (!await copyTextSafely(value)) throw new Error("Clipboard copy is not available.");
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button type="button" className="chat-copy-button" onClick={() => void copy()} title={label}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

const MarkdownRenderer = memo(function MarkdownRenderer({ content, onOpenLink, streaming = false }: Pick<ChatMessageContentProps, "content" | "onOpenLink" | "streaming">): React.JSX.Element {
  const streamingSegments = useStreamingTextSegments(content, streaming);
  const rehypePlugins = useMemo(() => streamingSegments.length ? [createStreamingTextFadePlugin(streamingSegments)] : [], [streamingSegments]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={{
        a: ({ href, children }) => (
          <button className="markdown-link" type="button" onClick={() => onOpenLink(href)}>
            {children}
          </button>
        ),
        pre: ({ children }) => {
          const child = Array.isArray(children) ? children[0] : children;
          const props = child && typeof child === "object" && "props" in child
            ? (child.props as { className?: string; children?: unknown })
            : undefined;
          const language = props?.className?.match(/language-([^\s]+)/)?.[1] ?? "code";
          const code = String(props?.children ?? "").replace(/\n$/, "");
          return (
            <div className="chat-code-block">
              <div className="chat-code-header">
                <span>{language}</span>
                <CopyButton value={code} label="Copy" />
              </div>
              {language === "diff" ? <DiffContent value={code} /> : <pre>{children}</pre>}
            </div>
          );
        },
        table: ({ children }) => <TableBlock>{children}</TableBlock>,
        img: ({ src, alt }) => {
          if (!src || !isSafeImageSource(src)) return <span className="chat-image-blocked">[blocked image]</span>;
          return <img className="chat-markdown-image" src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

function MarkdownContent({ content, onOpenLink, streaming = false }: Pick<ChatMessageContentProps, "content" | "onOpenLink" | "streaming">): React.JSX.Element {
  const renderStartedAt = performance.now();
  const displayedContent = useStreamingDisplayBuffer(content, streaming);
  const split = useMemo(() => streaming ? splitStreamingMarkdown(displayedContent) : { stable: "", tail: displayedContent }, [displayedContent, streaming]);
  useLayoutEffect(() => {
    if (streaming) observeStreamingRenderMetric("commit-layout", performance.now() - renderStartedAt);
  }, [displayedContent, streaming]);
  return (
    <Profiler id="streaming-markdown" onRender={(_id, _phase, actualDuration) => {
      if (streaming) observeStreamingRenderMetric("markdown-render", actualDuration);
    }}>
      {split.stable ? <MarkdownRenderer content={split.stable} onOpenLink={onOpenLink} /> : null}
      {split.tail ? <MarkdownRenderer content={split.tail} onOpenLink={onOpenLink} streaming={streaming} /> : null}
    </Profiler>
  );
}

function TableBlock({ children }: { children: ReactNode }): React.JSX.Element {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [copied, setCopied] = useState(false);
  async function copyTable(): Promise<void> {
    const rows = Array.from(tableRef.current?.rows ?? []).map((row) =>
      Array.from(row.cells).map((cell) => cell.innerText.replace(/\s+/g, " ").trim()).join("\t"),
    );
    if (!rows.length) return;
    if (!await copyTextSafely(rows.join("\n"))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="chat-table-block">
      <div className="chat-table-actions">
        <button type="button" onClick={() => void copyTable()}>{copied ? "Copied" : "Copy table"}</button>
      </div>
      <div className="chat-table-scroll"><table ref={tableRef}>{children}</table></div>
    </div>
  );
}

function DiffContent({ value }: { value: string }): React.JSX.Element {
  return (
    <pre className="chat-diff">
      {value.split("\n").map((line, index) => {
        const kind = line.startsWith("+") && !line.startsWith("+++")
          ? "add"
          : line.startsWith("-") && !line.startsWith("---")
            ? "remove"
            : line.startsWith("@@") ? "hunk" : "context";
        return <span className={`chat-diff-line ${kind}`} key={`${index}-${line}`}>{line || " "}</span>;
      })}
    </pre>
  );
}

function isSafeImageSource(src: string): boolean {
  try {
    const protocol = new URL(src).protocol;
    return protocol === "https:" || protocol === "http:" || (protocol === "data:" && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src));
  } catch {
    return false;
  }
}

function ReasoningPart({ text, complete }: { text: string; complete: boolean; language: "en" | "zh" }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const labels = { reasoning: "Reasoning", thinking: "Thinking" };
  const title = complete ? labels.reasoning : labels.thinking;
  return (
    <details className="chat-reasoning" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
      </summary>
      <div className="chat-reasoning-content">
        <MarkdownContent content={text} onOpenLink={() => undefined} />
      </div>
    </details>
  );
}

export const ChatMessageContent = memo(function ChatMessageContent({
  content,
  streaming = false,
  language,
  onOpenLink,
  plainMarkdown = false,
}: ChatMessageContentProps): React.JSX.Element {
  if (plainMarkdown) {
    return (
      <div className="chat-output">
        <div className="chat-markdown">
          <MarkdownContent content={content} onOpenLink={onOpenLink} streaming={streaming} />
        </div>
      </div>
    );
  }
  const parts = parseChatOutput(content, { streaming });
  return (
    <div className="chat-output">
      {parts.map((part) => part.type === "reasoning" ? (
        <ReasoningPart key={part.id} text={part.text} complete={part.complete && !streaming} language={language} />
      ) : (
        <div className="chat-markdown" key={part.id}>
          <MarkdownContent content={part.text} onOpenLink={onOpenLink} streaming={streaming} />
        </div>
      ))}
    </div>
  );
});
