/**
 * StreamingAssistant — renders the in-flight assistant turn from $current.
 *
 * During streaming we deliberately render plain text (with <think> blocks stripped)
 * instead of running the full markdown parser on every delta. Reasons:
 *   1. Token boundaries are arbitrary — a half-arrived table row gets misparsed
 *      as a paragraph, then later "rewritten" as a table once the closing rows
 *      stream in. The intermediate states look garbled.
 *   2. Re-parsing/re-rendering markdown on every token wastes CPU.
 *
 * When the turn finishes, it moves into the <Static> transcript and gets the
 * full <MarkdownRenderer> treatment with proper tables/headers/lists/code blocks.
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'

import { $current } from '../app/turnStore.js'
import { $showReasoning } from '../app/uiStore.js'
import { theme } from '../theme.js'

import { stripThinkBlocks } from './markdownRenderer.js'
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
          <Text color={theme.assistant}>{cleanText}</Text>
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
