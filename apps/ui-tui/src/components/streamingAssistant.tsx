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
 *
 * "Thinking" hint:
 *   When the turn has started but no text / tool call has happened yet
 *   (typical for reasoning models — GPT-5, Claude thinking, etc., that
 *   take 10-60 s before the first token), we show an animated spinner
 *   plus a wall-clock elapsed counter so the user can tell the agent is
 *   working vs. wedged. We DELIBERATELY stop the animation once any
 *   content arrives — that way the dynamic frame stops repainting at
 *   the spinner's cadence and we don't fight the P1-01 scroll-anchor
 *   issue while text streams.
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'

import { stripTodoWriteArtifacts } from '../app/todoArtifacts.js'
import { $current } from '../app/turnStore.js'
import { $showReasoning, $terminalFocused } from '../app/uiStore.js'
import { theme } from '../theme.js'

import { stripThinkBlocks } from './markdownRenderer.js'
import { ToolCallLine } from './toolCallLine.js'

// Braille rotor — 10 frames is a typical xterm spinner; tick every 100 ms.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_TICK_MS = 100
// Re-render the elapsed counter at 1 s granularity — anything finer
// adds repaints with no user-visible benefit.
const ELAPSED_TICK_MS = 1000

/**
 * Combined spinner + elapsed-seconds hook.
 *
 * Returns ``{ frame, elapsed }`` while ``active`` is true. When
 * ``active`` flips to false the interval is torn down and the values
 * freeze, so the consumer should simply stop rendering them.
 *
 * ``active`` is passed in so the parent can pause the animation when
 * the terminal window loses focus (saves CPU + stops emitting Ink
 * frames into a window the user isn't looking at).
 */
function useThinkingPulse(active: boolean, startedAt: number) {
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) return
    const spin = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length)
    }, SPINNER_TICK_MS)
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, ELAPSED_TICK_MS)
    // Prime the elapsed counter immediately so the first render doesn't
    // sit on "0s" for a full second.
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    return () => {
      clearInterval(spin)
      clearInterval(tick)
    }
  }, [active, startedAt])

  return { glyph: SPINNER_FRAMES[frame], elapsed }
}

export function StreamingAssistant() {
  const cur = useStore($current)
  const showReasoning = useStore($showReasoning)
  const termFocused = useStore($terminalFocused)

  const cleanText = cur?.text ? stripTodoWriteArtifacts(stripThinkBlocks(cur.text)) : ''

  // "Thinking" pulse runs only:
  //   - turn is in flight (status === 'streaming')
  //   - no visible content yet (no text, no tool call started)
  //   - terminal window has focus (don't burn CPU repainting an
  //     invisible window — see P1-17)
  const showThinking =
    !!cur &&
    cur.status === 'streaming' &&
    !cleanText &&
    cur.tools.length === 0
  const pulse = useThinkingPulse(showThinking && termFocused, cur?.startedAt ?? Date.now())

  if (!cur) return null

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

      {showThinking && (
        <Box>
          <Text color={theme.muted} dimColor>
            {`  ${termFocused ? pulse.glyph : '○'} thinking… ${pulse.elapsed}s`}
          </Text>
        </Box>
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
