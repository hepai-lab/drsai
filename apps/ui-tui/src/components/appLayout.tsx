/**
 * AppLayout — top-level layout:
 *   ┌────────────────────────────────┐
 *   │ Banner                         │
 *   │ TranscriptPane (scrollable)    │
 *   │ ─────────                      │
 *   │ Prompts overlay (conditional)  │
 *   │ StatusBar                      │
 *   │ ComposerPane                   │
 *   └────────────────────────────────┘
 *
 * Note on the banner:
 *   The banner lives in the dynamic frame (NOT inside <Static>). An earlier
 *   experiment moved it into <Static> to avoid a "multiple banners" artifact
 *   seen while dragging the window wider — but <Static> means "append-only,
 *   never repainted", so after a resize the banner just *disappeared* and
 *   never came back. That was strictly worse.
 *
 *   The "multiple banners" artifact is the price of Ink 6's resize handling:
 *   on width increase, Ink calls onRender() without log.clear(), so the
 *   previous frame's banner row can linger until the next re-render. Any
 *   subsequent React update (cursor blink at 530 ms, streaming delta, status
 *   change, etc.) overwrites the duplicates. In practice the artifact is
 *   only visible *during* rapid drag-resize and resolves within ~0.5 s.
 *
 *   Do NOT put banner-like content into <Static> unless you also accept
 *   that it will be invisible after the first reflow.
 */

import { Box, Text } from 'ink'

import type { GatewayClient } from '../gatewayClient.js'
import type { TurnController } from '../app/turnController.js'
import { theme } from '../theme.js'

import { ComposerPane } from './composerPane.js'
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
      <Box>
        <Text color={theme.primary} bold>⚡ DrSai</Text>
      </Box>
      <TranscriptPane />
      <PromptsOverlay gw={gw} />
      <StatusBar />
      <ComposerPane sessionId={sessionId} controller={controller} switchSession={switchSession} />
    </Box>
  )
}
