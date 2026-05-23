/**
 * App — startup orchestration:
 *   1. Spawn gateway via GatewayClient (entry already constructs it)
 *   2. Wait for gateway.ready
 *   3. Resolve current session (cwd-bound; create if none)
 *   4. session.resume → loads agent (slow first time; shows spinner)
 *   5. Subscribe gateway events → store mutations
 *   6. Render AppLayout
 */

import { useStore } from '@nanostores/react'
import { Box, Text, useApp, useInput } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createGatewayEventHandler } from './app/createGatewayEventHandler.js'
import { TurnController } from './app/turnController.js'
import { $current, $transcript } from './app/turnStore.js'
import { $connectionError, $connectionStatus, $userId } from './app/uiStore.js'
import { AppLayout } from './components/appLayout.js'
import { SetupScreen } from './components/setupScreen.js'
import type { GatewayClient } from './gatewayClient.js'
import type { SessionCreateResult, SessionInfo, SessionListResult, SessionResumeResult } from './gatewayTypes.js'
import { theme } from './theme.js'

interface AppProps {
  gw: GatewayClient
}

type Bootstrap =
  | { phase: 'connecting' }
  | { phase: 'setup'; configExists: boolean }
  | { phase: 'resuming'; session: SessionInfo }
  | { phase: 'ready'; sessionId: string; controller: TurnController }
  | { phase: 'error'; message: string }

export function App({ gw }: AppProps) {
  const { exit } = useApp()
  const [boot, setBoot] = useState<Bootstrap>({ phase: 'connecting' })

  // Ref so the SetupScreen can trigger the post-setup boot path without
  // needing the App's effect to re-run (which would recreate the controller).
  const setupCompleteHandlerRef = useRef<(() => Promise<void>) | null>(null)

  // Hard-exit on Ctrl+D so the user can always escape even if the UI is wedged.
  useInput((_input, key) => {
    if (key.ctrl && _input === 'd') {
      gw.kill()
      exit()
    }
  })

  // Switch the UI to a different session (used by /new and /switch).
  // Resets the transcript + streaming state and re-resumes the agent for sid.
  const switchSession = useCallback(
    async (sid: string) => {
      try {
        // Clear the in-memory transcript so the new session starts fresh in
        // the UI. (The DB-side history for the OLD session is untouched.)
        $transcript.set([])
        $current.set(null)
        const result = await gw.request<SessionResumeResult>('session.resume', {
          session_id: sid,
        })
        const userId = (result as { user_id?: string }).user_id || $userId.get()
        if (userId) $userId.set(userId)
        setBoot(prev =>
          prev.phase === 'ready'
            ? { ...prev, sessionId: result.session.session_id }
            : prev,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setBoot({ phase: 'error', message: msg })
      }
    },
    [gw],
  )

  useEffect(() => {
    let cancelled = false

    // Create the controller up-front so the event handler can call
    // controller.finalize() when message.complete arrives. (prompt.submit
    // returns immediately now; the end-of-turn is event-driven.)
    const controller = new TurnController(gw)

    // Wire events first so we don't miss anything (session.info etc.)
    const handler = createGatewayEventHandler(gw, controller)
    const unsub = gw.onAny(handler)

    // Capture setup status from gateway.ready before deciding to boot.
    // Stored in a closure so the async block below can read it.
    interface SetupSnapshot {
      setup_required?: boolean
      config_exists?: boolean
    }
    let setupStatus: SetupSnapshot | null = null
    const unsubSetup = gw.onEvent('gateway.ready', ev => {
      const p = ev.payload as { setup?: SetupSnapshot } | undefined
      if (p?.setup) setupStatus = p.setup
    })

    // Resolve session + ready phase. Reusable so SetupScreen.onComplete can
    // re-run it after the user enters credentials.
    async function resolveSession() {
      // Resolve session: most_recent for current cwd → create new (named after cwd)
      // Do NOT fall back to list[0] — that would grab some random old session
      // from an unrelated workdir.
      let session: SessionInfo | null = null
      const recent = await gw.request<{ session: SessionInfo | null; user_id?: string }>(
        'session.most_recent',
        {},
      )
      if (recent.user_id) $userId.set(recent.user_id)
      if (recent.session) {
        session = recent.session
      }
      if (!session) {
        const created = await gw.request<SessionCreateResult>('session.create', {
          name: process.env.DRSAI_SESSION_NAME || undefined,
        })
        session = created.session
        if (created.user_id) $userId.set(created.user_id)
      }

      if (cancelled) return
      setBoot({ phase: 'resuming', session })

      const result = await gw.request<SessionResumeResult>('session.resume', {
        session_id: session.session_id,
      })
      if (cancelled) return
      const userId = (result as { user_id?: string }).user_id || $userId.get()
      if (userId) $userId.set(userId)

      setBoot({ phase: 'ready', sessionId: result.session.session_id, controller })
    }

    // Stash on the App's closure so SetupScreen can trigger it after save.
    setupCompleteHandlerRef.current = async () => {
      try {
        await resolveSession()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setBoot({ phase: 'error', message: msg })
      }
    }

    void (async () => {
      try {
        await gw.ready_()
        // The gateway.ready handler above has now run (synchronously, before
        // ready_ resolves), so setupStatus is populated if the gateway sent it.
        unsubSetup()
        if (cancelled) return

        // First-run or missing-API-key → drop into the interactive setup
        // screen. SetupScreen.onComplete will call our resolveSession later.
        const captured = setupStatus as SetupSnapshot | null
        if (captured?.setup_required) {
          setBoot({
            phase: 'setup',
            configExists: !!captured.config_exists,
          })
          return
        }

        await resolveSession()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!cancelled) setBoot({ phase: 'error', message: msg })
      }
    })()

    return () => {
      cancelled = true
      unsub()
    }
  }, [gw])

  if (boot.phase === 'connecting') {
    return <BootScreen text="connecting to gateway…" />
  }
  if (boot.phase === 'resuming') {
    return (
      <BootScreen
        text={`resuming session ${boot.session.name} (${boot.session.session_id.slice(0, 8)})… first run can take ~30-60s for skill loading`}
      />
    )
  }
  if (boot.phase === 'setup') {
    return (
      <SetupScreen
        gw={gw}
        configExists={boot.configExists}
        onComplete={() => {
          setBoot({ phase: 'connecting' })
          void setupCompleteHandlerRef.current?.()
        }}
      />
    )
  }
  if (boot.phase === 'error') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.error}>✗ Failed to start: {boot.message}</Text>
        <Text color={theme.muted} dimColor>press Ctrl+D to exit</Text>
      </Box>
    )
  }

  return <AppLayout gw={gw} controller={boot.controller} sessionId={boot.sessionId} switchSession={switchSession} />
}

function BootScreen({ text }: { text: string }) {
  const conn = useStore($connectionStatus)
  const err = useStore($connectionError)
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={theme.primary} bold>⚡ DrSai </Text>
        <Text color={theme.muted} dimColor>· starting</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.warn}>○ </Text>
        <Text color={theme.text}>{text}</Text>
      </Box>
      {err && (
        <Box marginTop={1}>
          <Text color={theme.error}>{err}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>status: {conn}</Text>
      </Box>
    </Box>
  )
}
