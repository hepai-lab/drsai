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
import { getPartText, getReasoningText, type ContentPart, type TextContentPart, type ToolCall } from '../app/types.js'
import { clearHeightCache, getCachedHeight, setCachedHeight } from '../app/heightCache.js'
import { softWrapWide } from '../app/stringWidth.js'
import { $current } from '../app/turnStore.js'
import { $showReasoning, $terminalFocused, $toolDetail, $composerInputHeight } from '../app/uiStore.js'
import { useTerminalSize } from '../hooks/terminalSizeStore.js'
import { theme } from '../theme.js'

import { stripThinkBlocks } from './markdownRenderer.js'
import { ToolCallLine } from './toolCallLine.js'

// Braille rotor — 10 frames is a typical xterm spinner; tick every 100 ms.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_TICK_MS = 100
const ELAPSED_TICK_MS = 1000

// Rows reserved for non-streaming UI OUTSIDE StreamingAssistant.
//
// This is now DYNAMIC: the base overhead (StatusBar + ComposerPane
// marginTop + divider + banner + safety margin) is constant, but the
// composer's TextInput height is variable — it grows as the user types
// more lines. The $composerInputHeight atom (updated by TextInput via
// onHeightChange) provides the current input area height.
//
// Breakdown:
//   ComposerPane:  marginTop(1) + divider(1) + composerInputHeight
//   StatusBar:     marginTop(1) + divider(1) + content(1) = 3 (wide)
//   Banner:        0-1 (optional MemoryPreviewBanner)
//   Safety margin: 1
//   Total:          composerInputHeight + 6
//
// When the user types more lines, composerInputHeight grows, so
// RESERVED_ROWS grows, and the streaming budget shrinks — keeping the
// total dynamic frame (StreamingAssistant + StatusBar + Composer)
// strictly below stdout.rows.
const RESERVED_BASE_ROWS = 6  // everything except the composer input height
const MIN_STREAM_ROWS = 3

// Maximum fraction of terminal rows the dynamic streaming frame may
// occupy. Keeping this well below 1.0 provides a hard ceiling that
// prevents Ink's fullscreen branch (lastOutputHeight >= stdout.rows)
// from firing even when the RESERVED_ROWS estimate is too optimistic.
// At 0.55, a 24-row terminal gets a max budget of ~13 rows for
// streaming content, leaving ~11 rows for StatusBar + Composer +
// headers/margins — more than enough, and the frame can never reach
// 24 rows to trigger fullscreen.
const MAX_FRAME_FRACTION = 0.55

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
 * Soft-wrap a logical line to `cols` terminal cells and return the
 * wrapped lines. Display-width-aware (CJK = 2 cells, emoji = 2 cells)
 * via the stringWidth module — prevents height underestimation for
 * Chinese text which would otherwise cause the frame to overflow.
 * Returns ``['']`` for an empty string so the count matches the
 * visual reality (one blank row).
 */
function visualWrap(line: string, cols: number): string[] {
  if (cols <= 0) return [line]
  if (line.length === 0) return ['']
  return softWrapWide(line, cols)
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
  // ── Operator tools: use tool-specific height estimate ──────────
  // These tools have custom rendering in OperatorToolLine with
  // different arg/result line counts than the generic estimator.
  const opToolNames = new Set([
    'run_read', 'run_write', 'run_edit', 'run_grep', 'run_glob',
    'run_bash', 'run_bash_background', 'run_powershell', 'run_powershell_background',
    'get_bash_task', 'get_powershell_task',
    'list_bash_tasks', 'list_powershell_tasks',
    'kill_bash_task', 'kill_powershell_task',
  ])
  if (opToolNames.has(tool.name)) {
    // Header (1) + arg lines (varies by tool, use argCount as upper bound)
    // + result lines (up to 5 for preview, up to 8 for edit diff)
    const argCount = Object.keys(tool.args).length
    const maxResultLines = tool.name === 'run_edit' ? 8 : 5
    const resultLines = tool.result
      ? Math.min(tool.result.split('\n').filter(l => l.trim()).length, maxResultLines)
      : 0
    // Conservative: 1 (header) + argCount (args) + 1 (arrow or summary) + resultLines
    return 1 + Math.min(argCount, 3) + (resultLines > 0 ? 1 + resultLines : 0)
  }
  // Expanded: header (1) + args (N) + result lines (up to 3) + arrow (1)
  const argCount = Object.keys(tool.args).length
  const resultLines = tool.result
    ? Math.min(tool.result.split('\n').filter(l => l.trim()).length, 3)
    : 0
  return 1 + argCount + (resultLines > 0 ? 1 + resultLines : 0)
}

// Maximum number of content parts to scan in clipContentParts.
// Only the last MAX_SCAN_PARTS items are height-estimated; older
// parts are assumed to be already-hidden (clipped from top). This
// bounds the per-flush cost of clipContentParts to O(MAX_SCAN_PARTS)
// instead of O(total_parts), which matters when a single turn has
// 50+ parts after compaction.
const MAX_SCAN_PARTS = 20

