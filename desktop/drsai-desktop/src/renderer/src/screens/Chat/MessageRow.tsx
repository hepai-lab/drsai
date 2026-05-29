import { memo, useState } from "react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";
import type { ChatMessage, MessageRole } from "./types";

// ── Approval detection ────────────────────────────

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

// ── <think> block parsing ─────────────────────────

interface ThinkBlock {
  type: "thinking" | "content";
  text: string;
}

/**
 * Split `` blocks out of agent output so they can be rendered inside
 * a collapsible reasoning panel.
 *
 * - `` … `` → thinking (collapsed by default)
 * - Unclosed `` → everything after it is still thinking (streaming safety)
 * - Closing `` without opening → treated as literal text
 * - HTML-escaped `` → also recognised
 */
function parseThinkBlocks(raw: string): ThinkBlock[] {
  const blocks: ThinkBlock[] = [];

  // Match both raw and HTML-escaped `` tags.
  // Use per-call regexes to avoid shared lastIndex across renders.
  const THINK_OPEN = /<think(\s[^>]*)?>|&lt;think(\s[^>]*)?&gt;/gi;
  const THINK_CLOSE = /<\/think>|&lt;\/think&gt;/gi;

  if (!THINK_OPEN.test(raw)) {
    if (raw) blocks.push({ type: "content", text: raw });
    return blocks;
  }

  let cursor = 0;
  THINK_OPEN.lastIndex = 0;

  let open: RegExpExecArray | null;
  while ((open = THINK_OPEN.exec(raw)) !== null) {
    const pre = raw.slice(cursor, open.index);
    if (pre) blocks.push({ type: "content", text: pre });

    const thinkStart = open.index + open[0].length;
    THINK_CLOSE.lastIndex = thinkStart;
    const close = THINK_CLOSE.exec(raw);

    if (close) {
      const thinkText = raw.slice(thinkStart, close.index);
      if (thinkText.trim()) {
        blocks.push({ type: "thinking", text: thinkText.trimStart() });
      }
      cursor = close.index + close[0].length;
    } else {
      // Unclosed <think> — streaming / malformed → rest is thinking
      const thinkText = raw.slice(thinkStart);
      if (thinkText.trim()) {
        blocks.push({ type: "thinking", text: thinkText.trimStart() });
      }
      cursor = raw.length;
      break;
    }

    THINK_OPEN.lastIndex = cursor;
  }

  const tail = raw.slice(cursor);
  if (tail.trim()) blocks.push({ type: "content", text: tail });

  return blocks;
}

// ── Avatars ───────────────────────────────────────

export const DrsaiAvatar = memo(function DrsaiAvatar({
  size = 30,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <img src={icon} width={size} height={size} alt="" />
    </div>
  );
});

/** Pick an avatar element for each message role. */
function RoleAvatar({ role }: { role: MessageRole }): React.JSX.Element {
  switch (role) {
    case "user":
      return <div className="chat-avatar chat-avatar-user">U</div>;
    case "tool":
    case "tool_request":
      return <div className="chat-avatar chat-avatar-tool">⚙</div>;
    case "thinking":
      return <div className="chat-avatar chat-avatar-thinking">💭</div>;
    case "agent":
    default:
      return <DrsaiAvatar />;
  }
}

/** Normalise role for CSS class suffixes ("tool_request" → "tool"). */
function cssRole(role: MessageRole): string {
  return role === "tool_request" ? "tool" : role;
}

// ── Sub-components ────────────────────────────────

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

