/**
 * DaemonPanel — interactive overlay for managing background daemon processes.
 *
 * Triggered by `/daemons` (no args) or `ui_action: "daemon.panel"`.
 * Shows a live list of daemons with keyboard shortcuts for:
 *   ↑↓ navigate · Enter detail · l logs · s stop · r refresh · q quit
 */

import { Box, Text, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

interface DaemonInfo {
  name: string
  pid: number | null
  ws_port: number
  alive: boolean
  uptime_seconds?: number
  session_count?: number
  started_at?: number
  api_token?: string
  log_file?: string
  wechat_enabled?: boolean
  model?: string
}

interface Props {
  gw: GatewayClient
  onDismiss: () => void
}

type View = 'list' | 'detail' | 'logs'

export function DaemonPanel({ gw, onDismiss }: Props) {
  const [daemons, setDaemons] = useState<DaemonInfo[]>([])
  const [cursor, setCursor] = useState(0)
  const [view, setView] = useState<View>('list')
  const [selectedDaemon, setSelectedDaemon] = useState<DaemonInfo | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await gw.request<{ daemons: DaemonInfo[] }>('daemon.list', {})
      setDaemons(res.daemons || [])
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }, [gw])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000) // refresh every 5s
    return () => clearInterval(timer)
  }, [refresh])

  const showDetail = async (d: DaemonInfo) => {
    try {
      const res = await gw.request<Record<string, unknown>>('daemon.status', { name: d.name })
      setSelectedDaemon({ ...d, ...res } as DaemonInfo)
      setView('detail')
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  const showLogs = async (d: DaemonInfo) => {
    try {
      const res = await gw.request<{ lines: string[]; log_file: string }>('daemon.logs', { name: d.name, tail: 50 })
      setLogs(res.lines || [])
      setSelectedDaemon(d)
      setView('logs')
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  const stopDaemon = async (d: DaemonInfo) => {
    try {
      await gw.request('daemon.stop', { name: d.name })
      setMessage(`✓ Daemon '${d.name}' stopped`)
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  function formatUptime(seconds: number): string {
    if (!seconds || seconds < 0) return 'N/A'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h}h${m}m`
    return `${m}m`
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      if (view !== 'list') {
        setView('list')
        setSelectedDaemon(null)
      } else {
        onDismiss()
      }
      return
    }

    if (view === 'list') {
      if (key.upArrow) setCursor(c => Math.max(0, c - 1))
      if (key.downArrow) setCursor(c => Math.min(daemons.length - 1, c + 1))
      if (input === 'r') refresh()

      if (daemons[cursor]) {
        if (key.return) showDetail(daemons[cursor])
        if (input === 'l') showLogs(daemons[cursor])
        if (input === 's') stopDaemon(daemons[cursor])
      }
    }
  })

  // ── List view ──────────────────────────────────────────
  if (view === 'list') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>🤖 Daemon Manager</Text>
          <Text color={theme.muted} dimColor>  ({daemons.length} daemon{daemons.length !== 1 ? 's' : ''})</Text>
        </Box>

        {daemons.length === 0 ? (
          <Text color={theme.muted}>  No daemons configured.</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={theme.muted} dimColor>
              {'  Name'.padEnd(20)} {'Port'.padEnd(8)} {'Status'.padEnd(10)} {'Uptime'.padEnd(10)} {'Sessions'.padEnd(10)}
            </Text>
            {daemons.map((d, i) => {
              const isCursor = i === cursor
              const prefix = isCursor ? '▶ ' : '  '
              const nameStr = (prefix + d.name).slice(0, 18).padEnd(20)
              const portStr = String(d.ws_port || '?').padEnd(8)
              const statusStr = (d.alive ? '● alive' : '○ dead').padEnd(10)
              const uptimeStr = formatUptime(d.uptime_seconds || 0).padEnd(10)
              const sessStr = String(d.session_count ?? 0).padEnd(10)
              return (
                <Text key={d.name} color={isCursor ? theme.accent : theme.text} bold={isCursor}>
                  {nameStr} {portStr} {statusStr} {uptimeStr} {sessStr}
                </Text>
              )
            })}
          </Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={theme.warn}>{message}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑↓ navigate · Enter detail · l logs · s stop · r refresh · q quit
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Detail view ────────────────────────────────────────
  if (view === 'detail' && selectedDaemon) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>Daemon: {selectedDaemon.name}</Text>
        </Box>
        <Text color={theme.text}>  PID:       {selectedDaemon.pid ?? 'N/A'}</Text>
        <Text color={theme.text}>  WS Port:   {selectedDaemon.ws_port || 'N/A'}</Text>
        <Text color={selectedDaemon.alive ? theme.good : theme.error}>
          {'  Status:    '}{selectedDaemon.alive ? '✅ Running' : '❌ Stopped'}
        </Text>
        <Text color={theme.text}>  Uptime:    {formatUptime(selectedDaemon.uptime_seconds || 0)}</Text>
        <Text color={theme.text}>  Sessions:  {selectedDaemon.session_count ?? 0}</Text>
        {selectedDaemon.wechat_enabled !== undefined && (
          <Text color={theme.text}>  WeChat:    {selectedDaemon.wechat_enabled ? '✓ enabled' : '✗ disabled'}</Text>
        )}
        {selectedDaemon.model && (
          <Text color={theme.text}>  Model:     {selectedDaemon.model}</Text>
        )}
        {selectedDaemon.log_file && (
          <Text color={theme.muted} dimColor>  Log:       {selectedDaemon.log_file}</Text>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={theme.warn}>{message}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Esc/back · l logs · s stop · q quit
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Logs view ──────────────────────────────────────────
  if (view === 'logs' && selectedDaemon) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>
            Logs: {selectedDaemon.name} (last {logs.length} lines)
          </Text>
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          {logs.length === 0 ? (
            <Text color={theme.muted}>  (no log output)</Text>
          ) : (
            logs.slice(-30).map((line, i) => (
              <Text key={i} color={theme.muted} dimColor>{line}</Text>
            ))
          )}
        </Box>
        <Text color={theme.muted} dimColor>Esc/back · q quit</Text>
      </Box>
    )
  }

  return null
}
