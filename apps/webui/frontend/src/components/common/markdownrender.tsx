import React, { useState, useEffect, useContext, createContext } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism, SyntaxHighlighterProps } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";

/** Fenced ``` blocks become hast <pre><code>; inline `x` is only <code>. Used to pick CodeBlock vs chip. */
const MarkdownCodeInFenceContext = createContext(false);
const MarkdownInlineCodeVariantContext = createContext<"default" | "compact">(
  "default"
);

function renderWithSingleNewlineBreaks(children: React.ReactNode): React.ReactNode {
  const flattened = React.Children.toArray(children);
  return flattened.flatMap((child, childIndex) => {
    if (typeof child !== "string") return child;
    const lines = child.split("\n");
    return lines.flatMap((line, lineIndex) => {
      if (lineIndex === lines.length - 1) return line;
      return [line, <br key={`br-${childIndex}-${lineIndex}`} />];
    });
  });
}

function toHtmlWithLineBreaks(rawHtml: string): string {
  return rawHtml.replace(/\r?\n/g, "<br />");
}

function MarkdownFencePre(
  props: React.ComponentPropsWithoutRef<"pre"> & ExtraProps
) {
  const { children } = props;
  return (
    <MarkdownCodeInFenceContext.Provider value={true}>
      {children}
    </MarkdownCodeInFenceContext.Provider>
  );
}

function MarkdownCode(
  props: React.ComponentPropsWithoutRef<"code"> & ExtraProps
) {
  const { node, className, children, ...rest } = props;
  const isInFence = useContext(MarkdownCodeInFenceContext);
  const variant = useContext(MarkdownInlineCodeVariantContext);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const value = String(children).replace(/\n$/, "");

  if (isInFence) {
    const lang = language || "text";
    return (
      <CodeBlock
        key={getCodeBlockKey(lang, value, node)}
        language={lang}
        value={value}
      />
    );
  }

  const compact = variant === "compact";
  return (
    <code
      style={
        compact
          ? {
            backgroundColor:
              "color-mix(in oklab, var(--color-magenta-600) 18%, transparent)",
            color: "var(--color-text-accent)",
            padding: "2px 4px",
            borderRadius: "3px",
            fontSize: "0.8rem",
          }
          : {
            whiteSpace: "pre-wrap",
            color: "var(--color-text-accent)",
            backgroundColor:
              "color-mix(in oklab, var(--color-magenta-600) 18%, transparent)",
            display: "inline",
            padding: "0.2em 0.4em",
            borderRadius: "0.375rem",
          }
      }
      {...rest}
    >
      {children}
    </code>
  );
}



const SyntaxHighlighter = Prism as any as React.FC<SyntaxHighlighterProps>;

interface MarkdownRendererProps {
  content: string;
  fileExtension?: string;
  truncate?: boolean;
  maxLength?: number;
  indented?: boolean;
  allowHtml?: boolean;
  /** When true, do NOT parse <think>...</think> into ThinkBubble. */
  disableThinkTags?: boolean;
}

// Stable key for CodeBlock to prevent remount on parent re-renders (avoids collapse on scroll)
function getCodeBlockKey(language: string, value: string, node?: { position?: { start?: { offset?: number } } }): string {
  const offset = node?.position?.start?.offset;
  if (typeof offset === "number") {
    return `code-${language}-${offset}`;
  }
  return `code-${language}-${value.length}-${value.slice(0, 50).replace(/\s/g, "_")}`;
}

// Map file extensions to syntax highlighting languages
const extensionToLanguage: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  java: "java",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  go: "go",
  php: "php",
  html: "html",
  css: "css",
  json: "json",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  txt: "text",
};

