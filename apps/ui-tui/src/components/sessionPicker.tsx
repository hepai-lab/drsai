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
import { useMemo, useState } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import type { GatewayClient } from '../gatewayClient.js'
import type { SessionInfo } from '../gatewayTypes.js'
import { theme } from '../theme.js'
import { TextInput } from './textInput.js'

export interface SessionPickerProps {
  sessions: SessionInfo[]
  currentId?: string
  onSelect: (sessionId: string) => void
  onCancel: () => void
  // New: enable filter mode
  enableFilter?: boolean
  // New: show grouping by workdir
  groupByWorkdir?: boolean
  // New: current workdir for highlighting
  currentWorkdir?: string
  // New: gateway client for pin/archive/tag operations
  gw?: GatewayClient
  // New: callback to refresh sessions after an operation
  onSessionsChanged?: () => void
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

export function SessionPicker({ sessions, currentId, onSelect, onCancel, enableFilter, groupByWorkdir, currentWorkdir, gw, onSessionsChanged }: SessionPickerProps) {
  const [filterText, setFilterText] = useState('')

  // Tag input mode: null = not active, { sessionId, sessionName, action } = active
  const [tagMode, setTagMode] = useState<{ sessionId: string; sessionName: string; action: 'add' | 'remove' } | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  const filteredSessions = useMemo(() => {
    if (!filterText) return sessions
    const needle = filterText.toLowerCase()
    return sessions.filter(s =>
      s.name.toLowerCase().includes(needle) ||
      s.preview.toLowerCase().includes(needle) ||
      s.workdir.toLowerCase().includes(needle) ||
      s.session_id.startsWith(needle) ||
      (s.tags || []).some(t => t.toLowerCase().includes(needle))
    )
  }, [sessions, filterText])

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
    if (isTerminalFocusEvent(input)) return

    // Tag input mode: capture all input for tag entry
    if (tagMode) {
      if (key.escape) {
        setTagMode(null)
        setTagInput('')
        return
      }
      if (key.return) {
        const tags = tagInput.split(/\s+/).filter(Boolean)
        if (tags.length > 0 && gw) {
          gw.request(`session.tag_${tagMode.action}`, {
            session_id: tagMode.sessionId,
            tags,
          })
            .then(() => {
              setStatusMsg(`${tagMode.action === 'add' ? 'Added' : 'Removed'} tags: ${tags.map(t => '#' + t).join(' ')}`)
              onSessionsChanged?.()
            })
            .catch((e: Error) => setStatusMsg(`Error: ${e.message}`))
        }
        setTagMode(null)
        setTagInput('')
        return
      }
      if (key.backspace) {
        setTagInput(prev => prev.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setTagInput(prev => prev + input)
      }
      return
    }

    // Filter mode: typing updates filter text (exclude nav + org keys)
    if (enableFilter && !key.return && !key.escape && !key.upArrow && !key.downArrow && !key.pageUp && !key.pageDown && !(key.ctrl && input === 'p') && !(key.ctrl && input === 'n') && !(key.ctrl && input === 'a') && !(key.ctrl && input === 'e') && input !== 'g' && input !== 'G' && !(input >= '1' && input <= '9') && input !== 'p' && input !== 'a' && input !== 't' && input !== 'T') {
      if (key.backspace) {
        setFilterText(prev => prev.slice(0, -1))
      } else if (input && !key.ctrl && !key.meta) {
        setFilterText(prev => prev + input)
      }
      return
    }

    if (key.escape) {
      onCancel()
      return
    }
    if (key.return) {
      const selected = filteredSessions[cursor]
      if (selected) onSelect(selected.session_id)
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      adjustWindow(Math.max(0, cursor - 1))
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      adjustWindow(Math.min(filteredSessions.length - 1, cursor + 1))
      return
    }
    if (key.pageUp) {
      adjustWindow(Math.max(0, cursor - WINDOW_SIZE))
      return
    }
    if (key.pageDown) {
      adjustWindow(Math.min(filteredSessions.length - 1, cursor + WINDOW_SIZE))
      return
    }
    // Ctrl+Home / Ctrl+End — first/last
    if ((key.ctrl && input === 'a') || input === 'g') {
      adjustWindow(0)
      return
    }
    if ((key.ctrl && input === 'e') || input === 'G') {
      adjustWindow(filteredSessions.length - 1)
      return
    }
    // Numeric jump: 1-9 → row within the visible window
    if (input >= '1' && input <= '9') {
      const rowInWindow = parseInt(input, 10) - 1
      const target = offset + rowInWindow
      if (target < filteredSessions.length) {
        setCursor(target)
        onSelect(filteredSessions[target].session_id)
      }
      return
    }

    // ── Session organization shortcuts (require gw) ────────────────
    if (!gw) return
    const selectedSession = filteredSessions[cursor]
    if (!selectedSession) return

    // p = toggle pin
    if (input === 'p') {
      const action = selectedSession.pinned ? 'unpin' : 'pin'
      gw.request(`session.${action}`, { session_id: selectedSession.session_id })
        .then(() => {
          setStatusMsg(`${action === 'pin' ? '📌 Pinned' : 'Unpinned'}: ${selectedSession.name}`)
          onSessionsChanged?.()
        })
        .catch((e: Error) => setStatusMsg(`Error: ${e.message}`))
      return
    }

    // a = toggle archive
    if (input === 'a') {
      const archive = !selectedSession.archived
      gw.request('session.archive', { session_id: selectedSession.session_id, archived: archive })
        .then(() => {
          setStatusMsg(`${archive ? '📦 Archived' : 'Unarchived'}: ${selectedSession.name}`)
          onSessionsChanged?.()
        })
        .catch((e: Error) => setStatusMsg(`Error: ${e.message}`))
      return
    }

    // t = add tag (enter tag input mode)
    if (input === 't') {
      setTagMode({ sessionId: selectedSession.session_id, sessionName: selectedSession.name, action: 'add' })
      setTagInput('')
      return
    }

    // T = remove tag (enter tag input mode)
    if (input === 'T') {
      setTagMode({ sessionId: selectedSession.session_id, sessionName: selectedSession.name, action: 'remove' })
      setTagInput('')
      return
    }
  })

