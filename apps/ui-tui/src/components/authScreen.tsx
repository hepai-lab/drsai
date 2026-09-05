/**
 * AuthScreen — OIDC Device Code Flow login for the TUI.
 *
 * Triggered when the user chooses "OIDC login" during first-run setup,
 * or when the stored OIDC token has expired and needs re-authentication.
 *
 * Flow:
 *   1. Call auth.oidc.start → get user_code + verification_uri
 *   2. Display the code + URL, start polling auth.oidc.poll
 *   3. On success → onComplete()
 *   4. On expired/error → allow retry or cancel
 */

import { Box, Text, useInput } from 'ink'
import { useEffect, useState, useRef, useCallback } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

interface AuthScreenProps {
  gw: GatewayClient
  /** Called after successful OIDC login. Triggers App to continue boot. */
  onComplete: () => void
  /** Called when user cancels (Esc) — go back to provider selection. */
  onCancel: () => void
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

interface PollResult {
  status: 'pending' | 'success' | 'expired' | 'error'
  user?: { user_id: string; email: string; name: string; roles: string[] }
  error?: string
}

type AuthPhase = 'starting' | 'showing' | 'polling' | 'success' | 'expired' | 'error'

export function AuthScreen({ gw, onComplete, onCancel }: AuthScreenProps) {
  const [phase, setPhase] = useState<AuthPhase>('starting')
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [user, setUser] = useState<{ user_id: string; email: string; name: string } | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const startDeviceFlow = useCallback(async () => {
    setPhase('starting')
    setErrorMsg('')
    try {
      const resp = await gw.request<DeviceCodeResponse>('auth.oidc.start', {})
      if (cancelledRef.current) return
      setDeviceCode(resp)
      setPhase('showing')
      // Start polling after a short delay
      const interval = Math.max(resp.interval || 5, 3) * 1000
      const poll = async () => {
        if (cancelledRef.current) return
        try {
          const result = await gw.request<PollResult>('auth.oidc.poll', {
            device_code: resp.device_code,
          })
          if (cancelledRef.current) return

          if (result.status === 'pending') {
            setPhase('polling')
            pollTimerRef.current = setTimeout(poll, interval)
          } else if (result.status === 'success') {
            stopPolling()
            if (result.user) {
              setUser(result.user)
            }
            setPhase('success')
            setTimeout(onComplete, 1000)
          } else if (result.status === 'expired') {
            stopPolling()
            setPhase('expired')
          } else {
            stopPolling()
            setErrorMsg(result.error || 'Authentication failed')
            setPhase('error')
          }
        } catch (err) {
          if (cancelledRef.current) return
          stopPolling()
          setErrorMsg(err instanceof Error ? err.message : String(err))
          setPhase('error')
        }
      }
      // Initial poll after showing the code
      pollTimerRef.current = setTimeout(poll, interval)
    } catch (err) {
      if (cancelledRef.current) return
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [gw, onComplete, stopPolling])

  // Start device flow on mount
  useEffect(() => {
    cancelledRef.current = false
    void startDeviceFlow()
    return () => {
      cancelledRef.current = true
      stopPolling()
      // Cancel the device flow on unmount if still in flight
      if (deviceCode?.device_code) {
        void gw.request('auth.oidc.cancel', { device_code: deviceCode.device_code }).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle input
  useInput((input, key) => {
    if (isTerminalFocusEvent(input)) return

    if (key.escape) {
      stopPolling()
      cancelledRef.current = true
      if (deviceCode?.device_code) {
        void gw.request('auth.oidc.cancel', { device_code: deviceCode.device_code }).catch(() => {})
      }
      onCancel()
      return
    }

    // Retry on expired/error
    if ((phase === 'expired' || phase === 'error') && key.return) {
      void startDeviceFlow()
    }

    // Continue on success (Enter)
    if (phase === 'success' && key.return) {
      onComplete()
    }
  })

  // ── Render ────────────────────────────────────────────────────────

  const banner = (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>⚡ OpenDrSai </Text>
        <Text color={theme.accent}>· OIDC Login</Text>
      </Box>
    </Box>
  )

  if (phase === 'starting') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.warn}>○ Starting device login flow…</Text>
        </Box>
      </Box>
    )
  }

  if (phase === 'showing' || phase === 'polling') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent} bold>Open this URL in your browser:</Text>
          <Box marginTop={1}>
            <Text color={theme.good} bold>
              {deviceCode?.verification_uri_complete || deviceCode?.verification_uri}
            </Text>
          </Box>
          {deviceCode?.verification_uri_complete && deviceCode.verification_uri && (
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.muted} dimColor>Or visit:</Text>
              <Text color={theme.muted}>  {deviceCode.verification_uri}</Text>
              <Text color={theme.muted} dimColor>and enter code:</Text>
              <Box>
                <Text color={theme.accent} bold>  {deviceCode.user_code}</Text>
              </Box>
            </Box>
          )}
          {!deviceCode?.verification_uri_complete && (
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.muted} dimColor>Then enter the code:</Text>
              <Box>
                <Text color={theme.accent} bold>  {deviceCode?.user_code}</Text>
              </Box>
            </Box>
          )}
        </Box>
        <Box marginTop={2}>
          {phase === 'polling' ? (
            <Text color={theme.warn}>○ Waiting for authentication…</Text>
          ) : (
            <Text color={theme.muted} dimColor>Waiting for authentication…</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>Esc: cancel</Text>
        </Box>
      </Box>
    )
  }

  if (phase === 'success') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.good}>✓ Login successful!</Text>
        </Box>
        {user && (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.text}>  User: {user.name || user.user_id}</Text>
            {user.email && <Text color={theme.muted}>  Email: {user.email}</Text>}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>Enter to continue</Text>
        </Box>
      </Box>
    )
  }

  if (phase === 'expired') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.warn}>⚠ Device code expired.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>Enter to retry · Esc to cancel</Text>
        </Box>
      </Box>
    )
  }

  // phase === 'error'
  return (
    <Box flexDirection="column" paddingX={1}>
      {banner}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.error}>✗ Login failed: {errorMsg}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>Enter to retry · Esc to cancel</Text>
      </Box>
    </Box>
  )
}
