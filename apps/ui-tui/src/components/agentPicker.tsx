/**
 * AgentPicker — interactive overlay for selecting a default subagent.
 *
 * Triggered by `/agent` (no args) or `ui_action: "agent.picker"`.
 * Fetches the list of available subagents via `slash.exec { command: "agent list" }`,
 * parses the text output, and lets the user pick with arrow keys.
 *
 *   ↑↓ navigate · Enter select · c clear · q quit
 */

import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

interface SubagentInfo {
  type: string
  description: string
  is_daemon: boolean
}

interface Props {
  gw: GatewayClient
  onSelect: (agentType: string | null) => void
  onDismiss: () => void
}

/**
 * Parse the text output of `/agent list` into structured data.
 *
 * Expected format:
 *   Available subagents:
 *   - explore: Read-only code explorer
 *   - general: General-purpose subagent
 *   - daemon:coder: Background coding daemon
 */
function parseAgentList(text: string): SubagentInfo[] {
  const lines = text.split('\n')
  const result: SubagentInfo[] = []
  for (const line of lines) {
    // Match lines like "  - name: description" or "- name: description"
    const match = line.match(/^\s*[-•]\s*(\S+):\s*(.+)$/)
    if (match) {
      const type = match[1].trim()
      const description = match[2].trim()
      result.push({
        type,
        description,
        is_daemon: type.startsWith('daemon:'),
      })
    }
  }
  return result
}

export function AgentPicker({ gw, onSelect, onDismiss }: Props) {
  const [agents, setAgents] = useState<SubagentInfo[]>([])
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    gw.request<{ output?: string }>('slash.exec', { command: 'agent list' })
      .then((res) => {
        const text = res.output || ''
        const parsed = parseAgentList(text)
        setAgents(parsed)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [gw])

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onDismiss()
      return
    }
    if (loading || error) return

    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(agents.length - 1, c + 1))

    if (key.return && agents[cursor]) {
      onSelect(agents[cursor].type)
    }

    // c = clear default subagent
    if (input === 'c') {
      onSelect(null)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>🤖 Select Default Subagent</Text>
      </Box>

      {loading && <Text color={theme.muted}>  Loading…</Text>}

      {error && (
        <Box flexDirection="column">
          <Text color={theme.error}>  Error: {error}</Text>
          <Text color={theme.muted} dimColor>  Press q to dismiss</Text>
        </Box>
      )}

      {!loading && !error && agents.length === 0 && (
        <Text color={theme.muted}>  No subagents configured.</Text>
      )}

      {!loading && !error && agents.length > 0 && (
        <Box flexDirection="column">
          {agents.map((a, i) => {
            const isCursor = i === cursor
            const prefix = isCursor ? '▶ ' : '  '
            return (
              <Text key={a.type} color={isCursor ? theme.accent : theme.text} bold={isCursor}>
                {prefix}{a.is_daemon ? '🖥' : '🤖'} {a.type}
                <Text color={theme.muted} dimColor> — {a.description.slice(0, 50)}</Text>
              </Text>
            )
          })}
        </Box>
      )}

      {!loading && !error && (
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑↓ navigate · Enter select · c clear · q quit
          </Text>
        </Box>
      )}
    </Box>
  )
}
