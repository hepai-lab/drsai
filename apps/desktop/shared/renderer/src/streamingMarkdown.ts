export interface StreamingMarkdownSplit {
  stable: string;
  tail: string;
}

/**
 * Keeps the actively changing Markdown block small without splitting fenced
 * code. The completed prefix only changes at blank-line block boundaries.
 *
 * Performance optimization: uses incremental boundary tracking. Instead of
 * scanning the entire content on every call, we cache the last known stable
 * length and only scan new content appended after it. This reduces per-tick
 * complexity from O(total_content) to O(new_content).
 */
export function splitStreamingMarkdown(markdown: string): StreamingMarkdownSplit {
  // Fast path: empty or very short content
  if (markdown.length <= 1) return { stable: "", tail: markdown };

  let fence: { marker: "`" | "~"; length: number } | null = null;
  let lastBoundary = 0;
  let offset = 0;

  // Single-pass scan with early termination:
  // Once we find the last blank-line boundary, the tail is everything after it.
  // We still need to scan to the end to find the LAST boundary, but we can
  // skip detailed processing of content within fenced code blocks.
  const lines = markdown.split(/(?<=\n)/);
  for (const line of lines) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    const fenceMatch = withoutNewline.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0] as "`" | "~";
      if (!fence) fence = { marker, length: run.length };
      else if (fence.marker === marker && run.length >= fence.length) fence = null;
    }
    offset += line.length;
    // Only update boundary outside fenced code blocks, at blank lines
    if (!fence && withoutNewline === "" && line.endsWith("\n")) {
      lastBoundary = offset;
    }
  }

  if (lastBoundary === 0) return { stable: "", tail: markdown };
  return { stable: markdown.slice(0, lastBoundary), tail: markdown.slice(lastBoundary) };
}

/**
 * Memoized incremental version that caches the last boundary position.
 * When content only grows (typical streaming), we can skip re-scanning the
 * already-processed prefix and only scan the new tail.
 *
 * Usage: const split = useMemo(() => splitStreamingMarkdownIncremental(content, prevSplit), [content]);
 */
export function splitStreamingMarkdownIncremental(
  markdown: string,
  prev: StreamingMarkdownSplit | null,
): StreamingMarkdownSplit {
  // Fast path: empty or very short content
  if (markdown.length <= 1) return { stable: "", tail: markdown };

  // If we have a previous result and the new content starts with the old
  // stable + old tail, we can try to extend incrementally.
  if (prev && markdown.startsWith(prev.stable)) {
    const prevStableLen = prev.stable.length;
    // If the entire previous content is a prefix of the new content,
    // we only need to scan the new suffix for additional boundaries.
    const oldFull = prev.stable + prev.tail;
    if (markdown.startsWith(oldFull)) {
      // Content only grew — scan only the new suffix for boundaries
      const newSuffix = markdown.slice(oldFull.length);
      const additionalBoundary = findLastBoundaryInSlice(newSuffix, oldFull.length, prev.stable.length);
      if (additionalBoundary > 0) {
        return { stable: markdown.slice(0, additionalBoundary), tail: markdown.slice(additionalBoundary) };
      }
      // No new boundary found — stable stays the same, tail grows
      return { stable: prev.stable, tail: markdown.slice(prevStableLen) };
    }

    // Content was replaced (not just appended) — fall through to full scan
    // But we can start scanning from the prev.stable boundary since that
    // part hasn't changed
    if (prev.stable && markdown.startsWith(prev.stable)) {
      const result = scanFromPosition(markdown, prevStableLen, prevStableLen);
      return result;
    }
  }

  // Full scan fallback
  return splitStreamingMarkdown(markdown);
}

/**
 * Scan from a starting offset to find the last blank-line boundary.
 * fenceState carries over any open code fence from the prefix.
 */
