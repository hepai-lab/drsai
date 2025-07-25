import React, { useState } from "react";
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

// ThinkBubble component for collapsible think content
const ThinkBubble: React.FC<{ content: string }> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="think-bubble-container" style={{ margin: "8px 0" }}>
      <div
        className="think-bubble-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-secondary)",
          borderRadius: "6px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span style={{ fontSize: "16px" }}>💭</span>
        <span
          style={{
            color: "var(--color-text-secondary)",
            fontSize: "0.9rem",
            fontWeight: "500",
          }}
        >
          Thinking Process
        </span>
        {isExpanded ? (
          <span
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "14px",
            }}
          >
            ▼
          </span>
        ) : (
          <span
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "14px",
            }}
          >
            ▶
          </span>
        )}
      </div>
      {isExpanded && (
        <div
          className="think-bubble-content"
          style={{
            padding: "12px",
            backgroundColor: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-secondary)",
            borderTop: "none",
            borderTopLeftRadius: "0",
            borderTopRightRadius: "0",
            borderBottomLeftRadius: "6px",
            borderBottomRightRadius: "6px",
            marginTop: "-1px",
          }}
        >
          <div
            style={{
              color: "var(--color-text-primary)",
              fontSize: "0.85rem",
              lineHeight: "1.5",
              whiteSpace: "pre-wrap",
            }}
          >
            {content}
          </div>
        </div>
      )}
    </div>
  );
};

// Function to parse content and extract think tags
const parseThinkTags = (
  content: string
): { parts: Array<{ type: "text" | "think"; content: string }> } => {
  const parts: Array<{ type: "text" | "think"; content: string }> = [];
  let currentIndex = 0;

  // Regular expression to match <think>...</think> tags
  const thinkRegex = /<think>(.*?)<\/think>/gs;
  let match;

  while ((match = thinkRegex.exec(content)) !== null) {
    // Add text before the think tag
    if (match.index > currentIndex) {
      parts.push({
        type: "text",
        content: content.substring(currentIndex, match.index),
      });
    }

    // Add the think content
    parts.push({
      type: "think",
      content: match[1].trim(),
    });

    currentIndex = match.index + match[0].length;
  }

  // Add remaining text after the last think tag
  if (currentIndex < content.length) {
    parts.push({
      type: "text",
      content: content.substring(currentIndex),
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
    content.includes("<think>") && content.includes("</think>");

  // If allowHtml is true and content contains HTML, render it directly
  if (allowHtml && (content.includes("<div") || content.includes("<span"))) {
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
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
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
              <ThinkBubble key={index} content={part.content} />
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
                {part.content}
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
          p: ({ children }) => {
            const text = String(children);
            // Check if this paragraph contains think bubble markers
            if (
              text.includes("**THINK_BUBBLE_START**") &&
              text.includes("**THINK_BUBBLE_END**")
            ) {
              const startIndex = text.indexOf(
                "**THINK_BUBBLE_START**"
              );
              const endIndex = text.indexOf(
                "**THINK_BUBBLE_END**"
              );
              const bubbleContent = text
                .substring(startIndex + 20, endIndex)
                .trim();

              return (
                <div
                  className="think-bubble"
                  style={{ margin: "8px 0" }}
                >
                  💭 {bubbleContent}
                </div>
              );
            }

            return (
              <p className="" style={{ color }}>
                {children}
              </p>
            );
          },
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
          think: ({ children }) => (
            <ThinkBubble content={String(children)} />
          ),
        }}
      >
        {truncate ? truncatedContent : processedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