const CodeBlock: React.FC<{ language: string; value: string }> = ({
  language,
  value,
}) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = async () => {
    try {
      // Check if clipboard API is available
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for environments where clipboard API is not available
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  // Split code into lines
  const lines = value.split("\n");
  const isLong = lines.length > 20;
  // const displayedValue =
  const displayedValue = value;

  const handleExpandToggle = () => setExpanded((prev) => !prev);

  return (
    <div style={{ position: "relative", marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.5rem 1rem",
          backgroundColor: "var(--color-bg-secondary)",
          borderTopLeftRadius: "0.375rem",
          borderTopRightRadius: "0.375rem",
          borderBottom: "1px solid var(--color-border-secondary)",
        }}
      >
        <span
          style={{
            color: "var(--color-text-secondary)",
            fontSize: "0.9rem",
          }}
        >
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            padding: "0.25rem 0.5rem",
            fontSize: "0.9rem",
            transition: "color 0.2s",
          }}
          onMouseEnter={(e) =>
          (e.currentTarget.style.color =
            "var(--color-text-primary)")
          }
          onMouseLeave={(e) =>
          (e.currentTarget.style.color =
            "var(--color-text-secondary)")
          }
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div
        style={{
          backgroundColor: "#000",
          // maxHeight: expanded && isLong ? "min(60vh, 500px)" : undefined,
          // overflowY: expanded && isLong ? "auto" : undefined,
          borderBottomLeftRadius: "0.375rem",
          borderBottomRightRadius: "0.375rem",
        }}
      >
        <SyntaxHighlighter
          style={tomorrow}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            backgroundColor: "#000",
            margin: 0,
            // borderBottomLeftRadius: expanded && isLong ? 0 : "0.375rem",
            // borderBottomRightRadius: expanded && isLong ? 0 : "0.375rem",
            padding: "1rem",
          }}
        >
          {displayedValue}
        </SyntaxHighlighter>
        {isLong && (
          <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
            <button
              onClick={handleExpandToggle}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                padding: "0.25rem 0.5rem",
                fontSize: "0.9rem",
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--color-text-primary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--color-text-secondary)")
              }
            >
              {/* {expanded
                ? "Show less"
                : `Show ${lines.length - 20} more lines`} */}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Spinner component for loading state