/** Tool / tool_request message row — collapsed by default. */
function ToolRow({ msg }: { msg: ChatMessage }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const cr = cssRole(msg.role);
  const isCall = msg.role === "tool_request";
  const toolName = msg.toolName || "tool";
  const content = msg.content || "";

  // Build a compact one-line preview for the collapsed state
  let preview = "";
  try {
    const parsed = JSON.parse(content);
    if (isCall) {
      // Tool call: show function name + first arg key
      const fnName = parsed.function || parsed.name || "";
      const args =
        typeof parsed.arguments === "string"
          ? (() => { try { return JSON.parse(parsed.arguments); } catch { return parsed.arguments; } })()
          : parsed.arguments;
      const argKeys = args && typeof args === "object" ? Object.keys(args).slice(0, 2).join(", ") : "";
      preview = fnName || toolName;
      if (argKeys) preview += `(${argKeys}${Object.keys(args || {}).length > 2 ? "…" : ""})`;
    } else {
      // Tool result: show first 80 chars
      const result = parsed.content ?? parsed.result ?? content;
      preview = typeof result === "string" ? result.slice(0, 80) : JSON.stringify(result).slice(0, 80);
    }
  } catch {
    preview = content.slice(0, 80);
  }
  if (!preview) preview = toolName;
  if (preview.length >= 80) preview = preview.slice(0, 77) + "…";

  const prettyPayload = (() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  })();

  return (
    <div className={`chat-message chat-message-${cr}`}>
      <RoleAvatar role={msg.role} />
      <div className={`chat-bubble chat-bubble-${cr}`}>
        <button
          className="chat-tool-toggle"
          onClick={() => setOpen((o) => !o)}
          title={isCall ? "Toggle call details" : "Toggle result details"}
        >
          <span className="chat-tool-toggle-icon">{open ? "▾" : "▸"}</span>
          <span className="chat-tool-toggle-label">
            {isCall ? "🔧 " : "📋 "}
            <code>{preview}</code>
          </span>
        </button>
        {open && (
          <pre className="chat-tool-payload">{prettyPayload}</pre>
        )}
      </div>
    </div>
  );
}

/** Dedicated thinking / reasoning message row (for DB-restored ThoughtEvent). */
function ThinkingRow({ msg }: { msg: ChatMessage }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-message chat-message-thinking">
      <RoleAvatar role="thinking" />
      <div className="chat-bubble chat-bubble-thinking">
        <button
          className="chat-thinking-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "▾" : "▸"} Reasoning
        </button>
        {open && (
          <div className="chat-thinking-content">
            <AgentMarkdown>{msg.content}</AgentMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline `` block inside an agent bubble — collapsed by default.
 *
 * This is used when `` tags appear inside a regular agent message
 * (e.g. DeepSeek-R1 reasoning).  The rest of the message flows naturally
 * around it.
 */
function InlineThinkBlock({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-inline-think">
      <button
        className="chat-thinking-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} Thinking
      </button>
      {open && (
        <div className="chat-thinking-content">
          <AgentMarkdown>{text}</AgentMarkdown>
        </div>
      )}
    </div>
  );
}

/** Render agent content, splitting `` blocks into collapsible panels. */
function AgentContent({ content }: { content: string }): React.JSX.Element {
  const blocks = parseThinkBlocks(content);

  if (blocks.length === 0) return <AgentMarkdown>{content}</AgentMarkdown>;
  if (blocks.length === 1 && blocks[0].type === "content") {
    return <AgentMarkdown>{blocks[0].text}</AgentMarkdown>;
  }

  return (
    <>
      {blocks.map((b, i) =>
        b.type === "thinking" ? (
          <InlineThinkBlock key={i} text={b.text} />
        ) : (
          <AgentMarkdown key={i}>{b.text}</AgentMarkdown>
        ),
      )}
    </>
  );
}

// ── Main MessageRow ───────────────────────────────

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const cr = cssRole(msg.role);
  const showApprovalBar =
    msg.role === "agent" &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);

  // Tool & thinking messages use dedicated sub-components
  if (msg.role === "tool" || msg.role === "tool_request") {
    return <ToolRow msg={msg} />;
  }
  if (msg.role === "thinking") {
    return <ThinkingRow msg={msg} />;
  }

  return (
    <div className={`chat-message chat-message-${cr}`}>
      <RoleAvatar role={msg.role} />
      <div className={`chat-bubble chat-bubble-${cr}`}>
        {msg.role === "agent" ? (
          <AgentContent content={msg.content} />
        ) : (
          msg.content
        )}
      </div>
      {showApprovalBar && (
        <div className="chat-approval-bar">
          <button
            className="chat-approval-btn chat-approve"
            onClick={onApprove}
          >
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}
    </div>
  );
});
