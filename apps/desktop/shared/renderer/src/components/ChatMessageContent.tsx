import { memo, Profiler, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type FC, type ComponentPropsWithoutRef, createContext } from "react";
import { Check, ChevronDown, ChevronRight, Copy, FileText } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseChatOutput } from "../chatOutputModel";
import { copyTextSafely } from "../clipboard";
import { copyTextReliable } from "../threadShareClient";
import { createStreamingTextFadePlugin, useStreamingTextSegments } from "../streamingTextFade";
import { splitStreamingMarkdownIncremental, splitMarkdownIntoBlocks, STREAMING_PLAINTEXT_THRESHOLD, MARKDOWN_BLOCK_THRESHOLD, type StreamingMarkdownSplit } from "../streamingMarkdown";
import { useStreamingDisplayBuffer } from "../streamingDisplayBuffer";
import { observeStreamingRenderMetric } from "../streamingRenderMetrics";
import { CITATION_HREF_PREFIX, createCitationMarkerPlugin, type InlineCitationLink } from "../citationMarkerPlugin";
import { ARTIFACT_HREF_PREFIX, createArtifactLinkPlugin, type SelectedInlineArtifactLink } from "../artifactLinkPlugin";

interface ChatMessageContentProps {
  content: string;
  streaming?: boolean;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
  /** When true, treat the whole string as markdown and do not emit nested reasoning blocks. */
  plainMarkdown?: boolean;
  /**
   * Citations this message can link its `[E<n>]` markers to. Omitted everywhere
   * except grounded answers, so ordinary chat renders exactly as before.
   */
  citations?: readonly InlineCitationLink[];
  onOpenCitation?: (citationId: string) => void;
  artifactLinks?: readonly SelectedInlineArtifactLink[];
  onOpenArtifactLink?: (artifactPartId: string) => void;
  onOpenArtifactLinkMenu?: (artifactPartId: string, anchor: { x: number; y: number; trigger?: HTMLElement }) => void;
}

type MarkdownRendererProps =
  Pick<ChatMessageContentProps, "content" | "language" | "onOpenLink" | "streaming" | "citations" | "onOpenCitation" | "artifactLinks" | "onOpenArtifactLink" | "onOpenArtifactLinkMenu">;

// ─── Context: passes callbacks to child components without triggering re-renders ───
// This allows the `components` object in MarkdownRenderer to be stable (useMemo'd
// only on `language`), preventing table scroll-reset and reducing reconciliation
// during streaming.
interface MarkdownCallbackContextValue {
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
  onOpenCitation?: (citationId: string) => void;
  artifactLinks?: readonly SelectedInlineArtifactLink[];
  onOpenArtifactLink?: (artifactPartId: string) => void;
  onOpenArtifactLinkMenu?: (artifactPartId: string, anchor: { x: number; y: number; trigger?: HTMLElement }) => void;
}

const MarkdownCallbackContext = createContext<MarkdownCallbackContextValue>({
  language: "en",
  onOpenLink: () => undefined,
});

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

// ─── Stable component references for ReactMarkdown `components` prop ───
// These components read callbacks from context, so they don't need to be
// recreated on every render. This prevents React from unmounting/remounting
// DOM elements (especially table scroll containers) during streaming re-renders.

const StableLinkComponent: FC<ComponentPropsWithoutRef<"a">> = ({ href, children, title }) => {
  const ctx = useContext(MarkdownCallbackContext);
  if (href?.startsWith(CITATION_HREF_PREFIX)) {
    const citationId = href.slice(CITATION_HREF_PREFIX.length);
    return (
      <button
        className="markdown-citation-link"
        type="button"
        title={title}
        onClick={() => ctx.onOpenCitation?.(citationId)}
      >
        {children}
      </button>
    );
  }
  if (href?.startsWith(ARTIFACT_HREF_PREFIX)) {
    const artifactPartId = decodeURIComponent(href.slice(ARTIFACT_HREF_PREFIX.length));
    const artifact = ctx.artifactLinks?.find((candidate) => candidate.id === artifactPartId);
    const disabled = artifact?.state === "deleted";
    const { onOpenArtifactLink, onOpenArtifactLinkMenu } = ctx;
    return (
      <button
        className="markdown-artifact-link"
        type="button"
        title={artifact?.title ?? title}
        data-artifact-inline-id={artifactPartId}
        data-resource-state={artifact?.state}
        aria-disabled={disabled || undefined}
        aria-label={`${ctx.language === "zh" ? "打开资源" : "Open resource"}: ${artifact?.label ?? String(children)}${artifact?.state ? ` · ${artifact.state}` : ""}`}
        onClick={disabled ? undefined : () => onOpenArtifactLink?.(artifactPartId)}
        onContextMenu={onOpenArtifactLinkMenu ? (event) => {
          event.preventDefault();
          event.currentTarget.focus();
          onOpenArtifactLinkMenu(artifactPartId, { x: event.clientX, y: event.clientY, trigger: event.currentTarget });
        } : undefined}
        onKeyDown={onOpenArtifactLinkMenu ? (event) => {
          if (event.key === "F10" && event.shiftKey) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenArtifactLinkMenu(artifactPartId, { x: rect.left, y: rect.bottom, trigger: event.currentTarget });
          }
        } : undefined}
      >
        <FileText size={14} aria-hidden="true" />
        <span>{children}</span>
      </button>
    );
  }
  return (
    <button className="markdown-link" type="button" onClick={() => ctx.onOpenLink(href)}>
      {children}
    </button>
  );
};

