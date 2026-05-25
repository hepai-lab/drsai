/**
 * TranscriptPane — renders the locked-in turn history above the live streaming turn.
 *
 * Completed turns go through Ink's <Static> component, which writes them to the
 * terminal *once* and never repaints them. This means:
 *   - Terminal resize doesn't trigger a full reflow that jumps the cursor to top
 *   - Streaming text in the live turn no longer competes with history repaints
 *   - History scrolls naturally into the terminal's scrollback buffer
 *
 * Only the in-flight streaming turn lives inside the regular dynamic render tree.
 */

import { Box, Static, Text } from 'ink'

import { stripTodoWriteArtifacts } from '../app/todoArtifacts.js'
import type { AssistantTurn, Turn } from '../app/types.js'
import { useVirtualHistory } from '../hooks/useVirtualHistory.js'
import { theme } from '../theme.js'

import { MarkdownRenderer } from './markdownRenderer.js'
import { StreamingAssistant } from './streamingAssistant.js'
import { ToolCallLine } from './toolCallLine.js'

function UserBlock({ text }: { text: string }) {
  return (
    <Box marginTop={1}>
      <Text color={theme.user} bold>▸ </Text>
      <Text color={theme.user}>{text}</Text>
    </Box>
  )
}

function AssistantBlock({ turn }: { turn: AssistantTurn }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.primary} bold>● assistant</Text>
      {turn.tools.map(t => (
        <ToolCallLine key={t.id} tool={t} />
      ))}
      {stripTodoWriteArtifacts(turn.text) && (
        <Box>
          <MarkdownRenderer text={stripTodoWriteArtifacts(turn.text)} color={theme.assistant} />
        </Box>
      )}
      {turn.status === 'error' && (
        <Text color={theme.error}>✗ error: {turn.errorMessage}</Text>
      )}
      {turn.status === 'interrupted' && (
        <Text color={theme.warn}>⚠ interrupted</Text>
      )}
      {turn.usage && (
        <Text color={theme.muted} dimColor>
          {`  ${turn.usage.model} · in=${turn.usage.prompt_tokens} out=${turn.usage.completion_tokens}`}
        </Text>
      )}
    </Box>
  )
}

function TurnView({ turn }: { turn: Turn }) {
  return turn.role === 'user'
    ? <UserBlock text={turn.text} />
    : <AssistantBlock turn={turn} />
}

export function TranscriptPane() {
  const { visible, hidden } = useVirtualHistory(50)

  // Static items: each must have a stable key tied to turn identity (not slice
  // index), so that when the virtual window slides (older turns drop out) the
  // remaining items keep the same keys and Ink doesn't re-print them.
  // User turns are keyed by their timestamp; assistant turns by startedAt.
  type StaticItem = { key: string; turn: Turn | null; isMarker?: boolean; hiddenCount?: number }
  const items: StaticItem[] = []
  // Only show the "hidden" marker once history actually has hidden items.
  // Pin the key to a coarse bucket so it doesn't change every time `hidden` increments by 1.
  if (hidden > 0) {
    items.push({
      key: 'hidden-marker',
      turn: null,
      isMarker: true,
      hiddenCount: hidden,
    })
  }
  visible.forEach(t => {
    const stableId = t.role === 'user' ? t.ts : t.startedAt
    items.push({ key: `turn-${t.role}-${stableId}`, turn: t })
  })

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {item => {
          if (item.isMarker) {
            return (
              <Box key={item.key}>
                <Text color={theme.muted} dimColor>
                  ── {item.hiddenCount} earlier turn{item.hiddenCount! > 1 ? 's' : ''} hidden (scroll up in terminal) ──
                </Text>
              </Box>
            )
          }
          return <TurnView key={item.key} turn={item.turn!} />
        }}
      </Static>
      <StreamingAssistant />
    </Box>
  )
}
