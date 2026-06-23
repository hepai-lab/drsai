/**
 * QuickSwitchPanel — quick session switch overlay for current workdir.
 *
 * Triggered by Ctrl+W. Shows sessions for the current workdir
 * with priority ordering (current → pinned → recent).
 */

import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import type { SessionInfo } from '../gatewayTypes.js'
import { theme } from '../theme.js'

export interface QuickSwitchPanelProps {
  sessions: SessionInfo[]
  currentId?: string
  currentWorkdir?: string
  onSelect: (sessionId: string) => void
  onCancel: () => void
}

export function QuickSwitchPanel({ sessions, currentId, currentWorkdir, onSelect, onCancel }: QuickSwitchPanelProps) {
  const [cursor, setCursor] = useState(() => {
    if (currentId) {
      const idx = sessions.findIndex(s => s.session_id === currentId)
      return idx >= 0 ? idx : 0
    }
    return 0
  })

  useInput((input, key) => {
    if (isTerminalFocusEvent(input)) return

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
      setCursor(Math.max(0, cursor - 1))
      return
    }

    if (key.downArrow || (key.ctrl && input === 'n')) {
      setCursor(Math.min(sessions.length - 1, cursor + 1))
      return
    }

    // Numeric quick select
    if (input >= '1' && input <= '9') {
      const idx = parseInt(input, 10) - 1
      if (idx < sessions.length) {
        onSelect(sessions[idx].session_id)
      }
      return
    }
  })

  // Trim workdir for display
  const trimWorkdir = (wd: string, max: number = 40) => {
    if (!wd) return ''
    if (wd.length <= max) return wd
    return '…' + wd.slice(-(max - 1))
  }

  if (sessions.length === 0) {
    return (
      <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
        <Text color={theme.warn}>No sessions found for this workdir</Text>
        <Text color={theme.muted} dimColor>Press Esc to dismiss</Text>
      </Box>
    )
  }

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>⚡ Quick Switch</Text>
        <Text color={theme.muted}> — {trimWorkdir(currentWorkdir || '', 50)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {sessions.map((s, i) => {
          const isCurrent = s.session_id === currentId
          const isCursor = i === cursor
          const prefix = isCursor ? '▶ ' : '  '
          const color = isCursor ? theme.accent : isCurrent ? theme.primary : theme.text

          return (
            <Box key={s.session_id} flexDirection="column">
              <Box>
                <Text color={color}>{prefix}{i + 1}. {s.name}</Text>
                {s.pinned && <Text color="red"> 📌</Text>}
                {isCurrent && <Text color={theme.primary}> ●</Text>}
                <Text color={theme.muted}> [{s.session_id.slice(0, 8)}]</Text>
                <Text color={theme.muted}> {s.message_count} msgs</Text>
              </Box>
              {s.preview && (
                <Box>
                  <Text color={theme.muted} dimColor>     "{s.preview.slice(0, 70)}"</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑/↓ navigate · 1-9 select · Enter switch · Esc cancel
        </Text>
      </Box>
    </Box>
  )
}