/**
 * Build the visible slice of content parts, clipping from the top
 * (oldest) to fit within ``budget`` rows. Returns the visible parts
 * and the number of hidden rows (for the "↑ N earlier lines" marker).
 *
 * ── Scan range limit ────────────────────────────────────────────
 *
 * Only the last MAX_SCAN_PARTS parts are scanned for height estimation.
 * Older parts are treated as "definitely hidden" — their exact heights
 * are not needed since they'll be clipped anyway when total height
 * exceeds budget. The hiddenRows count for these unscanned parts is
 * approximated as "all of them" (the marker just says "N earlier lines"
 * which is fine — the user doesn't need the exact count).
 */
function clipContentParts(
  parts: ContentPart[],
  tools: ToolCall[],
  budget: number,
  cols: number,
  toolDetail: 'compact' | 'expanded',
): { visible: ContentPart[]; hiddenRows: number; firstPartMaxRows: number } {
  if (parts.length === 0) return { visible: [], hiddenRows: 0, firstPartMaxRows: 0 }

  // Only scan the last MAX_SCAN_PARTS items; older parts are assumed hidden.
  const scanStart = Math.max(0, parts.length - MAX_SCAN_PARTS)
  const scanParts = parts.slice(scanStart)

  // Calculate height of each scanned part
  const heights = scanParts.map(p => estimatePartHeight(p, tools, cols, toolDetail))
  const totalHeight = heights.reduce((a, b) => a + b, 0)

  if (totalHeight <= budget && scanStart === 0) {
    return { visible: parts, hiddenRows: 0, firstPartMaxRows: 0 }
  }

  // If scanned parts fit but there are unscanned (older) parts, those
  // are all hidden.
  if (totalHeight <= budget) {
    // All scanned parts fit; older unscanned parts are all hidden.
    // We don't know their exact heights, so mark them as "hidden" with
    // a count that at least includes the number of unscanned parts.
    return {
      visible: scanParts,
      hiddenRows: scanStart > 0 ? scanStart : 0,  // approximate: 1 row per unscanned part
      firstPartMaxRows: 0,
    }
  }

  // Walk from the end (latest) and accumulate until we hit the budget
  let used = 0
  let cutIndex = scanParts.length
  for (let i = scanParts.length - 1; i >= 0; i--) {
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
  if (cutIndex >= scanParts.length) {
    cutIndex = scanParts.length - 1
    used = 0  // nothing before the last part is fully visible
  }

  const visible = scanParts.slice(cutIndex)

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

  // hiddenRows: fully hidden scanned parts + unscanned older parts
  const fullHiddenScanned = heights.slice(0, cutIndex).reduce((a, b) => a + b, 0)
  const partialHiddenRows = firstPartMaxRows > 0
    ? heights[cutIndex] - firstPartMaxRows
    : 0
  const totalHidden = fullHiddenScanned + partialHiddenRows + (scanStart > 0 ? scanStart : 0)

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
  const composerInputHeight = useStore($composerInputHeight)
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
  //   - RESERVED_ROWS for StatusBar + ComposerPane + this component's
  //     own marginTop (see RESERVED_BASE_ROWS comment for the full
  //     breakdown). The composer's TextInput height is now dynamic
  //     (reported via $composerInputHeight), so the budget shrinks
  //     when the user types more lines — preventing the total dynamic
  //     frame from reaching stdout.rows.
  //   - 1 row for the "● assistant" header
  //   - reasoning block height (if shown)
  //   - 1 row for the "↑ N earlier lines" marker (if we end up clipping)
  //   - 1 row SAFETY MARGIN to guarantee the total dynamic frame stays
  //     STRICTLY below stdout.rows.
  //
  // Then apply MAX_FRAME_FRACTION as a hard ceiling: the streaming
  // content area may never exceed 55% of terminal rows. This prevents
  // the total dynamic frame (StreamingAssistant + StatusBar + Composer)
  // from reaching stdout.rows and triggering Ink's fullscreen branch,
  // even when RESERVED_ROWS underestimates the real overhead.
  const effectiveCols = Math.max(20, cols - 4)
  const effectiveRows = rows > 0 ? rows : 24
  const reservedRows = composerInputHeight + RESERVED_BASE_ROWS
  const reasoningText = showReasoning && cur ? getReasoningText(cur).trim() : ''
  const reasoningRows = reasoningText
    ? 1 /* marginTop */ + 1 /* header */ + countVisualRows(reasoningText, Math.max(10, effectiveCols - 2)) + 1 /* footer */
    : 0
  const rawBudget = effectiveRows - reservedRows - 1 /* header */ - reasoningRows - 1 /* marker */ - 1 /* safety */
  const maxBudget = Math.floor(effectiveRows * MAX_FRAME_FRACTION)
  const budget = Math.max(
    MIN_STREAM_ROWS,
    Math.min(rawBudget, maxBudget),
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

      {showReasoning && reasoningText && (
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text color={theme.reasoning} dimColor>┌─ reasoning ─</Text>
          <Text color={theme.reasoning} dimColor>{reasoningText}</Text>
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
