/**
 * TranscriptPane — renders completed turns above the live streaming turn.
 *
 * Architecture:
 *   - Completed turns go into Ink's <Static>. Static is APPEND-ONLY:
 *     once a turn is rendered, Ink writes it to stdout and never
 *     repaints it. The terminal's scrollback owns it from then on, so
 *     the user can scroll back through history with the terminal's
 *     native scrollbar / wheel without Ink's eraseLines() yanking the
 *     view back to the bottom (P1-01).
 *   - The streaming assistant turn lives in the DYNAMIC frame (below
 *     <Static>). Ink keeps repainting just that small region as deltas
 *     arrive. When the turn finalizes, turnController moves it from
 *     $current into $transcript, which lets <Static> commit it
 *     permanently to scrollback in the next render.
 *
 * Why we dropped the in-TUI virtual scroll (PageUp/PageDown turn
 * stepping):
 *   With <Static> the terminal already provides scrollback for every
 *   completed turn. The old PageUp logic stepped by turn index inside
 *   the dynamic frame which competed with terminal-native scroll and
 *   confused users when both were active. Native scrolling is the
 *   right primitive — the user already knows how to do it.
 *
 * Session switch:
 *   The parent passes `sessionId` so we can key the wrapper. When the
 *   user changes sessions, $transcript is replaced and Static remounts
 *   (its internal `index` cursor resets) so the new session's history
 *   appears clean rather than "appended" below the old one.
 */

import { memo } from 'react'
import { useStore } from '@nanostores/react'
import { Box, Static, Text } from 'ink'

import { stripTodoWriteArtifacts } from '../app/todoArtifacts.js'
import { getPartText, type AssistantTurn, type Turn } from '../app/types.js'
import { $transcript, $transcriptGeneration } from '../app/turnStore.js'
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
  // If we have ordered contentParts, render text segments and tool calls
  // in their real interleaving order. Each text segment is rendered
  // with MarkdownRenderer (completed turns use Markdown; streaming
  // turns in StreamingAssistant use plain <Text> for performance).
  if (turn.contentParts.length > 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.primary} bold>● assistant</Text>
        {turn.contentParts.map(part => {
          if (part.kind === 'tool') {
            const tool = turn.tools.find(t => t.id === part.toolId)
            if (!tool) return null
            return <ToolCallLine key={part.id} tool={tool} />
          }
          // Text part
          const cleanText = stripTodoWriteArtifacts(getPartText(part))
          if (!cleanText) return null
          return (
            <Box key={part.id}>
              <MarkdownRenderer text={cleanText} color={theme.assistant} />
            </Box>
          )
        })}
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

  // Legacy fallback: no contentParts (e.g. history-loaded turns).
  // Render tools first, then text — the old behaviour.
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

/**
 * TurnView is memoised so re-renders of the parent (when streaming
 * deltas push transcript to a new array reference) don't re-parse
 * markdown on every completed turn. Static already filters by index,
 * but defence-in-depth keeps the cost flat.
 */
const TurnView = memo(function TurnView({ turn }: { turn: Turn }) {
  return turn.role === 'user'
    ? <UserBlock text={turn.text} />
    : <AssistantBlock turn={turn} />
})

interface TranscriptPaneProps {
  /** Used to remount <Static> when the user switches sessions. */
  sessionId?: string
}

export function TranscriptPane({ sessionId }: TranscriptPaneProps) {
  const transcript = useStore($transcript)
  const generation = useStore($transcriptGeneration)

  return (
    <Box flexDirection="column" key={`${sessionId ?? 'default'}-gen${generation}`}>
      {/*
        Completed turns — flushed into terminal scrollback by Ink's
        <Static>. Once written they are never re-rendered, which is
        exactly what we want: the terminal's native scrollback now
        owns the history and the user can scroll back without Ink's
        eraseLines() pulling the viewport back down.
      */}
      <Static items={transcript}>
        {(turn, index) => {
          const stableId = turn.role === 'user' ? turn.ts : turn.startedAt
          return <TurnView key={`turn-${turn.role}-${stableId}-${index}`} turn={turn} />
        }}
      </Static>

      {/* Live streaming assistant turn — dynamic frame; finalized into
          $transcript via turnController.finalize() once message.complete
          arrives. */}
      <StreamingAssistant />
    </Box>
  )
}
