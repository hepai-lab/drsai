/**
 * SmartSearchPane — natural language session search overlay.
 *
 * Triggered by /find command. Displays search input + results with
 * relevance scores. Supports keyboard navigation and selection.
 */

import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import type { SessionInfo } from '../gatewayTypes.js'
import { theme } from '../theme.js'

export interface SmartSearchPaneProps {
  query: string
  results: Array<{
    session_id: string
    name: string
    preview: string
    relevance_score: number
  }>
  onSelect: (sessionId: string) => void
  onCancel: () => void
  onSearch: (query: string) => void
}

const PREVIEW_MAX = 60

export function SmartSearchPane({ query, results, onSelect, onCancel, onSearch }: SmartSearchPaneProps) {
  const [searchText, setSearchText] = useState(query)
  const [cursor, setCursor] = useState(0)

  useInput((input, key) => {
    if (isTerminalFocusEvent(input)) return

    if (key.escape) {
      onCancel()
      return
    }

    if (key.return) {
      if (results.length > 0) {
        onSelect(results[cursor].session_id)
      } else if (searchText.trim()) {
        onSearch(searchText)
      }
      return
    }

    if (key.upArrow || (key.ctrl && input === 'p')) {
      setCursor(Math.max(0, cursor - 1))
      return
    }

    if (key.downArrow || (key.ctrl && input === 'n')) {
      setCursor(Math.min(results.length - 1, cursor + 1))
      return
    }

    // Numeric quick select
    if (input >= '1' && input <= '9' && results.length > 0) {
      const idx = parseInt(input, 10) - 1
      if (idx < results.length) {
        onSelect(results[idx].session_id)
      }
      return
    }

    // Type to update search text
    if (key.backspace) {
      const newText = searchText.slice(0, -1)
      setSearchText(newText)
      if (newText.length > 0) {
        onSearch(newText)
      }
      return
    }

    if (input && !key.ctrl && !key.meta && !key.return) {
      const newText = searchText + input
      setSearchText(newText)
      onSearch(newText)
    }
  })

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>🔍 Smart Search</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted}>Query: </Text>
        <Text color={theme.accent}>{searchText || '(type to search...)'}</Text>
        <Text color={theme.muted}> _</Text>
      </Box>

      {results.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {results.map((r, i) => {
            const isCursor = i === cursor
            const prefix = isCursor ? '▶ ' : '  '
            const color = isCursor ? theme.accent : theme.text
            return (
              <Box key={r.session_id} flexDirection="column">
                <Box>
                  <Text color={color}>{prefix}{i + 1}. {r.name}</Text>
                  <Text color={theme.muted}> [{r.session_id.slice(0, 8)}]</Text>
                  <Text color={theme.primary}> score:{r.relevance_score.toFixed(2)}</Text>
                </Box>
                {r.preview && (
                  <Box>
                    <Text color={theme.muted} dimColor>     "{r.preview.slice(0, PREVIEW_MAX)}"</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )}

      {results.length === 0 && searchText && (
        <Box marginTop={1}>
          <Text color={theme.warn}>No results found. Press Enter to retry, Esc to cancel.</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          Type to search · ↑/↓ navigate · 1-9 select · Enter open · Esc cancel
        </Text>
      </Box>
    </Box>
  )
}