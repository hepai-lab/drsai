/**
 * ToolCallLine — summary of a tool invocation. Two display modes driven by
 * the global ``$toolDetail`` atom (toggled via Ctrl+T in <App>):
 *
 *   - ``compact`` (default): single line, args truncated at 60 chars and
 *     result preview at 80 chars. Same look as the original.
 *   - ``expanded``: multi-line, full arg values + up to 5 lines of
 *     result preview. Used when debugging an agent run where the
 *     exact bash command / grep pattern matters.
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'

import type { ToolCall } from '../app/types.js'
import { $toolDetail } from '../app/uiStore.js'
import { theme } from '../theme.js'

import { isTodoWriteTool, TodoWriteLine } from './todoWriteLine.js'

interface Props {
  tool: ToolCall
}

const COMPACT_ARG_LIMIT = 60
const COMPACT_RESULT_LIMIT = 80
const EXPANDED_RESULT_LINES = 5

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** Format one (key, value) pair of args; value is JSON for non-string. */
function formatArgPair(k: string, v: unknown): string {
  const vs = typeof v === 'string' ? v : JSON.stringify(v)
  return `${k}=${vs}`
}

function compactArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  const [k, v] = entries[0]
  const head = formatArgPair(k, v)
  return truncate(head, COMPACT_ARG_LIMIT)
}

function compactResult(text?: string): string {
  if (!text) return ''
  const first = text.split('\n').find(l => l.trim()) ?? text
  return truncate(first, COMPACT_RESULT_LIMIT)
}

/**
 * Pull all (key, value) pairs without truncation, for expanded mode.
 * Returned lines are already prefixed with "  " for the indent under
 * the tool name row.
 */
function expandedArgLines(args: Record<string, unknown>): string[] {
  return Object.entries(args).map(([k, v]) => '  ' + formatArgPair(k, v))
}

/**
 * Up to ``EXPANDED_RESULT_LINES`` non-empty lines, with a trailing
 * "…+N more" marker if the result was longer.
 */
function expandedResultLines(text?: string): { lines: string[]; truncated: number } {
  if (!text) return { lines: [], truncated: 0 }
  const all = text.split('\n')
  if (all.length <= EXPANDED_RESULT_LINES) {
    return { lines: all, truncated: 0 }
  }
  return {
    lines: all.slice(0, EXPANDED_RESULT_LINES),
    truncated: all.length - EXPANDED_RESULT_LINES,
  }
}

export function ToolCallLine({ tool }: Props) {
  const detail = useStore($toolDetail)

  if (isTodoWriteTool(tool)) {
    return <TodoWriteLine tool={tool} />
  }

  // ── Compact: original 1-line layout ─────────────────────────────────
  if (detail === 'compact') {
    const args = compactArgs(tool.args)
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
      const result = compactResult(tool.result)
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

  // ── Expanded: header line + full args + up-to-5-line result ─────────
  const argLines = expandedArgLines(tool.args)
  const { lines: resLines, truncated } = expandedResultLines(tool.result)

  if (tool.status === 'running') {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Box>
          <Text color={theme.warn}>◐ </Text>
          <Text color={theme.tool}>{tool.name}</Text>
          <Text color={theme.muted} dimColor> …running</Text>
        </Box>
        {argLines.map((line, i) => (
          <Text key={i} color={theme.muted}>{line}</Text>
        ))}
      </Box>
    )
  }

  if (tool.status === 'complete') {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Box>
          <Text color={theme.good}>✓ </Text>
          <Text color={theme.tool}>{tool.name}</Text>
          <Text color={theme.muted} dimColor> ({tool.durationMs ?? 0}ms)</Text>
        </Box>
        {argLines.map((line, i) => (
          <Text key={`a${i}`} color={theme.muted}>{line}</Text>
        ))}
        {resLines.length > 0 && (
          <>
            <Text color={theme.muted}>  →</Text>
            {resLines.map((line, i) => (
              <Text key={`r${i}`} color={theme.good}>{'    ' + line}</Text>
            ))}
            {truncated > 0 && (
              <Text color={theme.muted} dimColor>{`    …+${truncated} more line${truncated > 1 ? 's' : ''}`}</Text>
            )}
          </>
        )}
      </Box>
    )
  }

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Box>
        <Text color={theme.error}>✗ {tool.name}</Text>
      </Box>
      {argLines.map((line, i) => (
        <Text key={i} color={theme.muted}>{line}</Text>
      ))}
    </Box>
  )
}