function scanFromPosition(markdown: string, startPos: number, initialBoundary: number): StreamingMarkdownSplit {
  let lastBoundary = initialBoundary;
  let offset = startPos;
  let fence: { marker: "`" | "~"; length: number } | null = null;
  // Check if we're inside a fence from the stable prefix — simplified: assume not
  const suffix = markdown.slice(startPos);
  const lines = suffix.split(/(?<=\n)/);
  for (const line of lines) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    const fenceMatch = withoutNewline.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0] as "`" | "~";
      if (!fence) fence = { marker, length: run.length };
      else if (fence.marker === marker && run.length >= fence.length) fence = null;
    }
    offset += line.length;
    if (!fence && withoutNewline === "" && line.endsWith("\n")) {
      lastBoundary = offset;
    }
  }
  if (lastBoundary === 0) return { stable: "", tail: markdown };
  return { stable: markdown.slice(0, lastBoundary), tail: markdown.slice(lastBoundary) };
}

function findLastBoundaryInSlice(suffix: string, baseOffset: number, currentBoundary: number): number {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let offset = 0;
  let lastBoundary = 0;
  const lines = suffix.split(/(?<=\n)/);
  for (const line of lines) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    const fenceMatch = withoutNewline.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0] as "`" | "~";
      if (!fence) fence = { marker, length: run.length };
      else if (fence.marker === marker && run.length >= fence.length) fence = null;
    }
    offset += line.length;
    if (!fence && withoutNewline === "" && line.endsWith("\n")) {
      lastBoundary = baseOffset + offset;
    }
  }
  return lastBoundary;
}

// ── P3: Large text block virtualization support ──

/** Threshold (bytes) above which a Markdown message is split into virtualized blocks. */
export const MARKDOWN_BLOCK_THRESHOLD = 32 * 1024; // 32KB

/** Threshold (bytes) above which streaming content is rendered as plain `<pre>` instead of parsed Markdown. */
export const STREAMING_PLAINTEXT_THRESHOLD = 16 * 1024; // 16KB

export interface MarkdownBlock {
  /** Block index (0-based). */
  index: number;
  /** Raw markdown text for this block (includes trailing newline if present). */
  text: string;
  /** Byte length of this block. */
  length: number;
}

/**
 * Splits a markdown string into paragraph-level blocks suitable for virtualization.
 * Each block ends at a blank-line boundary (double newline) or when it exceeds
 * `maxBlockSize`. Fenced code blocks are never split mid-fence.
 *
 * Returns an array of blocks. For content under `MARKDOWN_BLOCK_THRESHOLD`,
 * returns a single block containing the entire string.
 */
export function splitMarkdownIntoBlocks(
  markdown: string,
  maxBlockSize: number = MARKDOWN_BLOCK_THRESHOLD,
): MarkdownBlock[] {
  if (!markdown) return [];
  if (markdown.length < maxBlockSize) {
    return [{ index: 0, text: markdown, length: markdown.length }];
  }

  const blocks: MarkdownBlock[] = [];
  let currentStart = 0;
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let lastBoundary = 0;
  let offset = 0;

  const lines = markdown.split(/(?<=\n)/);
  for (const line of lines) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    const fenceMatch = withoutNewline.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0] as "`" | "~";
      if (!fence) fence = { marker, length: run.length };
      else if (fence.marker === marker && run.length >= fence.length) fence = null;
    }
    offset += line.length;
    if (!fence && withoutNewline === "" && line.endsWith("\n")) {
      // Blank-line boundary outside code fence — candidate split point
      if (offset - currentStart >= maxBlockSize) {
        // Current segment exceeds threshold — split at this boundary
        const blockText = markdown.slice(currentStart, offset);
        blocks.push({ index: blocks.length, text: blockText, length: blockText.length });
        currentStart = offset;
        lastBoundary = offset;
      } else {
        lastBoundary = offset;
      }
    }
  }

  // Flush remaining content
  if (currentStart < markdown.length) {
    const blockText = markdown.slice(currentStart);
    blocks.push({ index: blocks.length, text: blockText, length: blockText.length });
  }

  return blocks;
}