const StablePreComponent: FC<ComponentPropsWithoutRef<"pre">> = ({ children }) => {
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
};

const TableBlock = memo(function TableBlock({ children }: { children: ReactNode }): React.JSX.Element {
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
});

const StableTableComponent: FC<ComponentPropsWithoutRef<"table">> = ({ children }) => (
  <TableBlock>{children}</TableBlock>
);

const StableImgComponent: FC<ComponentPropsWithoutRef<"img">> = ({ src, alt }) => {
  if (!src || !isSafeImageSource(src)) return <span className="chat-image-blocked">[blocked image]</span>;
  return <img className="chat-markdown-image" src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />;
};

// ─── Stable components object: created once per `language` change ───
// This is the KEY fix: previously the `components` prop was an inline object
// literal recreated on every render (every 64ms during streaming), causing
// React to see new function references → unmount/remount DOM elements →
// table scroll position reset to 0.
const stableComponents = {
  a: StableLinkComponent,
  pre: StablePreComponent,
  table: StableTableComponent,
  img: StableImgComponent,
} as const;

const MarkdownRenderer = memo(function MarkdownRenderer({ content, language, onOpenLink, streaming = false, citations, onOpenCitation, artifactLinks, onOpenArtifactLink, onOpenArtifactLinkMenu }: MarkdownRendererProps): React.JSX.Element {
  const streamingSegments = useStreamingTextSegments(content, streaming);
  const rehypePlugins = useMemo(() => streamingSegments.length ? [createStreamingTextFadePlugin(streamingSegments)] : [], [streamingSegments]);
  const remarkPlugins = useMemo(() => {
    const citationPlugin = citations?.length ? createCitationMarkerPlugin(citations) : undefined;
    const artifactPlugin = artifactLinks?.length ? createArtifactLinkPlugin(artifactLinks) : undefined;
    if (citationPlugin && artifactPlugin) return [remarkGfm, citationPlugin, artifactPlugin];
    if (citationPlugin) return [remarkGfm, citationPlugin];
    if (artifactPlugin) return [remarkGfm, artifactPlugin];
    return [remarkGfm];
  }, [artifactLinks, citations]);
  // react-markdown drops any href whose scheme is not http/https/mailto/tel,
  // so a `citation:` link arrived here as an empty string and the marker looked
  // clickable while doing nothing. Only our own scheme is added back; every
  // other URL still goes through the default sanitiser.
  const urlTransform = useMemo(() => citations?.length || artifactLinks?.length
    ? (url: string) => url.startsWith(CITATION_HREF_PREFIX) || url.startsWith(ARTIFACT_HREF_PREFIX) ? url : defaultUrlTransform(url)
    : defaultUrlTransform, [artifactLinks, citations]);

  // Provide callbacks via context so the stable `components` object doesn't
  // need to be recreated when callbacks change.
  const contextValue = useMemo<MarkdownCallbackContextValue>(() => ({
    language,
    onOpenLink,
    onOpenCitation,
    artifactLinks,
    onOpenArtifactLink,
    onOpenArtifactLinkMenu,
  }), [language, onOpenLink, onOpenCitation, artifactLinks, onOpenArtifactLink, onOpenArtifactLinkMenu]);

  return (
    <MarkdownCallbackContext.Provider value={contextValue}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={stableComponents}
      >
        {content}
      </ReactMarkdown>
    </MarkdownCallbackContext.Provider>
  );
});

// ── P3: VirtualizedMarkdown — renders large markdown in virtualized blocks ──
// When markdown content exceeds MARKDOWN_BLOCK_THRESHOLD (32KB), it is split
// into paragraph-level blocks. Only blocks near the viewport are rendered;
// off-screen blocks use a lightweight placeholder. This prevents React from
// having to reconcile thousands of DOM nodes for very long messages.
const PRERENDER_BLOCKS = 5; // blocks above/below viewport to pre-render

