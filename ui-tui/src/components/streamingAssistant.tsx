/**
 * StreamingAssistant — renders the in-flight assistant turn from $current.
 *
 * Uses MarkdownRenderer for incremental formatting. Incomplete markdown
 * structures (e.g. a table with only a header row) gracefully fall back
 * to paragraph rendering until the structure is complete.
 *
 * The rendering "snaps" into place once closing markers arrive (e.g. the
 * `|---|---|` separator line makes a table appear). This is much better
 * than showing raw markdown source for the entire streaming duration.
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'

import { $current } from '../app/turnStore.js'
import { $showReasoning } from '../app/uiStore.js'
import { theme } from '../theme.js'

import { MarkdownRenderer, stripThinkBlocks } from './markdownRenderer.js'
import { ToolCallLine } from './toolCallLine.js'

export function StreamingAssistant() {
  const cur = useStore($current)
  const showReasoning = useStore($showReasoning)
  if (!cur) return null

  const cleanText = cur.text ? stripThinkBlocks(cur.text) : ''

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.primary} bold>● assistant</Text>

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

      {cleanText && (
        <Box marginTop={1}>
          <MarkdownRenderer text={cleanText} color={theme.assistant} />
        </Box>
      )}

      {cur.status === 'streaming' && !cleanText && cur.tools.length === 0 && (
        <Text color={theme.muted} dimColor>  …thinking…</Text>
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
