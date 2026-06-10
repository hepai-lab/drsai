/**
 * SessionPicker — overlay for selecting a session from the list.
 *
 * Triggered by `/list` or `/switch` (without args). Displays sessions with
 * arrow-key navigation; Enter selects, Esc cancels.
 *
 * Numbering: pure decimal (1, 2, ..., N). Picker shows a scrolling window of
 * ``WINDOW_SIZE`` items at a time; ↑/↓ scroll the window when the cursor
 * hits the top/bottom edge. PageUp/PageDown jump a window. Home/End jump to
 * the very first/last. Number keys (1-9) jump to that row of the *visible
 * window*, not the absolute index — so they always do something visible.
 *
 * Layout per row:
 *   N. <name>           [id8]  msgs=N  cwd:<workdir-tail>
 *      "<last user message preview>"
 */

import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import type { SessionInfo } from '../gatewayTypes.js'
import { theme } from '../theme.js'

export interface SessionPickerProps {
  sessions: SessionInfo[]
  currentId?: string
  onSelect: (sessionId: string) => void
  onCancel: () => void
}

const WINDOW_SIZE = 10
const PREVIEW_MAX = 70
const WORKDIR_MAX = 35
const NAME_MAX = 22

function truncate(s: string, max: number): string {
  if (!s) return ''
  const clean = s.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1) + '…'
}

function trimWorkdir(wd: string, max: number): string {
  if (!wd) return ''
  if (wd.length <= max) return wd
  return '…' + wd.slice(-(max - 1))
}

export function SessionPicker({ sessions, currentId, onSelect, onCancel }: SessionPickerProps) {
  const [cursor, setCursor] = useState(() => {
    if (currentId) {
      const idx = sessions.findIndex(s => s.session_id === currentId)
      return idx >= 0 ? idx : 0
    }
    return 0
  })

  // Window scroll offset (top index of visible slice)
  const [offset, setOffset] = useState(() => {
    if (currentId) {
      const idx = sessions.findIndex(s => s.session_id === currentId)
      if (idx >= 0) {
        // Center the current session in the window
        return Math.max(0, Math.min(
          sessions.length - WINDOW_SIZE,
          idx - Math.floor(WINDOW_SIZE / 2),
        ))
      }
    }
    return 0
  })

  // Keep cursor inside the window
  function adjustWindow(newCursor: number) {
    setCursor(newCursor)
    if (newCursor < offset) {
      setOffset(newCursor)
    } else if (newCursor >= offset + WINDOW_SIZE) {
      setOffset(newCursor - WINDOW_SIZE + 1)
    }
  }

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.return) {
      const selected = sessions[cursor]
      if (selected) onSelect(selected.session_id)
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      adjustWindow(Math.max(0, cursor - 1))
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      adjustWindow(Math.min(sessions.length - 1, cursor + 1))
      return
    }
    if (key.pageUp) {
      adjustWindow(Math.max(0, cursor - WINDOW_SIZE))
      return
    }
    if (key.pageDown) {
      adjustWindow(Math.min(sessions.length - 1, cursor + WINDOW_SIZE))
      return
    }
    // Ctrl+Home / Ctrl+End — first/last
    if ((key.ctrl && input === 'a') || input === 'g') {
      adjustWindow(0)
      return
    }
    if ((key.ctrl && input === 'e') || input === 'G') {
      adjustWindow(sessions.length - 1)
      return
    }
    // Numeric jump: 1-9 → row within the visible window
    if (input >= '1' && input <= '9') {
      const rowInWindow = parseInt(input, 10) - 1
      const target = offset + rowInWindow
      if (target < sessions.length) {
        setCursor(target)
        onSelect(sessions[target].session_id)
      }
    }
  })

  if (sessions.length === 0) {
    return (
      <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column">
        <Text color={theme.warn}>No sessions found</Text>
        <Text color={theme.muted} dimColor>Press Esc to dismiss</Text>
      </Box>
    )
  }

  const visible = sessions.slice(offset, offset + WINDOW_SIZE)
  const showingTo = Math.min(offset + WINDOW_SIZE, sessions.length)

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>Select session</Text>
        <Text color={theme.muted} dimColor>  ({offset + 1}-{showingTo} of {sessions.length})</Text>
      </Box>

      {offset > 0 && (
        <Box>
          <Text color={theme.muted} dimColor>  ↑ ({offset} more above)</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {visible.map((s, i) => {
          const absIdx = offset + i
          const isCurrent = s.session_id === currentId
          const isCursor = absIdx === cursor
          const prefix = isCursor ? '▶ ' : '  '
          const color = isCursor ? theme.accent : isCurrent ? theme.good : theme.text
          const name = truncate(s.name, NAME_MAX).padEnd(NAME_MAX)
          // Absolute index, always decimal, width 3 for up to 999 sessions
          const idx = `${(absIdx + 1).toString().padStart(2)}.`
          const wd = s.workdir ? `cwd:${trimWorkdir(s.workdir, WORKDIR_MAX)}` : ''
          const previewLine = s.preview && s.message_count > 0
            ? truncate(s.preview, PREVIEW_MAX)
            : ''
          return (
            <Box key={s.session_id} flexDirection="column">
              <Text color={color}>
                {prefix}
                {idx} {name} [{s.session_id.slice(0, 8)}] msgs={s.message_count}
                {isCurrent && ' ← current'}
              </Text>
              {(previewLine || wd) && (
                <Box paddingLeft={6}>
                  <Text color={theme.muted} dimColor>
                    {previewLine ? `“${previewLine}”` : ''}
                    {previewLine && wd ? '  ' : ''}
                    {wd}
                  </Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>

      {showingTo < sessions.length && (
        <Box>
          <Text color={theme.muted} dimColor>  ↓ ({sessions.length - showingTo} more below)</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑/↓ scroll · PgUp/PgDn page · 1-9 select row in view · Enter open · Esc cancel
        </Text>
      </Box>
    </Box>
  )
}
