/**
 * SlashOutputOverlay — persistent slash-command output viewer.
 *
 * Short-lived toasts are fine for status messages, but informational commands
 * like /help need to stay visible until the user has finished reading them.
 */

import { Box, Text, useInput } from 'ink'

import { theme } from '../theme.js'

export interface SlashOutputOverlayProps {
  output: string
  onDismiss: () => void
}

export function SlashOutputOverlay({ output, onDismiss }: SlashOutputOverlayProps) {
  useInput((_input, key) => {
    if (key.return || key.escape) {
      onDismiss()
    }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.border}>{'─'.repeat(60)}</Text>
      </Box>
      <Box borderStyle="round" borderColor={theme.border} flexDirection="column" paddingX={1}>
        <Text color={theme.text}>{output}</Text>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Press Enter or Esc to return to input
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
