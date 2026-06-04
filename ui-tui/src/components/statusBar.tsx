/**
 * StatusBar — bottom status line showing model, session, status messages.
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'

import { $isStreaming } from '../app/turnStore.js'
import { $connectionStatus, $sessionMeta, $statusLine, $userId } from '../app/uiStore.js'
import { theme } from '../theme.js'

export function StatusBar() {
  const meta = useStore($sessionMeta)
  const userId = useStore($userId)
  const conn = useStore($connectionStatus)
  const statusLine = useStore($statusLine)
  const isStreaming = useStore($isStreaming)

  const connBadge =
    conn === 'ready' ? <Text color={theme.good}>● connected</Text> :
    conn === 'connecting' ? <Text color={theme.warn}>○ connecting</Text> :
    conn === 'exited' ? <Text color={theme.error}>✗ exited</Text> :
    <Text color={theme.error}>✗ error</Text>

  const modelLabel = meta?.model ?? '?'
  const toolCount = meta?.tools?.length ?? 0
  const workdir = meta?.workdir ?? ''
  // Show just the basename + maybe parent for the status line
  const workdirShort = workdir
    ? (() => {
        const parts = workdir.split('/').filter(Boolean)
        if (parts.length <= 2) return workdir
        return '…/' + parts.slice(-2).join('/')
      })()
    : ''

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.border}>{'─'.repeat(60)}</Text>
      </Box>
      <Box>
        {connBadge}
        <Text color={theme.muted}> · </Text>
        <Text color={theme.text}>{userId || '?'}</Text>
        <Text color={theme.muted}> @ </Text>
        <Text color={theme.accent}>{modelLabel}</Text>
        <Text color={theme.muted}> · </Text>
        <Text color={theme.text}>{toolCount} tools</Text>
        {workdirShort && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.text}>📂 {workdirShort}</Text>
          </>
        )}
        {meta?.plan_mode && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.warn}>plan</Text>
          </>
        )}
        {meta?.default_subagent && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.accent}>🤖 {meta.default_subagent}</Text>
          </>
        )}
        {meta?.workspace_enabled === false && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.warn}>any-path</Text>
          </>
        )}
        <Text color={theme.muted}> · </Text>
        {meta?.allow_dangerous_commands ? (
          <Text color={theme.error} bold>any-cmd</Text>
        ) : (
          <Text color={theme.good}>safe-cmd</Text>
        )}
        {isStreaming && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.warn}>streaming</Text>
          </>
        )}
      </Box>
      {statusLine && (
        <Box>
          <Text color={theme.muted} dimColor>{statusLine}</Text>
        </Box>
      )}
    </Box>
  )
}
