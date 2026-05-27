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

import { stripTodoWriteArtifacts } from '../app/todoArtifacts.js'
import { $current } from '../app/turnStore.js'
import { $showReasoning } from '../app/uiStore.js'
import { theme } from '../theme.js'

import { stripThinkBlocks } from './markdownRenderer.js'
import { ToolCallLine } from './toolCallLine.js'

export function StreamingAssistant() {
  const cur = useStore($current)
  const showReasoning = useStore($showReasoning)
  if (!cur) return null

  const cleanText = cur.text ? stripTodoWriteArtifacts(stripThinkBlocks(cur.text)) : ''

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

      {/*
        Streaming text is rendered as plain <Text> (no Markdown parsing).
        Reasons:
          1. MarkdownRenderer re-parses the entire growing buffer on every
             flush — O(n²) and the largest source of jank on slow terminals.
          2. Plain text grows monotonically: Ink's diff is a single string
             update on one node, so the terminal does not reflow earlier
             lines. On legacy conhost (Win10 PowerShell 5.1), that means
             the viewport stays put when the user scrolls up mid-stream.
        The completed turn moves into TranscriptPane's <Static>, which
        renders the full MarkdownRenderer exactly once and never repaints.
      */}
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
