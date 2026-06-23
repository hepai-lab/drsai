/**
 * WeChatPanel — interactive overlay for WeChat integration management.
 *
 * Triggered by `/wechat` (no args) or `ui_action: "wechat.panel"`.
 * Shows WeChat login status, active daemons, and provides login/logout actions.
 *
 *   r refresh · l login · x logout · q quit
 */

import { Box, Text, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

interface WeChatStatus {
  configured: boolean
  credentials_valid: boolean
  login_time: string | null
  expires_at: string | null
  bot_token: string | null
  account_id: string | null
  active_daemons: Array<{ name: string; port: number }>
}

interface Props {
  gw: GatewayClient
  onDismiss: () => void
}

export function WeChatPanel({ gw, onDismiss }: Props) {
  const [status, setStatus] = useState<WeChatStatus | null>(null)
  const [message, setMessage] = useState('')
  const [loginPending, setLoginPending] = useState(false)
  const [qrUrl, setQrUrl] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await gw.request<WeChatStatus>('wechat.status', {})
      setStatus(res)
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }, [gw])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function startLogin() {
    try {
      setLoginPending(true)
      setMessage('Requesting QR code…')
      const res = await gw.request<{ qr_url: string; qr_id: string; status: string }>('wechat.login', {})
      setQrUrl(res.qr_url)
      setMessage('QR code received. Scan with WeChat app…')
      // Poll for login status
      const pollId = setInterval(async () => {
        try {
          const pollRes = await gw.request<{ status: string; account_id?: string }>('wechat.login_status', { qr_id: res.qr_id })
          if (pollRes.status === 'confirmed') {
            clearInterval(pollId)
            setLoginPending(false)
            setQrUrl('')
            setMessage(`✓ Login confirmed! Account: ${pollRes.account_id || 'N/A'}`)
            refresh()
          } else if (pollRes.status === 'expired') {
            clearInterval(pollId)
            setLoginPending(false)
            setQrUrl('')
            setMessage('❌ QR code expired. Press l to try again.')
          }
        } catch {
          // Ignore polling errors
        }
      }, 3000)
      // Auto-stop polling after 2 minutes
      setTimeout(() => clearInterval(pollId), 120000)
    } catch (e) {
      setLoginPending(false)
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  async function logout() {
    try {
      await gw.request('wechat.logout', {})
      setMessage('✓ Logged out, credentials deleted.')
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onDismiss()
      return
    }
    if (input === 'r') refresh()
    if (input === 'l' && !loginPending) startLogin()
    if (input === 'x' && status?.configured) logout()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>💬 WeChat Integration</Text>
      </Box>

      {status ? (
        <Box flexDirection="column">
          <Text color={theme.text}>
            {'  Configured:    '}{status.configured ? '✓ Yes' : '✗ No'}
          </Text>
          <Text color={status.credentials_valid ? theme.good : theme.error}>
            {'  Credentials:   '}{status.credentials_valid ? '✓ Valid' : (status.configured ? '⚠ Expired' : '✗ None')}
          </Text>
          {status.login_time && (
            <Text color={theme.muted} dimColor>{'  Login time:    '}{status.login_time}</Text>
          )}
          {status.expires_at && (
            <Text color={theme.muted} dimColor>{'  Expires at:    '}{status.expires_at}</Text>
          )}
          {status.account_id && (
            <Text color={theme.muted} dimColor>{'  Account ID:    '}{status.account_id}</Text>
          )}
          {status.bot_token && (
            <Text color={theme.muted} dimColor>{'  Bot token:     '}{status.bot_token}</Text>
          )}
          {status.active_daemons.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={theme.muted} dimColor>  Active daemons with WeChat:</Text>
              {status.active_daemons.map(d => (
                <Text key={d.name} color={theme.text}>    ● {d.name} (port {d.port})</Text>
              ))}
            </Box>
          )}
        </Box>
      ) : (
        <Text color={theme.muted}>  Loading…</Text>
      )}

      {qrUrl && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent}>  QR Code URL:</Text>
          <Text color={theme.muted} dimColor>  {qrUrl.slice(0, 60)}…</Text>
          <Text color={theme.muted}>  (Copy URL to a QR generator to scan)</Text>
        </Box>
      )}

      {message && (
        <Box marginTop={1}>
          <Text color={theme.warn}>{message}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          r refresh{!loginPending ? ' · l login' : ' · (login pending…)'}{status?.configured ? ' · x logout' : ''} · q quit
        </Text>
      </Box>
    </Box>
  )
}
