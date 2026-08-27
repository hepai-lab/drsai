/**
 * TranscriptPane — renders completed turns above the live streaming turn.
 *
 * Architecture:
 *   - Completed turns go into Ink's <Static>. Static is APPEND-ONLY:
 *     once a turn is rendered, Ink writes it to stdout and never
 *     repaints it. The terminal's scrollback owns it from then on, so
 *     the user can scroll back through history with the terminal's
 *     native scrollbar / wheel without Ink's eraseLines() yanking the
 *     view back to the bottom (P1-01).
 *   - The streaming assistant turn lives in the DYNAMIC frame (below
 *     <Static>). Ink keeps repainting just that small region as deltas
 *     arrive. When the turn finalizes, turnController moves it from
 *     $current into $transcript, which lets <Static> commit it
 *     permanently to scrollback in the next render.
 *
 * Why we dropped the in-TUI virtual scroll (PageUp/PageDown turn
 * stepping):
 *   With <Static> the terminal already provides scrollback for every
 *   completed turn. The old PageUp logic stepped by turn index inside
 *   the dynamic frame which competed with terminal-native scroll and
 *   confused users when both were active. Native scrolling is the
 *   right primitive — the user already knows how to do it.
 *
 * Session switch:
 *   The parent passes `sessionId` so we can key the wrapper. When the
 *   user changes sessions, $transcript is replaced and Static remounts
 *   (its internal `index` cursor resets) so the new session's history
 *   appears clean rather than "appended" below the old one.
 */

import { memo } from 'react'
import { useStore } from '@nanostores/react'
import { Box, Static, Text } from 'ink'

import { stripTodoWriteArtifacts } from '../app/todoArtifacts.js'
import { getPartText, type AssistantTurn, type ContentPart, type ToolCall, type Turn } from '../app/types.js'
import { softWrapWide } from '../app/stringWidth.js'
import { $transcript, $transcriptGeneration } from '../app/turnStore.js'
import { $toolDetail } from '../app/uiStore.js'
import { $terminalSize } from '../hooks/terminalSizeStore.js'
import { theme } from '../theme.js'

import { MarkdownRenderer, stripThinkBlocks } from './markdownRenderer.js'
import { StreamingAssistant } from './streamingAssistant.js'
import { ToolCallLine } from './toolCallLine.js'

// ── Final-render height clipping ───────────────────────────────────
//
// During streaming, ``StreamingAssistant`` clips content to ~55% of
// terminal rows to prevent Ink's fullscreen branch. But at finalization,
// the turn moves to ``<Static>`` which writes ALL contentParts to stdout
// at full height — a massive synchronous write that can freeze the
// terminal for very long turns (500+ lines).
//
// This module applies similar height clipping at final render time:
//   - Budget: ``max(rows * 2, 50)`` — generous enough for normal
//     responses, but caps pathological cases.
//   - Truncation direction: show latest (bottom), hide oldest (top).
//   - Shows "↑ N earlier lines collapsed (Ctrl+E to expand)" marker.
//   - Ctrl+E prints the full content to scrollback via ``console.log()``.
//
// Non-reactive store reads (``.get()``) are intentional here: <Static>
// items are rendered once and never re-rendered, so we want the
// terminal size at commit time, not a live subscription.

const FINAL_RENDER_BUDGET_MULT = 2
const MIN_FINAL_RENDER_BUDGET = 50

/** Count the visual rows of ``text`` when wrapped at ``cols`` columns. */
function countTextVisualRows(text: string, cols: number): number {
  if (!text) return 0
  let count = 0
  for (const ll of text.split('\n')) {
    count += softWrapWide(ll, cols).length
  }
  return count
}

/**
 * Estimate the visual height (in terminal rows) of a single content part
 * in a completed turn. Text parts use width-aware row counting; tool parts
 * use the same heuristic as ``StreamingAssistant.estimatePartHeight``.
 */
function estimateCompletedPartHeight(
  part: ContentPart,
  tools: ToolCall[],
  cols: number,
  toolDetail: 'compact' | 'expanded',
): number {
  if (part.kind === 'text') {
    const cleanText = stripTodoWriteArtifacts(stripThinkBlocks(getPartText(part)))
    const rows = countTextVisualRows(cleanText, cols)
    return rows + 1  // +1 for the marginTop on the wrapping <Box>
  }
  // Tool part
  const tool = tools.find(t => t.id === part.toolId)
  if (!tool) return 1
  if (toolDetail === 'compact') return 1
  // Expanded: header (1) + arg lines + result preview lines
  const argCount = Object.keys(tool.args).length
  const resultLines = tool.result
    ? Math.min(tool.result.split('\n').filter(l => l.trim()).length, 5)
    : 0
  return 1 + Math.min(argCount, 3) + (resultLines > 0 ? 1 + resultLines : 0)
}

