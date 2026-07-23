/**
 * AppLayout — top-level layout:
 *   ┌────────────────────────────────┐
 *   │ (Banner — pre-printed)         │
 *   │ TranscriptPane (scrollable)    │
 *   │ ─────────                      │
 *   │ Prompts overlay (conditional)  │
 *   │ StatusBar                      │
 *   │ ComposerPane                   │
 *   └────────────────────────────────┘
 *
 * Banner note:
 *   The "⚡ DrSai" banner is now pre-printed via process.stdout.write in
 *   entry.tsx BEFORE Ink starts rendering.  This keeps it outside Ink's
 *   dynamic frame so it is never re-rendered.  Previously it lived inside
 *   the dynamic frame, which caused duplicate banner lines during the
 *   "thinking" phase (every 100ms spinner tick triggered a re-render, and
 *   on some terminals Ink's eraseLines() didn't fully clear the previous
 *   frame, causing the banner to accumulate).
 */

import { Box } from 'ink'

import type { GatewayClient } from '../gatewayClient.js'
import type { TurnController } from '../app/turnController.js'

import { ComposerPane } from './composerPane.js'
import { MemoryPreviewBanner } from './memoryPreviewBanner.js'
import { PromptsOverlay } from './prompts.js'
import { StatusBar } from './statusBar.js'
import { TranscriptPane } from './transcriptPane.js'

interface Props {
  gw: GatewayClient
  controller: TurnController
  sessionId: string
  switchSession: (sid: string) => Promise<void>
}

export function AppLayout({ gw, controller, sessionId, switchSession }: Props) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/*
        Banner ("⚡ DrSai") is now pre-printed in entry.tsx BEFORE Ink
        starts rendering.  This keeps it outside Ink's dynamic frame so
        it is NOT re-rendered on every spinner tick / streaming flush.
        Previously it lived here as:
          <Box><Text color={theme.primary} bold>⚡ DrSai</Text></Box>
        which caused duplicate banner lines during the "thinking" phase
        on terminals where Ink's eraseLines() doesn't fully clear frames.
      */}
      <MemoryPreviewBanner />
      <TranscriptPane sessionId={sessionId} />
      <PromptsOverlay gw={gw} />
      <StatusBar />
      <ComposerPane sessionId={sessionId} controller={controller} switchSession={switchSession} />
    </Box>
  )
}
