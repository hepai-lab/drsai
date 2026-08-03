/**
 * StreamingAssistant — renders the in-flight assistant turn from $current.
 *
 * ── Ordered content rendering ────────────────────────────────────────
 *
 * The turn's ``contentParts`` array preserves the real interleaving order
 * of text segments and tool calls (text → tool → text → …). We render
 * them in that order so the user sees content exactly as the LLM produced
 * it, rather than "all tools first, then all text at the bottom".
 *
 * ── Height-clipping (P1-01 root cause fix) ──────────────────────────
 *
 * Ink has a "fullscreen" branch (see ink.js): when the dynamic frame
 * height ever reaches or exceeds the terminal row count, every render
 * thereafter writes ``clearTerminal + fullStaticOutput + output``,
 * which:
 *   1. clears the entire screen including the user's scroll position,
 *   2. re-emits the whole <Static> history (so the terminal scrollback
 *      ends up with the same turn duplicated dozens of times during
 *      one long answer),
 *   3. anchors the viewport firmly at the bottom — manual scroll-up is
 *      ripped back immediately.
 *
 * The only way out is to keep the dynamic frame STRICTLY shorter than
 * the terminal. We clip the streaming content to the last N visual rows
 * where N is computed from the current terminal size minus a budget
 * reserved for the status bar, composer, banner, etc.
 *
 * ── Truncation direction: show latest, hide oldest ──────────────────
 *
 * When the total visual height of all content parts exceeds the budget,
 * we truncate from the TOP (oldest content) and keep the BOTTOM (latest
 * content). This applies across both text segments AND tool calls — so
 * if the LLM did "text A → tool → text B" and only text B fits, the
 * user sees text B, not text A. A "↑ N earlier lines" marker indicates
 * that older content was hidden.
 *
 * "Thinking" hint:
 *   When the turn has started but no text / tool call has happened yet,
 *   we show an animated spinner plus elapsed seconds so the user can
 *   tell the agent is working (especially for reasoning models that
 *   take 10-60 s before first token). The animation stops once any
 *   content arrives so we don't fight the streaming repaints.
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'

import { stripTodoWriteArtifacts } from '../app/todoArtifacts.js'
import { getPartText, type ContentPart, type TextContentPart, type ToolCall } from '../app/types.js'
import { clearHeightCache, getCachedHeight, setCachedHeight } from '../app/heightCache.js'
import { $current } from '../app/turnStore.js'
import { $showReasoning, $terminalFocused, $toolDetail } from '../app/uiStore.js'
import { useTerminalSize } from '../hooks/terminalSizeStore.js'
import { theme } from '../theme.js'

import { stripThinkBlocks } from './markdownRenderer.js'
import { ToolCallLine } from './toolCallLine.js'

// Braille rotor — 10 frames is a typical xterm spinner; tick every 100 ms.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_TICK_MS = 100
const ELAPSED_TICK_MS = 1000

// Rows we reserve for non-streaming UI: banner (1) + transcript margins
// (2) + status bar divider+row (2) + statusLine (1) + composer prompt (1-2)
// + safety margin (1). 8 is a conservative budget that holds even when
// the status bar is in its multi-row narrow layout.
const RESERVED_ROWS = 8
const MIN_STREAM_ROWS = 3

/**
 * Spinner + elapsed-seconds hook. ``active`` gates the timers so an
 * unfocused window doesn't burn CPU.
 */
function useThinkingPulse(active: boolean, startedAt: number) {
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) return
    const spin = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length)
    }, SPINNER_TICK_MS)
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, ELAPSED_TICK_MS)
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    return () => {
      clearInterval(spin)
      clearInterval(tick)
    }
  }, [active, startedAt])

  return { glyph: SPINNER_FRAMES[frame], elapsed }
}

/**
 * Soft-wrap a logical line to `cols` columns and return the wrapped
 * lines. Naïve character-count wrap — no CJK width awareness — but the
 * count only needs to be a (slight) overestimate of visual lines, so
 * this is good enough for the clip threshold. Returns ``['']`` for an
 * empty string so the count matches the visual reality (one blank row).
 */
function visualWrap(line: string, cols: number): string[] {
  if (cols <= 0) return [line]
  if (line.length === 0) return ['']
  const out: string[] = []
  for (let i = 0; i < line.length; i += cols) {
    out.push(line.slice(i, i + cols))
  }
  return out
}

