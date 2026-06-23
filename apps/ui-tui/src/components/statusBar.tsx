/**
 * StatusBar — bottom status line showing model, session, status messages.
 *
 * Layout:
 *   - Wide terminals (≥ 90 cols) render the full one-line summary with
 *     all badges separated by " · " on a single Box row.
 *   - Narrow terminals (< 90 cols) collapse to a stacked, multi-row
 *     layout where each logical group sits on its own line. Without this
 *     adjustment Yoga's flex row would silently overflow and the badges
 *     would wrap mid-segment, leaving disjointed "tools" / " · " glyphs
 *     scattered across columns.
 *
 *   The separator divider line is sized to the current terminal width so
 *   it never wraps onto a second visual row when the window shrinks.
 */

import { useStore } from '@nanostores/react'
import { Box, Text } from 'ink'

import { useTerminalWidth } from '../hooks/useTerminalWidth.js'
import { $isStreaming } from '../app/turnStore.js'
import { $connectionStatus, $copyMode, $lastUsage, $sessionMeta, $statusLine, $userId } from '../app/uiStore.js'
import { theme } from '../theme.js'

/** Truncate a string to at most `maxChars` characters, appending "…" if truncated. */
function truncate(s: string, maxChars: number): string {
  if (!s || s.length <= maxChars) return s
  return s.slice(0, maxChars - 1) + '…'
}

/** Width below which we switch to the stacked / narrow layout. */
const NARROW_BREAKPOINT = 90

export function StatusBar() {
  const meta = useStore($sessionMeta)
  const userId = useStore($userId)
  const conn = useStore($connectionStatus)
  const statusLine = useStore($statusLine)
  const isStreaming = useStore($isStreaming)
  const lastUsage = useStore($lastUsage)
  const copyMode = useStore($copyMode)
  const cols = useTerminalWidth(80)
  // Padding-aware effective width — appLayout uses paddingX={1} so subtract 2.
  const effectiveCols = Math.max(20, cols - 2)
  const isNarrow = effectiveCols < NARROW_BREAKPOINT

  // Cap status-line text to roughly three terminal rows. Long log messages
  // (e.g. FunctionCall with big arguments) would otherwise push the whole UI
  // upward and make the composer invisible.
  const statusLineShort = truncate(statusLine, Math.max(120, effectiveCols * 3))

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

  // Divider — sized to the current terminal width so a window resize doesn't
  // leave us with a 60-char line wrapping in a 50-col terminal (which used
  // to draw a "──── //── //──" zig-zag once Ink wrapped the second segment).
  const dividerWidth = Math.min(80, effectiveCols)

  // ── Wide layout (single line, all badges) ──────────────────────────
  if (!isNarrow) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={theme.border}>{'─'.repeat(dividerWidth)}</Text>
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
          {(meta?.has_injected_prefix || meta?.has_injected_suffix) && (
            <>
              <Text color={theme.muted}> · </Text>
              <Text color={theme.tool}>📝 inject</Text>
              {meta?.has_injected_prefix && <Text color={theme.muted}>↥</Text>}
              {meta?.has_injected_suffix && <Text color={theme.muted}>↧</Text>}
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
          {/* Copy mode is a transient state and worth surfacing prominently. */}
          {copyMode && (
            <>
              <Text color={theme.muted}> · </Text>
              <Text color={theme.warn} bold>copy</Text>
            </>
          )}
          {/* Latest token usage (Issue #8 fix) */}
          {lastUsage && !isStreaming && (
            <>
              <Text color={theme.muted}> · </Text>
              <Text color={theme.muted}>
                {lastUsage.prompt_tokens}↑ {lastUsage.completion_tokens}↓ = {lastUsage.total_tokens} tokens
              </Text>
            </>
          )}
        </Box>
        {statusLineShort && (
          <Box>
            <Text color={theme.muted} dimColor>{statusLineShort}</Text>
          </Box>
        )}
      </Box>
    )
  }

  // ── Narrow layout (stacked, two rows) ──────────────────────────────
  // Row 1: connection · user @ model
  // Row 2: tools · cwd · flags · stream · copy
  // Row 3 (optional): tokens
  // Row 4 (optional): statusLine
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.border}>{'─'.repeat(dividerWidth)}</Text>
      </Box>
      <Box>
        {connBadge}
        <Text color={theme.muted}> · </Text>
        <Text color={theme.text}>{userId || '?'}</Text>
        <Text color={theme.muted}> @ </Text>
        <Text color={theme.accent}>{modelLabel}</Text>
      </Box>
      <Box>
        <Text color={theme.text}>{toolCount} tools</Text>
        {workdirShort && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.text}>📂 {workdirShort}</Text>
          </>
        )}
      </Box>
      <Box>
        {meta?.allow_dangerous_commands ? (
          <Text color={theme.error} bold>any-cmd</Text>
        ) : (
          <Text color={theme.good}>safe-cmd</Text>
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
        {(meta?.has_injected_prefix || meta?.has_injected_suffix) && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.tool}>📝 inject</Text>
            {meta?.has_injected_prefix && <Text color={theme.muted}>↥</Text>}
            {meta?.has_injected_suffix && <Text color={theme.muted}>↧</Text>}
          </>
        )}
        {meta?.workspace_enabled === false && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.warn}>any-path</Text>
          </>
        )}
        {isStreaming && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.warn}>streaming</Text>
          </>
        )}
        {copyMode && (
          <>
            <Text color={theme.muted}> · </Text>
            <Text color={theme.warn} bold>copy</Text>
          </>
        )}
      </Box>
      {lastUsage && !isStreaming && (
        <Box>
          <Text color={theme.muted}>
            {lastUsage.prompt_tokens}↑ {lastUsage.completion_tokens}↓ = {lastUsage.total_tokens} tokens
          </Text>
        </Box>
      )}
      {statusLineShort && (
        <Box>
          <Text color={theme.muted} dimColor>{statusLineShort}</Text>
        </Box>
      )}
    </Box>
  )
}
