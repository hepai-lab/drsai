import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism, SyntaxHighlighterProps } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";



const SyntaxHighlighter = Prism as any as React.FC<SyntaxHighlighterProps>;

interface MarkdownRendererProps {
  content: string;
  fileExtension?: string;
  truncate?: boolean;
  maxLength?: number;
  indented?: boolean;
  allowHtml?: boolean;
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
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Split code into lines
  const lines = value.split("\n");
  const isLong = lines.length > 20;
  const displayedValue =
    !expanded && isLong ? lines.slice(0, 20).join("\n") : value;

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
      <div style={{ backgroundColor: "#000" }}>
        <SyntaxHighlighter
          style={tomorrow}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            backgroundColor: "#000",
            margin: 0,
            borderBottomLeftRadius: "0.375rem",
            borderBottomRightRadius: "0.375rem",
            padding: "1rem",
          }}
        >
          {displayedValue}
        </SyntaxHighlighter>
        {isLong && (
          <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
            <button
              onClick={() => setExpanded((prev) => !prev)}
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
              {expanded
                ? "Show less"
                : `Show ${lines.length - 20} more lines`}
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
  isStreaming = false
}) => {
  // Default to reasoning type if not specified
  const type = attributes.type || 'reasoning';
  const isDone = attributes.done === 'true' || attributes.done === true;

  // Think starts expanded, collapses when done
  const [isExpanded, setIsExpanded] = useState(!isDone);
  const [startTime] = useState(Date.now());
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [userManuallyToggled, setUserManuallyToggled] = useState(false);

  // Auto-collapse when thinking is done, but only if user hasn't manually toggled
  useEffect(() => {
    if (isDone && isExpanded && !userManuallyToggled) {
      // Add a small delay before auto-collapsing
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 1500); // Slightly longer delay for better UX
      return () => clearTimeout(timer);
    }
  }, [isDone, isExpanded, userManuallyToggled]);

  // Handle manual toggle
  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    setUserManuallyToggled(true);
  };

  // Update current time every second when thinking
  useEffect(() => {
    if (!isDone) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isDone]);

  const duration = attributes.duration || Math.floor((currentTime - startTime) / 1000);

  const getTitle = () => {
    if (type === 'reasoning') {
      if (isDone && duration) {
        if (duration < 60) {
          return `Thought for ${duration} seconds`;
        } else {
          const minutes = Math.floor(duration / 60);
          const seconds = duration % 60;
          return `Thought for ${minutes}m ${seconds}s`;
        }
      } else {
        return 'Thinking...';
      }
    } else if (type === 'code_interpreter') {
      return isDone ? 'Analyzed' : 'Analyzing...';
    } else if (type === 'tool_calls') {
      return isDone ? `View Result from **${attributes.name || 'Tool'}**` : `Executing **${attributes.name || 'Tool'}**...`;
    }
    return 'Thinking...';
  };

  const shouldShowSpinner = !isDone && !isStreaming;
  const shouldShimmer = !isDone;

  return (
    <div className="think-bubble-container" style={{ margin: "8px 0", width: "100%" }}>
      <div
        className="think-bubble-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "8px 12px",
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-secondary)",
          borderRadius: "6px",
          cursor: "pointer",
          userSelect: "none",
          fontWeight: "500",
          transition: "all 0.2s ease",
        }}
        onClick={handleToggle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)";
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%"
          }}
          className={shouldShimmer ? "shimmer" : ""}
        >
          {shouldShowSpinner && (
            <Spinner className="size-4" />
          )}

          <div style={{ flex: 1 }}>
            <span
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "0.9rem",
                fontWeight: "500",
              }}
            >
              {getTitle()}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center" }}>
            {isExpanded ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <path d="m18 15-6-6-6 6" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            )}
          </div>
        </div>
      </div>
      {isExpanded && (
        <div
          className="think-bubble-content"
          style={{
            position: "relative",
            padding: "12px 12px 12px 20px",
            backgroundColor: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-secondary)",
            borderTop: "none",
            borderTopLeftRadius: "0",
            borderTopRightRadius: "0",
            borderBottomLeftRadius: "6px",
            borderBottomRightRadius: "6px",
            marginTop: "-1px",
            overflow: "hidden",
            willChange: "transform, opacity",
            transition: "all 0.2s ease-out",
          }}
        >
          {/* Left border line - DeepSeek style */}
          <div
            style={{
              position: "absolute",
              left: "8px",
              top: "0",
              bottom: "0",
              width: "2px",
              backgroundColor: isDone
                ? "var(--color-magenta-600)"
                : "var(--color-border-secondary)",
              borderRadius: "1px",
              transition: "background-color 0.3s ease",
              opacity: 0.3,
            }}
          />

          <div style={{ position: "relative" }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => (
                  <p style={{
                    color: "var(--color-text-secondary)",
                    fontSize: "0.85rem",
                    lineHeight: "1.5",
                    margin: "0 0 8px 0"
                  }}>
                    {children}
                  </p>
                ),
                code: ({ children, className }) => {
                  const match = /language-(\w+)/.exec(className || "");
                  const language = match ? match[1] : "";
                  const inline = !language;

                  if (inline) {
                    return (
                      <code
                        style={{
                          backgroundColor: "var(--color-bg-secondary)",
                          color: "var(--color-text-secondary)",
                          padding: "2px 4px",
                          borderRadius: "3px",
                          fontSize: "0.8rem",
                        }}
                      >
                        {children}
                      </code>
                    );
                  }

                  return (
                    <CodeBlock
                      language={language}
                      value={String(children).replace(/\n$/, "")}
                    />
                  );
                },
                // 其他元素也使用浅色
                li: ({ children }) => (
                  <li style={{ color: "var(--color-text-secondary)" }}>
                    {children}
                  </li>
                ),
                strong: ({ children }) => (
                  <strong style={{ color: "var(--color-text-secondary)", fontWeight: "600" }}>
                    {children}
                  </strong>
                ),
                em: ({ children }) => (
                  <em style={{ color: "var(--color-text-secondary)" }}>
                    {children}
                  </em>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}
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

  // Regular expression to match complete <think>...</think> tags
  const completeThinkRegex = /<think>(.*?)<\/think>/gs;
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
}) => {

  // Determine if we should render as a file preview
  const isFilePreview = !!fileExtension;
  const color = indented
    ? "var(--color-text-primary)"
    : "var(--color-text-primary)";
  // ? "var(--color-text-secondary)"
  // : "var(--color-text-primary)";

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

  // Check if content contains think tags
  const hasThinkTags =
    (content.includes("<think>")) && content.includes("</think>");
  // If allowHtml is true and content contains HTML, render it directly
  // But first check for think tags and process them
  if (allowHtml && (content.includes("<div") || content.includes("<span")) || content.includes("<img")) {
    if (hasThinkTags) {
      const { parts } = parseThinkTags(content);
      return (
        <div
          className="prose w-full"
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
                  dangerouslySetInnerHTML={{ __html: part.content.replace(/<think>(.*?)<\/think>/gs, '') }}
                />
              );
            }
          })}
        </div>
      );
    } else {
      return (
        <div
          className="prose w-full"
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
          dangerouslySetInnerHTML={{ __html: content.replace(/<think>(.*?)<\/think>/gs, '') }}
        />
      );
    }
  }

  // If content has think tags, parse and render them specially
  if (hasThinkTags) {

    const { parts } = parseThinkTags(content);
    return (
      <div
        className="prose w-full"
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
                  h1: ({ children }) => (
                    <h1 style={{ color }}>{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 style={{ color }}>{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 style={{ color }}>{children}</h3>
                  ),
                  h4: ({ children }) => (
                    <h4 style={{ color }}>{children}</h4>
                  ),
                  h5: ({ children }) => (
                    <h5 style={{ color }}>{children}</h5>
                  ),
                  h6: ({ children }) => (
                    <h6 style={{ color }}>{children}</h6>
                  ),
                  p: ({ children }) => (
                    <p className="" style={{ color }}>
                      {children}
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
                  code: ({
                    node,
                    className,
                    children,
                    ...props
                  }) => {
                    const match = /language-(\w+)/.exec(
                      className || ""
                    );
                    const language = match ? match[1] : "";
                    const inline = !language;
                    if (inline) {
                      return (
                        <code
                          style={{
                            whiteSpace: "pre-wrap",
                            color: "var(--color-text-primary)",
                            backgroundColor:
                              "var(--color-bg-primary)",
                            display: "inline",
                            padding: "0.2em 0.4em",
                            borderRadius:
                              "0.375rem",
                          }}
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }

                    return (
                      <CodeBlock
                        language={language}
                        value={String(children).replace(
                          /\n$/,
                          ""
                        )}
                      />
                    );
                  },
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
      className="prose w-full "
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
          h1: ({ children }) => <h1 style={{ color }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color }}>{children}</h3>,
          h4: ({ children }) => <h4 style={{ color }}>{children}</h4>,
          h5: ({ children }) => <h5 style={{ color }}>{children}</h5>,
          h6: ({ children }) => <h6 style={{ color }}>{children}</h6>,
          p: ({ children }) => (
            <p className="" style={{ color }}>
              {children}
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
          code: ({ node, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            const inline = !language;
            if (inline) {
              return (
                <code
                  style={{
                    whiteSpace: "pre-wrap",
                    color: "var(--color-text-primary)",
                    backgroundColor:
                      "var(--color-bg-primary)",
                    display: "inline",
                    padding: "0.2em 0.4em",
                    borderRadius: "0.375rem",
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock
                language={language}
                value={String(children).replace(/\n$/, "")}
              />
            );
          },
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