  if (filteredSessions.length === 0) {
    return (
      <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column">
        <Text color={theme.warn}>{filterText ? 'No sessions match filter' : 'No sessions found'}</Text>
        <Text color={theme.muted} dimColor>Press Esc to dismiss</Text>
      </Box>
    )
  }

  const visible = filteredSessions.slice(offset, offset + WINDOW_SIZE)
  const showingTo = Math.min(offset + WINDOW_SIZE, filteredSessions.length)

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>Select session</Text>
        <Text color={theme.muted} dimColor>  ({offset + 1}-{showingTo} of {filteredSessions.length})</Text>
      </Box>

      {enableFilter && (
        <Box>
          <Text color={theme.muted}>🔍 Filter: </Text>
          <Text color={theme.accent}>{filterText || '(type to filter)'}</Text>
          <Text color={theme.muted}> ({filteredSessions.length}/{sessions.length})</Text>
        </Box>
      )}

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
          const pinIcon = s.pinned ? '📌 ' : ''
          const archiveIcon = s.archived ? '📦 ' : ''
          const tagsStr = (s.tags || []).length > 0
            ? ` ${s.tags!.map(t => `#${t}`).join(' ')}`
            : ''
          return (
            <Box key={s.session_id} flexDirection="column">
              <Text color={color}>
                {prefix}
                {idx} {pinIcon}{archiveIcon}{name} [{s.session_id.slice(0, 8)}] msgs={s.message_count}
                {isCurrent && ' ← current'}
              </Text>
              {tagsStr && <Text color="yellow">   {tagsStr}</Text>}
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

      {showingTo < filteredSessions.length && (
        <Box>
          <Text color={theme.muted} dimColor>  ↓ ({filteredSessions.length - showingTo} more below)</Text>
        </Box>
      )}

      {statusMsg && (
        <Box marginTop={1}>
          <Text color={theme.warn}>{statusMsg}</Text>
        </Box>
      )}

      {tagMode && (
        <Box marginTop={1} borderStyle="round" paddingX={1}>
          <Text color={theme.accent}>
            {tagMode.action === 'add' ? 'Add tags' : 'Remove tags'} for "{tagMode.sessionName}":
          </Text>
          <Text color={theme.text}> {tagInput || '(type tags separated by spaces)'}</Text>
          <Text color={theme.muted} dimColor>  Enter confirm · Esc cancel</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑/↓ scroll · PgUp/PgDn page · 1-9 select{enableFilter ? ' · type to filter' : ''} · Enter open{gw ? ' · p pin · a archive · t tag · T untag' : ''} · Esc cancel
        </Text>
      </Box>
    </Box>
  )
}