const VirtualizedBlock = memo(
  function VirtualizedBlock({ block, language, onOpenLink, citations, onOpenCitation, artifactLinks, onOpenArtifactLink, onOpenArtifactLinkMenu }: {
    block: { index: number; text: string; length: number };
  } & Omit<MarkdownRendererProps, "content" | "streaming">): React.JSX.Element {
    return (
      <MarkdownRenderer
        content={block.text}
        language={language}
        onOpenLink={onOpenLink}
        citations={citations}
        onOpenCitation={onOpenCitation}
        artifactLinks={artifactLinks}
        onOpenArtifactLink={onOpenArtifactLink}
        onOpenArtifactLinkMenu={onOpenArtifactLinkMenu}
      />
    );
  },
  (prev, next) => {
    if (prev.block.text !== next.block.text) return false;
    if (prev.language !== next.language) return false;
    return true;
  },
);

const VirtualizedMarkdown = memo(function VirtualizedMarkdown({
  content,
  language,
  onOpenLink,
  citations,
  onOpenCitation,
  artifactLinks,
  onOpenArtifactLink,
  onOpenArtifactLinkMenu,
}: Omit<MarkdownRendererProps, "streaming">): React.JSX.Element {
  const blocks = useMemo(() => splitMarkdownIntoBlocks(content), [content]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(blocks.length, PRERENDER_BLOCKS * 2 + 1) });

  // IntersectionObserver to track which blocks are visible
  useEffect(() => {
    if (blocks.length <= PRERENDER_BLOCKS * 2 + 1) return; // no virtualization needed
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first and last visible block indices
        let minIdx = Infinity, maxIdx = -1;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.blockIndex);
            if (idx < minIdx) minIdx = idx;
            if (idx > maxIdx) maxIdx = idx;
          }
        }
        if (minIdx === Infinity) return;
        setVisibleRange({
          start: Math.max(0, minIdx - PRERENDER_BLOCKS),
          end: Math.min(blocks.length, maxIdx + PRERENDER_BLOCKS + 1),
        });
      },
      { root: container.closest('.chat-output, .chat-markdown') || null, rootMargin: "200px" },
    );

    // Observe sentinel elements
    const sentinels = container.querySelectorAll('[data-block-index]');
    sentinels.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [blocks.length]);

  // If blocks are few enough, render all without virtualization
  if (blocks.length <= PRERENDER_BLOCKS * 2 + 1) {
    return (
      <div ref={containerRef}>
        {blocks.map((block) => (
          <VirtualizedBlock
            key={block.index}
            block={block}
            language={language}
            onOpenLink={onOpenLink}
            citations={citations}
            onOpenCitation={onOpenCitation}
            artifactLinks={artifactLinks}
            onOpenArtifactLink={onOpenArtifactLink}
            onOpenArtifactLinkMenu={onOpenArtifactLinkMenu}
          />
        ))}
      </div>
    );
  }

  // Virtualized rendering: only render blocks within visibleRange, use
  // lightweight placeholders for off-screen blocks to minimize DOM node count
  return (
    <div ref={containerRef}>
      {blocks.map((block) => {
        const isVisible = block.index >= visibleRange.start && block.index < visibleRange.end;
        if (isVisible) {
          return (
            <div key={block.index} data-block-index={block.index}>
              <VirtualizedBlock
                key={block.index}
                block={block}
                language={language}
                onOpenLink={onOpenLink}
                citations={citations}
                onOpenCitation={onOpenCitation}
                artifactLinks={artifactLinks}
                onOpenArtifactLink={onOpenArtifactLink}
                onOpenArtifactLinkMenu={onOpenArtifactLinkMenu}
              />
            </div>
          );
        }
        // Placeholder: estimate height based on block length (rough heuristic)
        const estimatedHeight = Math.max(40, Math.min(2000, block.length * 0.3));
        return (
          <div
            key={block.index}
            data-block-index={block.index}
            style={{ height: `${estimatedHeight}px` }}
            className="chat-virtualized-placeholder"
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
});

// ── P3: StableMarkdown — memoized renderer for the "stable" split part ──
// During streaming, `splitStreamingMarkdownIncremental` locks completed blocks
// into `split.stable`. This part never changes, but the parent re-renders every
// ~64ms. A custom comparator prevents ReactMarkdown from re-parsing the stable
// part, saving significant CPU on long messages.
const StableMarkdown = memo(
  function StableMarkdown({ content, language, onOpenLink, citations, onOpenCitation, artifactLinks, onOpenArtifactLink, onOpenArtifactLinkMenu }: MarkdownRendererProps): React.JSX.Element {
    return (
      <MarkdownRenderer
        content={content}
        language={language}
        onOpenLink={onOpenLink}
        citations={citations}
        onOpenCitation={onOpenCitation}
        artifactLinks={artifactLinks}
        onOpenArtifactLink={onOpenArtifactLink}
        onOpenArtifactLinkMenu={onOpenArtifactLinkMenu}
      />
    );
  },
  (prev, next) => {
    if (prev.content !== next.content) return false;
    if (prev.language !== next.language) return false;
    // Deep-ish comparison for arrays that may get new references but same content
    if (prev.citations !== next.citations) {
      const a = prev.citations, b = next.citations;
      if (!a || !b) return a === b;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
    }
    if (prev.artifactLinks !== next.artifactLinks) {
      const a = prev.artifactLinks, b = next.artifactLinks;
      if (!a || !b) return a === b;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
    }
    return true;
  },
);

function MarkdownContent({ content, language, onOpenLink, streaming = false, citations, onOpenCitation, artifactLinks, onOpenArtifactLink, onOpenArtifactLinkMenu }: MarkdownRendererProps): React.JSX.Element {
  const renderStartedAt = performance.now();
  const displayedContent = useStreamingDisplayBuffer(content, streaming);
  // Track previous split for incremental optimization
  const prevSplitRef = useRef<StreamingMarkdownSplit | null>(null);
  const split = useMemo(() => {
    if (!streaming) return { stable: "", tail: displayedContent };
    const result = splitStreamingMarkdownIncremental(displayedContent, prevSplitRef.current);
    prevSplitRef.current = result;
    return result;
  }, [displayedContent, streaming]);
  useLayoutEffect(() => {
    if (streaming) observeStreamingRenderMetric("commit-layout", performance.now() - renderStartedAt);
  }, [displayedContent, streaming]);

  // P3: Streaming degraded rendering — when tail exceeds threshold, render as
  // plain <pre> to avoid expensive ReactMarkdown re-parsing every 64ms.
  const tailIsLarge = streaming && split.tail.length > STREAMING_PLAINTEXT_THRESHOLD;

  // P3: Non-streaming virtualization — when final content exceeds block threshold,
  // use VirtualizedMarkdown to avoid rendering all DOM nodes at once.
  const shouldVirtualize = !streaming && displayedContent.length > MARKDOWN_BLOCK_THRESHOLD;

  if (shouldVirtualize) {
    return (
      <VirtualizedMarkdown
        content={displayedContent}
        language={language}
        onOpenLink={onOpenLink}
        citations={citations}
        onOpenCitation={onOpenCitation}
        artifactLinks={artifactLinks}
        onOpenArtifactLink={onOpenArtifactLink}
        onOpenArtifactLinkMenu={onOpenArtifactLinkMenu}
      />
    );
  }

  return (
    <Profiler id="streaming-markdown" onRender={(_id, _phase, actualDuration) => {
      if (streaming) observeStreamingRenderMetric("markdown-render", actualDuration);
    }}>
      {split.stable ? <StableMarkdown content={split.stable} language={language} onOpenLink={onOpenLink} citations={citations} onOpenCitation={onOpenCitation} artifactLinks={artifactLinks} onOpenArtifactLink={onOpenArtifactLink} onOpenArtifactLinkMenu={onOpenArtifactLinkMenu} /> : null}
      {split.tail ? (
        tailIsLarge ? (
          <pre className="chat-streaming-plaintext">{split.tail}</pre>
        ) : (
          <MarkdownRenderer content={split.tail} language={language} onOpenLink={onOpenLink} streaming={streaming} citations={citations} onOpenCitation={onOpenCitation} artifactLinks={artifactLinks} onOpenArtifactLink={onOpenArtifactLink} onOpenArtifactLinkMenu={onOpenArtifactLinkMenu} />
        )
      ) : null}
    </Profiler>
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

function ReasoningPart({ text, complete, language }: { text: string; complete: boolean; language: "en" | "zh" }): React.JSX.Element {
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
        <MarkdownContent content={text} language={language} onOpenLink={() => undefined} />
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
  citations,
  onOpenCitation,
  artifactLinks,
  onOpenArtifactLink,
  onOpenArtifactLinkMenu,
}: ChatMessageContentProps): React.JSX.Element {
  if (plainMarkdown) {
    return (
      <div className="chat-output">
        <div className="chat-markdown">
          <MarkdownContent content={content} language={language} onOpenLink={onOpenLink} streaming={streaming} citations={citations} onOpenCitation={onOpenCitation} artifactLinks={artifactLinks} onOpenArtifactLink={onOpenArtifactLink} onOpenArtifactLinkMenu={onOpenArtifactLinkMenu} />
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
          <MarkdownContent content={part.text} language={language} onOpenLink={onOpenLink} streaming={streaming} citations={citations} onOpenCitation={onOpenCitation} artifactLinks={artifactLinks} onOpenArtifactLink={onOpenArtifactLink} onOpenArtifactLinkMenu={onOpenArtifactLinkMenu} />
        </div>
      ))}
    </div>
  );
});
