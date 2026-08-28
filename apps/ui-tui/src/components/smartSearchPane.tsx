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
    match_snippet?: string
  }>
  onSelect: (sessionId: string) => void
  onCancel: () => void
  onSearch: (query: string) => void
}

const PREVIEW_MAX = 80
const SNIPPET_MAX = 100

/**
 * Render a match snippet with highlighted terms.
 *
 * The snippet uses 【...】 delimiters (set by the FTS5 highlight() function
 * or by the Python-side re.sub in Phase 1). We split on these delimiters
 * and render the matched terms in a bright accent color.
 */
function HighlightedSnippet({ text, maxLen, color }: { text: string; maxLen: number; color: string }) {
  // Truncate the snippet if it's too long. Try to keep the context around
  // the first match by finding the first 【 and showing some text before/after.
  let display = text
  if (text.length > maxLen) {
    const firstMark = text.indexOf('【')
    if (firstMark >= 0) {
      const start = Math.max(0, firstMark - 20)
      display = (start > 0 ? '…' : '') + text.slice(start, start + maxLen)
      if (display.length === maxLen && start + maxLen < text.length) {
        display += '…'
      }
    } else {
      display = text.slice(0, maxLen) + (text.length > maxLen ? '…' : '')
    }
  }

  // Split on 【 and 】 to separate highlighted from non-highlighted text
  const parts: Array<{ text: string; highlighted: boolean }> = []
  let remaining = display
  while (remaining.length > 0) {
    const open = remaining.indexOf('【')
    if (open < 0) {
      parts.push({ text: remaining, highlighted: false })
      break
    }
    if (open > 0) {
      parts.push({ text: remaining.slice(0, open), highlighted: false })
    }
    const close = remaining.indexOf('】', open + 1)
    if (close < 0) {
      // Malformed — no closing bracket, just show the rest
      parts.push({ text: remaining.slice(open + 1), highlighted: true })
      break
    }
    parts.push({ text: remaining.slice(open + 1, close), highlighted: true })
    remaining = remaining.slice(close + 1)
  }

  return (
    <Text>
      {parts.map((p, i) => (
        <Text key={i} color={p.highlighted ? color : theme.muted} bold={p.highlighted}>
          {p.text}
        </Text>
      ))}
    </Text>
  )
}

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
                {r.match_snippet ? (
                  <Box marginLeft={5}>
                    <HighlightedSnippet text={r.match_snippet} maxLen={SNIPPET_MAX} color={theme.warn} />
                  </Box>
                ) : r.preview ? (
                  <Box marginLeft={5}>
                    <Text color={theme.muted} dimColor>"{r.preview.slice(0, PREVIEW_MAX)}"</Text>
                  </Box>
                ) : null}
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