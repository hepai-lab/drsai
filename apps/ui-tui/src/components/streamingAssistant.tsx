/**
 * StreamingAssistant — renders the in-flight assistant turn from $current.
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
 * the terminal. We clip the streaming text to the last N visual lines
 * where N is computed from the current terminal size minus a budget
 * reserved for the status bar, composer, banner, etc. Older lines have
 * already been seen by the user and are accessible after finalize via
 * the terminal's scrollback (the completed turn flows into <Static>
 * which writes a clean copy at end-of-turn).
 *
 * We also wrap long logical lines to terminal width before counting so
 * a single 500-character line still gets clipped correctly.
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
import { $current } from '../app/turnStore.js'
import { $showReasoning, $terminalFocused } from '../app/uiStore.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
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

/**
 * Clip ``text`` to the last ``maxRows`` visual rows (after wrapping at
 * ``cols``). If clipped, prepend a marker line so the user knows older
 * content is in scrollback (will appear once the turn finalizes).
 */
function clipToLastRows(text: string, maxRows: number, cols: number): {
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
  const { cols, rows } = useTerminalSize()

  const cleanText = cur?.text ? stripTodoWriteArtifacts(stripThinkBlocks(cur.text)) : ''

  // Compute the row budget for streaming text. Subtract:
  //   - RESERVED_ROWS for the rest of the dynamic frame
  //   - 1 row for the "● assistant" header
  //   - 1 row per tool call already shown
  //   - "+N earlier lines" marker (if we end up clipping)
  const toolRows = cur?.tools.length ?? 0
  const reasoningRows = showReasoning && cur?.reasoning?.trim() ? 4 : 0
  const budget = Math.max(
    MIN_STREAM_ROWS,
    rows - RESERVED_ROWS - 1 /* header */ - toolRows - reasoningRows - 1 /* marker */,
  )

  const { clipped, hiddenLines } = clipToLastRows(cleanText, budget, Math.max(20, cols - 4))

  // "Thinking" pulse runs only:
  //   - turn is in flight (status === 'streaming')
  //   - no visible content yet (no text, no tool call started)
  //   - terminal window has focus
  const showThinking =
    !!cur &&
    cur.status === 'streaming' &&
    !cleanText &&
    cur.tools.length === 0
  const pulse = useThinkingPulse(showThinking && termFocused, cur?.startedAt ?? Date.now())

  if (!cur) return null

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* ▎ prefix acts as a left-edge progress indicator (like ChatGPT/Copilot sidebar) */}
      <Text color={theme.primary} bold>▎ ● assistant</Text>

      {cur.tools.map(tool => (
        <ToolCallLine key={tool.id} tool={tool} />
      ))}

      {showReasoning && cur.reasoning.trim() && (
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text color={theme.reasoning} dimColor>┌─ reasoning ─</Text>
          <Text color={theme.reasoning} dimColor>{cur.reasoning.trim()}</Text>
          <Text color={theme.reasoning} dimColor>└─</Text>
        </Box>
      )}

      {/*
        Streaming text is rendered as plain <Text> (no Markdown parsing).
        Reasons:
          1. MarkdownRenderer re-parses the entire growing buffer on every
             flush — O(n²) and the largest source of jank on slow terminals.
          2. Plain text grows monotonically so Ink's diff is a single string
             update on one node.
        The completed turn moves into TranscriptPane's <Static>, which
        renders the full MarkdownRenderer exactly once.

        Height-clipping note: we hand Ink the already-clipped string so
        the dynamic frame stays strictly below `terminal rows`, avoiding
        Ink's full-clear branch (see ink.js fullscreen path). The hidden
        content reappears in <Static> at finalize and is then permanently
        in the terminal's scrollback.
      */}
      {hiddenLines > 0 && (
        <Box>
          <Text color={theme.muted} dimColor>
            {`  ↑ ${hiddenLines} earlier line${hiddenLines > 1 ? 's' : ''} (will appear in scrollback when turn ends)`}
          </Text>
        </Box>
      )}
      {clipped && (
        <Box marginTop={1}>
          <Text color={theme.assistant}>{clipped}</Text>
        </Box>
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
