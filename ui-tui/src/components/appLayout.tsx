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
