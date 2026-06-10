import { useState, useEffect, memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { useI18n } from "./useI18n";

// ── Lazy-load syntax highlighter ──────────────────
// Only imported when a code block renders, keeping initial bundle small.

let _highlighterMod: typeof import("react-syntax-highlighter") | null = null;
let _oneDark: Record<string, React.CSSProperties> | null = null;
let _loadingPromise: Promise<void> | null = null;

function loadHighlighter(): Promise<void> {
  if (_highlighterMod && _oneDark) return Promise.resolve();
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ]).then(([mod, style]) => {
    _highlighterMod = mod;
    _oneDark = style.default as Record<string, React.CSSProperties>;
  });
  return _loadingPromise;
}

// ── Diff viewer ───────────────────────────────────

function DiffView({ code }: { code: string }): React.JSX.Element {
  const lines = code.split("\n");
  return (
    <div className="chat-diff-content">
      {lines.map((line, i) => {
        let cls = "chat-diff-line";
        if (line.startsWith("+")) cls += " chat-diff-add";
        else if (line.startsWith("-")) cls += " chat-diff-remove";
        else if (line.startsWith("@@")) cls += " chat-diff-hunk";
        return (
          <div key={i} className={cls}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

// ── Code block ────────────────────────────────────

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [highlighterReady, setHighlighterReady] = useState(
    () => _highlighterMod !== null && _oneDark !== null,
  );
  const code = String(children).replace(/\n$/, "");
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const isDiff = language === "diff";

  useEffect(() => {
    if (!highlighterReady) {
      loadHighlighter().then(() => setHighlighterReady(true));
    }
  }, [highlighterReady]);

  function handleCopy(): void {
    navigator.clipboard.writeText(code).catch(() => {
      // Fallback for environments where clipboard API is restricted
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fallbackPre = (
    <pre
      style={{
        margin: 0,
        borderRadius: 0,
        fontSize: "13px",
        padding: "12px",
        background: "transparent",
        color: "#abb2bf",
        overflow: "auto",
      }}
    >
      <code>{code}</code>
    </pre>
  );

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span className="chat-code-lang">
          {isDiff ? "diff" : language || "code"}
        </span>
        <button className="chat-code-copy" onClick={handleCopy}>
          {copied ? t("common.copied") : <Copy size={13} />}
        </button>
      </div>
      {isDiff ? (
        <DiffView code={code} />
      ) : highlighterReady && _highlighterMod && _oneDark ? (
        <_highlighterMod.Prism
          style={_oneDark}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "13px",
            padding: "12px",
            background: "transparent",
          }}
        >
          {code}
        </_highlighterMod.Prism>
      ) : (
        fallbackPre
      )}
    </div>
  );
}

// ── Main Markdown renderer ────────────────────────

const AgentMarkdown = memo(function AgentMarkdown({
  children,
}: {
  children: string;
}): React.JSX.Element {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        // ── Links: open externally, block unsafe protocols ──
        a: ({ href, children: linkChildren, ...props }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              if (!href) return;
              try {
                const url = new URL(href, "https://placeholder.invalid");
                if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                  return;
                }
              } catch {
                return;
              }
              window.drsaiAPI.openExternal(href);
            }}
            {...props}
          >
            {linkChildren}
          </a>
        ),

        // ── Code: inline vs block ──
        code: ({
          className,
          children: codeChildren,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ref: _codeRef,
          ...props
        }) => {
          const isInline =
            !className &&
            typeof codeChildren === "string" &&
            !codeChildren.includes("\n");
          if (isInline) {
            return (
              <code className={className} {...props}>
                {codeChildren}
              </code>
            );
          }
          return (
            <CodeBlock className={className}>{codeChildren}</CodeBlock>
          );
        },

        // ── Images: responsive, click-to-open ──
        img: ({ src, alt }) => (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-img-link"
            onClick={(e) => {
              e.preventDefault();
              if (src) window.drsaiAPI.openExternal(src);
            }}
          >
            <img src={src} alt={alt || ""} className="chat-img" />
          </a>
        ),

        // ── Tables: wrap in scrollable container ──
        table: ({ children: tableChildren }) => (
          <div className="chat-table-wrap">
            <table>{tableChildren}</table>
          </div>
        ),

        // ── Blockquote ──
        blockquote: ({ children: bqChildren }) => (
          <blockquote className="chat-blockquote">{bqChildren}</blockquote>
        ),

        // ── Horizontal rule ──
        hr: () => <hr className="chat-hr" />,

        // ── Task list items (GFM) ──
        input: ({ checked, disabled }) => (
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            className="chat-task-check"
            readOnly
          />
        ),
      }}
    >
      {children}
    </Markdown>
  );
});

export { AgentMarkdown };
export default AgentMarkdown;
