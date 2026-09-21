import type { DesktopThreadMessageSnapshot } from "./desktopApi";

const SHARE_FORMAT_VERSION = "conclusion-md-v3";

/** Pure HTML builder for OpenDrSai-styled read-only conversation shares. */
export function renderThreadShareHtml(input: {
  shareId: string;
  title: string;
  createdAt: string;
  messages: DesktopThreadMessageSnapshot[];
}): string {
  const createdLabel = new Date(input.createdAt).toLocaleString();
  const visibleMessages = input.messages.filter((message) => message.role !== "system");
  const body = visibleMessages.map((message) => renderMessageHtml(message)).join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="opendrsai-share" content="readonly" />
  <meta name="opendrsai-share-format" content="${SHARE_FORMAT_VERSION}" />
  <meta name="opendrsai-share-id" content="${escapeHtml(input.shareId)}" />
  <title>${escapeHtml(input.title)} · OpenDrSai Share</title>
  <style>
    :root {
      color-scheme: light;
      --app-font-family: "Segoe UI", "Open Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
      --app-surface-bg: #fafafe;
      --app-panel-soft: #fafafe;
      --app-panel-border: #ddd3ef;
      --app-accent: #8b5cf6;
      --app-accent-strong: #6d4bd6;
      --app-accent-soft: #f1eef7;
      --app-accent-muted: #ebe3f2;
      --app-accent-border: #ddd3ef;
      --app-text-primary: #2f2a3a;
      --app-text-secondary: #5f5870;
      --app-text-muted: #5f5870;
      --app-code-bg: #eeeaf3;
      --app-code-block-bg: #2f2a3a;
      --app-code-block-text: #f7f3fb;
      --app-shadow-panel: 0 12px 30px rgba(47, 42, 58, 0.1);
      --app-shadow-sm: 0 1px 2px rgba(47, 42, 58, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--app-font-family);
      color: var(--app-text-primary);
      background:
        radial-gradient(1200px 420px at 50% -80px, color-mix(in srgb, var(--app-accent) 14%, transparent), transparent 70%),
        var(--app-surface-bg);
      font-synthesis-weight: none;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      width: min(960px, calc(100% - 32px));
      margin: 28px auto 56px;
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
      color: var(--app-text-secondary);
      font-size: 13px;
    }
    .brand-mark {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(145deg, var(--app-accent) 0%, var(--app-accent-strong) 100%);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      box-shadow: var(--app-shadow-sm);
    }
    .brand-bar strong {
      color: var(--app-text-primary);
      font-weight: 700;
    }
    .banner {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 14px;
      padding: 12px 14px;
      border: 1px solid var(--app-accent-border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--app-accent-soft) 70%, #fff);
      color: var(--app-text-primary);
    }
    .banner strong { display: block; margin-bottom: 3px; font-size: 13px; }
    .banner span { color: var(--app-text-secondary); font-size: 12.5px; line-height: 1.5; }
    .card {
      overflow: hidden;
      border: 1px solid var(--app-panel-border);
      border-radius: 14px;
      background: #fff;
      box-shadow: var(--app-shadow-panel);
    }
    header {
      padding: 20px 22px 16px;
      border-bottom: 1px solid var(--app-panel-border);
      background: color-mix(in srgb, var(--app-panel-soft) 80%, #fff);
    }
    header h1 {
      margin: 0 0 6px;
      font-size: 20px;
      line-height: 1.3;
      font-weight: 750;
      color: var(--app-text-primary);
    }
    header p {
      margin: 0;
      color: var(--app-text-muted);
      font-size: 12.5px;
    }
    .messages {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 22px max(16px, calc((100% - 720px) / 2 + 16px)) 28px;
    }
    .message {
      display: grid;
      gap: 6px;
      max-width: min(720px, 82%);
      padding: 12px 14px;
      border: 1px solid var(--app-panel-border);
      border-radius: 8px;
      background: var(--app-panel-soft);
      font-size: 12px;
    }
    .message.user {
      align-self: flex-end;
      max-width: min(720px, 78%);
      border-color: var(--app-accent-border);
      background: var(--app-accent-soft);
    }
    .message.assistant {
      align-self: flex-start;
      width: 100%;
      max-width: 100%;
      min-width: min(220px, 100%);
      background: #fff;
    }
    .role {
      display: block;
      margin-bottom: 2px;
      color: var(--app-text-primary);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .content {
      overflow-wrap: anywhere;
      word-break: break-word;
      color: var(--app-text-primary);
      font-size: 14px;
      line-height: 1.68;
    }
    .content.plain { white-space: pre-wrap; }
    .content.markdown > :first-child { margin-top: 0; }
    .content.markdown > :last-child { margin-bottom: 0; }
    .content.markdown > * + * { margin-top: 10px; }
    .content.markdown p {
      margin: 0;
      line-height: 1.48;
      white-space: pre-wrap;
    }
    .content.markdown h1,
    .content.markdown h2,
    .content.markdown h3 {
      margin: 0;
      line-height: 1.35;
      font-weight: 700;
      color: var(--app-text-primary);
    }
    .content.markdown h1 { font-size: 1.28em; }
    .content.markdown h2 { font-size: 1.16em; }
    .content.markdown h3 { font-size: 1.06em; }
    .content.markdown ul,
    .content.markdown ol {
      margin: 0;
      padding-left: 1.35em;
    }
    .content.markdown li { margin: 0.25em 0; }
    .content.markdown code {
      font-family: "JetBrains Mono", Consolas, ui-monospace, monospace;
      font-size: 12px;
      background: var(--app-code-bg);
      padding: 1px 4px;
      border-radius: 4px;
    }
    .content.markdown pre {
      margin: 0;
      padding: 10px;
      overflow: auto;
      max-width: 100%;
      border-radius: 7px;
      background: var(--app-code-block-bg);
      color: var(--app-code-block-text);
    }
    .content.markdown pre code {
      background: transparent;
      padding: 0;
      color: inherit;
      font-size: 12px;
    }
    .content.markdown blockquote {
      margin: 0;
      padding: 0.15em 0 0.15em 0.85em;
      border-left: 2px solid var(--app-panel-border);
      color: var(--app-text-secondary);
    }
    .content.markdown a {
      color: var(--app-accent-strong);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .content.markdown hr {
      border: 0;
      border-top: 1px solid var(--app-panel-border);
      margin: 4px 0;
    }
    .content.markdown .table-wrap {
      margin: 0;
      overflow-x: auto;
      border: 1px solid var(--app-panel-border);
      border-radius: 8px;
    }
    .content.markdown table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .content.markdown th,
    .content.markdown td {
      padding: 9px 11px;
      border-bottom: 1px solid var(--app-panel-border);
      text-align: left;
      vertical-align: top;
    }
    .content.markdown th {
      background: var(--app-accent-soft);
      font-weight: 650;
      color: var(--app-text-primary);
    }
    .content.markdown tr:last-child td { border-bottom: 0; }
    .attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding-top: 2px;
    }
    .attachment {
      display: inline-flex;
      align-items: center;
      max-width: min(240px, 100%);
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(47, 42, 58, 0.08);
      color: var(--app-text-secondary);
      font-size: 11px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    footer {
      margin-top: 16px;
      text-align: center;
      color: var(--app-text-muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand-bar" aria-label="OpenDrSai">
      <span class="brand-mark" aria-hidden="true">OD</span>
      <div><strong>OpenDrSai</strong> · ${escapeHtml(String(visibleMessages.length))} 条消息 · ${escapeHtml(createdLabel)}</div>
    </div>
    <div class="banner" role="note">
      <div>
        <strong>只读分享</strong>
        <span>此页面仅用于查看聊天记录，无法发起新对话或继续提问。</span>
      </div>
    </div>
    <article class="card">
      <header>
        <h1>${escapeHtml(input.title)}</h1>
        <p>OpenDrSai 桌面端只读分享</p>
      </header>
      <div class="messages">
        ${body}
      </div>
    </article>
    <footer>OpenDrSai read-only share · ${escapeHtml(input.shareId)}</footer>
  </div>
  <script>
    document.addEventListener("submit", (event) => event.preventDefault(), true);
  </script>
</body>
</html>`;
}

export function extractShareMessageText(message: DesktopThreadMessageSnapshot): string {
  if (message.role === "assistant") {
    const fromParts = message.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n\n");
    const raw = (fromParts || message.content || "").trim();
    return extractShareConclusion(raw, message.reasoningContent);
  }

  if (message.parts?.length) {
    const parts = message.parts
      .map((part) => {
        if (part.type === "reasoning") return "";
        if (part.type === "text" || part.type === "status") return part.text;
        if (part.type === "error") return part.message;
        if (part.type === "file") return `[file] ${part.name}`;
        return "";
      })
      .filter(Boolean);
    if (parts.length) return stripThinkBlocks(parts.join("\n\n"));
  }
  return stripThinkBlocks([message.content, message.statusContent].filter(Boolean).join("\n\n"));
}

/**
 * Final-answer only: strip &lt;think&gt; blocks and remove duplicated reasoning
 * paragraphs that models sometimes append after the answer.
 */
export function extractShareConclusion(content: string, reasoningContent?: string): string {
  let visible = getVisibleShareText(content);
  const reasoning = mergeShareReasoning(reasoningContent, getShareReasoningText(content));
  if (visible && reasoning) {
    if (visible.includes(reasoning)) {
      visible = visible.replace(reasoning, "");
    }
    const reasoningParagraphs = splitShareParagraphs(reasoning);
    visible = splitShareParagraphs(visible)
      .filter((paragraph) => !isReasoningLikeParagraph(paragraph, reasoningParagraphs))
      .join("\n\n");
  } else {
    visible = splitShareParagraphs(visible)
      .filter((paragraph) => !isInternalMonologueParagraph(paragraph))
      .join("\n\n");
  }
  return stripThinkBlocks(visible).replace(/\n{3,}/g, "\n\n").trim();
}

function isReasoningLikeParagraph(paragraph: string, reasoningParagraphs: string[]): boolean {
  const text = paragraph.trim();
  if (!text) return true;
  if (isInternalMonologueParagraph(text)) return true;
  for (const reasoning of reasoningParagraphs) {
    if (reasoning.length < 16) continue;
    if (text === reasoning) return true;
    if (text.includes(reasoning) || reasoning.includes(text)) return true;
    const tip = reasoning.slice(0, Math.min(36, reasoning.length));
    if (tip.length >= 16 && text.includes(tip)) return true;
  }
  return false;
}

function isInternalMonologueParagraph(paragraph: string): boolean {
  const text = paragraph.trim();
  if (!text) return true;
  return /^(用户想|用户问|The user|I need to|I'll |I will |Let me |系统提示|根据系统|我应该|我需要)/i.test(
    text,
  );
}

/** Remove model thinking blocks so shared views only show the final answer. */
export function stripThinkBlocks(content: string): string {
  return content
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/(?:think|redacted_thinking)>|$)/gi, "")
    .replace(/<\/(?:think|redacted_thinking)>/gi, "")
    .replace(/&lt;think\b[^&]*&gt;[\s\S]*?(?:&lt;\/(?:think|redacted_thinking)&gt;|$)/gi, "")
    .replace(/&lt;\/(?:think|redacted_thinking)&gt;/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderMessageHtml(message: DesktopThreadMessageSnapshot): string {
  const roleLabel =
    message.role === "user" ? "You" : message.role === "assistant" ? "OpenDrSai" : message.role;
  const text = extractShareMessageText(message);
  const bodyHtml =
    message.role === "assistant"
      ? `<div class="content markdown">${markdownToShareHtml(text) || "<em>（空消息）</em>"}</div>`
      : `<div class="content plain">${escapeHtml(text) || "<em>（空消息）</em>"}</div>`;
  const attachments =
    message.attachments && message.attachments.length
      ? `<div class="attachments">${message.attachments
          .map(
            (attachment) =>
              `<span class="attachment">${escapeHtml(attachment.name || attachment.path || attachment.kind)}</span>`,
          )
          .join("")}</div>`
      : "";
  return `<section class="message ${escapeHtml(message.role)}">
  <div class="role">${escapeHtml(roleLabel)}</div>
  ${bodyHtml}
  ${attachments}
</section>`;
}

/**
 * Lightweight markdown → HTML for share pages (no runtime deps).
 */
export function markdownToShareHtml(markdown: string): string {
  const source = stripThinkBlocks(markdown);
  if (!source) return "";

  const codeBlocks: string[] = [];
  let text = source.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const index = codeBlocks.length;
    const language = escapeHtml((lang || "").trim());
    codeBlocks.push(
      `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`,
    );
    return `\n\n%%CODE_BLOCK_${index}%%\n\n`;
  });

  // Recover GFM tables that were accidentally collapsed onto one line.
  text = expandCollapsedMarkdownTables(text);

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];
  let tableRows: string[] = [];

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }
    html.push(
      `<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listType}>`,
    );
    listType = null;
    listItems = [];
  };

  const flushTable = (): void => {
    if (!tableRows.length) return;
    const tableHtml = renderMarkdownTable(tableRows);
    if (tableHtml) html.push(tableHtml);
    tableRows = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const codeMatch = trimmed.match(/^%%CODE_BLOCK_(\d+)%%$/);
    if (codeMatch) {
      flushParagraph();
      flushList();
      flushTable();
      html.push(codeBlocks[Number(codeMatch[1])] || "");
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }
    if (isMarkdownTableRow(trimmed)) {
      flushParagraph();
      flushList();
      tableRows.push(trimmed);
      continue;
    }
    flushTable();
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push("<hr />");
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push(`<blockquote><p>${inlineMarkdown(trimmed.replace(/^>\s?/, ""))}</p></blockquote>`);
      continue;
    }
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      continue;
    }
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushTable();
  return html.join("\n");
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  // Require a pipe on both sides or at least two pipes to avoid false positives.
  const pipes = (trimmed.match(/\|/g) || []).length;
  if (pipes < 2) return false;
  return /^\|?.+\|.+\|?$/.test(trimmed);
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderMarkdownTable(rows: string[]): string {
  const meaningful = rows.filter((row) => row.trim());
  if (meaningful.length < 2) return "";

  let header = splitMarkdownTableRow(meaningful[0]);
  let bodyStart = 1;
  if (isMarkdownTableSeparator(meaningful[1])) {
    bodyStart = 2;
  } else if (meaningful.length >= 3 && isMarkdownTableSeparator(meaningful[2])) {
    // Rare malformed case: keep first row as header anyway.
    bodyStart = 3;
    header = splitMarkdownTableRow(meaningful[0]);
  }

  const bodyRows = meaningful.slice(bodyStart).map(splitMarkdownTableRow);
  if (!header.length) return "";

  const columnCount = Math.max(header.length, ...bodyRows.map((row) => row.length));
  const pad = (cells: string[]): string[] => {
    const next = cells.slice(0, columnCount);
    while (next.length < columnCount) next.push("");
    return next;
  };

  const headHtml = pad(header)
    .map((cell) => `<th>${inlineMarkdown(cell)}</th>`)
    .join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${pad(row).map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

/**
 * Some chat snapshots collapse GFM tables into one line:
 * `| a | b | | --- | --- | | c | d |`
 * Expand those back into one row per line before parsing.
 */
export function expandCollapsedMarkdownTables(markdown: string): string {
  return markdown.replace(/(^|\n)(\|[^\n]+)/g, (match, prefix: string, block: string) => {
    if (block.includes("\n")) return match;
    if (!/\|\s*:?-{3,}:?\s*\|/.test(block)) return match;
    const pipes = (block.match(/\|/g) || []).length;
    if (pipes < 5) return match;

    const cells: string[] = [];
    const cellPattern = /\|([^|]*)/g;
    let found = cellPattern.exec(block);
    while (found) {
      cells.push(found[1].trim());
      found = cellPattern.exec(block);
    }
    if (cells.length && block.trim().endsWith("|") && cells[cells.length - 1] === "") {
      cells.pop();
    }
    if (cells.length < 4) return match;

    const rows: string[][] = [];
    let current: string[] = [];
    for (const cell of cells) {
      if (cell === "") {
        if (current.length) {
          rows.push(current);
          current = [];
        }
        continue;
      }
      current.push(cell);
    }
    if (current.length) rows.push(current);
    if (rows.length < 3) return match;

    const rebuilt = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
    return `${prefix}${rebuilt}`;
  });
}

function inlineMarkdown(value: string): string {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Avoid lookbehind for broader runtime support.
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noreferrer noopener" target="_blank">$1</a>',
  );
  return text;
}

function getVisibleShareText(content: string): string {
  return parseShareOutput(content)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function getShareReasoningText(content: string): string {
  return parseShareOutput(content)
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function mergeShareReasoning(primary: string | undefined, secondary: string | undefined): string {
  const left = primary?.trim() ?? "";
  const right = secondary?.trim() ?? "";
  if (!left) return right;
  if (!right) return left;
  if (left.includes(right) || right.includes(left)) {
    return left.length >= right.length ? left : right;
  }
  return `${left}\n\n${right}`;
}

function splitShareParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

type ShareOutputPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string };

const OPEN_TAG = /^<think(?:\s[^>]*)?>/i;
const CLOSE_TAG = /^<\/(?:think|redacted_thinking)>/i;
const ESCAPED_OPEN_TAG = /^&lt;think(?:\s.*?)?&gt;/i;
const ESCAPED_CLOSE_TAG = /^&lt;\/(?:think|redacted_thinking)&gt;/i;

function parseShareOutput(content: string): ShareOutputPart[] {
  const parts: ShareOutputPart[] = [];
  let mode: "text" | "reasoning" = "text";
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (!buffer) return;
    const text = mode === "reasoning" ? buffer.trim() : buffer;
    if (!text.trim()) {
      buffer = "";
      return;
    }
    const previous = parts[parts.length - 1];
    if (previous && previous.type === mode) {
      previous.text += text;
    } else {
      parts.push({ type: mode, text });
    }
    buffer = "";
  };

  while (index < content.length) {
    const rest = content.slice(index);
    const open = rest.match(OPEN_TAG) ?? rest.match(ESCAPED_OPEN_TAG);
    const close = rest.match(CLOSE_TAG) ?? rest.match(ESCAPED_CLOSE_TAG);
    if (mode === "text" && open) {
      flush();
      mode = "reasoning";
      index += open[0].length;
      continue;
    }
    if (mode === "reasoning" && close) {
      flush();
      mode = "text";
      index += close[0].length;
      continue;
    }
    buffer += content[index];
    index += 1;
  }
  flush();
  return parts;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
