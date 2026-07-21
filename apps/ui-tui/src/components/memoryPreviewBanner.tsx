/**
 * MemoryPreviewBanner — displays MEMORY.md summary on TUI startup.
 *
 * When the backend emits a ``status.update`` event with
 * ``kind: "memory.preview"``, the content is stored in ``$memoryPreview``.
 * This component renders it as a single-line banner.
 *
 * The banner is typically pre-printed to stdout via ``preprintMemoryBanner``
 * (in app.tsx) before Ink commits <Static> items, so it appears in terminal
 * scrollback above the transcript.  This React component is a fallback for
 * the event-based path.
 *
 * Content format from backend: "~/.drsai/.../MEMORY.md (2/15 entries)"
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'

import { $memoryPreview } from '../app/uiStore.js'
import { theme } from '../theme.js'

export function MemoryPreviewBanner() {
  const memoryPreview = useStore($memoryPreview)

  if (!memoryPreview || !memoryPreview.trim()) return null

  return (
    <Box marginBottom={1}>
      <Text color={theme.primary} bold>
        📋 Memory{' '}
      </Text>
      <Text color={theme.muted} dimColor>
        {memoryPreview.trim()}
      </Text>
    </Box>
  )
}
