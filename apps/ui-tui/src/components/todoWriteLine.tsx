/**
 * TodoWriteLine — dedicated renderer for TodoWrite tool calls.
 *
 * TodoWrite is not a normal noisy tool result: it represents the agent's task
 * plan/progress. Rendering it as a structured checklist makes progress visible
 * in the TUI transcript instead of hiding it in a one-line tool summary.
 */

import { Box, Text } from 'ink'

import type { ToolCall } from '../app/types.js'
import { theme } from '../theme.js'

type TodoStatus = 'pending' | 'in_progress' | 'completed'

interface TodoItem {
  content: string
  status: TodoStatus
}

interface Props {
  tool: ToolCall
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

function normaliseItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const content = typeof obj.content === 'string' ? obj.content : ''
  const status = isTodoStatus(obj.status) ? obj.status : 'pending'
  if (!content.trim()) return null
  return { content, status }
}

function parseItemsFromArgs(args: Record<string, unknown>): TodoItem[] {
  const rawItems = args.items
  if (!Array.isArray(rawItems)) return []
  return rawItems.map(normaliseItem).filter((item): item is TodoItem => item !== null)
}

function parseItemsFromResult(result?: string): TodoItem[] {
  if (!result) return []
  const rows: TodoItem[] = []
  for (const line of result.split('\n')) {
    const match = line.match(/^\s*\[(x|>| )\]\s+(.+?)\s*$/i)
    if (!match) continue
    const marker = match[1]
    const content = match[2]?.trim() ?? ''
    if (!content) continue
    const status: TodoStatus = marker.toLowerCase() === 'x'
      ? 'completed'
      : marker === '>'
        ? 'in_progress'
        : 'pending'
    rows.push({ content, status })
  }
  return rows
}

function itemsForTool(tool: ToolCall): TodoItem[] {
  const fromArgs = parseItemsFromArgs(tool.args)
  if (fromArgs.length > 0) return fromArgs
  return parseItemsFromResult(tool.result)
}

function statusIcon(status: TodoStatus): string {
  switch (status) {
    case 'completed': return '✓'
    case 'in_progress': return '▶'
    case 'pending': return '○'
  }
}

function statusColor(status: TodoStatus): string {
  switch (status) {
    case 'completed': return theme.good
    case 'in_progress': return theme.warn
    case 'pending': return theme.muted
  }
}

export function isTodoWriteTool(tool: ToolCall): boolean {
  const name = tool.name.toLowerCase()
  return name === 'todowrite' || name === 'todo_write'
}

export function TodoWriteLine({ tool }: Props) {
  const items = itemsForTool(tool)
  const completed = items.filter(item => item.status === 'completed').length
  const total = items.length
  const running = tool.status === 'running'

  if (items.length === 0) {
    return (
      <Box paddingLeft={2}>
        <Text color={running ? theme.warn : theme.good}>{running ? '◐ ' : '✓ '}</Text>
        <Text color={theme.tool}>TodoWrite</Text>
        <Text color={theme.muted} dimColor>{running ? ' …updating' : ' updated'}</Text>
      </Box>
    )
  }

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Box>
        <Text color={running ? theme.warn : theme.good}>{running ? '◐ ' : '✓ '}</Text>
        <Text color={theme.tool}>Todo</Text>
        <Text color={theme.muted}> progress </Text>
        <Text color={theme.good}>{completed}</Text>
        <Text color={theme.muted}>/</Text>
        <Text color={theme.text}>{total}</Text>
        {tool.durationMs !== undefined && (
          <Text color={theme.muted} dimColor> ({tool.durationMs}ms)</Text>
        )}
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {items.map((item, idx) => (
          <Box key={`${idx}-${item.content}`}>
            <Text color={statusColor(item.status)}>{statusIcon(item.status)} </Text>
            <Text color={item.status === 'pending' ? theme.muted : theme.text}>{item.content}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