/** Count the visual rows of ``text`` when wrapped at ``cols`` columns. */
function countVisualRows(text: string, cols: number): number {
  if (!text) return 0
  let count = 0
  for (const ll of text.split('\n')) {
    count += visualWrap(ll, cols).length
  }
  return count
}

/**
 * Estimate the visual height (in terminal rows) of a single content part.
 *
 * - Text parts: count wrapped rows at ``cols`` width.
 * - Tool parts: compact mode ≈ 1 row; expanded mode ≈ 1 (header) +
 *   argCount + min(resultLines, 3) + 1 (arrow). We use a conservative
 *   overestimate so clipping kicks in slightly early rather than late.
 *
 * ── Caching ────────────────────────────────────────────────────────
 *
 * Text parts' heights are cached by (partId, chunkCount, cols). Between
 * flushes only the last text part grows (chunkCount increases); all
 * earlier parts hit the cache. This reduces per-flush cost from
 * O(total_text) to O(last_part_text).
 */
function estimatePartHeight(
  part: ContentPart,
  tools: ToolCall[],
  cols: number,
  toolDetail: 'compact' | 'expanded',
): number {
  if (part.kind === 'text') {
    // Check cache: keyed by partId + chunkCount + cols. If the part
    // hasn't grown since last estimate and cols is the same, reuse.
    const cached = getCachedHeight(part.id, part.chunks.length, cols)
    if (cached !== undefined) return cached
    // Cache miss: compute from the joined text. Use getPartText() which
    // lazily joins chunks and caches the result in part.text.
    const cleanText = stripTodoWriteArtifacts(stripThinkBlocks(getPartText(part)))
    const rows = countVisualRows(cleanText, cols)
    setCachedHeight(part.id, part.chunks.length, cols, rows)
    return rows
  }
  // Tool part — find the referenced tool
  const tool = tools.find(t => t.id === part.toolId)
  if (!tool) return 1
  if (toolDetail === 'compact') {
    return 1
  }
  // Expanded: header (1) + args (N) + result lines (up to 3) + arrow (1)
  const argCount = Object.keys(tool.args).length
  const resultLines = tool.result
    ? Math.min(tool.result.split('\n').filter(l => l.trim()).length, 3)
    : 0
  return 1 + argCount + (resultLines > 0 ? 1 + resultLines : 0)
}

/**
 * Build the visible slice of content parts, clipping from the top
 * (oldest) to fit within ``budget`` rows. Returns the visible parts
 * and the number of hidden rows (for the "↑ N earlier lines" marker).
 */
function clipContentParts(
  parts: ContentPart[],
  tools: ToolCall[],
  budget: number,
  cols: number,
  toolDetail: 'compact' | 'expanded',
): { visible: ContentPart[]; hiddenRows: number; firstPartMaxRows: number } {
  if (parts.length === 0) return { visible: [], hiddenRows: 0, firstPartMaxRows: 0 }

  // Calculate height of each part
  const heights = parts.map(p => estimatePartHeight(p, tools, cols, toolDetail))
  const totalHeight = heights.reduce((a, b) => a + b, 0)

  if (totalHeight <= budget) {
    return { visible: parts, hiddenRows: 0, firstPartMaxRows: 0 }
  }

  // Walk from the end (latest) and accumulate until we hit the budget
  let used = 0
  let cutIndex = parts.length
  for (let i = parts.length - 1; i >= 0; i--) {
    const h = heights[i]
    if (used + h > budget) {
      cutIndex = i + 1
      break
    }
    used += h
    cutIndex = i
  }

  // If nothing fits (single part taller than budget), keep at least
  // the last part and clip it intra-part (handled by firstPartMaxRows)
  if (cutIndex >= parts.length) {
    cutIndex = parts.length - 1
    used = 0  // nothing before the last part is fully visible
  }

  const visible = parts.slice(cutIndex)

  // If the first visible part is a text part that didn't fully fit,
  // calculate how many rows of it we CAN show (the remainder of the
  // budget). This enables intra-part text clipping (keep the tail).
  let firstPartMaxRows = 0
  if (visible.length > 0 && visible[0].kind === 'text') {
    const remaining = budget - used
    const firstHeight = heights[cutIndex]
    if (firstHeight > remaining) {
      firstPartMaxRows = Math.max(MIN_STREAM_ROWS, remaining)
    }
  }

  // hiddenRows includes fully hidden parts above + partially hidden
  // rows in the first visible part
  const fullHiddenRows = heights.slice(0, cutIndex).reduce((a, b) => a + b, 0)
  const partialHiddenRows = firstPartMaxRows > 0
    ? heights[cutIndex] - firstPartMaxRows
    : 0
  const totalHidden = fullHiddenRows + partialHiddenRows

  return { visible, hiddenRows: totalHidden, firstPartMaxRows }
}

