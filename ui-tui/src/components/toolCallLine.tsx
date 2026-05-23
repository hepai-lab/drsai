/**
 * ToolCallLine — one-line summary of a tool invocation.
 */

import { Box, Text } from 'ink'

import type { ToolCall } from '../app/types.js'
import { theme } from '../theme.js'

interface Props {
  tool: ToolCall
}

function summariseArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  const [k, v] = entries[0]
  const vs = typeof v === 'string' ? v : JSON.stringify(v)
  const head = `${k}=${vs}`
  return head.length > 60 ? head.slice(0, 57) + '…' : head
}

function summariseResult(text?: string): string {
  if (!text) return ''
  const first = text.split('\n').find(l => l.trim()) ?? text
  return first.length > 80 ? first.slice(0, 77) + '…' : first
}

export function ToolCallLine({ tool }: Props) {
  const args = summariseArgs(tool.args)
  if (tool.status === 'running') {
    return (
      <Box paddingLeft={2}>
        <Text color={theme.warn}>◐ </Text>
        <Text color={theme.tool}>{tool.name}</Text>
        {args && <Text color={theme.muted}> {args}</Text>}
        <Text color={theme.muted} dimColor> …running</Text>
      </Box>
    )
  }
  if (tool.status === 'complete') {
    const result = summariseResult(tool.result)
    return (
      <Box paddingLeft={2}>
        <Text color={theme.good}>✓ </Text>
        <Text color={theme.tool}>{tool.name}</Text>
        {args && <Text color={theme.muted}> {args}</Text>}
        <Text color={theme.muted} dimColor> ({tool.durationMs ?? 0}ms)</Text>
        {result && (
          <>
            <Text color={theme.muted}> → </Text>
            <Text color={theme.good}>{result}</Text>
          </>
        )}
      </Box>
    )
  }
  return (
    <Box paddingLeft={2}>
      <Text color={theme.error}>✗ {tool.name}</Text>
    </Box>
  )
}