const Spinner: React.FC<{ className?: string }> = ({ className = "size-4" }) => (
  <svg
    className={`animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

// Enhanced ThinkBubble component with reasoning state management
interface ThinkBubbleProps {
  content: string;
  attributes?: {
    type?: string;
    done?: string | boolean;
    duration?: number;
    name?: string;
  };
  isStreaming?: boolean;
}

const ThinkBubble: React.FC<ThinkBubbleProps> = ({
  content,
  attributes = {},
  isStreaming = false,
}) => {
  const type = attributes.type || "reasoning";
  const isDone = attributes.done === "true" || attributes.done === true;
  const [isExpanded, setIsExpanded] = useState(!isDone);
  const [startTime] = useState(Date.now());
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [userManuallyToggled, setUserManuallyToggled] = useState(false);
  const cleanContent = content.trim();

  useEffect(() => {
    if (isDone && isExpanded && !userManuallyToggled) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isDone, isExpanded, userManuallyToggled]);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    setUserManuallyToggled(true);
  };

  useEffect(() => {
    if (!isDone) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isDone]);

  const durationSeconds =
    typeof attributes.duration === "number"
      ? Math.max(0, attributes.duration)
      : Math.max(0, Math.floor((currentTime - startTime) / 1000));
  const showDoneBadge =
    type === "reasoning" &&
    isDone &&
    cleanContent.length === 0;
  const shouldShowSpinner = !isDone;
  const statusTextColor =
    type === "reasoning" && isDone
      ? "var(--color-text-secondary)"
      : isDone
        ? "var(--color-text-primary)"
        : "var(--color-text-secondary)";
  const accentColor = isDone
    ? "var(--color-magenta-600)"
    : "var(--color-border-secondary)";

  const getReasoningTitle = () => {
    if (!isDone) return "Thinking...";
    if (cleanContent.length === 0) return "Thought";
    if (durationSeconds < 1) return "Thought Completed";
    if (durationSeconds < 60) return `Thought for ${durationSeconds} seconds`;
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    if (seconds === 0) return `Thought for ${minutes}m`;
    return `Thought for ${minutes}m ${seconds}s`;
  };

  const getTitle = () => {
    if (type === "reasoning") return getReasoningTitle();
    if (type === "code_interpreter") return isDone ? "Analysis complete" : "Analyzing...";
    if (type === "tool_calls") {
      const toolName = attributes.name || "Tool";
      return isDone ? `Result ready: ${toolName}` : `Executing ${toolName}...`;
    }
    return isDone ? "Done" : "Working...";
  };



  const renderTitle = () => {
    if (showDoneBadge) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/25 px-2 py-0.5 text-xs font-medium text-secondary">
          <span aria-hidden className="text-magenta-600/80">
            ✓
          </span>
          <span>Thought</span>
        </span>
      );
    }
    return getTitle();
  };

  return (
    <div className="think-bubble-container w-full my-1.5 first:mt-0 last:mb-0">
      <div className="think-bubble-shell rounded-xl overflow-hidden border-0 bg-secondary/[0.07]">
        <button
          type="button"
          className="think-bubble-header w-full flex items-center justify-between gap-2.5 border-0 py-2.5 cursor-pointer select-none text-left bg-transparent transition-colors duration-200 hover:bg-secondary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-500/25 focus-visible:ring-inset"
          onClick={handleToggle}
        >
          <div className="flex items-center gap-2 w-full min-w-0">
            {/* Tight cluster: multiple gap-2.5 segments read as a large empty band before the title */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex shrink-0 text-secondary" aria-hidden>
                {isExpanded ? (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                ) : (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                )}
              </div>
              <span
                aria-hidden
                className="shrink-0 rounded-full w-2 h-2"
                style={{
                  backgroundColor: accentColor,
                  boxShadow: isDone
                    ? "none"
                    : "0 0 0 3px color-mix(in oklab, var(--color-magenta-600) 22%, transparent)",
                }}
              />
              {shouldShowSpinner && !isStreaming && <Spinner className="size-4 shrink-0" />}
            </div>

            <div className="flex-1 min-w-0">
              <div
                className="text-[0.92rem] font-semibold leading-snug truncate"
                style={{ color: statusTextColor }}
              >
                {renderTitle()}
              </div>

            </div>
          </div>
        </button>
        {isExpanded && (
          <div
            className="think-bubble-content relative border-0 bg-primary px-3 py-2.5 pl-[1.35rem] overflow-hidden transition-[opacity,transform] duration-200 ease-out"
          >
            <div
              className="absolute left-2.5 top-2.5 bottom-2.5 w-0.5 rounded-full transition-opacity duration-200"
              style={{
                backgroundColor: accentColor,
                opacity: isDone ? 0.5 : 0.38,
              }}
            />

            <div className="relative">
              <MarkdownInlineCodeVariantContext.Provider value="compact">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: MarkdownFencePre,
                    p: ({ children }) => (
                      <p
                        style={{
                          color: "var(--color-text-primary)",
                          fontSize: "0.85rem",
                          lineHeight: "1.62",
                          // Keep paragraphs compact inside the bubble (especially within list items)
                          margin: "0 0 6px 0",
                        }}
                      >
                        {renderWithSingleNewlineBreaks(children)}
                      </p>
                    ),
                    code: MarkdownCode,
                    ul: ({ children }) => (
                      <ul
                        style={{
                          margin: "0 0 10px 0",
                          paddingLeft: "1.15rem",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol
                        style={{
                          margin: "0 0 10px 0",
                          paddingLeft: "1.15rem",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li
                        style={{
                          color: "var(--color-text-primary)",
                          margin: "2px 0",
                        }}
                      >
                        {children}
                      </li>
                    ),
                    strong: ({ children }) => (
                      <strong style={{ color: "var(--color-text-primary)", fontWeight: 650 }}>
                        {children}
                      </strong>
                    ),
                    em: ({ children }) => (
                      <em style={{ color: "var(--color-text-primary)" }}>{children}</em>
                    ),
                  }}
                >
                  {content}
                </ReactMarkdown>
              </MarkdownInlineCodeVariantContext.Provider>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Function to parse content and extract think tags with state detection
const parseThinkTags = (
  content: string
): {
  parts: Array<{
    type: "text" | "think";
    content: string;
    attributes?: {
      type: string;
      done: boolean;
      duration?: number;
    };
  }>
} => {
  const parts: Array<{
    type: "text" | "think";
    content: string;
    attributes?: {
      type: string;
      done: boolean;
      duration?: number;
    };
  }> = [];
  let currentIndex = 0;

  // Match `</think>` (streaming) or `</think>` (some persisted payloads).
  const completeThinkRegex =
    /<think>(.*?)<\/(?:think|redacted_thinking)>/gs;
  // Regular expression to match incomplete <think> tags (without closing tag)
  const incompleteThinkRegex = /<think>(.*)$/s;

  let match;

  // First, find all complete think tags
  while ((match = completeThinkRegex.exec(content)) !== null) {
    // Add text before the think tag
    if (match.index > currentIndex) {
      parts.push({
        type: "text",
        content: content.substring(currentIndex, match.index),
      });
    }

    // Add the complete think content
    parts.push({
      type: "think",
      content: match[1].trim(),
      attributes: {
        type: "reasoning",
        done: true,
      }
    });

    currentIndex = match.index + match[0].length;

  }

  // Check for incomplete think tag at the end
  const remainingContent = content.substring(currentIndex);
  const incompleteMatch = incompleteThinkRegex.exec(remainingContent);

  if (incompleteMatch) {
    // Add text before the incomplete think tag
    const beforeIncomplete = remainingContent.substring(0, incompleteMatch.index);
    if (beforeIncomplete) {
      parts.push({
        type: "text",
        content: beforeIncomplete,
      });
    }

    // Add the incomplete think content
    parts.push({
      type: "think",
      content: incompleteMatch[1].trim(),
      attributes: {
        type: "reasoning",
        done: false,
      }
    });
  } else if (currentIndex < content.length) {
    // Add remaining text after the last complete think tag
    parts.push({
      type: "text",
      content: remainingContent,
    });
  }

  return { parts };
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  fileExtension,
  truncate,
  maxLength,
  indented = false,
  allowHtml = false,
  disableThinkTags = false,
}) => {

  // Determine if we should render as a file preview
  const isFilePreview = !!fileExtension;
  const color = indented
    ? "var(--color-text-primary)"
    : "var(--color-text-primary)";
  // ? "var(--color-text-secondary)"
  // : "var(--color-text-primary)";
  const proseReadableStyle = {
    "--tw-prose-body": "var(--color-text-primary)",
    "--tw-prose-headings": "var(--color-text-primary)",
    "--tw-prose-bold": "var(--color-text-primary)",
    "--tw-prose-links": "var(--color-text-accent)",
    "--tw-prose-counters": "var(--color-text-secondary)",
    "--tw-prose-bullets": "var(--color-text-secondary)",
  } as React.CSSProperties;
  const headingColor = "var(--color-text-primary)";
  const headingBaseStyle = {
    color: headingColor,
    letterSpacing: "-0.01em",
  };

  // If this is a file preview, wrap the content in a code block
  const processedContent = isFilePreview
    ? `\`\`\`${extensionToLanguage[fileExtension?.toLowerCase() || ""] || "text"
    }\n${content}\n\`\`\``
    : content;

  // Truncate content if needed
  const truncatedContent =
    truncate && maxLength && content.length > maxLength
      ? content.slice(0, maxLength) + "..."
      : content;

  const contentForThinkParsing = disableThinkTags
    ? content.replaceAll("<think>", "").replaceAll("</think>", "")
    : content;

  // Check if content contains think tags (both complete and incomplete)
  const hasThinkTags = !disableThinkTags && contentForThinkParsing.includes("<think>");
  // If allowHtml is true and content contains HTML, render it directly
  // But first check for think tags and process them
  if (allowHtml && (contentForThinkParsing.includes("<div") || contentForThinkParsing.includes("<span")) || contentForThinkParsing.includes("<img")) {

    if (hasThinkTags) {
      const { parts } = parseThinkTags(contentForThinkParsing);
      return (
        <div
          className="prose prose-code:before:content-[''] prose-code:after:content-[''] w-full"
          style={{
            ...proseReadableStyle,
            color,
            fontSize: "0.85rem",
            overflowWrap: "break-word",
            wordWrap: "break-word",
            wordBreak: "break-word",
            overflowX: "auto",
            maxWidth: "100%",
            position: "relative",
          }}
        >
          {parts.map((part, index) => {
            if (part.type === "think") {
              return (
                <ThinkBubble
                  key={index}
                  content={part.content}
                  attributes={part.attributes}
                />
              );
            } else {
              return (
                <div
                  key={index}
                  dangerouslySetInnerHTML={{
                    __html: toHtmlWithLineBreaks(
                      part.content.replace(/<think>(.*?)<\/think>/gs, "")
                    ),
                  }}
                />
              );
            }
          })}
        </div>
      );
    } else {
      return (
        <div
          className="prose prose-code:before:content-[''] prose-code:after:content-[''] w-full"
          style={{
            color,
            fontSize: "0.85rem",
            overflowWrap: "break-word",
            wordWrap: "break-word",
            wordBreak: "break-word",
            overflowX: "auto",
            maxWidth: "100%",
            position: "relative",
          }}
          dangerouslySetInnerHTML={{
            __html: toHtmlWithLineBreaks(
              contentForThinkParsing.replace(/<think>(.*?)<\/think>/gs, "")
            ),
          }}
        />
      );
    }
  }

  // If content has think tags, parse and render them specially
  if (hasThinkTags) {

    const { parts } = parseThinkTags(contentForThinkParsing);
    return (
      <div
        className="prose prose-code:before:content-[''] prose-code:after:content-[''] w-full"
        style={{
          ...proseReadableStyle,
          color,
          fontSize: "0.85rem",
          overflowWrap: "break-word",
          wordWrap: "break-word",
          wordBreak: "break-word",
          overflowX: "auto",
          maxWidth: "100%",
          position: "relative",
        }}
      >

        {indented && (
          <div
            style={{
              position: "absolute",
              left: "1.2rem",
              top: 0,
              bottom: 0,
              width: "2px",
            }}
          />
        )}
        {parts.map((part, index) => {
          if (part.type === "think") {
            return (
              <ThinkBubble
                key={index}
                content={part.content}
                attributes={part.attributes}
              />
            );
          } else {
            // Render regular text content with markdown
            return (
              <ReactMarkdown
                key={index}
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[]}
                components={{
                  pre: MarkdownFencePre,
                  h1: ({ children }) => (
                    <h1
                      style={{
                        ...headingBaseStyle,
                        fontSize: "1.4rem",
                        fontWeight: 750,
                        lineHeight: 1.3,
                        margin: "0.7em 0 0.45em",
                      }}
                    >
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2
                      style={{
                        ...headingBaseStyle,
                        fontSize: "1.22rem",
                        fontWeight: 700,
                        lineHeight: 1.34,
                        margin: "0.62em 0 0.4em",
                      }}
                    >
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3
                      style={{
                        ...headingBaseStyle,
                        fontSize: "1.08rem",
                        fontWeight: 680,
                        lineHeight: 1.35,
                        margin: "0.56em 0 0.35em",
                      }}
                    >
                      {children}
                    </h3>
                  ),
                  h4: ({ children }) => <h4 style={{ ...headingBaseStyle, fontWeight: 650 }}>{children}</h4>,
                  h5: ({ children }) => <h5 style={{ ...headingBaseStyle, fontWeight: 630 }}>{children}</h5>,
                  h6: ({ children }) => <h6 style={{ ...headingBaseStyle, fontWeight: 620 }}>{children}</h6>,
                  p: ({ children }) => (
                    <p className="" style={{ color }}>
                      {renderWithSingleNewlineBreaks(children)}
                    </p>
                  ),
                  strong: ({ children }) => (
                    <strong style={{ color }}>
                      {children}
                    </strong>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      style={{ color }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  code: MarkdownCode,
                  blockquote: ({ children }) => (
                    <blockquote
                      style={{
                        backgroundColor:
                          "var(--color-bg-primary)",
                        color: "var(--color-text-primary)",
                        padding: "10px",
                        borderLeft:
                          "5px solid var(--color-border-secondary)",
                      }}
                    >
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {part.content.replace(/<think>(.*?)<\/think>/gs, '')}
              </ReactMarkdown>
            );
          }
        })}
      </div>
    );
  }

  return (
    <div
      className="prose prose-code:before:content-[''] prose-code:after:content-[''] w-full"
      style={{
        ...proseReadableStyle,
        color,
        fontSize: "0.85rem",
        overflowWrap: "break-word",
        wordWrap: "break-word",
        wordBreak: "break-word",
        overflowX: "auto",
        maxWidth: "100%",
        position: "relative",
      }}
    >
      {indented && (
        <div
          style={{
            position: "absolute",
            left: "1.2rem",
            top: 0,
            bottom: 0,
            width: "2px",
          }}
        />
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[]}
        components={{
          pre: MarkdownFencePre,
          h1: ({ children }) => (
            <h1
              style={{
                ...headingBaseStyle,
                fontSize: "1.4rem",
                fontWeight: 750,
                lineHeight: 1.3,
                margin: "0.7em 0 0.45em",
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              style={{
                ...headingBaseStyle,
                fontSize: "1.22rem",
                fontWeight: 700,
                lineHeight: 1.34,
                margin: "0.62em 0 0.4em",
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              style={{
                ...headingBaseStyle,
                fontSize: "1.08rem",
                fontWeight: 680,
                lineHeight: 1.35,
                margin: "0.56em 0 0.35em",
              }}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => <h4 style={{ ...headingBaseStyle, fontWeight: 650 }}>{children}</h4>,
          h5: ({ children }) => <h5 style={{ ...headingBaseStyle, fontWeight: 630 }}>{children}</h5>,
          h6: ({ children }) => <h6 style={{ ...headingBaseStyle, fontWeight: 620 }}>{children}</h6>,
          p: ({ children }) => (
            <p className="" style={{ color }}>
              {renderWithSingleNewlineBreaks(children)}
            </p>
          ),
          strong: ({ children }) => (
            <strong style={{ color }}>{children}</strong>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              style={{ color }}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          code: MarkdownCode,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                padding: "10px",
                borderLeft:
                  "5px solid var(--color-border-secondary)",
              }}
            >
              {children}
            </blockquote>
          ),

        }}
      >
        {(truncate ? truncatedContent : processedContent).replace(/<think>(.*?)<\/think>/gs, '')}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