/**
 * Clip a text segment to its last ``maxRows`` visual rows. Used when a
 * single text part is taller than the entire budget — we keep only its
 * tail so the latest text is visible.
 */
function clipTextSegment(text: string, maxRows: number, cols: number): {
  clipped: string
  hiddenLines: number
} {
  if (!text) return { clipped: '', hiddenLines: 0 }
  const visualLines: string[] = []
  for (const ll of text.split('\n')) {
    visualLines.push(...softWrapWide(ll, cols))
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

/**
 * Build the visible slice of content parts for a completed turn,
 * clipping from the top (oldest) to fit within ``budget`` rows.
 * Returns the visible parts, the count of hidden rows, and
 * ``firstPartMaxRows`` for intra-part clipping of the first visible
 * text part (if it didn't fully fit).
 */
function clipCompletedContent(
  parts: ContentPart[],
  tools: ToolCall[],
  budget: number,
  cols: number,
  toolDetail: 'compact' | 'expanded',
): { visible: ContentPart[]; hiddenRows: number; firstPartMaxRows: number } {
  if (parts.length === 0) return { visible: [], hiddenRows: 0, firstPartMaxRows: 0 }

  const heights = parts.map(p => estimateCompletedPartHeight(p, tools, cols, toolDetail))
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
  // the last part and clip it intra-part
  if (cutIndex >= parts.length) {
    cutIndex = parts.length - 1
    used = 0
  }

  const visible = parts.slice(cutIndex)

  // If the first visible part is a text part that didn't fully fit,
  // calculate how many rows of it we CAN show
  let firstPartMaxRows = 0
  if (visible.length > 0 && visible[0].kind === 'text') {
    const remaining = budget - used
    const firstHeight = heights[cutIndex]
    if (firstHeight > remaining) {
      const textRows = Math.max(0, remaining - 1)  // -1 for marginTop
      firstPartMaxRows = Math.max(3, textRows)
    }
  }

  const fullHidden = heights.slice(0, cutIndex).reduce((a, b) => a + b, 0)
  const partialHidden = firstPartMaxRows > 0
    ? heights[cutIndex] - firstPartMaxRows
    : 0
  const totalHidden = fullHidden + partialHidden

  return { visible, hiddenRows: totalHidden, firstPartMaxRows }
}

function UserBlock({ text }: { text: string }) {
  return (
    <Box marginTop={1}>
      <Text color={theme.user} bold>▸ </Text>
      <Text color={theme.user}>{text}</Text>
    </Box>
  )
}

function AssistantBlock({ turn }: { turn: AssistantTurn }) {
  // Non-reactive reads: <Static> items are rendered once and never
  // re-rendered, so we want the values at commit time.
  const toolDetail = $toolDetail.get()
  const { cols: termCols, rows: termRows } = $terminalSize.get()
  const effectiveCols = Math.max(20, termCols - 4)
  const budget = Math.max(termRows * FINAL_RENDER_BUDGET_MULT, MIN_FINAL_RENDER_BUDGET)

  // If we have ordered contentParts, render text segments and tool calls
  // in their real interleaving order. Each text segment is rendered
  // with MarkdownRenderer (completed turns use Markdown; streaming
  // turns in StreamingAssistant use plain <Text> for performance).
  if (turn.contentParts.length > 0) {
    // Apply height clipping to prevent terminal freeze on very long turns.
    // Same strategy as StreamingAssistant: show latest (bottom), hide oldest (top).
    const clipResult = clipCompletedContent(
      turn.contentParts, turn.tools, budget, effectiveCols, toolDetail,
    )
    const visibleParts = clipResult.visible
    const hiddenRows = clipResult.hiddenRows
    const firstPartMaxRows = clipResult.firstPartMaxRows

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.primary} bold>● assistant</Text>
        {hiddenRows > 0 && (
          <Box>
            <Text color={theme.muted} dimColor>
              {`  ↑ ${hiddenRows} earlier line${hiddenRows > 1 ? 's' : ''} collapsed (Ctrl+E to expand)`}
            </Text>
          </Box>
        )}
        {visibleParts.map((part, idx) => {
          if (part.kind === 'tool') {
            const tool = turn.tools.find(t => t.id === part.toolId)
            if (!tool) return null
            return <ToolCallLine key={part.id} tool={tool} />
          }
          // Text part
          let cleanText = stripTodoWriteArtifacts(getPartText(part))
          if (!cleanText) return null

          // If this is the first visible part and it needs intra-part
          // clipping (single text segment taller than remaining budget),
          // clip to show only the latest rows.
          if (idx === 0 && firstPartMaxRows > 0) {
            const clipped = clipTextSegment(cleanText, firstPartMaxRows, effectiveCols)
            cleanText = clipped.clipped
            if (!cleanText) return null
          }

          return (
            <Box key={part.id}>
              <MarkdownRenderer text={cleanText} color={theme.assistant} />
            </Box>
          )
        })}
        {turn.status === 'error' && (
          <Text color={theme.error}>✗ error: {turn.errorMessage}</Text>
        )}
        {turn.status === 'interrupted' && (
          <Text color={theme.warn}>⚠ interrupted</Text>
        )}
        {turn.usage && (
          <Text color={theme.muted} dimColor>
            {`  ${turn.usage.model} · in=${turn.usage.prompt_tokens} out=${turn.usage.completion_tokens}`}
          </Text>
        )}
      </Box>
    )
  }

  // Legacy fallback: no contentParts (e.g. history-loaded turns).
  // Render tools first, then text — the old behaviour.
  // Apply text clipping for the same reason as above.
  const legacyCleanText = stripTodoWriteArtifacts(turn.text)
  const legacyToolRows = turn.tools.length
  const legacyTextBudget = Math.max(3, budget - legacyToolRows)
  const legacyClip = clipTextSegment(legacyCleanText, legacyTextBudget, effectiveCols)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.primary} bold>● assistant</Text>
      {turn.tools.map(t => (
        <ToolCallLine key={t.id} tool={t} />
      ))}
      {legacyClip.hiddenLines > 0 && (
        <Box>
          <Text color={theme.muted} dimColor>
            {`  ↑ ${legacyClip.hiddenLines} earlier line${legacyClip.hiddenLines > 1 ? 's' : ''} collapsed (Ctrl+E to expand)`}
          </Text>
        </Box>
      )}
      {legacyClip.clipped && (
        <Box>
          <MarkdownRenderer text={legacyClip.clipped} color={theme.assistant} />
        </Box>
      )}
      {turn.status === 'error' && (
        <Text color={theme.error}>✗ error: {turn.errorMessage}</Text>
      )}
      {turn.status === 'interrupted' && (
        <Text color={theme.warn}>⚠ interrupted</Text>
      )}
      {turn.usage && (
        <Text color={theme.muted} dimColor>
          {`  ${turn.usage.model} · in=${turn.usage.prompt_tokens} out=${turn.usage.completion_tokens}`}
        </Text>
      )}
    </Box>
  )
}

