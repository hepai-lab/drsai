/**
 * SlashOutputOverlay — full-screen viewer for slash-command output.
 *
 * Triggered when ``slashOutput`` is set in composerPane WITHOUT a timeout —
 * the composer's render branch replaces the input UI with this overlay,
 * giving us the full pane height to render long outputs (e.g. /help).
 *
 * ── Why this overlay needs its own scroll viewport ──────────────────
 * Mouse tracking is OFF by default (so the terminal owns selection /
 * scrollback). When the overlay TAKES OVER the composer area, the user
 * has no good way to "scroll" the overlay itself — the terminal can
 * only scroll its scrollback buffer, but the overlay redraws on every
 * keypress and would overwrite anything we'd push into scrollback.
 *
 * Solution: a keyboard-driven scroll viewport inside the overlay that
 * shows ``VIEWPORT_LINES`` lines at a time, with up / down / pageUp /
 * pageDown / home / end keys to navigate. A header line shows
 * ``[start–end / total]`` so the user always knows where they are.
 *
 * Why we don't use Ink's native rendering for scroll:
 *   Ink renders everything React puts in the tree; it has no "viewport"
 *   primitive. We have to slice the text ourselves and only render the
 *   visible window.
 *
 * Mouse note:
 *   With mouse tracking disabled (the default), the wheel does NOT
 *   reach this component — the terminal handles it as native
 *   scrollback (which is empty for the overlay since the overlay
 *   redraws). The keyboard keys are the only reliable input. If a
 *   user opted into mouse tracking, wheel events arrive as SGR mouse
 *   sequences via Ink's stdin and we DO handle them (see parseMouseEvent
 *   below), but this is a rarely used opt-in path.
 */

import { Box, Text, useInput, useStdout } from 'ink'
import { useEffect, useState } from 'react'

import { isTerminalFocusEvent, parseMouseEvent } from '../app/focusEvents.js'
import { theme } from '../theme.js'

export interface SlashOutputOverlayProps {
  output: string
  onDismiss: () => void
}

const MAX_LINE_LENGTH = 200   // Soft-truncate any single line wider than this
const MIN_VIEWPORT_LINES = 8
const FALLBACK_VIEWPORT_LINES = 20
/** Rows reserved for header + footer + borders so the viewport doesn't push the UI offscreen. */
const RESERVED_OVERLAY_ROWS = 6
const PAGE_STEP = 10

function truncateLine(line: string, maxLen: number): string {
  if (line.length <= maxLen) return line
  return line.slice(0, maxLen - 1) + '…'
}

export function SlashOutputOverlay({ output, onDismiss }: SlashOutputOverlayProps) {
  // Pre-process the output once into an array of (mildly-truncated) lines.
  // We pull terminal rows from stdout so the viewport adapts to window size.
  const { stdout } = useStdout()
  const terminalRows = stdout?.rows ?? 24
  const viewportLines = Math.max(
    MIN_VIEWPORT_LINES,
    Math.min(FALLBACK_VIEWPORT_LINES, terminalRows - RESERVED_OVERLAY_ROWS),
  )

  const allLines = output.split('\n').map(l => truncateLine(l, MAX_LINE_LENGTH))
  const total = allLines.length
  const maxOffset = Math.max(0, total - viewportLines)

  // ``offset`` = first visible line index. 0 = top.
  const [offset, setOffset] = useState(0)

  // If the user resizes the window mid-overlay, clamp the offset so we
  // don't end up showing a blank viewport past the end.
  useEffect(() => {
    if (offset > maxOffset) setOffset(maxOffset)
  }, [offset, maxOffset])

  const end = Math.min(total, offset + viewportLines)
  const visible = allLines.slice(offset, end)

  function clamp(next: number) {
    if (next < 0) return 0
    if (next > maxOffset) return maxOffset
    return next
  }

  useInput((input, key) => {
    if (isTerminalFocusEvent(input)) return

    // Opt-in mouse-tracking path: wheel events arrive as SGR sequences.
    // With the default mouse-tracking-off configuration this branch is
    // simply never hit, since the terminal handles the wheel natively
    // (no bytes reach us).
    const mouse = parseMouseEvent(input)
    if (mouse.isMouse) {
      if (mouse.type === 'wheel-up') {
        setOffset(prev => clamp(prev - 3))
      } else if (mouse.type === 'wheel-down') {
        setOffset(prev => clamp(prev + 3))
      }
      return
    }

    if (key.return || key.escape || (key.ctrl && input === 'c') || input === 'q') {
      onDismiss()
      return
    }
    if (key.upArrow) {
      setOffset(prev => clamp(prev - 1))
      return
    }
    if (key.downArrow) {
      setOffset(prev => clamp(prev + 1))
      return
    }
    if (key.pageUp) {
      setOffset(prev => clamp(prev - PAGE_STEP))
      return
    }
    if (key.pageDown || input === ' ') {
      setOffset(prev => clamp(prev + PAGE_STEP))
      return
    }
    if (key.home || input === 'g') {
      setOffset(0)
      return
    }
    if (key.end || input === 'G') {
      setOffset(maxOffset)
      return
    }
  })

  const showTop = offset > 0
  const showBottom = end < total
  // Position label: 1-indexed inclusive range for human readability.
  const rangeLabel = total === 0
    ? '0 / 0'
    : `${offset + 1}–${end} / ${total}`

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.border}>{'─'.repeat(60)}</Text>
      </Box>
      <Box borderStyle="round" borderColor={theme.border} flexDirection="column" paddingX={1}>
        {/* Header — scroll position indicator */}
        <Box>
          <Text color={theme.muted} dimColor>
            {`Lines ${rangeLabel}`}
            {showTop ? '  ↑ more above' : ''}
            {showBottom ? '  ↓ more below' : ''}
          </Text>
        </Box>

        {/* Visible window. We render each line separately so that
            slicing is exact and a tall block stays inside the viewport
            regardless of Ink's own wrap behavior. */}
        {visible.map((line, i) => (
          <Text key={`overlay-line-${offset + i}`} color={theme.text}>
            {line || ' ' /* preserve blank line height */}
          </Text>
        ))}

        {/* Footer — keybindings hint */}
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑/↓ line · PgUp/PgDn or Space page · g/G top/bottom · Enter/Esc/q close
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
