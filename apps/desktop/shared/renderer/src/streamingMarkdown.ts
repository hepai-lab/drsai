export interface StreamingMarkdownSplit {
  stable: string;
  tail: string;
}

/**
 * Keeps the actively changing Markdown block small without splitting fenced
 * code. The completed prefix only changes at blank-line block boundaries.
 */
export function splitStreamingMarkdown(markdown: string): StreamingMarkdownSplit {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let lastBoundary = 0;
  let offset = 0;
  for (const line of markdown.split(/(?<=\n)/)) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    const fenceMatch = withoutNewline.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0] as "`" | "~";
      if (!fence) fence = { marker, length: run.length };
      else if (fence.marker === marker && run.length >= fence.length) fence = null;
    }
    offset += line.length;
    if (!fence && /^\s*$/.test(withoutNewline) && line.endsWith("\n")) lastBoundary = offset;
  }
  if (lastBoundary === 0) return { stable: "", tail: markdown };
  return { stable: markdown.slice(0, lastBoundary), tail: markdown.slice(lastBoundary) };
}