/**
 * TurnView is memoised so re-renders of the parent (when streaming
 * deltas push transcript to a new array reference) don't re-parse
 * markdown on every completed turn. Static already filters by index,
 * but defence-in-depth keeps the cost flat.
 */
const TurnView = memo(function TurnView({ turn }: { turn: Turn }) {
  return turn.role === 'user'
    ? <UserBlock text={turn.text} />
    : <AssistantBlock turn={turn} />
})

interface TranscriptPaneProps {
  /** Used to remount <Static> when the user switches sessions. */
  sessionId?: string
}

export function TranscriptPane({ sessionId }: TranscriptPaneProps) {
  const transcript = useStore($transcript)
  const generation = useStore($transcriptGeneration)

  return (
    <Box flexDirection="column" key={`${sessionId ?? 'default'}-gen${generation}`}>
      {/*
        Completed turns — flushed into terminal scrollback by Ink's
        <Static>. Once written they are never re-rendered, which is
        exactly what we want: the terminal's native scrollback now
        owns the history and the user can scroll back without Ink's
        eraseLines() pulling the viewport back down.
      */}
      <Static items={transcript}>
        {(turn, index) => {
          const stableId = turn.role === 'user' ? turn.ts : turn.startedAt
          return <TurnView key={`turn-${turn.role}-${stableId}-${index}`} turn={turn} />
        }}
      </Static>

      {/* Live streaming assistant turn — dynamic frame; finalized into
          $transcript via turnController.finalize() once message.complete
          arrives. */}
      <StreamingAssistant />
    </Box>
  )
}