/**
 * Clip a text segment to its last ``maxRows`` visual rows. Used when
 * a single text part is taller than the entire budget — we keep only
 * its tail so the latest text is visible.
 */
function clipTextSegment(text: string, maxRows: number, cols: number): {
  clipped: string
  hiddenLines: number
} {
  if (!text) return { clipped: '', hiddenLines: 0 }
  const logicalLines = text.split('\n')
  const visualLines: string[] = []
  for (const ll of logicalLines) {
    visualLines.push(...visualWrap(ll, cols))
  }
  if (visualLines.length <= maxRows) {
    return { clipped: text, hiddenLines: 0 }
  }
  const kept = visualLines.slice(visualLines.length - maxRows)
  return {
    clipped: kept.join('\n'),
    hiddenLines: visualLines.length - maxRows,
  }
}

export function StreamingAssistant() {
  const cur = useStore($current)
  const showReasoning = useStore($showReasoning)
  const termFocused = useStore($terminalFocused)
  const toolDetail = useStore($toolDetail)
  const { cols, rows } = useTerminalSize()

  // During streaming, text is not maintained on the turn object (see
  // flushBuffers in createGatewayEventHandler.ts) — we derive it from
  // contentParts instead. For legacy turns (loaded from history with
  // empty contentParts), fall back to cur.text.
  const hasContentParts = !!cur && cur.contentParts.length > 0
  const hasStreamContent = hasContentParts
    ? cur!.contentParts.some(p => p.kind === 'text' && getPartText(p).length > 0) || cur!.tools.length > 0
    : !!cur && (stripTodoWriteArtifacts(stripThinkBlocks(cur.text)).length > 0 || cur.tools.length > 0)
  // For legacy fallback path: clean text from cur.text (only used when
  // contentParts is empty, e.g. history-loaded turns that are streaming)
  const legacyCleanText = !hasContentParts && cur
    ? stripTodoWriteArtifacts(stripThinkBlocks(cur.text))
    : ''

  // Compute the row budget for streaming content. Subtract:
  //   - RESERVED_ROWS for the rest of the dynamic frame
  //   - 1 row for the "● assistant" header
  //   - reasoning block height (if shown)
  //   - 1 row for the "↑ N earlier lines" marker (if we end up clipping)
  const reasoningRows = showReasoning && cur?.reasoning?.trim() ? 4 : 0
  // Guard: if rows is still 0 or impossibly small (terminal size not yet
  // reported), use a generous default so we don't trigger clipping on
  // the very first render.
  const effectiveRows = rows > 0 ? rows : 24
  const budget = Math.max(
    MIN_STREAM_ROWS,
    effectiveRows - RESERVED_ROWS - 1 /* header */ - reasoningRows - 1 /* marker */,
  )

  // "Thinking" pulse runs only:
  //   - turn is in flight (status === 'streaming')
  //   - no visible content yet (no text, no tool call started)
  //   - terminal window has focus
  const showThinking =
    !!cur &&
    cur.status === 'streaming' &&
    !hasStreamContent
  const pulse = useThinkingPulse(showThinking && termFocused, cur?.startedAt ?? Date.now())

  if (!cur) return null

  // Build ordered render items from contentParts. Fall back to legacy
  // rendering (all tools → text) if contentParts is empty (e.g. turns
  // loaded from history that haven't been migrated yet).
  const effectiveCols = Math.max(20, cols - 4)

  let visibleParts: ContentPart[] = []
  let hiddenRows = 0
  let firstPartMaxRows = 0

  if (hasContentParts) {
    const result = clipContentParts(cur.contentParts, cur.tools, budget, effectiveCols, toolDetail)
    visibleParts = result.visible
    hiddenRows = result.hiddenRows
    firstPartMaxRows = result.firstPartMaxRows
  }

  // Legacy fallback: if no contentParts, use the old clip-to-last-rows on text
  let legacyClipped = ''
  let legacyHidden = 0
  if (!hasContentParts) {
    const toolRows = cur.tools.length
    const textBudget = Math.max(MIN_STREAM_ROWS, budget - toolRows)
    const result = clipTextSegment(legacyCleanText, textBudget, effectiveCols)
    legacyClipped = result.clipped
    legacyHidden = result.hiddenLines
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* ▎ prefix acts as a left-edge progress indicator (like ChatGPT/Copilot sidebar) */}
      <Text color={theme.primary} bold>▎ ● assistant</Text>

      {showReasoning && cur.reasoning.trim() && (
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text color={theme.reasoning} dimColor>┌─ reasoning ─</Text>
          <Text color={theme.reasoning} dimColor>{cur.reasoning.trim()}</Text>
          <Text color={theme.reasoning} dimColor>└─</Text>
        </Box>
      )}

      {/*
        Ordered content rendering: text segments and tool calls are
        interleaved in the order they arrived from the LLM.

        Height-clipping: when total height exceeds the budget, we
        truncate from the TOP (oldest content) and keep the BOTTOM
        (latest content). A "↑ N earlier lines" marker appears at the
        top of the visible region. The hidden content reappears in
        <Static> at finalize and is then permanently in the terminal's
        scrollback.
      */}
      {hasContentParts && hiddenRows > 0 && (
        <Box>
          <Text color={theme.muted} dimColor>
            {`  ↑ ${hiddenRows} earlier line${hiddenRows > 1 ? 's' : ''} (will appear in scrollback when turn ends)`}
          </Text>
        </Box>
      )}

      {hasContentParts && visibleParts.map((part, idx) => {
        if (part.kind === 'tool') {
          const tool = cur.tools.find(t => t.id === part.toolId)
          if (!tool) return null
          return <ToolCallLine key={part.id} tool={tool} />
        }
        // Text part — clean and render as plain <Text> (no Markdown
        // during streaming, for performance).
        let cleanPartText = stripTodoWriteArtifacts(stripThinkBlocks(getPartText(part)))
        if (!cleanPartText) return null

        // If this is the first visible part and it needs intra-part
        // clipping (single text segment taller than remaining budget),
        // clip to show only the latest rows.
        if (idx === 0 && firstPartMaxRows > 0) {
          const clipped = clipTextSegment(cleanPartText, firstPartMaxRows, effectiveCols)
          cleanPartText = clipped.clipped
          if (!cleanPartText) return null
        }

        return (
          <Box key={part.id} marginTop={1}>
            <Text color={theme.assistant}>{cleanPartText}</Text>
          </Box>
        )
      })}

      {/* Legacy fallback rendering (no contentParts — e.g. history-loaded turns) */}
      {!hasContentParts && (
        <>
          {cur.tools.map(tool => (
            <ToolCallLine key={tool.id} tool={tool} />
          ))}
          {legacyHidden > 0 && (
            <Box>
              <Text color={theme.muted} dimColor>
                {`  ↑ ${legacyHidden} earlier line${legacyHidden > 1 ? 's' : ''} (will appear in scrollback when turn ends)`}
              </Text>
            </Box>
          )}
          {legacyClipped && (
            <Box marginTop={1}>
              <Text color={theme.assistant}>{legacyClipped}</Text>
            </Box>
          )}
        </>
      )}

      {showThinking && (
        <Box>
          <Text color={theme.muted} dimColor>
            {`  ${termFocused ? pulse.glyph : '○'} thinking… ${pulse.elapsed}s`}
          </Text>
        </Box>
      )}

      {cur.status === 'error' && (
        <Box marginTop={1}>
          <Text color={theme.error}>✗ error: {cur.errorMessage}</Text>
        </Box>
      )}

      {cur.status === 'interrupted' && (
        <Box marginTop={1}>
          <Text color={theme.warn}>⚠ interrupted</Text>
        </Box>
      )}
    </Box>
  )
}
